/**
 * Local brand marks for transaction rows.
 *
 * A merchant you recognise should be recognisable at a glance, but the
 * favicon-fetching version of this sent every merchant name — read out of a
 * bank SMS — to a third-party logo host, along with the device IP. That is
 * spending history leaving the phone one row at a time.
 *
 * So the marks ship inside the app: a short letterform in the brand's own
 * colour. Colour is what the eye actually reads at 44px, it works offline and
 * on first launch, it costs nothing to download, and it needs no trademarked
 * artwork. Anything not in this table falls back to its category glyph.
 *
 * Colours are deliberately mid-tone rather than the exact brand hex: the mark
 * is drawn in the brand colour on a 12%-alpha tile of the same colour, and it
 * has to stay legible in both light and dark themes. noon's #FEEE00 vanishes
 * on white; the ochre below does not.
 */
export interface BrandMark {
  /** 1–3 characters standing in for the brand. */
  mark: string;
  color: string;
}

const BRANDS: [RegExp, BrandMark][] = [
  // Marketplaces and retail
  [/\bnoon\b/i, { mark: 'n', color: '#D4A200' }],
  [/\btabby\b/i, { mark: 'tb', color: '#3BB78F' }],
  [/\btamara\b/i, { mark: 'tm', color: '#B57CE6' }],
  [/amazon|\bamzn\b/i, { mark: 'a', color: '#F0921E' }],
  [/aliexpress|alibaba/i, { mark: 'ae', color: '#E8532F' }],
  [/\bshein\b/i, { mark: 'sn', color: '#8E8E93' }],
  [/\btemu\b/i, { mark: 'te', color: '#F1663A' }],
  [/namshi/i, { mark: 'nm', color: '#C88A5B' }],
  [/\bikea\b/i, { mark: 'ik', color: '#E0A32E' }],
  [/sharaf/i, { mark: 'sd', color: '#E0453E' }],
  [/dubizzle/i, { mark: 'dz', color: '#E14C4C' }],
  [/decathlon/i, { mark: 'dc', color: '#3B85D6' }],
  [/\bnike\b/i, { mark: 'nk', color: '#9A9A9E' }],
  [/adidas/i, { mark: 'ad', color: '#7FB3D5' }],
  [/gmg consumer|sun ?& ?sand/i, { mark: 'sss', color: '#4C8DD8' }],
  [/al ?shaya/i, { mark: 'as', color: '#C77B4E' }],
  [/virgin megastore/i, { mark: 'vm', color: '#D63A3A' }],

  // Groceries
  [/carrefour/i, { mark: 'cf', color: '#3B7BD8' }],
  [/\blulu\b/i, { mark: 'lu', color: '#3FA85C' }],
  [/spinneys/i, { mark: 'sp', color: '#4EA45B' }],
  [/union coop/i, { mark: 'uc', color: '#4C9BD1' }],
  [/choithram/i, { mark: 'ch', color: '#D0563F' }],
  [/\bnesto\b/i, { mark: 'ns', color: '#5AAE5A' }],
  [/instashop/i, { mark: 'is', color: '#E8A33D' }],

  // Food
  [/talabat/i, { mark: 'tl', color: '#EE7B2E' }],
  [/deliveroo/i, { mark: 'dl', color: '#3FBFBF' }],
  [/qlub/i, { mark: 'ql', color: '#E0685E' }],
  [/kitopi/i, { mark: 'kt', color: '#D4785A' }],
  [/starbucks/i, { mark: 'sb', color: '#3E9E6E' }],
  [/tim hortons/i, { mark: 'th', color: '#D4453C' }],
  [/\bcosta\b/i, { mark: 'co', color: '#B0524A' }],
  [/mcdonald/i, { mark: 'mc', color: '#E0A93B' }],
  [/\bkfc\b/i, { mark: 'kfc', color: '#D6453F' }],
  [/pizza hut/i, { mark: 'ph', color: '#D6453F' }],
  [/domino/i, { mark: 'dm', color: '#3D7FC1' }],
  [/subway/i, { mark: 'sw', color: '#4FA45C' }],
  [/arabica/i, { mark: '%', color: '#9AA0A6' }],

  // Transport and fuel
  [/careem(?!\s*food)/i, { mark: 'cr', color: '#4CAF7D' }],
  [/\buber\b/i, { mark: 'ub', color: '#9AA0A6' }],
  [/\bsalik\b/i, { mark: 'sk', color: '#4C9BD1' }],
  [/\brta\b|road\s*(?:&|and)\s*transport/i, { mark: 'rta', color: '#C8474C' }],
  [/adnoc/i, { mark: 'an', color: '#3D7FC1' }],
  [/\benoc\b/i, { mark: 'en', color: '#5AAE7A' }],
  [/emarat/i, { mark: 'em', color: '#4C9BD1' }],

  // Airlines and travel
  [/emirates(?!\s*(?:nbd|islamic|coop))/i, { mark: 'ek', color: '#D6453F' }],
  [/flydubai/i, { mark: 'fz', color: '#D67A2E' }],
  [/etihad/i, { mark: 'ey', color: '#C4A46A' }],
  [/air arabia/i, { mark: 'g9', color: '#D64C7A' }],
  [/booking\.com|^booking\b/i, { mark: 'bk', color: '#3D7FC1' }],
  [/airbnb/i, { mark: 'ab', color: '#E0566E' }],
  [/dragonpass|loungekey/i, { mark: 'dp', color: '#B08D4C' }],

  // Utilities and telecom
  [/\bdewa\b/i, { mark: 'dw', color: '#4CAF7D' }],
  [/\bsewa\b/i, { mark: 'se', color: '#5AAE9E' }],
  [/etisalat|\be&\b/i, { mark: 'e&', color: '#8ABF4C' }],
  [/^du\b/i, { mark: 'du', color: '#D6453F' }],

  // Digital services
  // Anchored: the parser normalises these to the title "Apple", and a bare
  // /apple/ would badge a Pineapple Cafe.
  [/^apple\b|apple\.com|icloud|itunes/i, { mark: 'ap', color: '#9AA0A6' }],
  [/you\s*tube/i, { mark: 'yt', color: '#D6453F' }],
  [/netflix/i, { mark: 'nf', color: '#D6453F' }],
  [/spotify/i, { mark: 'sf', color: '#4CAF6E' }],
  [/anghami/i, { mark: 'ag', color: '#B04CD6' }],
  [/shahid/i, { mark: 'sh', color: '#4CAF9E' }],
  [/\bosn\b/i, { mark: 'osn', color: '#C84C7A' }],
  [/disney/i, { mark: 'd+', color: '#5A7BD6' }],
  [/\bvox\b/i, { mark: 'vox', color: '#D6453F' }],
  [/reel cinemas/i, { mark: 'rl', color: '#B5486A' }],
  [/novo cinemas/i, { mark: 'nv', color: '#4C9BD1' }],
  [/zomato/i, { mark: 'zm', color: '#E05A5A' }],
  [/discord/i, { mark: 'ds', color: '#7A6BD6' }],
  [/telegram/i, { mark: 'tg', color: '#4C9BD1' }],
  [/audible/i, { mark: 'au', color: '#E8A33D' }],
  [/real-?debrid/i, { mark: 'rd', color: '#5AAE7A' }],
  [/all-?debrid/i, { mark: 'al', color: '#4C8DD8' }],
  [/\bsteam\b/i, { mark: 'st', color: '#6BA8CC' }],
  [/playstation|\bpsn\b/i, { mark: 'ps', color: '#4C7BD6' }],
  [/\bxbox\b/i, { mark: 'xb', color: '#4CAF5A' }],
  [/chat\s*gpt|openai/i, { mark: 'ai', color: '#4CAF9E' }],
  [/anthropic|\bclaude\b/i, { mark: 'cl', color: '#D4785A' }],
  [/openrouter/i, { mark: 'or', color: '#8A94A6' }],
  [/perplexity/i, { mark: 'px', color: '#4CA8AF' }],
  [/\bcursor\b/i, { mark: 'cs', color: '#8A94A6' }],
  [/github/i, { mark: 'gh', color: '#9AA0A6' }],
  [/\bnotion\b/i, { mark: 'nt', color: '#9AA0A6' }],
  [/\bcanva\b/i, { mark: 'cv', color: '#4CBFC4' }],
  [/adobe/i, { mark: 'adb', color: '#D6453F' }],
  [/microsoft|office\s*365/i, { mark: 'ms', color: '#4C9BD1' }],
  [/linkedin/i, { mark: 'in', color: '#3D7FC1' }],
  [/dropbox/i, { mark: 'db', color: '#4C8DD8' }],
  [/fiverr/i, { mark: 'fv', color: '#4CAF5A' }],
  [/google\s*one|google\s*storage/i, { mark: 'g1', color: '#4C8DD8' }],
  [/hetzner/i, { mark: 'hz', color: '#D6453F' }],
  [/vercel/i, { mark: '▲', color: '#9AA0A6' }],
  [/namecheap|name\.com|godaddy/i, { mark: 'dn', color: '#D67A2E' }],
  [/kickresume/i, { mark: 'kr', color: '#4C9BD1' }],
  [/mailsuite/i, { mark: 'mx', color: '#5A9BD6' }],

  // Money
  [/etoro/i, { mark: 'et', color: '#5AAE7A' }],
  [/capital\.com/i, { mark: 'cp', color: '#4C8DD8' }],
  [/binance/i, { mark: 'bn', color: '#D4A200' }],
  [/crypto\.com/i, { mark: 'cd', color: '#4C7BD6' }],
  [/exinity/i, { mark: 'ex', color: '#8A94A6' }],
  [/\bziina\b/i, { mark: 'zi', color: '#7A6BD6' }],
];

/**
 * The brand mark for a transaction title, or null when the merchant is not a
 * brand this app knows — the caller then draws the category glyph.
 */
export function brandMarkFor(title: string): BrandMark | null {
  if (!title) return null;
  for (const [re, mark] of BRANDS) {
    if (re.test(title)) return mark;
  }
  return null;
}
