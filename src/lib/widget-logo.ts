/** Bundled recurring-service identities only. Exact reviewed aliases; no network or substring guesses. */
export const WIDGET_LOGO_ALIASES = {
  careem: ["Careem", "Careem Food", "Careem Pay", "Careem Pay Topup", "Careem Pay Top-up", "Careem Pay Top Up", "Careem Plus", "Careem Networks"],
  talabat: ["Talabat", "Talabat Mart", "Talabat Pro", "Talabat.com", "Talabat sales", "Talabat Business", "طلبات"],
  deliveroo: ["Deliveroo", "Deliveroo Plus", "Deliveroo.ae", "ديليفرو", "دليفرو"],
  noon: ["Noon", "Noon.com", "Noon One", "Noon Food", "Noon Minutes", "Noon Grocery", "Noon Send", "نون"],
  amazon: ["Amazon", "Amazon.ae", "Amazon.com", "Amazon.sa", "Amazon Prime", "Amazon Marketplace", "Amazon Retail", "AMZN", "AMZN Mktp", "امازون", "أمازون"],
  netflix: ["Netflix", "Netflix.com", "نتفليكس", "نتفلكس"],
  spotify: ["Spotify", "Spotify Premium", "Spotify AB", "سبوتيفاي"],
  youtube: ["YouTube", "YouTube Premium", "YouTube Music", "Google YouTube", "Google YouTube Premium", "يوتيوب"],
  apple: ["Apple", "Apple.com/bill", "Apple Services", "Apple Store", "Apple Store US", "iTunes", "iCloud", "iCloud+", "ابل", "آبل"],
  google: ["Google", "Google One", "Google Storage", "Google Play", "Google Workspace", "Google Domains", "جوجل", "غوغل"],
  uber: ["Uber", "Uber Trip", "Uber Eats", "Uber One", "اوبر", "أوبر"],
  claude: ["Claude", "Claude AI", "Anthropic", "Anthropic Claude"],
  github: ["GitHub", "GitHub Copilot"],
  notion: ["Notion", "Notion Labs", "Notion AI"],
  discord: ["Discord", "Discord Nitro"],
  telegram: ["Telegram", "Telegram Premium", "تلغرام", "تيليجرام"],
  dropbox: ["Dropbox", "Dropbox Plus"],
  du: ["du", "du Telecom", "du Postpaid", "du Home Internet", "du Bill", "دو"],
  etisalat: ["Etisalat", "Etisalat Postpaid", "Etisalat Bill", "Etisalat eLife", "e&", "e& UAE", "e and UAE", "اتصالات"],
  osn: ["OSN", "OSN+", "OSN Plus", "OSN Streaming"],
  dewa: ["DEWA", "DEWA Bill", "Dubai Electricity and Water Authority", "ديوا", "هيئة كهرباء ومياه دبي"],
  anghami: ["Anghami", "Anghami Plus", "انغامي", "أنغامي"],
  audible: ["Audible", "Audible.com", "Audible Membership"],
  chatgpt: ["ChatGPT", "Chat GPT", "OpenAI", "OpenAI ChatGPT", "ChatGPT Plus", "ChatGPT Pro"],
  crunchyroll: ["Crunchyroll", "Crunchyroll Premium", "كرانشي رول"],
  deezer: ["Deezer", "Deezer Premium", "ديزر"],
  disney: ["Disney+", "Disney Plus", "DisneyPlus", "ديزني بلس"],
  playstation: ["PlayStation", "PlayStation Network", "PlayStation Plus", "PSN", "بلايستيشن"],
  sewa: ["SEWA", "SEWA Bill", "Sharjah Electricity Water and Gas Authority", "سيوا", "هيئة كهرباء ومياه وغاز الشارقة"],
  shahid: ["Shahid", "Shahid VIP", "Shahid.net", "شاهد", "شاهد VIP"],
  vercel: ["Vercel", "Vercel Inc", "Vercel Pro"],
  xbox: ["Xbox", "Xbox Game Pass", "Xbox Live", "Microsoft Xbox", "اكس بوكس"],
  zoom: ["Zoom", "Zoom.us", "Zoom Video Communications"],
} as const;
export type WidgetLogoId = keyof typeof WIDGET_LOGO_ALIASES;
export const WIDGET_LOGO_IDS = Object.keys(WIDGET_LOGO_ALIASES) as WidgetLogoId[];
export function isWidgetLogoId(value: unknown): value is WidgetLogoId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WIDGET_LOGO_ALIASES, value);
}
const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/[’‘']/g, '')
  .replace(/[.*_/#\\+\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const aliases = new Map<string, WidgetLogoId>();
for (const id of WIDGET_LOGO_IDS) for (const title of WIDGET_LOGO_ALIASES[id]) aliases.set(normalize(title), id);
export function widgetLogoIdFor(title: string): WidgetLogoId | null {
  if (typeof title !== 'string' || title.length > 240 || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(title)) return null;
  if (/^[./\\]/.test(title.trim())) return null;
  return aliases.get(normalize(title)) ?? null;
}
