'use strict';
// Payment cards' card stack: decorative card faces above the card rows,
// rendered from the shipping source through the reference harness. Synthetic
// ledger only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const tiles = load(path.join(root, 'src/lib/spending-calendar-tiles.ts'));

function loadFace(h) {
  return load(path.join(root, 'src/components/card-stack/card-face.ts'), h.deps);
}

/** The Payment cards screen with its sheet and store boundaries stubbed. */
function renderCards(options = {}) {
  const h = createHarness(options);
  const { jsx, deps } = h;
  if (options.motion) deps['@/hooks/use-reduced-motion'] = { useReducedMotion: () => false, useMotionPreference: () => options.motion };
  deps['@/components/card-detail-sheet'] = { CardDetailSheet: (p) => jsx('CardDetailSheet', p) };
  deps['@/components/ui/choice-sheet'] ??= { ChoiceSheet: (p) => jsx('ChoiceSheet', p) };
  deps['@/components/ui/confirm-sheet'] ??= { ConfirmSheet: (p) => jsx('ConfirmSheet', p) };
  deps['@/components/ui/layout'] ??= { Row: (p) => jsx('Row', p), Section: (p) => jsx('Section', p),
    SectionHeader: (p) => jsx('SectionHeader', p) };
  const store = deps['@/lib/store'];
  deps['@/lib/store'] = { ...store, reliableBalanceFils: (_state, account) =>
    account.snapshotKind === 'outstanding' ? -account.snapshotFils : null };
  deps['@/components/card-stack/card-face'] = loadFace(h);
  deps['@/components/card-stack/card-stack'] = load(path.join(root, 'src/components/card-stack/card-stack.tsx'), deps);
  const screen = load(path.join(root, 'src/app/cards.tsx'), deps);
  return { h, tree: screen.default() };
}

const secondCard = { id: 'fab', name: 'FAB credit card', kind: 'card', bankName: 'FAB', cardType: 'credit', last4: '7713',
  openingFils: 0, snapshotKind: 'limit', snapshotFils: 100000, creditLimitFils: 1000000, color: '#E8C33A' };
const withLimit = (h) => h.state.accounts.map((a) => (a.id === 'credit' ? { ...a, creditLimitFils: 1000000 } : a));

test('every card face text colour reads at 4.5:1, including mid-tones and bad values', () => {
  const h = createHarness();
  const { cardFaceColors } = loadFace(h);
  const colours = ['#166CA2', '#BD364C', '#997349', '#E8C33A', '#777777', '#808080', '#7F7F7F', '#FFFFFF', '#000000',
    '#00A651', '#E4002B', '#5C2D91', '#F7A800', '#888', 'not-a-colour', undefined];
  for (const scheme of ['light', 'dark']) {
    for (const colour of colours) {
      const { face, text: ink } = cardFaceColors(colour, scheme);
      assert.ok(tiles.contrastRatio(ink, face) >= 4.5, `${colour} (${scheme}): ${ink} on ${face}`);
    }
  }
  // A colour that already reads keeps its exact face.
  assert.equal(cardFaceColors('#166CA2', 'light').face, '#166CA2');
});

test('the stack geometry: front card lowest, the ones behind peeking above, a list when fanned', () => {
  const { stackLayout, CARD_HEIGHT, FAN_GAP, STACK_PEEK, STACK_MAX_DEPTH } = loadFace(createHarness());
  const layout = stackLayout(6);
  assert.equal(layout.fannedHeight, 6 * CARD_HEIGHT + 5 * FAN_GAP);
  assert.equal(layout.stackedHeight, CARD_HEIGHT + STACK_MAX_DEPTH * STACK_PEEK);
  const stackedTop = (p) => p.fannedTop + p.stackedOffset;
  assert.equal(stackedTop(layout.placements[0]), STACK_MAX_DEPTH * STACK_PEEK);
  assert.equal(stackedTop(layout.placements[1]), (STACK_MAX_DEPTH - 1) * STACK_PEEK);
  // Cards beyond the deepest visible one sit exactly behind it.
  assert.equal(stackedTop(layout.placements[5]), stackedTop(layout.placements[3]));
  assert.ok(layout.placements[1].stackedScale < layout.placements[0].stackedScale);
  assert.deepEqual(JSON.parse(JSON.stringify(stackLayout(0))), { placements: [], stackedHeight: 0, fannedHeight: 0 });
});

