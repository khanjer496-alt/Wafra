#!/usr/bin/env python3
"""Candidate semantic models for the Wafra local parser benchmark.

Every model exposes the same contract:

    fit(train_rows, val_rows) -> None
    predict_proba(texts)      -> np.ndarray[float32] of shape (n, len(labels))
    labels                    -> tuple[str, ...]   (English intent names)
    size_bytes()              -> int               deployable artifact size
    describe()                -> dict              config actually used

All fitting and all hyperparameter selection happens on the MSA+PAL train/val
splits.  No model ever sees a dialect test set during fitting.
"""

from __future__ import annotations

import io
import json
import math
import os
import pickle
import random
import time
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn as nn


# Spelling variants that dialects disagree on but that carry no meaning here.
# Folding them was chosen on the MSA<->PAL transfer proxy in
# dialect_shift_dev.py, never on a sealed dialect split.
_ORTHOGRAPHIC_FOLD = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ى": "ي", "ئ": "ي",
    "ة": "ه",
    "ؤ": "و",
    "گ": "ك", "چ": "ج", "پ": "ب", "ڤ": "ف",
})


def fold_orthography(text: str) -> str:
    return text.translate(_ORTHOGRAPHIC_FOLD)


def augment_spelling(text: str, rng: random.Random, rate: float) -> str:
    """Character noise standing in for unseen dialectal spelling.

    Drops, doubles or transposes characters.  It invents no vocabulary, so it
    can only buy tolerance to spelling drift -- never to unseen synonyms.
    """
    out: list[str] = []
    for ch in text:
        roll = rng.random()
        if roll < rate / 3:
            continue
        if roll < 2 * rate / 3:
            out.append(ch)
        out.append(ch)
    if len(out) > 3 and rng.random() < rate:
        i = rng.randrange(len(out) - 1)
        out[i], out[i + 1] = out[i + 1], out[i]
    return "".join(out)


def set_all_seeds(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


# --------------------------------------------------------------------------
# 1. Character n-gram linear baseline
# --------------------------------------------------------------------------


class CharNGramLinear:
    """TF-IDF character n-grams + multinomial logistic regression.

    The cheap, fully interpretable baseline.  Ships as a sparse weight matrix
    and a vocabulary, so it is the only candidate that is unambiguously small
    enough for a phone today.
    """

    name = "char-ngram-linear"

    def __init__(
        self,
        *,
        ngram_range: tuple[int, int] = (2, 5),
        min_df: int = 2,
        max_features: int = 300_000,
        C: float = 4.0,
        sublinear_tf: bool = True,
        fold_orthography: bool = False,
        augment_copies: int = 0,
        augment_rate: float = 0.08,
        seed: int = 20260920,
    ) -> None:
        self.cfg = {
            "ngram_range": list(ngram_range),
            "min_df": min_df,
            "max_features": max_features,
            "C": C,
            "sublinear_tf": sublinear_tf,
            "analyzer": "char_wb",
            "fold_orthography": fold_orthography,
            "augment_copies": augment_copies,
            "augment_rate": augment_rate,
            "seed": seed,
        }
        self.seed = seed
        self._vec = None
        self._clf = None
        self.labels: tuple[str, ...] = ()

    def fit(self, train_rows, val_rows=None) -> None:  # noqa: ARG002 - val unused here
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.linear_model import LogisticRegression

        set_all_seeds(self.seed)
        texts = [self._prepare(r.text) for r in train_rows]
        y_names = [r.intent_en for r in train_rows]
        if self.cfg["augment_copies"]:
            rng = random.Random(self.seed)
            base = list(texts)
            for _ in range(self.cfg["augment_copies"]):
                texts.extend(
                    augment_spelling(t, rng, self.cfg["augment_rate"]) for t in base
                )
                y_names = y_names + [r.intent_en for r in train_rows]
        self.labels = tuple(sorted({r.intent_en for r in train_rows}))
        index = {name: i for i, name in enumerate(self.labels)}
        y = np.array([index[name] for name in y_names])

        self._vec = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=tuple(self.cfg["ngram_range"]),
            min_df=self.cfg["min_df"],
            max_features=self.cfg["max_features"],
            sublinear_tf=self.cfg["sublinear_tf"],
        )
        X = self._vec.fit_transform(texts)
        self._clf = LogisticRegression(
            C=self.cfg["C"],
            max_iter=2000,
            random_state=self.seed,
        )
        self._clf.fit(X, y)

    def _prepare(self, text: str) -> str:
        return fold_orthography(text) if self.cfg["fold_orthography"] else text

    def predict_proba(self, texts: list[str]) -> np.ndarray:
        X = self._vec.transform([self._prepare(t) for t in texts])
        return self._clf.predict_proba(X).astype(np.float32)

    def size_bytes(self) -> int:
        buf = io.BytesIO()
        pickle.dump({"vec": self._vec, "clf": self._clf}, buf, protocol=5)
        return buf.tell()

    def deployable_bytes(self) -> dict:
        """Size of what would actually ship, not the pickle overhead."""
        vocab = self._vec.vocabulary_
        vocab_bytes = sum(len(k.encode("utf-8")) + 4 for k in vocab)
        coef = self._clf.coef_
        return {
            "pickle_bytes": self.size_bytes(),
            "vocab_terms": len(vocab),
            "vocab_bytes": vocab_bytes,
            "coef_float32_bytes": coef.size * 4,
            "coef_int8_bytes": coef.size + coef.shape[0] * 4,
            "estimated_float32_total": vocab_bytes + coef.size * 4 + len(vocab) * 4,
            "estimated_int8_total": vocab_bytes + coef.size + len(vocab) * 4,
        }

    def describe(self) -> dict:
        return {"model": self.name, **self.cfg, "n_labels": len(self.labels)}


