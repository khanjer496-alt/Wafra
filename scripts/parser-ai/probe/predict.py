"""Run the exported int8 ONNX tagger over any rows JSONL (inference only).

    python predict.py --work <scratch>/parser-ai --rows rows.jsonl --out pred.jsonl
"""
import argparse
import json
import os

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from train import DIRECTIONS, FAMILIES, STATUSES, decode, encode, load, softmax


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--rows", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    tok = Tokenizer.from_file(os.path.join(args.work, "e5-pruned", "tokenizer.json"))
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 4
    sess = ort.InferenceSession(os.path.join(args.work, "tagger.int8.onnx"), opts, providers=["CPUExecutionProvider"])
    with open(args.out, "w") as fh:
        for r in load(args.rows):
            item = encode(tok, [r], False)[0]
            ids = np.array([item["ids"]], dtype=np.int64)
            t, s, f, d = sess.run(None, {"input_ids": ids, "attention_mask": np.ones_like(ids)})
            tp = softmax(t[0])
            sp, fp, dp = softmax(s[0]), softmax(f[0]), softmax(d[0])
            fh.write(json.dumps({
                "id": r["id"], "status": STATUSES[int(sp.argmax())], "statusP": round(float(sp.max()), 4),
                "family": FAMILIES[int(fp.argmax())], "direction": DIRECTIONS[int(dp.argmax())],
                "spans": decode(r["body"], item["offsets"], tp.argmax(-1).tolist(), tp.max(-1).tolist()),
            }, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