test('a credit card is drawn above the rows, hidden from assistive tech, with its usage from the real figures', () => {
  const h0 = createHarness();
  const { h, tree } = renderCards({ state: { accounts: withLimit(h0) } });
  const stack = byId(tree, 'card-stack');
  assert.ok(stack, 'the stack is drawn');
  assert.equal(stack.props.accessibilityElementsHidden, true);
  assert.equal(stack.props.importantForAccessibility, 'no-hide-descendants');
  // Nothing inside it can take keyboard focus or speak.
  for (const node of walk(stack).filter((n) => n.type === 'Pressable')) {
    assert.equal(node.props.focusable, false);
    assert.equal(node.props.accessibilityLabel, undefined);
  }
  // AED 2,800 outstanding of the user's AED 10,000 limit: 28%, within the limit.
  const fill = flat(byId(stack, 'card-stack-fill-credit').props.style);
  assert.equal(Math.round(parseFloat(fill.width)), 28);
  // Within the limit, the fill is the face's own ink, so it reads on any card colour.
  const card = h.state.accounts.find((a) => a.id === 'credit');
  const face = loadFace(h).cardFaceColors(card.color, h.deps['@/hooks/use-band'].useBand('accounts').scheme);
  assert.equal(fill.backgroundColor, face.text);
  assert.match(text(stack), /Emirates NBD/);
  assert.match(text(stack), /•• 0294/);
  // The card's row keeps its spoken label and figure.
  const rows = walk(tree).filter((n) => n.type === 'Row');
  assert.deepEqual(rows.map((n) => n.props.accessibilityLabel), ['NBD credit card, open statements and payments']);
  // Its written figures are unchanged: AED 2,800 outstanding, AED 7,200 of the limit left.
  assert.equal(text(rows[0]).replace(/\s+/g, ' ').trim(),
    'Emirates NBD Credit ·· 0294 · due 10 Sept 2,800.00 Outstanding · 7,200 left');
  // A single card is just the card: no stack toggle.
  assert.equal(byId(tree, 'card-stack-toggle'), undefined);
});

test('no limit entered: the face carries no usage fill', () => {
  const { tree } = renderCards();
  assert.ok(byId(tree, 'card-stack-face-credit'));
  assert.equal(byId(tree, 'card-stack-usage-credit'), undefined);
});

test('reduced motion keeps the same stack (it fans at once), and a face opens what its row opens', () => {
  const h0 = createHarness();
  const { h, tree } = renderCards({ state: { accounts: [...withLimit(h0), secondCard] } });
  assert.ok(byId(tree, 'card-stack-collapsed'), 'the stack, not a tall list of faces');
  assert.ok(byId(tree, 'card-stack-face-credit'));
  // Limit quoted as AED 1,000 left of AED 10,000: AED 9,000 used, past 85%.
  const fill = flat(byId(tree, 'card-stack-fill-fab').props.style);
  assert.equal(Math.round(parseFloat(fill.width)), 90);
  assert.equal(fill.backgroundColor, h.deps['@/hooks/use-band'].useBand('accounts').statusNear);
  byId(tree, 'card-stack-face-fab').props.onPress();
  const opened = h.events.filter((e) => e[0] === 'state' && e[2]?.id === 'fab');
  assert.equal(opened.length, 1, 'the face opens the card detail, like its row');
});

test('with motion, two credit cards stack; a tap fans them and the faces wait until fanned', () => {
  const h0 = createHarness();
  const { h, tree } = renderCards({ state: { accounts: [...withLimit(h0), secondCard] }, motion: { ready: true, reducedMotion: false } });
  const collapsed = byId(tree, 'card-stack-collapsed');
  assert.ok(collapsed, 'stacked');
  assert.equal(collapsed.props.disabled, false);
  assert.equal(byId(tree, 'card-stack-face-fab').props.disabled, true);
  assert.ok(byId(tree, 'card-stack-toggle'));
  const before = h.events.length;
  collapsed.props.onPress();
  assert.ok(h.events.slice(before).some((e) => e[0] === 'state' && e[2] === true), 'the tap fans the stack');
  // Still hidden from assistive tech in this mode too.
  assert.equal(byId(tree, 'card-stack').props.importantForAccessibility, 'no-hide-descendants');
});

test('larger text draws no faces: the rows the person uses come first', () => {
  const h0 = createHarness();
  const { tree } = renderCards({ largeText: true, state: { accounts: [...withLimit(h0), secondCard] },
    motion: { ready: true, reducedMotion: false } });
  assert.equal(byId(tree, 'card-stack'), undefined);
  assert.equal(byId(tree, 'card-stack-face-fab'), undefined);
});
