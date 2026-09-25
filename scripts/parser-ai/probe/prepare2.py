"""Phase-2 step 1: fetch intfloat/multilingual-e5-small and prune its vocabulary.

Keeps the TOP_N highest-scoring SentencePiece pieces plus every piece that the TRAIN
splits use under the word-level encoding of words.py (alerts: body, Ask: question).
Dev/test/held-out text is never consulted. Output: <work>/e5-pruned (scratch only).

    python prepare2.py --work <dir> --train a.jsonl,b.jsonl
"""
import argparse
import json
import os
import shutil

import torch
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer
from transformers import AutoConfig, AutoModel

from words import words

MODEL_ID = "intfloat/multilingual-e5-small"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--train", required=True)
    ap.add_argument("--top", type=int, default=20000)
    args = ap.parse_args()
    raw = os.path.join(args.work, "e5-raw")
    os.makedirs(raw, exist_ok=True)
    cache = os.path.join(args.work, "hf")
    for name in ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "model.safetensors"]:
        path = hf_hub_download(MODEL_ID, name, cache_dir=cache)
        shutil.copy(path, os.path.join(raw, name))
    shutil.rmtree(cache, ignore_errors=True)

    tok = Tokenizer.from_file(os.path.join(raw, "tokenizer.json"))
    spec = json.load(open(os.path.join(raw, "tokenizer.json")))
    vocab = spec["model"]["vocab"]
    special = {t["id"] for t in spec["added_tokens"]}
    by_score = sorted(range(len(vocab)), key=lambda i: -vocab[i][1] if i not in special else float("inf"))
    keep = set(special) | set(range(4)) | set(by_score[: args.top])
    used = 0
    for path in args.train.split(","):
        with open(path) as fh:
            for line in fh:
                r = json.loads(line)
                text = r.get("body") or r.get("question") or ""
                for (_, _, w) in words(text):
                    ids = tok.encode(w, add_special_tokens=False).ids
                    used += len(ids)
                    keep.update(ids)
    kept = sorted(keep)
    remap = {old: new for new, old in enumerate(kept)}
    print(json.dumps({"original_vocab": len(vocab), "kept": len(kept), "train_pieces": used}))
    spec["model"]["vocab"] = [vocab[i] for i in kept]
    spec["model"]["unk_id"] = remap[spec["model"]["unk_id"]]
    for t in spec["added_tokens"]:
        t["id"] = remap[t["id"]]
    post = spec.get("post_processor") or {}
    for proc in [post] + list(post.get("processors", [])):
        for token in (proc.get("special_tokens") or {}).values():
            token["ids"] = [remap[i] for i in token["ids"]]
        for key in ("sep", "cls"):
            if key in proc:
                proc[key][1] = remap[proc[key][1]]
    out = os.path.join(args.work, "e5-pruned")
    os.makedirs(out, exist_ok=True)
    json.dump(spec, open(os.path.join(out, "tokenizer.json"), "w"), ensure_ascii=False)
    for name in ["tokenizer_config.json", "special_tokens_map.json"]:
        shutil.copy(os.path.join(raw, name), os.path.join(out, name))
    model = AutoModel.from_pretrained(raw)
    emb = model.get_input_embeddings().weight.data[torch.tensor(kept)]
    model.resize_token_embeddings(len(kept))
    model.get_input_embeddings().weight.data.copy_(emb)
    model.config.vocab_size = len(kept)
    model.save_pretrained(out)
    shutil.rmtree(raw)
    print(json.dumps({"pruned_params": sum(p.numel() for p in model.parameters()), "saved": out}))


if __name__ == "__main__":
    main()
