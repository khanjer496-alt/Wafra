#!/usr/bin/env python3
"""Compact pretrained multilingual/Arabic encoders for the benchmark.

The previous research round could not benchmark these at all: that sandbox
could not fetch Hugging Face weights.  This one can, so the numbers here are
real runs, not estimates.

Two usage modes, because they have very different deployment costs:

``frozen``     encoder used as a fixed feature extractor + logistic head.
               Cheap to fit, and the honest lower bound for "what does generic
               pretraining buy us".
``finetune``   full fine-tune of the encoder with a classification head.

Both record the real artifact size and batch-1 CPU latency.
"""

from __future__ import annotations

import io
import math
import os
import time

import numpy as np
import torch
import torch.nn as nn

from models import set_all_seeds

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HOME", "/home/user/.hfcache")


class PretrainedEncoderClassifier:
    """Fine-tuned (or frozen) transformer encoder over the 77 intents."""

    def __init__(
        self,
        model_id: str,
        *,
        mode: str = "finetune",
        max_len: int = 64,
        lr: float = 3e-5,
        head_lr: float = 1e-3,
        epochs: int = 3,
        batch_size: int = 32,
        weight_decay: float = 0.01,
        label_smoothing: float = 0.05,
        seed: int = 20260920,
        threads: int = 4,
    ) -> None:
        if mode not in {"finetune", "frozen"}:
            raise ValueError(mode)
        self.model_id = model_id
        self.mode = mode
        self.cfg = {
            "model_id": model_id,
            "mode": mode,
            "max_len": max_len,
            "lr": lr,
            "head_lr": head_lr,
            "epochs": epochs,
            "batch_size": batch_size,
            "weight_decay": weight_decay,
            "label_smoothing": label_smoothing,
            "seed": seed,
        }
        self.name = f"pretrained-{model_id.split('/')[-1]}-{mode}"
        self.labels: tuple[str, ...] = ()
        self._tok = None
        self._encoder = None
        self._head = None
        self._history: list[dict] = []
        self._best_val: float | None = None
        torch.set_num_threads(threads)

    # -- helpers ----------------------------------------------------------
    def _load_backbone(self):
        from transformers import AutoModel, AutoTokenizer

        self._tok = AutoTokenizer.from_pretrained(self.model_id)
        self._encoder = AutoModel.from_pretrained(self.model_id)
        return self._encoder.config.hidden_size

    def _encode_batch(self, texts: list[str]):
        return self._tok(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=self.cfg["max_len"],
        )

    def _pool(self, enc) -> torch.Tensor:
        out = self._encoder(**enc).last_hidden_state
        mask = enc["attention_mask"].unsqueeze(-1).float()
        return (out * mask).sum(1) / mask.sum(1).clamp(min=1e-6)

    # -- fit --------------------------------------------------------------
    def fit(self, train_rows, val_rows) -> None:
        set_all_seeds(self.cfg["seed"])
        hidden = self._load_backbone()
        self.labels = tuple(sorted({r.intent_en for r in train_rows}))
        index = {name: i for i, name in enumerate(self.labels)}
        self._head = nn.Linear(hidden, len(self.labels))

        if self.mode == "frozen":
            self._fit_frozen(train_rows, val_rows, index)
        else:
            self._fit_finetune(train_rows, val_rows, index)

    def _embed_all(self, texts: list[str], batch: int = 64) -> torch.Tensor:
        self._encoder.eval()
        chunks = []
        with torch.inference_mode():
            for start in range(0, len(texts), batch):
                enc = self._encode_batch(texts[start : start + batch])
                chunks.append(self._pool(enc))
        return torch.cat(chunks)

    def _fit_frozen(self, train_rows, val_rows, index) -> None:
        Xtr = self._embed_all([r.text for r in train_rows])
        Xva = self._embed_all([r.text for r in val_rows])
        ytr = torch.tensor([index[r.intent_en] for r in train_rows])
        yva = torch.tensor([index[r.intent_en] for r in val_rows])

        opt = torch.optim.AdamW(self._head.parameters(), lr=self.cfg["head_lr"], weight_decay=1e-4)
        loss_fn = nn.CrossEntropyLoss(label_smoothing=self.cfg["label_smoothing"])
        best, best_state = -1.0, None
        gen = torch.Generator().manual_seed(self.cfg["seed"])
        for epoch in range(60):
            self._head.train()
            perm = torch.randperm(len(ytr), generator=gen)
            for start in range(0, len(perm), 256):
                idx = perm[start : start + 256]
                opt.zero_grad()
                loss = loss_fn(self._head(Xtr[idx]), ytr[idx])
                loss.backward()
                opt.step()
            self._head.eval()
            with torch.inference_mode():
                acc = float((self._head(Xva).argmax(-1) == yva).float().mean())
            self._history.append({"epoch": epoch, "val_acc": acc})
            if acc > best:
                best = acc
                best_state = {k: v.clone() for k, v in self._head.state_dict().items()}
        self._head.load_state_dict(best_state)
        self._head.eval()
        self._best_val = best

    def _fit_finetune(self, train_rows, val_rows, index) -> None:
        ytr = torch.tensor([index[r.intent_en] for r in train_rows])
        yva = torch.tensor([index[r.intent_en] for r in val_rows])
        texts_tr = [r.text for r in train_rows]
        texts_va = [r.text for r in val_rows]

        params = [
            {"params": self._encoder.parameters(), "lr": self.cfg["lr"]},
            {"params": self._head.parameters(), "lr": self.cfg["head_lr"]},
        ]
        opt = torch.optim.AdamW(params, weight_decay=self.cfg["weight_decay"])
        bs = self.cfg["batch_size"]
        steps = math.ceil(len(ytr) / bs) * self.cfg["epochs"]
        sched = torch.optim.lr_scheduler.OneCycleLR(
            opt, max_lr=[self.cfg["lr"], self.cfg["head_lr"]], total_steps=steps, pct_start=0.1
        )
        loss_fn = nn.CrossEntropyLoss(label_smoothing=self.cfg["label_smoothing"])

        best, best_state = -1.0, None
        gen = torch.Generator().manual_seed(self.cfg["seed"])
        for epoch in range(self.cfg["epochs"]):
            self._encoder.train()
            self._head.train()
            perm = torch.randperm(len(ytr), generator=gen)
            started = time.time()
            running = 0.0
            for step, start in enumerate(range(0, len(perm), bs)):
                idx = perm[start : start + bs].tolist()
                enc = self._encode_batch([texts_tr[i] for i in idx])
                opt.zero_grad()
                logits = self._head(self._pool(enc))
                loss = loss_fn(logits, ytr[idx])
                loss.backward()
                torch.nn.utils.clip_grad_norm_(
                    list(self._encoder.parameters()) + list(self._head.parameters()), 1.0
                )
                opt.step()
                sched.step()
                running += float(loss) * len(idx)
            acc = self._val_accuracy(texts_va, yva)
            self._history.append(
                {
                    "epoch": epoch,
                    "train_loss": running / len(ytr),
                    "val_acc": acc,
                    "seconds": time.time() - started,
                }
            )
            print(f"  [{self.name}] epoch {epoch} val_acc={acc:.4f} "
                  f"({self._history[-1]['seconds']:.0f}s)", flush=True)
            if acc > best:
                best = acc
                best_state = {
                    "encoder": {k: v.detach().clone() for k, v in self._encoder.state_dict().items()},
                    "head": {k: v.detach().clone() for k, v in self._head.state_dict().items()},
                }
        self._encoder.load_state_dict(best_state["encoder"])
        self._head.load_state_dict(best_state["head"])
        self._encoder.eval()
        self._head.eval()
        self._best_val = best

    def _val_accuracy(self, texts: list[str], y: torch.Tensor) -> float:
        self._encoder.eval()
        self._head.eval()
        hits = 0
        with torch.inference_mode():
            for start in range(0, len(texts), 64):
                enc = self._encode_batch(texts[start : start + 64])
                pred = self._head(self._pool(enc)).argmax(-1)
                hits += int((pred == y[start : start + 64]).sum())
        return hits / len(texts)

    # -- inference --------------------------------------------------------
    def predict_proba(self, texts: list[str]) -> np.ndarray:
        self._encoder.eval()
        self._head.eval()
        out = []
        with torch.inference_mode():
            for start in range(0, len(texts), 64):
                enc = self._encode_batch(texts[start : start + 64])
                out.append(torch.softmax(self._head(self._pool(enc)), dim=-1).numpy())
        return np.concatenate(out).astype(np.float32)

    def parameter_count(self) -> int:
        return sum(p.numel() for p in self._encoder.parameters()) + sum(
            p.numel() for p in self._head.parameters()
        )

    def size_bytes(self) -> int:
        buf = io.BytesIO()
        torch.save(
            {"encoder": self._encoder.state_dict(), "head": self._head.state_dict()}, buf
        )
        return buf.tell()

    def describe(self) -> dict:
        return {
            "model": self.name,
            **self.cfg,
            "n_labels": len(self.labels),
            "parameters": self.parameter_count(),
            "hidden_size": self._encoder.config.hidden_size,
            "tokenizer_vocab": self._tok.vocab_size,
            "best_val_intent_accuracy": self._best_val,
            "history": self._history[-6:],
        }
