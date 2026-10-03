"""Phase-1 feasibility probe, step 2: fine-tune, export, quantize, predict.

Multi-task model on the vocabulary-pruned multilingual E5-small encoder:
  - token head: BIO tags for AMT, CUR, MER, DATE, BAL, CUE_DEBIT, CUE_CREDIT, CUE_NONPOST
  - sequence heads (mean-pooled): status, family, direction
Trains on the synthetic TRAIN split only, exports ONNX, applies dynamic int8
quantization, and writes predictions FROM THE INT8 ONNX MODEL for the held-out
synthetic test split and the repo-fixture eval set. Also measures latency.

    python train.py --work <scratch>/parser-ai --data <scratch>/parser-ai/synth
"""
import argparse
import json
import math
import os
import random
import time

import numpy as np
import torch
from tokenizers import Tokenizer
from torch import nn
from transformers import AutoModel

SPAN_LABELS = ["AMT", "CUR", "MER", "DATE", "BAL", "CUE_DEBIT", "CUE_CREDIT", "CUE_NONPOST"]
TAGS = ["O"] + [f"{p}-{l}" for l in SPAN_LABELS for p in ("B", "I")]
STATUSES = ["completed", "pending", "declined", "otp", "promo", "informational", "future", "request", "unknown"]
FAMILIES = ["purchase", "refund", "transfer", "salary", "fee", "withdrawal", "card-payment", "bill-payment", "non-posting"]
DIRECTIONS = ["debit", "credit", "none"]
MAX_LEN = 128