class CharNGramCentroid:
    """Nearest-centroid prototype scorer over the same TF-IDF space."""

    name = "char-ngram-centroid"

    def __init__(self, *, ngram_range=(2, 5), min_df=2, max_features=300_000, seed=20260920):
        self.cfg = {
            "ngram_range": list(ngram_range),
            "min_df": min_df,
            "max_features": max_features,
            "analyzer": "char_wb",
            "seed": seed,
        }
        self.seed = seed
        self._vec = None
        self._centroids = None
        self.labels: tuple[str, ...] = ()

    def fit(self, train_rows, val_rows=None) -> None:  # noqa: ARG002
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.preprocessing import normalize

        set_all_seeds(self.seed)
        texts = [r.text for r in train_rows]
        y_names = [r.intent_en for r in train_rows]
        self.labels = tuple(sorted(set(y_names)))
        index = {name: i for i, name in enumerate(self.labels)}

        self._vec = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=tuple(self.cfg["ngram_range"]),
            min_df=self.cfg["min_df"],
            max_features=self.cfg["max_features"],
            sublinear_tf=True,
        )
        X = self._vec.fit_transform(texts)
        cent = np.zeros((len(self.labels), X.shape[1]), dtype=np.float32)
        counts = np.zeros(len(self.labels), dtype=np.float32)
        Xa = X.toarray() if X.shape[1] < 20000 else None
        if Xa is None:
            for i, name in enumerate(y_names):
                cent[index[name]] += np.asarray(X[i].todense(), dtype=np.float32).ravel()
                counts[index[name]] += 1
        else:
            for i, name in enumerate(y_names):
                cent[index[name]] += Xa[i]
                counts[index[name]] += 1
        cent /= np.maximum(counts, 1)[:, None]
        self._centroids = normalize(cent).astype(np.float32)

    def predict_proba(self, texts: list[str]) -> np.ndarray:
        from sklearn.preprocessing import normalize

        X = normalize(self._vec.transform(texts))
        sims = (X @ self._centroids.T).astype(np.float32)
        sims = np.asarray(sims)
        # temperature-scaled softmax over cosine similarity
        logits = sims * 12.0
        logits -= logits.max(axis=1, keepdims=True)
        exp = np.exp(logits)
        return (exp / exp.sum(axis=1, keepdims=True)).astype(np.float32)

    def size_bytes(self) -> int:
        buf = io.BytesIO()
        pickle.dump({"vec": self._vec, "cent": self._centroids}, buf, protocol=5)
        return buf.tell()

    def describe(self) -> dict:
        return {"model": self.name, **self.cfg, "n_labels": len(self.labels)}


# --------------------------------------------------------------------------
# 2. Small byte/character neural classifier
# --------------------------------------------------------------------------


@dataclass
class CharCNNConfig:
    max_len: int = 128
    embed_dim: int = 64
    channels: int = 192
    kernel_sizes: tuple[int, ...] = (2, 3, 4, 5)
    hidden: int = 256
    dropout: float = 0.3
    lr: float = 2e-3
    weight_decay: float = 1e-5
    epochs: int = 30
    batch_size: int = 64
    label_smoothing: float = 0.05
    seed: int = 20260920


