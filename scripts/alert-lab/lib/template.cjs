'use strict';
// Tiny template language for alert phrasings.
//   {NAME}      a slot, always rendered (the generator must supply it)
//   [ ... ]     an optional segment, rendered only when every slot inside it
//               has a non-empty value. No nesting.
// Ids are content hashes, so editing a phrasing makes it a new item rather
// than silently changing what an old id meant.
const { shortHash } = require('./prng.cjs');

const SLOT = /\{([A-Z0-9_]+)\}/g;

const slotsOf = (text) => [...text.matchAll(SLOT)].map((m) => m[1]);

/** Slots outside any optional segment: the template cannot render without them. */
const requiredSlots = (text) => slotsOf(text.replace(/\[[^\]]*\]/g, ''));

function render(text, values) {
  const used = new Set();
  const fill = (part) => part.replace(SLOT, (_, name) => {
    used.add(name);
    const v = values[name];
    if (v === undefined || v === null || v === '') throw new Error(`template slot {${name}} has no value in: ${text}`);
    return String(v);
  });
  const withOptional = text.replace(/\[([^\]]*)\]/g, (_, inner) => {
    const names = slotsOf(inner);
    if (names.some((n) => values[n] === undefined || values[n] === null || values[n] === '')) return '';
    return fill(inner);
  });
  const out = fill(withOptional)
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.,;:!?])(?=\s|$)/g, '$1')
    // A year-less dotted date ("21.10.") ending a sentence keeps one dot.
    .replace(/(\d)\.\.(?=\s|$)/g, '$1.')
    .trim();
  return { text: out, used };
}

/** Turn a lexicon list into items with stable ids and optional group tags. */
function items(prefix, list) {
  return list.map((entry) => {
    const raw = typeof entry === 'string' ? entry : entry.t;
    // "x|" marks a transfer-group template, "c|" a card-group template.
    const m = /^([cxa])\|(.*)$/s.exec(raw);
    const group = m ? m[1] : 'a';
    const t = m ? m[2] : raw;
    return { id: `${prefix}:${shortHash(t)}`, t, group, required: requiredSlots(t) };
  });
}

module.exports = { render, items, slotsOf, requiredSlots };
