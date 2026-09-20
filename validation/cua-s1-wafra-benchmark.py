#!/usr/bin/env python3
"""Zero-shot CUA-S1 evaluation on Wafra bank-alert fixtures.

This intentionally does NOT fine-tune CUA-S1. The purpose is to answer a
pre-integration question: does the released form-oriented checkpoint transfer
to Wafra alert semantics or amount disambiguation without task-specific
training?
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
import time
import unicodedata
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

import torch

from cua_s1.model import ChoiceExample, load_checkpoint, parameter_count


FAMILY_VALUES = (
    "purchase",
    "transfer",
    "cash-withdrawal",
    "refund",
    "fee",
    "utility",
    "recurring-payment",
    "statement",
    "balance",
    "authentication",
    "unknown",
)
STATUS_VALUES = ("posted", "failed", "future", "informational", "unknown")
DIRECTION_VALUES = ("debit", "credit", "none")
DECISION_VALUES = ("review", "refuse")

EXPONENTS = {
    "BHD": 3,
    "JOD": 3,
    "KWD": 3,
    "OMR": 3,
    "JPY": 0,
}


def percentile(values: list[float], p: float) -> float:
    if not values:
        return math.nan
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil(p * len(ordered)) - 1))
    return ordered[idx]


def discover_checkpoint(root: Path) -> Path:
    root = root.resolve()
    if root.is_file():
        return root
    if (root / "model.safetensors").is_file() and (root / "config.json").is_file():
        return root
    safes = sorted(root.rglob("*.safetensors"))
    for safe in safes:
        if safe.with_suffix(".json").is_file():
            return safe
    raise FileNotFoundError(
        f"Could not find model.safetensors+config.json or matching *.safetensors/*.json under {root}"
    )


def checkpoint_bytes(checkpoint: Path) -> int:
    if checkpoint.is_dir():
        return sum(p.stat().st_size for p in checkpoint.glob("*") if p.is_file())
    total = checkpoint.stat().st_size
    cfg = checkpoint.with_suffix(".json")
    if cfg.is_file():
        total += cfg.stat().st_size
    return total


class Scorer:
    def __init__(self, checkpoint: Path, device: str) -> None:
        self.device = torch.device(device)
        self.model, self.collator, self.config = load_checkpoint(checkpoint, self.device)
        self.model.eval()

    def score(self, context: str, options: list[str]) -> tuple[int, float, list[float]]:
        example = ChoiceExample(context=context, options=tuple(options), label=0)
        batch = self.collator([example])
        batch = {key: tensor.to(self.device) for key, tensor in batch.items()}
        with torch.inference_mode():
            logits = self.model(batch)
            probs = torch.softmax(logits[0], dim=-1).detach().cpu().tolist()
        idx = max(range(len(probs)), key=probs.__getitem__)
        return idx, float(probs[idx]), [float(value) for value in probs]


def make_context(field: str, body: str) -> str:
    # CUA-S1 truncates context by UTF-8 bytes. Keep the target label first so
    # the benchmark does not accidentally truncate away the thing being asked.
    return f'TASK classify a bank alert\nELEMENT Edit "{field}" value=""\nALERT {body}'


def make_options(field: str, values: tuple[str, ...]) -> list[str]:
    return [f"fill {field}: {value}" for value in values]


def expected_direction(row: dict) -> str | None:
    direction = row["expected"].get("direction")
    if direction in {"debit", "credit", "none"}:
        return direction
    tx_type = row["expected"].get("type")
    if tx_type == "expense":
        return "debit"
    if tx_type == "income":
        return "credit"
    return None


def stable_rotation(row_id: str, task: str, count: int) -> int:
    digest = hashlib.sha256(f"{row_id}:{task}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % count


def rotated(values: tuple[str, ...], shift: int) -> tuple[str, ...]:
    if not values:
        return values
    shift %= len(values)
    return values[shift:] + values[:shift]


def task_eval(scorer: Scorer, rows: list[dict]) -> dict:
    specs = {
        "decision": (DECISION_VALUES, lambda row: row["expected"].get("decision")),
        "status": (STATUS_VALUES, lambda row: row["expected"].get("status")),
        "family": (FAMILY_VALUES, lambda row: row["expected"].get("family")),
        "direction": (DIRECTION_VALUES, expected_direction),
    }
    results: dict[str, dict] = {}
    for task, (base_values, get_expected) in specs.items():
        total = correct = high_conf_wrong = 0
        confidences: list[float] = []
        market = defaultdict(lambda: [0, 0])
        confusion = Counter()
        truncated = 0
        examples = []
        for row in rows:
            expected = get_expected(row)
            if expected not in base_values:
                continue
            # Local AE/SA acceptance rows do not carry a family label. Do not
            # turn missing ground truth into an "unknown" target.
            if task == "family" and row.get("familyGroundTruth") is False:
                continue
            values = rotated(base_values, stable_rotation(row["id"], task, len(base_values)))
            context = make_context(task, row["body"])
            if len(context.encode("utf-8")) > scorer.config["context_tokens"]:
                truncated += 1
            options = make_options(task, values)
            pred_idx, confidence, probs = scorer.score(context, options)
            predicted = values[pred_idx]
            total += 1
            correct += int(predicted == expected)
            confidences.append(confidence)
            market[row["market"]][1] += 1
            market[row["market"]][0] += int(predicted == expected)
            confusion[(expected, predicted)] += 1
            if predicted != expected and confidence >= 0.80:
                high_conf_wrong += 1
            if len(examples) < 12 and predicted != expected:
                ranked = sorted(zip(values, probs), key=lambda item: item[1], reverse=True)[:3]
                examples.append(
                    {
                        "id": row["id"],
                        "market": row["market"],
                        "expected": expected,
                        "predicted": predicted,
                        "confidence": round(confidence, 6),
                        "top3": [[name, round(prob, 6)] for name, prob in ranked],
                    }
                )
        results[task] = {
            "correct": correct,
            "total": total,
            "accuracy": (correct / total) if total else None,
            "meanConfidence": statistics.fmean(confidences) if confidences else None,
            "highConfidenceWrong": high_conf_wrong,
            "contextTruncated": truncated,
            "byMarket": {
                key: {"correct": value[0], "total": value[1], "accuracy": value[0] / value[1]}
                for key, value in sorted(market.items())
            },
            "mostCommonConfusions": [
                {"expected": a, "predicted": b, "count": n}
                for (a, b), n in confusion.most_common(12)
                if a != b
            ],
            "wrongExamples": examples,
        }
    return results


def parse_minor(raw: str, currency: str) -> int | None:
    exp = EXPONENTS.get(currency, 2)
    text = unicodedata.normalize("NFKC", raw)
    text = re.sub(r"[\s\u00a0\u202f]", "", text)
    text = re.sub(r"[^0-9.,]", "", text)
    if not text or not any(ch.isdigit() for ch in text):
        return None
    last_dot = text.rfind(".")
    last_comma = text.rfind(",")
    sep = "." if last_dot > last_comma else "," if last_comma >= 0 else None
    if exp == 0:
        canonical = text.replace(".", "").replace(",", "")
    elif sep:
        tail = len(text) - max(last_dot, last_comma) - 1
        if tail == exp:
            other = "," if sep == "." else "."
            canonical = text.replace(other, "").replace(sep, ".")
        else:
            canonical = text.replace(".", "").replace(",", "")
    else:
        canonical = text
    try:
        value = Decimal(canonical)
    except InvalidOperation:
        return None
    scaled = value * (10**exp)
    if scaled != scaled.to_integral_value():
        return None
    return int(scaled)


AMOUNT_AFTER = re.compile(r"\b([A-Z]{3})\s*([0-9０-９][0-9０-９.,\s\u00a0\u202f]*[0-9０-９])")
AMOUNT_BEFORE = re.compile(r"([0-9０-９][0-9０-９.,\s\u00a0\u202f]*[0-9０-９])\s*([A-Z]{3})\b")


def amount_candidates(body: str) -> list[dict]:
    normalized = unicodedata.normalize("NFKC", body)
    found: list[dict] = []
    seen = set()
    for pattern, reverse in ((AMOUNT_AFTER, False), (AMOUNT_BEFORE, True)):
        for match in pattern.finditer(normalized):
            currency = match.group(2 if reverse else 1)
            raw = match.group(1 if reverse else 2).strip()
            key = (match.start(), match.end(), currency, raw)
            if key in seen:
                continue
            seen.add(key)
            minor = parse_minor(raw, currency)
            if minor is None:
                continue
            left = max(0, match.start() - 34)
            right = min(len(normalized), match.end() + 34)
            snippet = " ".join(normalized[left:right].split())
            found.append(
                {
                    "currency": currency,
                    "minorUnits": minor,
                    "span": [match.start(), match.end()],
                    "snippet": snippet,
                    "raw": normalized[match.start():match.end()],
                }
            )
    found.sort(key=lambda item: item["span"][0])
    return found


def amount_eval(scorer: Scorer, rows: list[dict]) -> dict:
    total = correct = truncated = high_conf_wrong = 0
    confidences: list[float] = []
    examples = []
    candidate_counts = Counter()
    for row in rows:
        expected = row["expected"]
        currency = expected.get("sourceCurrency") or expected.get("currency")
        raw_minor = expected.get("sourceMinorUnits") or expected.get("minorUnits")
        if not currency or raw_minor is None:
            continue
        expected_minor = int(raw_minor)
        candidates = amount_candidates(row["body"])
        candidate_counts[len(candidates)] += 1
        valid_targets = [
            idx for idx, item in enumerate(candidates)
            if item["currency"] == currency and item["minorUnits"] == expected_minor
        ]
        if len(candidates) < 2 or len(valid_targets) != 1:
            continue
        options = [
            f"fill amount candidate: {item['snippet']}"[: scorer.config["option_tokens"]]
            for item in candidates
        ]
        target = valid_targets[0]
        shift = stable_rotation(row["id"], "amount", len(options))
        rotated_options = options[shift:] + options[:shift]
        rotated_target = (target - shift) % len(options)
        context = make_context("posted transaction amount", row["body"])
        if len(context.encode("utf-8")) > scorer.config["context_tokens"]:
            truncated += 1
        pred, confidence, probs = scorer.score(context, rotated_options)
        total += 1
        correct += int(pred == rotated_target)
        confidences.append(confidence)
        if pred != rotated_target and confidence >= 0.80:
            high_conf_wrong += 1
        if len(examples) < 12 and pred != rotated_target:
            examples.append(
                {
                    "id": row["id"],
                    "market": row["market"],
                    "expected": candidates[target],
                    "predicted": candidates[(pred + shift) % len(options)],
                    "confidence": round(confidence, 6),
                    "probabilities": [round(v, 6) for v in probs],
                }
            )
    return {
        "correct": correct,
        "total": total,
        "accuracy": correct / total if total else None,
        "meanConfidence": statistics.fmean(confidences) if confidences else None,
        "highConfidenceWrong": high_conf_wrong,
        "contextTruncated": truncated,
        "candidateCountHistogram": dict(sorted(candidate_counts.items())),
        "wrongExamples": examples,
    }


def latency_eval(scorer: Scorer, row: dict) -> dict:
    values = FAMILY_VALUES
    context = make_context("family", row["body"])
    options = make_options("family", values)
    for _ in range(20):
        scorer.score(context, options)
    timings = []
    for _ in range(250):
        started = time.perf_counter_ns()
        scorer.score(context, options)
        timings.append((time.perf_counter_ns() - started) / 1_000_000.0)
    return {
        "runs": len(timings),
        "medianMs": statistics.median(timings),
        "p95Ms": percentile(timings, 0.95),
        "meanMs": statistics.fmean(timings),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()

    rows = json.loads(args.fixtures.read_text(encoding="utf-8"))
    checkpoint = discover_checkpoint(args.checkpoint)
    scorer = Scorer(checkpoint, args.device)

    report = {
        "benchmark": "wafra-cua-s1-zero-shot-v1",
        "intent": "pre-integration transfer test; no fine-tuning",
        "fixtureCount": len(rows),
        "checkpoint": {
            "path": str(checkpoint),
            "bytes": checkpoint_bytes(checkpoint),
            "parameters": parameter_count(scorer.model),
            "config": scorer.config,
        },
        "classification": task_eval(scorer, rows),
        "amountDisambiguation": amount_eval(scorer, rows),
        "latencyCpuBatch1": latency_eval(scorer, rows[0]),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
