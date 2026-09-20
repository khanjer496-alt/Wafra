#!/usr/bin/env python3
"""Research-only domain-adaptation test for CUA-S1 on Wafra alerts."""

from __future__ import annotations

import argparse, hashlib, json, random, statistics, time
from collections import defaultdict
from pathlib import Path

import torch
import torch.nn.functional as F

from cua_s1.model import ChoiceExample, load_checkpoint, parameter_count

FAMILIES = ("purchase","transfer","cash-withdrawal","refund","fee","utility","recurring-payment","statement","balance","authentication","unknown")
STATUSES = ("posted","failed","future","informational","unknown")
DIRECTIONS = ("debit","credit","none")
DECISIONS = ("review","refuse")
SPECS = {
    "decision": DECISIONS,
    "status": STATUSES,
    "family": FAMILIES,
    "direction": DIRECTIONS,
}

def stable_rotation(row_id: str, task: str, count: int) -> int:
    d = hashlib.sha256(f"{row_id}:{task}".encode()).digest()
    return int.from_bytes(d[:4], "big") % count

def rotate(values, shift):
    shift %= len(values)
    return values[shift:] + values[:shift]

def context(task: str, body: str) -> str:
    return f'TASK classify bank alert {task}\nELEMENT Edit "{task}" value=""\nALERT {body}'

def options(task: str, values) -> tuple[str, ...]:
    return tuple(f"fill {task}: {v}" for v in values)

def expected(row: dict, task: str):
    e = row["expected"]
    if task == "direction":
        return e.get("direction")
    return e.get(task)

def examples(rows: list[dict]) -> list[tuple[str, ChoiceExample]]:
    out = []
    for row in rows:
        for task, base in SPECS.items():
            y = expected(row, task)
            if y not in base:
                continue
            shift = stable_rotation(row["id"], task, len(base))
            vals = rotate(base, shift)
            out.append((task, ChoiceExample(
                context=context(task, row["body"]),
                options=options(task, vals),
                label=vals.index(y),
            )))
    return out

def to_device(batch, device):
    return {k: v.to(device) for k,v in batch.items()}

def evaluate(model, collator, tagged, device):
    model.eval()
    stats = defaultdict(lambda: [0,0])
    confs = defaultdict(list)
    with torch.inference_mode():
        for task, ex in tagged:
            batch = to_device(collator([ex]), device)
            logits = model(batch)[0]
            probs = torch.softmax(logits, -1)
            pred = int(probs.argmax().item())
            stats[task][1] += 1
            stats[task][0] += int(pred == ex.label)
            confs[task].append(float(probs[pred].item()))
    result = {}
    total_c = total_n = 0
    for task in SPECS:
        c,n = stats[task]
        total_c += c; total_n += n
        result[task] = {
            "correct": c, "total": n,
            "accuracy": c/n if n else None,
            "meanConfidence": statistics.fmean(confs[task]) if confs[task] else None,
        }
    result["macroTaskAccuracy"] = statistics.fmean(
        v["accuracy"] for k,v in result.items()
        if k != "macroTaskAccuracy" and v["accuracy"] is not None
    )
    result["microAccuracy"] = total_c/total_n if total_n else None
    return result

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=20)
    args = ap.parse_args()

    random.seed(20260920)
    torch.manual_seed(20260920)
    device = torch.device("cpu")
    payload = json.loads(args.data.read_text())
    train_rows = payload["train"]
    val_rows = payload["validation"]
    test_base_rows = payload["testBase"]
    test_stress_rows = payload["testStress"]

    model, collator, config = load_checkpoint(args.checkpoint, device)
    train = examples(train_rows)
    val = examples(val_rows)
    test_base = examples(test_base_rows)
    test_stress = examples(test_stress_rows)

    initial = {
        "validation": evaluate(model, collator, val, device),
        "testBase": evaluate(model, collator, test_base, device),
        "testStress": evaluate(model, collator, test_stress, device),
    }

    optimizer = torch.optim.AdamW(model.parameters(), lr=8e-4, weight_decay=1e-3)
    batch_size = 32
    best_state = None
    best_val = -1.0
    history = []
    started = time.perf_counter()

    for epoch in range(1, args.epochs + 1):
        model.train()
        order = list(range(len(train)))
        random.shuffle(order)
        losses = []
        for start in range(0, len(order), batch_size):
            batch_items = [train[i][1] for i in order[start:start+batch_size]]
            batch = to_device(collator(batch_items), device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(batch)
            loss = F.cross_entropy(logits, batch["labels"])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.item()))
        val_result = evaluate(model, collator, val, device)
        score = val_result["macroTaskAccuracy"]
        history.append({"epoch": epoch, "loss": statistics.fmean(losses), "validationMacro": score})
        if score > best_val:
            best_val = score
            best_state = {k: v.detach().cpu().clone() for k,v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    final = {
        "validation": evaluate(model, collator, val, device),
        "testBase": evaluate(model, collator, test_base, device),
        "testStress": evaluate(model, collator, test_stress, device),
    }
    report = {
        "benchmark": "wafra-cua-s1-domain-adaptation-v1",
        "note": "research-only; synthetic/privacy-safe Wafra fixture benchmark, not production certification",
        "config": config,
        "parameters": parameter_count(model),
        "rows": {k: len(v) for k,v in {
            "train": train_rows, "validation": val_rows, "testBase": test_base_rows, "testStress": test_stress_rows
        }.items()},
        "examples": {k: len(v) for k,v in {
            "train": train, "validation": val, "testBase": test_base, "testStress": test_stress
        }.items()},
        "initial": initial,
        "final": final,
        "bestValidationMacro": best_val,
        "trainingSeconds": time.perf_counter() - started,
        "history": history,
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