class ByteCharCNN:
    """Small from-scratch character CNN over the normalized UTF-8 string.

    Vocabulary is built from training characters only; unseen characters map to
    a shared UNK id so a novel dialect's orthography degrades instead of
    crashing.
    """

    name = "byte-char-cnn"

    def __init__(self, cfg: CharCNNConfig | None = None) -> None:
        self.cfg = cfg or CharCNNConfig()
        self.labels: tuple[str, ...] = ()
        self._char2id: dict[str, int] = {}
        self._model = None
        self._best_val = None

    # -- encoding ---------------------------------------------------------
    def _encode(self, text: str) -> list[int]:
        ids = [self._char2id.get(ch, 1) for ch in text[: self.cfg.max_len]]
        if len(ids) < self.cfg.max_len:
            ids += [0] * (self.cfg.max_len - len(ids))
        return ids

    def _batch(self, texts: list[str]):
        return torch.tensor([self._encode(t) for t in texts], dtype=torch.long)

    # -- fit --------------------------------------------------------------
    def fit(self, train_rows, val_rows) -> None:
        set_all_seeds(self.cfg.seed)
        chars = sorted({ch for r in train_rows for ch in r.text})
        self._char2id = {ch: i + 2 for i, ch in enumerate(chars)}  # 0 pad, 1 unk
        self.labels = tuple(sorted({r.intent_en for r in train_rows}))
        index = {name: i for i, name in enumerate(self.labels)}

        Xtr = self._batch([r.text for r in train_rows])
        ytr = torch.tensor([index[r.intent_en] for r in train_rows], dtype=torch.long)
        Xva = self._batch([r.text for r in val_rows])
        yva = torch.tensor([index[r.intent_en] for r in val_rows], dtype=torch.long)

        model = _CharCNNModule(
            vocab=len(self._char2id) + 2, n_labels=len(self.labels), cfg=self.cfg
        )
        opt = torch.optim.AdamW(
            model.parameters(), lr=self.cfg.lr, weight_decay=self.cfg.weight_decay
        )
        steps = math.ceil(len(train_rows) / self.cfg.batch_size) * self.cfg.epochs
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=self.cfg.lr, total_steps=steps)
        loss_fn = nn.CrossEntropyLoss(label_smoothing=self.cfg.label_smoothing)

        best_acc, best_state, history = -1.0, None, []
        generator = torch.Generator().manual_seed(self.cfg.seed)
        for epoch in range(self.cfg.epochs):
            model.train()
            perm = torch.randperm(len(ytr), generator=generator)
            total = 0.0
            for start in range(0, len(perm), self.cfg.batch_size):
                idx = perm[start : start + self.cfg.batch_size]
                opt.zero_grad()
                logits = model(Xtr[idx])
                loss = loss_fn(logits, ytr[idx])
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                sched.step()
                total += float(loss.detach()) * len(idx)
            model.eval()
            with torch.inference_mode():
                preds = []
                for start in range(0, len(yva), 256):
                    preds.append(model(Xva[start : start + 256]).argmax(dim=-1))
                acc = float((torch.cat(preds) == yva).float().mean())
            history.append({"epoch": epoch, "train_loss": total / len(ytr), "val_acc": acc})
            if acc > best_acc:
                best_acc = acc
                best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}

        model.load_state_dict(best_state)
        model.eval()
        self._model = model
        self._best_val = best_acc
        self._history = history

    def predict_proba(self, texts: list[str]) -> np.ndarray:
        out = []
        with torch.inference_mode():
            for start in range(0, len(texts), 256):
                batch = self._batch(texts[start : start + 256])
                out.append(torch.softmax(self._model(batch), dim=-1).numpy())
        return np.concatenate(out).astype(np.float32)

    def parameter_count(self) -> int:
        return sum(p.numel() for p in self._model.parameters())

    def size_bytes(self) -> int:
        buf = io.BytesIO()
        torch.save(self._model.state_dict(), buf)
        return buf.tell()

    def describe(self) -> dict:
        cfg = dict(self.cfg.__dict__)
        cfg["kernel_sizes"] = list(cfg["kernel_sizes"])
        return {
            "model": self.name,
            **cfg,
            "n_labels": len(self.labels),
            "char_vocab": len(self._char2id) + 2,
            "parameters": self.parameter_count(),
            "best_val_intent_accuracy": self._best_val,
        }


class _CharCNNModule(nn.Module):
    def __init__(self, vocab: int, n_labels: int, cfg: CharCNNConfig) -> None:
        super().__init__()
        self.embed = nn.Embedding(vocab, cfg.embed_dim, padding_idx=0)
        self.convs = nn.ModuleList(
            [nn.Conv1d(cfg.embed_dim, cfg.channels, k, padding=k // 2) for k in cfg.kernel_sizes]
        )
        self.norm = nn.LayerNorm(cfg.channels * len(cfg.kernel_sizes))
        self.drop = nn.Dropout(cfg.dropout)
        self.fc1 = nn.Linear(cfg.channels * len(cfg.kernel_sizes), cfg.hidden)
        self.fc2 = nn.Linear(cfg.hidden, n_labels)
        self.act = nn.GELU()

    def forward(self, ids):
        mask = (ids != 0).unsqueeze(1)
        x = self.embed(ids).transpose(1, 2)
        length = ids.shape[1]
        feats = []
        for conv in self.convs:
            # even kernels with padding=k//2 emit L+1 steps; crop back to L so
            # the pad mask lines up.
            h = self.act(conv(x))[:, :, :length]
            h = h.masked_fill(~mask, -1e4)
            feats.append(h.max(dim=-1).values)
        h = torch.cat(feats, dim=-1)
        h = self.drop(self.norm(h))
        return self.fc2(self.drop(self.act(self.fc1(h))))