class Tagger(nn.Module):
    def __init__(self, path):
        super().__init__()
        self.enc = AutoModel.from_pretrained(path)
        h = self.enc.config.hidden_size
        self.drop = nn.Dropout(0.1)
        self.tok = nn.Linear(h, len(TAGS))
        self.status = nn.Linear(h, len(STATUSES))
        self.family = nn.Linear(h, len(FAMILIES))
        self.direction = nn.Linear(h, len(DIRECTIONS))

    def forward(self, input_ids, attention_mask):
        hs = self.enc(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        m = attention_mask.unsqueeze(-1).to(hs.dtype)
        pooled = (hs * m).sum(1) / m.sum(1).clamp(min=1)
        hs = self.drop(hs)
        pooled = self.drop(pooled)
        return self.tok(hs), self.status(pooled), self.family(pooled), self.direction(pooled)


def load(path):
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def encode(tok, rows, with_labels):
    batch = []
    for r in rows:
        enc = tok.encode(r["body"])
        ids = enc.ids[:MAX_LEN]
        offsets = enc.offsets[:MAX_LEN]
        tags = None
        if with_labels:
            tags = []
            spans = r.get("spans", [])
            prev = None
            for (s, e) in offsets:
                if e <= s:
                    tags.append(-100)
                    prev = None
                    continue
                while s < e and r["body"][s].isspace():
                    s += 1
                hit = next((sp for sp in spans if sp["start"] <= s < sp["end"]), None)
                if hit is None:
                    tags.append(0)
                    prev = None
                else:
                    begin = prev is not hit
                    tags.append(TAGS.index(f"{'B' if begin else 'I'}-{hit['label']}"))
                    prev = hit
        L = r.get("label", {})
        batch.append({
            "ids": ids, "offsets": offsets, "tags": tags,
            "status": STATUSES.index(L["status"]) if with_labels else 0,
            "family": FAMILIES.index(L["family"]) if with_labels else 0,
            "direction": DIRECTIONS.index(L["direction"]) if with_labels else 0,
        })
    return batch


def collate(items, pad_id):
    n = max(len(i["ids"]) for i in items)
    ids = torch.full((len(items), n), pad_id, dtype=torch.long)
    mask = torch.zeros((len(items), n), dtype=torch.long)
    tags = torch.full((len(items), n), -100, dtype=torch.long)
    for k, it in enumerate(items):
        ids[k, : len(it["ids"])] = torch.tensor(it["ids"])
        mask[k, : len(it["ids"])] = 1
        if it["tags"] is not None:
            tags[k, : len(it["tags"])] = torch.tensor(it["tags"])
    heads = {h: torch.tensor([it[h] for it in items]) for h in ("status", "family", "direction")}
    return ids, mask, tags, heads


def decode(body, offsets, tag_ids, tag_probs):
    spans, cur = [], None
    for (s, e), t, p in zip(offsets, tag_ids, tag_probs):
        if e <= s:
            continue
        name = TAGS[t]
        if name == "O":
            cur = None
            continue
        kind, label = name.split("-", 1)
        if cur and cur["label"] == label and (kind == "I" or body[cur["end"]:s].strip() == ""):
            cur["end"] = e
            cur["p"] = min(cur["p"], p)
        else:
            while s < e and body[s].isspace():
                s += 1
            cur = {"label": label, "start": s, "end": e, "p": p}
            spans.append(cur)
    for sp in spans:
        sp["text"] = body[sp["start"]:sp["end"]]
        sp["p"] = round(float(sp["p"]), 4)
    return spans


def softmax(x, axis=-1):
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=8e-5)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--budget-min", type=float, default=40)
    args = ap.parse_args()
    random.seed(13)
    torch.manual_seed(13)
    pruned = os.path.join(args.work, "e5-pruned")
    tok = Tokenizer.from_file(os.path.join(pruned, "tokenizer.json"))
    pad_id = tok.token_to_id("<pad>")
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    train_rows = load(os.path.join(args.data, "train.jsonl"))
    train = encode(tok, train_rows, True)
    model = Tagger(pruned).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = args.epochs * math.ceil(len(train) / args.batch)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / (0.06 * steps)) * max(0.0, (steps - s) / steps))
    ce = nn.CrossEntropyLoss(ignore_index=-100)
    t0 = time.time()
    step = 0
    model.train()
    for epoch in range(args.epochs):
        random.shuffle(train)
        total = 0.0
        for i in range(0, len(train), args.batch):
            ids, mask, tags, heads = collate(train[i : i + args.batch], pad_id)
            ids, mask, tags = ids.to(device), mask.to(device), tags.to(device)
            t, s, f, d = model(ids, mask)
            loss = ce(t.reshape(-1, len(TAGS)), tags.reshape(-1)) + ce(s, heads["status"].to(device)) \
                + ce(f, heads["family"].to(device)) + ce(d, heads["direction"].to(device))
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            step += 1
            total += loss.item()
            if (time.time() - t0) / 60 > args.budget_min:
                break
        print(json.dumps({"epoch": epoch, "loss": round(total / max(1, len(train) / args.batch), 4), "minutes": round((time.time() - t0) / 60, 2)}), flush=True)
        if (time.time() - t0) / 60 > args.budget_min:
            print("budget reached", flush=True)
            break
    train_minutes = (time.time() - t0) / 60

    # ── ONNX export + dynamic int8 quantization ─────────────────────────
    model.eval().to("cpu")
    fp32 = os.path.join(args.work, "tagger.onnx")
    int8 = os.path.join(args.work, "tagger.int8.onnx")
    dummy = collate(encode(tok, train_rows[:2], False), pad_id)
    torch.onnx.export(model, (dummy[0], dummy[1]), fp32, input_names=["input_ids", "attention_mask"],
                      output_names=["tags", "status", "family", "direction"], opset_version=17,
                      dynamic_axes={"input_ids": {0: "b", 1: "t"}, "attention_mask": {0: "b", 1: "t"}, "tags": {0: "b", 1: "t"},
                                    "status": {0: "b"}, "family": {0: "b"}, "direction": {0: "b"}}, dynamo=False)
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(fp32, int8, weight_type=QuantType.QInt8)
    import onnxruntime as ort
    sizes = {"fp32_mb": round(os.path.getsize(fp32) / 1e6, 1), "int8_mb": round(os.path.getsize(int8) / 1e6, 1)}
    os.remove(fp32)
    for extra in os.listdir(args.work):
        if extra.startswith("tagger.onnx"):
            os.remove(os.path.join(args.work, extra))

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    sess = ort.InferenceSession(int8, opts, providers=["CPUExecutionProvider"])

    def predict(rows):
        out = []
        for r in rows:
            item = encode(tok, [r], False)[0]
            ids = np.array([item["ids"]], dtype=np.int64)
            mask = np.ones_like(ids)
            t, s, f, d = sess.run(None, {"input_ids": ids, "attention_mask": mask})
            tp = softmax(t[0])
            sp, fp, dp = softmax(s[0]), softmax(f[0]), softmax(d[0])
            out.append({
                "id": r["id"],
                "status": STATUSES[int(sp.argmax())], "statusP": round(float(sp.max()), 4),
                "family": FAMILIES[int(fp.argmax())], "familyP": round(float(fp.max()), 4),
                "direction": DIRECTIONS[int(dp.argmax())], "directionP": round(float(dp.max()), 4),
                "spans": decode(r["body"], item["offsets"], tp.argmax(-1).tolist(), tp.max(-1).tolist()),
            })
        return out

    results = {"device": str(device), "train_rows": len(train), "steps": step, "train_minutes": round(train_minutes, 2), **sizes,
               "encoder_params": sum(p.numel() for p in model.enc.parameters()), "vocab": tok.get_vocab_size()}
    for name in ["test", "repo"] + (["uae_private"] if os.path.exists(os.path.join(args.data, "uae_private.jsonl")) else []):
        rows = load(os.path.join(args.data, f"{name}.jsonl"))
        t1 = time.time()
        preds = predict(rows)
        results[f"{name}_ms_per_msg"] = round((time.time() - t1) * 1000 / max(1, len(rows)), 2)
        with open(os.path.join(args.work, f"pred-{name}.jsonl"), "w") as fh:
            for p in preds:
                fh.write(json.dumps(p, ensure_ascii=False) + "\n")

    # Single-message latency distribution (1 thread, typical 40-80 token alert).
    sample = load(os.path.join(args.data, "test.jsonl"))[:200]
    lat = []
    for r in sample:
        item = encode(tok, [r], False)[0]
        ids = np.array([item["ids"]], dtype=np.int64)
        t1 = time.perf_counter()
        sess.run(None, {"input_ids": ids, "attention_mask": np.ones_like(ids)})
        lat.append((time.perf_counter() - t1) * 1000)
    lat.sort()
    results["latency_ms_1thread"] = {"p50": round(lat[len(lat) // 2], 2), "p95": round(lat[int(len(lat) * 0.95)], 2)}
    results["mean_tokens"] = round(sum(len(encode(tok, [r], False)[0]["ids"]) for r in sample) / len(sample), 1)
    json.dump(results, open(os.path.join(args.work, "probe-results.json"), "w"), indent=1)
    print(json.dumps(results))


if __name__ == "__main__":
    main()
