"""Zero-shot LLM structured extraction over eval JSONL sets (phase 2, item J).

Starts `llama-server` (llama.cpp) with a local GGUF model, asks for one JSON object per
alert under a JSON-schema constraint, and writes predictions JSONL:
  {id, status, amountText, currencyText, direction, family, merchant, dateText, ms, raw_ok}
plus a stats JSON (latency p50/p95, peak server RSS, model size). Python stdlib only.

    python run-llm.py --model model.gguf --sets <dir> --names synth,repo,uae --out <dir> [--ctx 2048]

The prompt is ZERO-SHOT: instructions + schema, no examples. Model files and outputs live
in scratch; nothing here is committed except this harness.
"""
import argparse
import json
import os
import subprocess
import threading
import time
import urllib.request

SCHEMA = {
    "type": "object",
    "properties": {
        "posting": {"type": "boolean"},
        "status": {"type": "string", "enum": ["completed", "pending", "declined", "otp", "promo", "balance",
                                               "statement", "request", "future", "other"]},
        "amount": {"type": "string"},
        "currency": {"type": "string"},
        "direction": {"type": "string", "enum": ["out", "in", "none"]},
        "family": {"type": "string", "enum": ["purchase", "refund", "transfer", "salary", "fee", "withdrawal",
                                               "card-payment", "bill-payment", "none"]},
        "merchant": {"type": "string"},
        "date": {"type": "string"},
    },
    "required": ["posting", "status", "amount", "currency", "direction", "family", "merchant", "date"],
}

SYSTEM = (
    "You extract structured data from ONE bank SMS or app notification, in any language. "
    "Return only JSON matching the schema.\n"
    "- posting: true only if the message reports ONE money movement that has already completed on the "
    "customer's account/card (a purchase, refund, transfer sent or received, salary, fee, ATM withdrawal, "
    "card payment received, bill paid). false for OTP/verification codes, pending/authorisation holds, "
    "declined/failed, promotions/offers, balance or statement/due reminders, payment requests, scheduled/future.\n"
    "- status: why (completed if posting).\n"
    "- amount: the transaction amount copied EXACTLY as written in the message (digits and separators), "
    "never a balance, available limit, minimum due or fee cap. Empty string if none.\n"
    "- currency: the currency code or symbol copied exactly as written next to that amount. Empty if none.\n"
    "- direction: out = money left the customer (debit), in = money came to the customer (credit), none if not posting.\n"
    "- family: the kind of movement, none if not posting.\n"
    "- merchant: the merchant, payee, payer or biller name as written, empty if none.\n"
    "- date: the transaction date exactly as written, empty if none."
)

STATUS_MAP = {"completed": "completed", "pending": "pending", "declined": "declined", "otp": "otp", "promo": "promo",
              "balance": "informational", "statement": "informational", "request": "request", "future": "future",
              "other": "unknown"}
DIR_MAP = {"out": "debit", "in": "credit", "none": "none"}


def post(url, payload, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def rss_mb(pid):
    try:
        out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)]).decode().strip()
        return int(out) / 1024 if out else 0
    except Exception:
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--sets", required=True)
    ap.add_argument("--names", default="synth,repo,uae")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--ctx", type=int, default=2048)
    ap.add_argument("--port", type=int, default=8931)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-schema", action="store_true", help="json_object without the schema grammar (faster; parsed leniently)")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    log = open(os.path.join(args.out, f"{args.tag}.server.log"), "w")
    server = subprocess.Popen(["llama-server", "-m", args.model, "--port", str(args.port), "-c", str(args.ctx),
                               "-ngl", "99", "--no-webui", "-np", "1", "--temp", "0"], stdout=log, stderr=log)
    base = f"http://127.0.0.1:{args.port}"
    peak = [0.0]
    stop = [False]

    def watch():
        while not stop[0]:
            peak[0] = max(peak[0], rss_mb(server.pid))
            time.sleep(0.5)

    threading.Thread(target=watch, daemon=True).start()
    try:
        for _ in range(240):
            try:
                with urllib.request.urlopen(base + "/health", timeout=2) as r:
                    if r.status == 200:
                        break
            except Exception:
                time.sleep(1)
        stats = {"model": os.path.basename(args.model), "model_mb": round(os.path.getsize(args.model) / 1e6, 1), "sets": {}}
        for name in args.names.split(","):
            path = os.path.join(args.sets, f"{name}.jsonl")
            if not os.path.exists(path):
                continue
            rows = [json.loads(l) for l in open(path) if l.strip()]
            if args.limit:
                rows = rows[: args.limit]
            lat, bad = [], 0
            with open(os.path.join(args.out, f"{args.tag}.{name}.jsonl"), "w") as fh:
                for r in rows:
                    t0 = time.time()
                    try:
                        res = post(base + "/v1/chat/completions", {
                            "messages": [{"role": "system", "content": SYSTEM},
                                         {"role": "user", "content": "Message:\n" + r["body"][:1200]}],
                            "temperature": 0, "max_tokens": 200,
                            # Qwen3-style hybrid thinkers: answer directly (no reasoning tokens).
                            "chat_template_kwargs": {"enable_thinking": False},
                            "response_format": {"type": "json_object"} if args.no_schema else {"type": "json_object", "schema": SCHEMA},
                        })
                        o = json.loads(res["choices"][0]["message"]["content"])
                        ok = True
                    except Exception:
                        o, ok = {}, False
                        bad += 1
                    ms = (time.time() - t0) * 1000
                    lat.append(ms)
                    status = STATUS_MAP.get(o.get("status"), "unknown")
                    if o.get("posting") is False and status == "completed":
                        status = "unknown"
                    if o.get("posting") is True and status != "completed":
                        status = status  # the stated reason wins: not posting
                    fh.write(json.dumps({
                        "id": r["id"], "status": status, "posting": bool(o.get("posting")),
                        "amountText": o.get("amount") or "", "currencyText": o.get("currency") or "",
                        "direction": DIR_MAP.get(o.get("direction"), "none"),
                        "family": o.get("family") if o.get("family") not in (None, "none") else "non-posting",
                        "merchant": o.get("merchant") or "", "dateText": o.get("date") or "",
                        "ms": round(ms, 1), "raw_ok": ok,
                    }, ensure_ascii=False) + "\n")
            lat.sort()
            stats["sets"][name] = {"n": len(rows), "failures": bad,
                                   "p50_ms": round(lat[len(lat) // 2], 1) if lat else None,
                                   "p95_ms": round(lat[int(len(lat) * 0.95)], 1) if lat else None}
            print(json.dumps({name: stats["sets"][name]}), flush=True)
        stats["peak_rss_mb"] = round(peak[0], 1)
        json.dump(stats, open(os.path.join(args.out, f"{args.tag}.stats.json"), "w"), indent=1)
        print(json.dumps(stats), flush=True)
    finally:
        stop[0] = True
        server.terminate()
        server.wait(timeout=30)


if __name__ == "__main__":
    main()
