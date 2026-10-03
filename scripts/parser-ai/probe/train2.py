"""Phase-2 tagger: word-level multi-task model on the pruned multilingual-E5-small encoder.

Heads (one ONNX graph, one download):
  alert  : per-word BIO tags (AMT CUR MER DATE BAL CUE_DEBIT CUE_CREDIT CUE_NONPOST),
           status / family / direction (mean-pooled)
  ask    : per-word BIO question slots + intent (optional; --ask <dir> with train/dev/test.jsonl)
Words come from words.py (identical to src/lib/ai-alert-words.ts); each word is encoded
separately and its FIRST piece carries the label, so offsets are exact on device.

Calibration: one temperature per head fitted on the DEV split (NLL), stored in the manifest.
Export: ONNX (opset 17) + dynamic int8. Predictions are produced FROM THE INT8 MODEL.

    python train2.py --work <dir> --data <v2 dir> [--ask <ask dir>] [--epochs 3] [--layers 12]
    python train2.py --work <dir> --predict rows.jsonl --out pred.jsonl   (inference only)
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

from words import words

SPAN_LABELS = ["AMT", "CUR", "MER", "DATE", "BAL", "CUE_DEBIT", "CUE_CREDIT", "CUE_NONPOST"]
TAGS = ["O"] + [f"{p}-{l}" for l in SPAN_LABELS for p in ("B", "I")]
STATUSES = ["completed", "pending", "declined", "otp", "promo", "informational", "future", "request", "unknown"]
FAMILIES = ["purchase", "refund", "transfer", "salary", "fee", "withdrawal", "card-payment", "bill-payment", "non-posting"]
DIRECTIONS = ["debit", "credit", "none"]
MAX_TOKENS = 192


def load(path):
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


class Tagger(nn.Module):
    def __init__(self, path, n_qtags=1, n_intents=1, layers=None):
        super().__init__()
        self.enc = AutoModel.from_pretrained(path)
        if layers and layers < len(self.enc.encoder.layer):
            self.enc.encoder.layer = self.enc.encoder.layer[:layers]
            self.enc.config.num_hidden_layers = layers
        h = self.enc.config.hidden_size
        self.drop = nn.Dropout(0.1)
        self.tok = nn.Linear(h, len(TAGS))
        self.status = nn.Linear(h, len(STATUSES))
        self.family = nn.Linear(h, len(FAMILIES))
        self.direction = nn.Linear(h, len(DIRECTIONS))
        self.qtok = nn.Linear(h, n_qtags)
        self.intent = nn.Linear(h, n_intents)

    def forward(self, input_ids, attention_mask):
        hs = self.enc(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
        m = attention_mask.unsqueeze(-1).to(hs.dtype)
        pooled = (hs * m).sum(1) / m.sum(1).clamp(min=1)
        hs, pooled = self.drop(hs), self.drop(pooled)
        return (self.tok(hs), self.status(pooled), self.family(pooled), self.direction(pooled),
                self.qtok(hs), self.intent(pooled))


def encode_words(tok, text, cls_id, sep_id):
    """ids, first-piece index per word, word list (truncated to MAX_TOKENS)."""
    ids, first, ws = [cls_id], [], []
    for (s, e, w) in words(text):
        piece = tok.encode(w, add_special_tokens=False).ids or [tok.token_to_id("<unk>")]
        if len(ids) + len(piece) + 1 > MAX_TOKENS:
            break
        first.append(len(ids))
        ids.extend(piece)
        ws.append((s, e))
    ids.append(sep_id)
    return ids, first, ws


def word_tags(ws, spans, labels, tags):
    out = []
    prev = None
    for (s, e) in ws:
        hit = next((sp for sp in spans if sp["start"] <= s < sp["end"] and sp["label"] in labels), None)
        if hit is None:
            out.append(0)
            prev = None
        else:
            out.append(tags.index(f"{'B' if prev is not hit else 'I'}-{hit['label']}"))
            prev = hit
    return out


def build(tok, rows, kind, qtags=None, intents=None, cls_id=0, sep_id=2):
    items = []
    for r in rows:
        text = r["body"] if kind == "alert" else r["question"]
        ids, first, ws = encode_words(tok, text, cls_id, sep_id)
        tags = [-100] * len(ids)
        item = {"ids": ids, "first": first, "ws": ws, "kind": kind, "id": r["id"]}
        if kind == "alert":
            if "label" in r and r.get("spans") is not None:
                for i, t in zip(first, word_tags(ws, r["spans"], SPAN_LABELS, TAGS)):
                    tags[i] = t
                L = r["label"]
                item.update(status=STATUSES.index(L["status"]), family=FAMILIES.index(L["family"]),
                            direction=DIRECTIONS.index(L["direction"]))
        else:
            if "intent" in r:
                labels = [t.split("-", 1)[1] for t in qtags[1::2]]
                for i, t in zip(first, word_tags(ws, r.get("spans", []), labels, qtags)):
                    tags[i] = t
                item.update(intent=intents.index(r["intent"]))
        item["tags"] = tags
        items.append(item)
    return items


def collate(items, pad_id):
    n = max(len(i["ids"]) for i in items)
    ids = torch.full((len(items), n), pad_id, dtype=torch.long)
    mask = torch.zeros((len(items), n), dtype=torch.long)
    tags = torch.full((len(items), n), -100, dtype=torch.long)
    for k, it in enumerate(items):
        ids[k, : len(it["ids"])] = torch.tensor(it["ids"])
        mask[k, : len(it["ids"])] = 1
        tags[k, : len(it["tags"])] = torch.tensor(it["tags"])
    return ids, mask, tags


def softmax(x, axis=-1):
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


def fit_temperature(logits, labels):
    """Scalar temperature minimising NLL on held-out dev logits."""
    logits = np.asarray(logits, dtype=np.float64)
    labels = np.asarray(labels)
    if len(labels) == 0:
        return 1.0
    best, best_t = 1e9, 1.0
    for t in np.exp(np.linspace(math.log(0.3), math.log(5.0), 60)):
        p = softmax(logits / t)
        nll = -np.log(np.clip(p[np.arange(len(labels)), labels], 1e-12, 1)).mean()
        if nll < best:
            best, best_t = nll, float(t)
    return round(best_t, 4)


def decode(ws, word_tag_ids, word_probs, tags):
    spans, cur = [], None
    for (s, e), t, p in zip(ws, word_tag_ids, word_probs):
        name = tags[t]
        if name == "O":
            cur = None
            continue
        kind, label = name.split("-", 1)
        if cur and cur["label"] == label and kind == "I":
            cur["end"] = e
            cur["p"] = min(cur["p"], p)
        else:
            cur = {"label": label, "start": s, "end": e, "p": p}
            spans.append(cur)
    for sp in spans:
        sp["p"] = round(float(sp["p"]), 4)
    return spans


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--data")
    ap.add_argument("--ask")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=8e-5)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--layers", type=int, default=0)
    ap.add_argument("--budget-min", type=float, default=60)
    ap.add_argument("--max-train", type=int, default=0, help="cap alert train rows (deterministic sample)")
    ap.add_argument("--predict")
    ap.add_argument("--out")
    ap.add_argument("--eval", default="", help="comma list name=path.jsonl to predict after training")
    args = ap.parse_args()
    random.seed(13)
    torch.manual_seed(13)
    pruned = os.path.join(args.work, "e5-pruned")
    tok = Tokenizer.from_file(os.path.join(pruned, "tokenizer.json"))
    pad_id, cls_id, sep_id = tok.token_to_id("<pad>"), tok.token_to_id("<s>"), tok.token_to_id("</s>")
    int8 = os.path.join(args.work, "tagger2.int8.onnx")
    manifest_path = os.path.join(args.work, "tagger2.manifest.json")

    if args.predict:
        manifest = json.load(open(manifest_path))
        predict_file(args, tok, manifest, int8, args.predict, args.out, cls_id, sep_id)
        return

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    train_rows = load(os.path.join(args.data, "train.jsonl"))
    if args.max_train and len(train_rows) > args.max_train:
        random.Random(7).shuffle(train_rows)
        train_rows = train_rows[: args.max_train]
    dev_rows = load(os.path.join(args.data, "dev.jsonl"))
    qtags, intents, ask_train, ask_dev = ["O"], ["unknown"], [], []
    if args.ask:
        ask_train = load(os.path.join(args.ask, "train.jsonl"))
        ask_dev = load(os.path.join(args.ask, "dev.jsonl"))
        qlabels = sorted({sp["label"] for r in ask_train for sp in r.get("spans", [])})
        qtags = ["O"] + [f"{p}-{l}" for l in qlabels for p in ("B", "I")]
        intents = sorted({r["intent"] for r in ask_train})
    train = build(tok, train_rows, "alert", cls_id=cls_id, sep_id=sep_id) + \
        build(tok, ask_train, "ask", qtags, intents, cls_id, sep_id)
    dev = build(tok, dev_rows, "alert", cls_id=cls_id, sep_id=sep_id)
    dev_ask = build(tok, ask_dev, "ask", qtags, intents, cls_id, sep_id)
    model = Tagger(pruned, len(qtags), len(intents), args.layers or None).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = args.epochs * math.ceil(len(train) / args.batch)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / (0.06 * steps)) * max(0.0, (steps - s) / steps))
    ce = nn.CrossEntropyLoss(ignore_index=-100)
    t0 = time.time()
    model.train()
    for epoch in range(args.epochs):
        # Batches are homogeneous in kind so each loss sees only its own heads.
        alert = [i for i in train if i["kind"] == "alert"]
        ask = [i for i in train if i["kind"] == "ask"]
        random.shuffle(alert)
        random.shuffle(ask)
        batches = [alert[i:i + args.batch] for i in range(0, len(alert), args.batch)] + \
                  [ask[i:i + args.batch] for i in range(0, len(ask), args.batch)]
        random.shuffle(batches)
        total = 0.0
        for b in batches:
            ids, mask, tags = collate(b, pad_id)
            ids, mask, tags = ids.to(device), mask.to(device), tags.to(device)
            t, s, f, d, qt, it = model(ids, mask)
            if b[0]["kind"] == "alert":
                loss = ce(t.reshape(-1, len(TAGS)), tags.reshape(-1)) \
                    + ce(s, torch.tensor([x["status"] for x in b], device=device)) \
                    + ce(f, torch.tensor([x["family"] for x in b], device=device)) \
                    + 1.5 * ce(d, torch.tensor([x["direction"] for x in b], device=device))
            else:
                loss = ce(qt.reshape(-1, len(qtags)), tags.reshape(-1)) + ce(it, torch.tensor([x["intent"] for x in b], device=device))
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            total += loss.item()
            step_i = getattr(model, "_steps", 0) + 1
            model._steps = step_i
            if step_i % 50 == 0:
                print(json.dumps({"step": step_i, "of": steps, "loss": round(loss.item(), 4), "minutes": round((time.time() - t0) / 60, 2)}), flush=True)
            if (time.time() - t0) / 60 > args.budget_min:
                break
        print(json.dumps({"epoch": epoch, "loss": round(total / max(1, len(batches)), 4), "minutes": round((time.time() - t0) / 60, 2)}), flush=True)
        if (time.time() - t0) / 60 > args.budget_min:
            break
    train_minutes = (time.time() - t0) / 60

    model.eval().to("cpu")
    fp32 = os.path.join(args.work, "tagger2.onnx")
    dummy = collate(build(tok, train_rows[:2], "alert", cls_id=cls_id, sep_id=sep_id), pad_id)
    outs = ["tags", "status", "family", "direction", "qtags", "intent"]
    torch.onnx.export(model, (dummy[0], dummy[1]), fp32, input_names=["input_ids", "attention_mask"], output_names=outs,
                      opset_version=17, dynamic_axes={"input_ids": {0: "b", 1: "t"}, "attention_mask": {0: "b", 1: "t"},
                                                      "tags": {0: "b", 1: "t"}, "qtags": {0: "b", 1: "t"}, "status": {0: "b"},
                                                      "family": {0: "b"}, "direction": {0: "b"}, "intent": {0: "b"}}, dynamo=False)
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(fp32, int8, weight_type=QuantType.QInt8)
    fp32_mb = round(os.path.getsize(fp32) / 1e6, 1)
    for extra in os.listdir(args.work):
        if extra.startswith("tagger2.onnx"):
            os.remove(os.path.join(args.work, extra))

    # Temperature calibration on DEV from the int8 graph.
    import onnxruntime as ort
    sess = ort.InferenceSession(int8, providers=["CPUExecutionProvider"])
    coll = {"status": ([], []), "family": ([], []), "direction": ([], []), "tags": ([], []), "intent": ([], []), "qtags": ([], [])}
    for it in dev[:3000] + dev_ask[:1500]:
        ids = np.array([it["ids"]], dtype=np.int64)
        o = dict(zip(outs, sess.run(None, {"input_ids": ids, "attention_mask": np.ones_like(ids)})))
        gold = [t for t in it["tags"] if t != -100]
        first = [i for i, t in enumerate(it["tags"]) if t != -100]
        if it["kind"] == "alert":
            for h in ("status", "family", "direction"):
                coll[h][0].append(o[h][0])
                coll[h][1].append(it[h])
            coll["tags"][0].extend(o["tags"][0][first])
            coll["tags"][1].extend(gold)
        else:
            coll["intent"][0].append(o["intent"][0])
            coll["intent"][1].append(it["intent"])
            coll["qtags"][0].extend(o["qtags"][0][first])
            coll["qtags"][1].extend(gold)
    temps = {h: fit_temperature(*coll[h]) for h in coll}
    manifest = {
        "schemaVersion": 1, "tags": TAGS, "statuses": STATUSES, "families": FAMILIES, "directions": DIRECTIONS,
        "qtags": qtags, "intents": intents, "temperatures": temps, "maxTokens": MAX_TOKENS,
        "layers": args.layers or 12, "trainRows": len(train_rows), "askTrainRows": len(ask_train),
        "trainMinutes": round(train_minutes, 2), "fp32_mb": fp32_mb, "int8_mb": round(os.path.getsize(int8) / 1e6, 1),
        "vocab": tok.get_vocab_size(),
    }
    json.dump(manifest, open(manifest_path, "w"), indent=1)
    print(json.dumps(manifest), flush=True)
    for spec in [s for s in args.eval.split(",") if s]:
        name, path = spec.split("=", 1)
        predict_file(args, tok, manifest, int8, path, os.path.join(args.work, f"pred2-{name}.jsonl"), cls_id, sep_id)


def predict_file(args, tok, manifest, int8, rows_path, out_path, cls_id, sep_id):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    sess = ort.InferenceSession(int8, opts, providers=["CPUExecutionProvider"])
    T = manifest["temperatures"]
    outs = ["tags", "status", "family", "direction", "qtags", "intent"]
    rows = load(rows_path)
    lat = []
    with open(out_path, "w") as fh:
        for r in rows:
            is_ask = "question" in r and "body" not in r
            text = r["question"] if is_ask else r["body"]
            ids, first, ws = encode_words(tok, text, cls_id, sep_id)
            arr = np.array([ids], dtype=np.int64)
            t1 = time.perf_counter()
            o = dict(zip(outs, sess.run(None, {"input_ids": arr, "attention_mask": np.ones_like(arr)})))
            lat.append((time.perf_counter() - t1) * 1000)
            if is_ask:
                qp = softmax(o["qtags"][0][first] / T["qtags"])
                ip = softmax(o["intent"][0] / T["intent"])
                spans = decode(ws, qp.argmax(-1).tolist(), qp.max(-1).tolist(), manifest["qtags"])
                for sp in spans:
                    sp["text"] = text[sp["start"]:sp["end"]]
                rec = {"id": r["id"], "intent": manifest["intents"][int(ip.argmax())], "intentP": round(float(ip.max()), 4), "spans": spans}
            else:
                tp = softmax(o["tags"][0][first] / T["tags"])
                sp_, fp_, dp_ = (softmax(o[h][0] / T[h]) for h in ("status", "family", "direction"))
                rec = {"id": r["id"],
                       "status": STATUSES[int(sp_.argmax())], "statusP": round(float(sp_.max()), 4),
                       "family": FAMILIES[int(fp_.argmax())], "familyP": round(float(fp_.max()), 4),
                       "direction": DIRECTIONS[int(dp_.argmax())], "directionP": round(float(dp_.max()), 4),
                       "spans": decode(ws, tp.argmax(-1).tolist(), tp.max(-1).tolist(), TAGS)}
            rec["ms"] = round(lat[-1], 2)
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    lat.sort()
    print(json.dumps({"predicted": rows_path, "n": len(rows), "p50_ms": round(lat[len(lat) // 2], 2),
                      "p95_ms": round(lat[int(len(lat) * 0.95)], 2)}), flush=True)


if __name__ == "__main__":
    main()
