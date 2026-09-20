#!/usr/bin/env python3
"""What each candidate would actually cost to ship, measured not estimated.

Accuracy numbers decide whether a model is good enough. This decides whether
it can go in a phone app at all, which for Wafra is the harder constraint.

Reported per candidate:

``fp32``          the published checkpoint
``int8``          real torch dynamic quantization of the Linear layers,
                  serialized -- not a parameter-count estimate
``tokenizer``     vocabulary files, which for a multilingual sentencepiece
                  model are not a rounding error
``encoder_only``  parameters outside the vocabulary embedding

That last split is the interesting one. A multilingual encoder is mostly
vocabulary: pruning it to the scripts an app actually sees is what makes these
models shippable, and it is what Geotrend already did to mBERT.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import time
from pathlib import Path

import torch
import torch.nn as nn

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HOME", "/home/user/.hfcache")

HERE = Path(__file__).parent
RESULTS = HERE / "results"

CANDIDATES = [
    "intfloat/multilingual-e5-small",
    "Geotrend/distilbert-base-ar-cased",
]


def serialized_bytes(module: nn.Module) -> int:
    buf = io.BytesIO()
    torch.save(module.state_dict(), buf)
    return buf.tell()


VOCAB_FILENAMES = (
    "tokenizer.json", "sentencepiece.bpe.model", "vocab.txt",
    "spiece.model", "vocab.json", "merges.txt", "tokenizer_config.json",
)


def tokenizer_bytes(model_id: str) -> dict:
    """Vocabulary file sizes, read out of the local Hugging Face cache."""
    cache = Path(os.environ.get("HF_HOME", "~/.cache/huggingface")).expanduser() / "hub"
    folder = cache / ("models--" + model_id.replace("/", "--"))
    files: dict[str, int] = {}
    if not folder.is_dir():
        return files
    for name in VOCAB_FILENAMES:
        for path in folder.rglob(name):
            if path.is_file():
                files[name] = path.stat().st_size
                break
    return files


def measure(model_id: str, latency_samples: int = 50) -> dict:
    from transformers import AutoModel, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(model_id)
    model = AutoModel.from_pretrained(model_id).eval()

    total = sum(p.numel() for p in model.parameters())
    embedding = sum(
        p.numel()
        for name, p in model.named_parameters()
        if "embeddings.word_embeddings" in name
    )

    fp32 = serialized_bytes(model)
    quantized = torch.quantization.quantize_dynamic(model, {nn.Linear}, dtype=torch.qint8)
    int8 = serialized_bytes(quantized)

    torch.set_num_threads(1)
    sample = tok("تم خصم مبلغ 320.50 درهم من حسابك", return_tensors="pt")
    with torch.inference_mode():
        for _ in range(5):
            quantized(**sample)
        started = time.perf_counter()
        for _ in range(latency_samples):
            quantized(**sample)
        int8_ms = (time.perf_counter() - started) / latency_samples * 1000
    torch.set_num_threads(4)

    tok_files = tokenizer_bytes(model_id)
    # torch dynamic quantization converts nn.Linear only, so the vocabulary
    # embedding is still fp32 inside `int8`. Separate the two: a multilingual
    # encoder is mostly vocabulary, and that is the part pruning removes.
    embedding_fp32 = embedding * 4
    encoder_int8 = int8 - embedding_fp32
    return {
        "model_id": model_id,
        "parameters": total,
        "vocab_size": tok.vocab_size,
        "embedding_parameters": embedding,
        "embedding_share": embedding / total if total else None,
        "encoder_parameters": total - embedding,
        "fp32_bytes": fp32,
        "int8_bytes": int8,
        "tokenizer_files": tok_files,
        "tokenizer_bytes": sum(tok_files.values()),
        "int8_plus_tokenizer_bytes": int8 + sum(tok_files.values()),
        "embedding_fp32_bytes": embedding_fp32,
        "int8_encoder_only_bytes": encoder_int8,
        # What a vocabulary-pruned, fully int8 build could reach: the encoder
        # plus one byte per retained embedding weight. An estimate, not a
        # measured build -- pruning and re-training are a separate exercise.
        "estimated_pruned_int8_bytes": {
            f"vocab_{size}": encoder_int8 + size * model.config.hidden_size
            for size in (10_000, 20_000, 32_000)
        },
        "batch1_int8_cpu_ms": int8_ms,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", default=",".join(CANDIDATES))
    parser.add_argument("--tag", default="v1")
    args = parser.parse_args()

    rows = []
    for model_id in [m.strip() for m in args.models.split(",") if m.strip()]:
        row = measure(model_id)
        rows.append(row)
        print(
            f"{model_id}\n"
            f"  params {row['parameters']/1e6:6.1f}M "
            f"({row['embedding_share']*100:.1f}% vocabulary)\n"
            f"  fp32 {row['fp32_bytes']/1e6:7.1f} MB | int8 {row['int8_bytes']/1e6:6.1f} MB "
            f"| + tokenizer {row['int8_plus_tokenizer_bytes']/1e6:6.1f} MB\n"
            f"  int8 encoder only {row['int8_encoder_only_bytes']/1e6:6.1f} MB "
            f"(vocabulary is {row['embedding_fp32_bytes']/1e6:.0f} MB of the int8 total)\n"
            f"  pruned-to-20k estimate {row['estimated_pruned_int8_bytes']['vocab_20000']/1e6:5.1f} MB "
            f"| batch-1 {row['batch1_int8_cpu_ms']:.1f} ms",
            flush=True,
        )

    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"artifact-sizes-{args.tag}.json"
    out.write_text(
        json.dumps(
            {
                "experiment": "shippable-artifact-size",
                "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "torch": torch.__version__,
                "note": (
                    "int8 is real torch dynamic quantization of Linear layers, "
                    "serialized. int8_encoder_only_bytes is the floor a "
                    "vocabulary-pruned build could reach, not a measured build."
                ),
                "candidates": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
