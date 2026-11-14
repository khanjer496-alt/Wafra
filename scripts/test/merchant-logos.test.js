const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../..');
const jsx = (type, props) => ({ type, props });
const dependencies = {
  react: { memo: f => f }, 'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View' }, '@/components/themed-text': { ThemedText: 'Text' },
  '@/hooks/use-theme': { useTheme: () => ({ text: '#111', primary: '#222', primarySoft: '#EEE' }) },
  '@/hooks/use-band': { useBand: () => ({ glyphGround: '#EEE' }) },
  '@/hooks/use-color-scheme': { useColorScheme: () => 'dark' },
  '@/constants/theme': { Radius: { tile: 8, control: 12 }, BandPalettes: { dark: { accounts: { glyphGround: '#123', tint: '#FFF' } } } },
};
const { MonogramAvatar } = load(path.join(root, 'src/components/ui/monogram-avatar.tsx'), dependencies);
dependencies['@/components/ui/monogram-avatar'] = { MonogramAvatar };
const { MerchantAvatar } = load(path.join(root, 'src/components/ui/merchant-avatar.tsx'), dependencies);
const { BankAvatar } = load(path.join(root, 'src/components/ui/bank-avatar.tsx'), dependencies);
for (const [name, initial] of [['Careem', 'C'], ['كريم', 'ك'], ['  Noon One ', 'N'], ['', '—'], ['éclair', 'É']]) {
  const node = MerchantAvatar({ title: name, category: 'other', size: 44 });
  assert.equal(node.type, MonogramAvatar);
  assert.equal(node.props.name, name, 'presentation never rewrites the merchant');
  const tile = node.type(node.props);
  assert.equal(tile.props.children.props.children, initial);
  assert.equal(tile.props.accessibilityElementsHidden, true);
  assert.equal(tile.props.style.width, 44);
}
assert.equal(BankAvatar({ account: { bankName: 'Example Bank', name: 'Savings', kind: 'bank' } }).props.name, 'Example Bank');
assert.equal(BankAvatar({ account: { name: 'Savings', kind: 'bank' } }).props.name, 'Savings');
console.log('✓ local merchant and bank monograms, EN/AR initials, sizing and decorative accessibility');
