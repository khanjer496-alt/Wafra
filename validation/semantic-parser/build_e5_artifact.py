#!/usr/bin/env python3
"""Build a real shippable int8 artifact from multilingual-e5-small.

Not an estimate. This fine-tunes the encoder on the ArBanking77 MSA+PAL
training data, prunes the vocabulary, quantizes both the Linear layers and the
embedding to int8, writes the artifact, and then evaluates *that artifact* on
the sealed dialect sets. The accuracy reported is the quantized, pruned model's
accuracy, because that is the thing that would ship.

Why the vocabulary is the whole story: e5-small is 117.7M parameters and 81.6%
of them are the 250k multilingual embedding. torch dynamic quantization
converts nn.Linear only, so it leaves 384 MB untouched. Pruning to the tokens
an Arabic banking app actually sees, and quantizing what remains, is what makes
the model a plausible mobile artifact.

The vocabulary is built from the **fitting splits only**. Tokens that appear
only in a dialect test set fall back to UNK, which is exactly what happens on a
phone when a new market uses a word the shipped vocabulary never saw. Measuring
that cost is the point, so it must not be engineered away by peeking.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HOME", "/home/user/.hfcache")

import metrics as metrics_mod  # noqa: E402
from arb_data import dataset_provenance, load_split, split_digest  # noqa: E402
from models import set_all_seeds  # noqa: E402
from wafra_taxonomy import (  # noqa: E402
    HIGH_RISK_INTENTS,
    INTENT_PROJECTION,
    MAPPING_VERSION,
    project,
)

HERE = Path(__file__).parent
RESULTS = HERE / "results"
ARTIFACTS = HERE / "artifacts"
EVAL_SPLITS = ("msa", "pal", "saudi", "moroccan", "tunisian")
SEED = 20260920
MODEL_ID = "intfloat/multilingual-e5-small"


class QuantizedEmbedding(nn.Module):
    """int8 embedding with a per-row scale.

    nn.Embedding has no dynamic-quantization path in torch, and for this model
    the embedding *is* the artifact, so it gets quantized by hand: one scale per
    token row, codes stored as int8, dequantized on lookup.
    """

    def __init__(self, weight: torch.Tensor, padding_idx: int | None = None) -> None:
        super().__init__()
        scale = weight.abs().amax(dim=1, keepdim=True).clamp(min=1e-8) / 127.0
        codes = torch.round(weight / scale).clamp(-127, 127).to(torch.int8)
        self.register_buffer("codes", codes)
        self.register_buffer("scale", scale.to(torch.float32))
        self.padding_idx = padding_idx

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        gathered = self.codes[ids].to(torch.float32)
        return gathered * self.scale[ids]


def artifact_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


class E5Classifier(nn.Module):
    def __init__(self, encoder, hidden: int, n_labels: int) -> None:
        super().__init__()
        self.encoder = encoder
        self.head = nn.Linear(hidden, n_labels)

    def forward(self, **enc):
        out = self.encoder(**enc).last_hidden_state
        mask = enc["attention_mask"].unsqueeze(-1).float()
        pooled = (out * mask).sum(1) / mask.sum(1).clamp(min=1e-6)
        return self.head(pooled)


def build_pruned_vocab(tok, rows, extra_ids: set[int]) -> tuple[list[int], dict[int, int]]:
    """Token ids worth keeping, from the fitting splits only."""
    keep: set[int] = set(extra_ids)
    for row in rows:
        keep.update(tok(row.text, add_special_tokens=True)["input_ids"])
    ordered = sorted(keep)
    return ordered, {old: new for new, old in enumerate(ordered)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--max-len", type=int, default=64)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--head-lr", type=float, default=1e-3)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--tag", default="v1")
    parser.add_argument("--limit", type=int, default=0,
                        help="smoke test on a slice of every split; never use for a result")
    args = parser.parse_args()

    from transformers import AutoModel, AutoTokenizer

    torch.set_num_threads(args.threads)
    set_all_seeds(SEED)

    train = load_split("train", purpose="train")
    val = load_split("val", purpose="train")
    tests = {name: load_split(name, purpose="evaluate") for name in EVAL_SPLITS}
    if args.limit:
        print(f"SMOKE TEST: {args.limit} rows per split -- results are not valid", flush=True)
        train, val = train[: args.limit], val[: args.limit]
        tests = {k: v[: args.limit] for k, v in tests.items()}

    tok = AutoTokenizer.from_pretrained(MODEL_ID)
    encoder = AutoModel.from_pretrained(MODEL_ID)
    hidden = encoder.config.hidden_size
    # The label space is the taxonomy's 77 intents, not whatever happens to
    # appear in the training rows -- otherwise a smoke-test slice silently
    # changes the head's shape.
    labels = tuple(sorted(INTENT_PROJECTION))
    index = {name: i for i, name in enumerate(labels)}

    # --- prune the vocabulary, fitting splits only ------------------------
    special = {i for i in tok.all_special_ids if i is not None}
    kept_ids, remap = build_pruned_vocab(tok, train + val, special)
    print(f"vocabulary {tok.vocab_size} -> {len(kept_ids)} "
          f"({100 * len(kept_ids) / tok.vocab_size:.1f}% kept)", flush=True)

    unk_id = tok.unk_token_id if tok.unk_token_id is not None else 0
    new_unk = remap.get(unk_id, 0)

    def encode(texts: list[str]) -> dict:
        enc = tok(texts, return_tensors="pt", padding=True, truncation=True,
                  max_length=args.max_len)
        enc["input_ids"] = enc["input_ids"].apply_(lambda i: remap.get(i, new_unk))
        return enc

    word_embeddings = encoder.get_input_embeddings()
    pruned_weight = word_embeddings.weight.data[torch.tensor(kept_ids)].clone()
    new_embedding = nn.Embedding(len(kept_ids), hidden)
    new_embedding.weight.data.copy_(pruned_weight)
    encoder.set_input_embeddings(new_embedding)
    encoder.config.vocab_size = len(kept_ids)

    model = E5Classifier(encoder, hidden, len(labels))

    # The embedding is frozen: it is about to be pruned and quantized, and a
    # dense gradient over it costs more than it buys.
    for param in model.encoder.get_input_embeddings().parameters():
        param.requires_grad = False

    trainable = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(
        [
            {"params": [p for n, p in model.named_parameters()
                        if p.requires_grad and not n.startswith("head")], "lr": args.lr},
            {"params": model.head.parameters(), "lr": args.head_lr},
        ],
        weight_decay=0.01,
    )
    steps = math.ceil(len(train) / args.batch_size) * args.epochs
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=[args.lr, args.head_lr], total_steps=steps, pct_start=0.1)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)

    texts_tr = [r.text for r in train]
    y_tr = torch.tensor([index[r.intent_en] for r in train])
    texts_va = [r.text for r in val]
    y_va = torch.tensor([index[r.intent_en] for r in val])

    def evaluate(texts, y) -> float:
        model.eval()
        hits = 0
        with torch.inference_mode():
            for start in range(0, len(texts), 64):
                pred = model(**encode(texts[start:start + 64])).argmax(-1)
                hits += int((pred == y[start:start + 64]).sum())
        return hits / len(texts)

    history = []
    best, best_state = -1.0, None
    generator = torch.Generator().manual_seed(SEED)
    for epoch in range(args.epochs):
        model.train()
        perm = torch.randperm(len(y_tr), generator=generator)
        started, running = time.time(), 0.0
        for start in range(0, len(perm), args.batch_size):
            idx = perm[start:start + args.batch_size].tolist()
            enc = encode([texts_tr[i] for i in idx])
            opt.zero_grad()
            loss = loss_fn(model(**enc), y_tr[idx])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            opt.step()
            sched.step()
            running += float(loss.detach()) * len(idx)
        acc = evaluate(texts_va, y_va)
        history.append({"epoch": epoch, "train_loss": running / len(y_tr),
                        "val_acc": acc, "seconds": time.time() - started})
        print(f"  epoch {epoch} val_acc={acc:.4f} ({history[-1]['seconds']:.0f}s)", flush=True)
        if acc > best:
            best = acc
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    model.eval()

    # --- quantize ---------------------------------------------------------
    fp32_dir = ARTIFACTS / f"e5-pruned-fp32-{args.tag}"
    int8_dir = ARTIFACTS / f"e5-pruned-int8-{args.tag}"
    for folder in (fp32_dir, int8_dir):
        folder.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), fp32_dir / "model.pt")

    quantized = torch.quantization.quantize_dynamic(model, {nn.Linear}, dtype=torch.qint8)
    current = quantized.encoder.get_input_embeddings()
    quantized.encoder.set_input_embeddings(
        QuantizedEmbedding(current.weight.data, padding_idx=current.padding_idx))
    quantized.eval()
    torch.save(quantized.state_dict(), int8_dir / "model.pt")
    (int8_dir / "vocab.json").write_text(
        json.dumps({"kept_token_ids": kept_ids, "unk": new_unk}), encoding="utf-8")
    (int8_dir / "labels.json").write_text(json.dumps(list(labels)), encoding="utf-8")

    # --- evaluate the artifact that would actually ship -------------------
    def predict(texts: list[str]) -> np.ndarray:
        out = []
        with torch.inference_mode():
            for start in range(0, len(texts), 64):
                logits = quantized(**encode(texts[start:start + 64]))
                out.append(torch.softmax(logits, dim=-1).numpy())
        return np.concatenate(out).astype(np.float32)

    torch.set_num_threads(1)
    warm = [tests["saudi"][i].text for i in range(20)]
    with torch.inference_mode():
        for text in warm[:5]:
            quantized(**encode([text]))
        timings = []
        for text in warm:
            t0 = time.perf_counter()
            quantized(**encode([text]))
            timings.append((time.perf_counter() - t0) * 1000)
    torch.set_num_threads(args.threads)

    splits = {}
    for name, rows in tests.items():
        proba = predict([r.text for r in rows])
        preds = [labels[i] for i in proba.argmax(1)]
        records = []
        for pred, row in zip(preds, rows):
            family, state, direction = project(pred)
            records.append({
                "pred_intent": pred, "true_intent": row.intent_en,
                "pred_family": family, "pred_state": state, "pred_direction": direction,
                "true_family": row.family, "true_state": row.state,
                "true_direction": row.direction,
                "confidence": float(proba[len(records)].max()),
                "high_risk": row.intent_en in HIGH_RISK_INTENTS,
            })
        high_risk = [r for r in records if r["high_risk"]]
        splits[name] = {
            "all": metrics_mod.semantic_report(records),
            "high_risk_subset": metrics_mod.semantic_report(high_risk) if high_risk else None,
            "calibration": metrics_mod.calibration_report(records),
        }
        print(f"  {name:9s} fam={splits[name]['all']['family_accuracy']:.4f} "
              f"state={splits[name]['all']['state_accuracy']:.4f} "
              f"joint={splits[name]['all']['joint_accuracy']:.4f}", flush=True)

    report = {
        "experiment": "e5-small-int8-artifact",
        "tag": args.tag,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model_id": MODEL_ID,
        "seed": SEED,
        "mapping_version": MAPPING_VERSION,
        "config": vars(args),
        "vocabulary": {
            "original": tok.vocab_size,
            "kept": len(kept_ids),
            "kept_share": len(kept_ids) / tok.vocab_size,
            "built_from": "MSA+PAL train and val only",
        },
        "artifact_bytes": {
            "pruned_fp32": artifact_bytes(fp32_dir),
            "pruned_int8": artifact_bytes(int8_dir),
            "pruned_int8_model_only": (int8_dir / "model.pt").stat().st_size,
        },
        "parameters": sum(p.numel() for p in model.parameters()),
        "best_val_intent_accuracy": best,
        "history": history,
        "latency_batch1_cpu": metrics_mod.latency_report(timings),
        "splits": splits,
        "digests": {"train": split_digest(train), "val": split_digest(val),
                    **{k: split_digest(v) for k, v in tests.items()}},
        "dataset": dataset_provenance(),
    }
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"e5-int8-artifact-{args.tag}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=float),
                   encoding="utf-8")
    print(f"\npruned fp32 {report['artifact_bytes']['pruned_fp32']/1e6:.1f} MB | "
          f"pruned int8 {report['artifact_bytes']['pruned_int8']/1e6:.1f} MB")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
