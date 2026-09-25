/**
 * Word pre-tokenizer for the on-device alert tagger. Must stay bit-for-bit
 * identical to scripts/parser-ai/probe/words.py (the training side); the
 * parity test in scripts/test/ai-alert-extractor.test.cjs pins both.
 *
 * Per Unicode code point: letters/marks form maximal words; a number is
 * digits (Nd) joined by one of . , ' ’ ٫ ٬ NBSP when a digit follows; spaces
 * separate; any other code point is a one-character token. Offsets are
 * UTF-16 code units (JavaScript string indices).
 */
export interface AlertWord {
  start: number;
  end: number;
  text: string;
}

const SPACES = new Set([
  ' ', '\t', '\n', '\r', '\f', '\v', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
  ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿',
]);
const NUMBER_JOINERS = new Set(['.', ',', "'", '’', '٫', '٬', ' ', ' ']);
const LETTER = /^[\p{L}\p{M}]$/u;
const DIGIT = /^\p{Nd}$/u;

type Kind = 'S' | 'L' | 'N' | 'P';
const kind = (ch: string): Kind => (SPACES.has(ch) ? 'S' : LETTER.test(ch) ? 'L' : DIGIT.test(ch) ? 'N' : 'P');

export function alertWords(text: string): AlertWord[] {
  const cps = Array.from(text);
  const u16: number[] = [0];
  for (const ch of cps) u16.push(u16[u16.length - 1] + ch.length);
  const out: AlertWord[] = [];
  let i = 0;
  while (i < cps.length) {
    const k = kind(cps[i]);
    if (k === 'S') { i += 1; continue; }
    let j = i + 1;
    if (k === 'L') {
      while (j < cps.length && kind(cps[j]) === 'L') j += 1;
    } else if (k === 'N') {
      while (j < cps.length) {
        const kj = kind(cps[j]);
        if (kj === 'N') j += 1;
        else if (NUMBER_JOINERS.has(cps[j]) && j + 1 < cps.length && kind(cps[j + 1]) === 'N') j += 2;
        else break;
      }
    }
    out.push({ start: u16[i], end: u16[j], text: cps.slice(i, j).join('') });
    i = j;
  }
  return out;
}
