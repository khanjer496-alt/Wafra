/** Curated, bundled artwork. Source and rights notes live in assets/merchants/. */
export interface MerchantLogo {
  readonly id: string;
  /** Metro's static asset identifier; remote image URLs are not supported. */
  readonly source: number;
}

// Static requires are intentional: Metro includes these files in native builds
// and OTA updates. No merchant name, bank message or device IP goes to a logo API.
const ENTRIES: readonly [string, number, readonly string[]][] = [
  ['careem', require('../../../assets/merchants/careem.png'), ['Careem', 'Careem Food', 'Careem Pay', 'Careem Plus', 'Careem Networks', 'كريم']],
  ['talabat', require('../../../assets/merchants/talabat.png'), ['Talabat', 'Talabat Mart', 'Talabat Pro', 'Talabat.com', 'طلبات']],
  ['deliveroo', require('../../../assets/merchants/deliveroo.png'), ['Deliveroo', 'Deliveroo Plus', 'Deliveroo.ae', 'ديليفرو', 'دليفرو']],
  ['carrefour', require('../../../assets/merchants/carrefour.png'), ['Carrefour', 'Carrefour Hypermarket', 'Carrefour Hyper', 'Carrefour Market', 'Carrefour MOE', 'Carrefour Mall of the Emirates', 'كارفور']],
  ['lulu', require('../../../assets/merchants/lulu.png'), ['Lulu', 'LuLu Hypermarket', 'Lulu Hyper Market', 'Lulu Hyper', 'Lulu Supermarket', 'لولو', 'لولو هايبرماركت', 'لولو هايبر ماركت']],
  ['spinneys', require('../../../assets/merchants/spinneys.png'), ['Spinneys', 'Spinneys.com', 'سبينس', 'سبينيس']],
  ['noon', require('../../../assets/merchants/noon.png'), ['Noon', 'Noon.com', 'Noon Food', 'Noon Minutes', 'Noon Grocery', 'نون']],
  ['amazon', require('../../../assets/merchants/amazon.png'), ['Amazon', 'Amazon.ae', 'Amazon.com', 'Amazon.sa', 'Amazon Prime', 'Amazon Marketplace', 'Amazon Retail', 'AMZN', 'AMZN Mktp', 'امازون', 'أمازون']],
  ['netflix', require('../../../assets/merchants/netflix.png'), ['Netflix', 'Netflix.com', 'نتفليكس', 'نتفلكس']],
  ['spotify', require('../../../assets/merchants/spotify.png'), ['Spotify', 'Spotify Premium', 'Spotify AB', 'سبوتيفاي']],
  ['youtube', require('../../../assets/merchants/youtube.png'), ['YouTube', 'YouTube Premium', 'YouTube Music', 'Google YouTube', 'Google YouTube Premium', 'يوتيوب']],
  ['apple', require('../../../assets/merchants/apple.png'), ['Apple', 'Apple.com/bill', 'Apple Services', 'Apple Store', 'Apple Store US', 'iTunes', 'iCloud', 'iCloud+', 'ابل', 'آبل']],
  ['google', require('../../../assets/merchants/google.png'), ['Google', 'Google One', 'Google Storage', 'Google Play', 'Google Workspace', 'Google Domains', 'جوجل', 'غوغل']],
  ['starbucks', require('../../../assets/merchants/starbucks.png'), ['Starbucks', 'Starbucks Coffee', 'ستاربكس', 'ستار بكس']],
  ['mcdonalds', require('../../../assets/merchants/mcdonalds.png'), ['McDonalds', "McDonald's", 'Mc Donalds', 'ماكدونالدز']],
  ['kfc', require('../../../assets/merchants/kfc.png'), ['KFC', 'Kentucky Fried Chicken', 'كنتاكي']],
  ['ikea', require('../../../assets/merchants/ikea.png'), ['IKEA', 'ايكيا', 'إيكيا']],
  ['uber', require('../../../assets/merchants/uber.png'), ['Uber', 'Uber Trip', 'Uber Eats', 'Uber One', 'اوبر', 'أوبر']],
  ['emirates', require('../../../assets/merchants/emirates.png'), ['Emirates', 'Emirates Airline', 'Emirates Airlines', 'Emirates.com', 'طيران الامارات', 'طيران الإمارات']],
  ['bookingdotcom', require('../../../assets/merchants/bookingdotcom.png'), ['Booking.com', 'Booking', 'بوكينج']],
  ['airbnb', require('../../../assets/merchants/airbnb.png'), ['Airbnb', 'Airbnb.com']],
  ['claude', require('../../../assets/merchants/claude.png'), ['Claude', 'Claude AI', 'Anthropic', 'Anthropic Claude']],
  ['github', require('../../../assets/merchants/github.png'), ['GitHub', 'GitHub Copilot']],
  ['notion', require('../../../assets/merchants/notion.png'), ['Notion', 'Notion Labs', 'Notion AI']],
  ['discord', require('../../../assets/merchants/discord.png'), ['Discord', 'Discord Nitro']],
  ['telegram', require('../../../assets/merchants/telegram.png'), ['Telegram', 'Telegram Premium', 'تلغرام', 'تيليجرام']],
  ['dropbox', require('../../../assets/merchants/dropbox.png'), ['Dropbox', 'Dropbox Plus']],
  ['rta', require('../../../assets/merchants/rta.png'), ['RTA', 'RTA Dubai', 'RTA Nol', 'RTA Nol Top-up', 'Nol Top-up', 'هيئة الطرق والمواصلات']],
  ['enoc', require('../../../assets/merchants/enoc.png'), ['ENOC', 'ENOC Fuel', 'ENOC Pay', 'EPPCO', 'اينوك', 'إينوك', 'ايبكو']],
  ['adnoc', require('../../../assets/merchants/adnoc.png'), ['ADNOC', 'ADNOC Distribution', 'ADNOC Dist', 'ADNOC Fuel', 'ADNOC Oasis', 'ادنوك', 'أدنوك']],
  ['du', require('../../../assets/merchants/du.png'), ['du', 'du Telecom', 'du Postpaid', 'du Home Internet', 'du Bill', 'دو']],
  ['etisalat', require('../../../assets/merchants/etisalat.png'), ['Etisalat', 'Etisalat Postpaid', 'Etisalat Bill', 'Etisalat eLife', 'e&', 'e& UAE', 'e and UAE', 'اتصالات']],
  ['osn', require('../../../assets/merchants/osn.png'), ['OSN', 'OSN+', 'OSN Plus', 'OSN Streaming']],
  ['dewa', require('../../../assets/merchants/dewa.png'), ['DEWA', 'DEWA Bill', 'Dubai Electricity and Water Authority', 'ديوا', 'هيئة كهرباء ومياه دبي']],
];

