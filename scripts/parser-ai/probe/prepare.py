"""Phase-1 feasibility probe, step 1: fetch and vocabulary-prune the encoder.

Downloads intfloat/multilingual-e5-small (the same backbone the app's local E5
work already ships as a pruned int8 ONNX), keeps the TOP_N highest-scoring
SentencePiece pieces plus every piece the synthetic TRAIN split uses, and saves
a pruned model + tokenizer. Test/eval text is never consulted for the vocab.

    python prepare.py --work <scratch>/parser-ai --train <scratch>/parser-ai/synth/train.jsonl

Nothing here is committed: weights live only under --work and are deleted
after the probe.
"""
import argparse
import json
import os
import shutil

import torch
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer
from transformers import AutoConfig, AutoModel

MODEL_ID = "intfloat/multilingual-e5-small"
TOP_N = 20000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--train", required=True)
    ap.add_argument("--top", type=int, default=TOP_N)
    args = ap.parse_args()
    os.environ.setdefault("HF_HOME", os.path.join(args.work, "hf"))
    raw = os.path.join(args.work, "e5-raw")
    os.makedirs(raw, exist_ok=True)
    for name in ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "model.safetensors"]:
        path = hf_hub_download(MODEL_ID, name, cache_dir=os.path.join(args.work, "hf"))
        shutil.copy(path, os.path.join(raw, name))
    shutil.rmtree(os.path.join(args.work, "hf"), ignore_errors=True)

    tok = Tokenizer.from_file(os.path.join(raw, "tokenizer.json"))
    spec = json.load(open(os.path.join(raw, "tokenizer.json")))
    vocab = spec["model"]["vocab"]  # [[piece, score], ...]
    special = {t["id"] for t in spec["added_tokens"]}
    by_score = sorted(range(len(vocab)), key=lambda i: -vocab[i][1] if i not in special else float("inf"))
    keep = set(special) | set(range(4)) | set(by_score[: args.top])
    used = 0
    with open(args.train) as fh:
        for line in fh:
            ids = tok.encode(json.loads(line)["body"]).ids
            used += len(ids)
            keep.update(ids)
    kept = sorted(keep)
    remap = {old: new for new, old in enumerate(kept)}
    print(json.dumps({"original_vocab": len(vocab), "kept": len(kept), "train_tokens": used}))

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

    config = AutoConfig.from_pretrained(raw)
    model = AutoModel.from_pretrained(raw)
    emb = model.get_input_embeddings().weight.data[torch.tensor(kept)]
    model.resize_token_embeddings(len(kept))
    model.get_input_embeddings().weight.data.copy_(emb)
    config.vocab_size = len(kept)
    model.config.vocab_size = len(kept)
    model.save_pretrained(out)
    shutil.rmtree(raw)
    params = sum(p.numel() for p in model.parameters())
    print(json.dumps({"pruned_params": params, "saved": out}))


if __name__ == "__main__":
    main()