/** Display-only matching. Never changes the ledger title, grouping or category. */
function keyFor(title: string): string {
  return title.normalize('NFKC').toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/[’‘']/g, '')
    .replace(/[.*_/#\\+\-]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const LOGOS = new Map<string, MerchantLogo>();
for (const [id, source, aliases] of ENTRIES) {
  const logo: MerchantLogo = Object.freeze({ id, source });
  for (const alias of aliases) LOGOS.set(keyFor(alias), logo);
}

export function merchantLogoFor(title: string): MerchantLogo | null {
  if (typeof title !== 'string' || !title.trim() || title.length > 240) return null;
  let key = keyFor(title);
  // Remove only known location/terminal tails, never arbitrary brand substrings
  // or payment-provider prefixes. "Cafe near Carrefour" stays an unknown cafe.
  for (let attempt = 0; attempt < 5; attempt++) {
    const logo = LOGOS.get(key);
    if (logo) return logo;
    const shorter = key.replace(/ (?:dubai|dxb|abu dhabi|sharjah|ajman|riyadh|jeddah|uae|are|ae|ksa|sau|sa|دبي|ابوظبي|ابو ظبي|الشارقة|الرياض|جدة|\d{3,12})$/, '');
    if (shorter === key) return null;
    key = shorter;
  }
  return LOGOS.get(key) ?? null;
}
