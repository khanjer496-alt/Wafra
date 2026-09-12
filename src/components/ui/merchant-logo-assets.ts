/** Curated, bundled artwork. Source and rights notes live in assets/merchants/. */
export interface MerchantLogo {
  readonly id: string;
  /** Metro's static asset identifier; remote image URLs are not supported. */
  readonly source: number;
  /** Single-color transparent marks use the theme ink for contrast. */
  readonly tint?: 'theme' | 'dark';
}

// Static requires are intentional: Metro includes these files in native builds
// and OTA updates. No merchant name, bank message or device IP goes to a logo API.
const ENTRIES: readonly [string, number, readonly string[]][] = [
  // Bare Arabic كريم is also a person's name; a title alone cannot identify the company.
  ['careem', require('../../../assets/merchants/careem.png'), ['Careem', 'Careem Food', 'Careem Pay', 'Careem Plus', 'Careem Networks']],
  ['talabat', require('../../../assets/merchants/talabat.png'), ['Talabat', 'Talabat Mart', 'Talabat Pro', 'Talabat.com', 'طلبات']],
  ['deliveroo', require('../../../assets/merchants/deliveroo.png'), ['Deliveroo', 'Deliveroo Plus', 'Deliveroo.ae', 'ديليفرو', 'دليفرو']],
  ['carrefour', require('../../../assets/merchants/carrefour.png'), ['Carrefour', 'Carrefour Hypermarket', 'Carrefour Hyper', 'Carrefour Market', 'Carrefour MOE', 'Carrefour Mall of the Emirates', 'كارفور']],
  ['lulu', require('../../../assets/merchants/lulu.png'), ['Lulu', 'LuLu Hypermarket', 'Lulu Hyper Market', 'Lulu Hyper', 'Lulu Supermarket', 'لولو', 'لولو هايبرماركت', 'لولو هايبر ماركت']],
  ['spinneys', require('../../../assets/merchants/spinneys.png'), ['Spinneys', 'Spinneys.com', 'سبينس', 'سبينيس']],
  ['noon', require('../../../assets/merchants/noon.png'), ['Noon', 'Noon.com', 'Noon One', 'Noon Food', 'Noon Minutes', 'Noon Grocery', 'نون']],
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
  // Additional retail, dining, subscriptions and regional services.
  ['adidas', require('../../../assets/merchants/adidas.png'), ["adidas","adidas Store","adidas.com","اديداس","أديداس"]],
  ['airarabia', require('../../../assets/merchants/airarabia.png'), ["Air Arabia","AirArabia","العربية للطيران"]],
  ['alibabadotcom', require('../../../assets/merchants/alibabadotcom.png'), ["Alibaba","Alibaba.com","علي بابا"]],
  ['aliexpress', require('../../../assets/merchants/aliexpress.png'), ["AliExpress","AliExpress.com","علي اكسبرس"]],
  ['anghami', require('../../../assets/merchants/anghami.png'), ["Anghami","Anghami Plus","انغامي","أنغامي"]],
  ['aster', require('../../../assets/merchants/aster.png'), ["Aster Pharmacy","Aster Pharmacies","صيدلية استر","صيدلية أستر"]],
  ['audible', require('../../../assets/merchants/audible.png'), ["Audible","Audible.com","Audible Membership"]],
  ['binance', require('../../../assets/merchants/binance.png'), ["Binance","Binance.com","بينانس"]],
  ['brandsforless', require('../../../assets/merchants/brandsforless.png'), ["Brands For Less","BFL","براندز فور لس"]],
  ['burgerking', require('../../../assets/merchants/burgerking.png'), ["Burger King","BurgerKing","برجر كنج","برغر كينغ"]],
  ['cafu', require('../../../assets/merchants/cafu.png'), ["CAFU","CAFU Fuel","CAFUAE","كافو"]],
  ['canva', require('../../../assets/merchants/canva.png'), ["Canva","Canva Pro","Canva.com","كانفا"]],
  ['centrepoint', require('../../../assets/merchants/centrepoint.png'), ["Centrepoint","Centrepoint Stores","سنتر بوينت","سنتربوينت"]],
  ['chatgpt', require('../../../assets/merchants/chatgpt.png'), ["ChatGPT","Chat GPT","OpenAI","OpenAI ChatGPT","ChatGPT Plus","ChatGPT Pro"]],
  ['cloudflare', require('../../../assets/merchants/cloudflare.png'), ["Cloudflare","Cloudflare Inc","Cloudflare Workers"]],
  ['costa', require('../../../assets/merchants/costa.png'), ["Costa","Costa Coffee","كوستا","كوستا كوفي"]],
  ['coursera', require('../../../assets/merchants/coursera.png'), ["Coursera","Coursera Plus","كورسيرا"]],
  ['crunchyroll', require('../../../assets/merchants/crunchyroll.png'), ["Crunchyroll","Crunchyroll Premium","كرانشي رول"]],
  ['cryptodotcom', require('../../../assets/merchants/cryptodotcom.png'), ["Crypto.com","Crypto com"]],
  ['cursor', require('../../../assets/merchants/cursor.png'), ["Cursor","Cursor AI","Cursor Pro","Anysphere"]],
  ['deezer', require('../../../assets/merchants/deezer.png'), ["Deezer","Deezer Premium","ديزر"]],
  ['digitalocean', require('../../../assets/merchants/digitalocean.png'), ["DigitalOcean","Digital Ocean"]],
  ['disney', require('../../../assets/merchants/disney.png'), ["Disney+","Disney Plus","DisneyPlus","ديزني بلس"]],
  ['dominos', require('../../../assets/merchants/dominos.png'), ["Dominos","Domino's","Dominos Pizza","Domino's Pizza","دومينوز","دومينوز بيتزا"]],
  ['doordash', require('../../../assets/merchants/doordash.png'), ["DoorDash","DoorDash DashPass","DashPass"]],
  ['dunkindonuts', require('../../../assets/merchants/dunkindonuts.png'), ["Dunkin","Dunkin Donuts","Dunkin' Donuts","دانكن","دانكن دونتس"]],
  ['duolingo', require('../../../assets/merchants/duolingo.png'), ["Duolingo","Super Duolingo","Duolingo Plus","دولينجو"]],
  ['epicgames', require('../../../assets/merchants/epicgames.png'), ["Epic Games","EpicGames","Epic Games Store"]],
  ['etihad', require('../../../assets/merchants/etihad.png'), ["Etihad","Etihad Airways","طيران الاتحاد"]],
  ['etoro', require('../../../assets/merchants/etoro.png'), ["eToro","eToro.com","ايتورو"]],
  ['fitnessfirst', require('../../../assets/merchants/fitnessfirst.png'), ["Fitness First","FitnessFirst","فيتنس فيرست"]],
  ['fiverr', require('../../../assets/merchants/fiverr.png'), ["Fiverr","Fiverr.com"]],
  ['flydubai', require('../../../assets/merchants/flydubai.png'), ["flydubai","Fly Dubai","فلاي دبي"]],
  ['godaddy', require('../../../assets/merchants/godaddy.png'), ["GoDaddy","GoDaddy.com"]],
  ['grab', require('../../../assets/merchants/grab.png'), ["Grab","Grab.com","Grab Food","GrabFood","Grab Transport"]],
  ['hetzner', require('../../../assets/merchants/hetzner.png'), ["Hetzner","Hetzner Online","Hetzner Cloud"]],
  ['instashop', require('../../../assets/merchants/instashop.png'), ["InstaShop","Insta Shop","انستاشوب"]],
  ['justlife', require('../../../assets/merchants/justlife.png'), ["Justlife","Just Life","Justmop","جست لايف"]],
  ['keeta', require('../../../assets/merchants/keeta.png'), ["Keeta","Keeta Food","كيتا"]],
  ['lifepharmacy', require('../../../assets/merchants/lifepharmacy.png'), ["LIFE Pharmacy","Life Pharmacies","صيدلية لايف"]],
  ['linkedin', require('../../../assets/merchants/linkedin.png'), ["LinkedIn","LinkedIn Premium","LinkedIn Ireland"]],
  ['marksandspencer', require('../../../assets/merchants/marksandspencer.png'), ["Marks & Spencer","Marks and Spencer","M&S","ماركس اند سبنسر"]],
  ['namecheap', require('../../../assets/merchants/namecheap.png'), ["Namecheap","Namecheap.com"]],
  ['namshi', require('../../../assets/merchants/namshi.png'), ["Namshi","Namshi.com","نمشي"]],
  ['nike', require('../../../assets/merchants/nike.png'), ["Nike","Nike Store","Nike.com","نايك"]],
  ['openrouter', require('../../../assets/merchants/openrouter.png'), ["OpenRouter","OpenRouter.ai"]],
  ['perplexity', require('../../../assets/merchants/perplexity.png'), ["Perplexity","Perplexity AI","Perplexity Pro"]],
  ['pizzahut', require('../../../assets/merchants/pizzahut.png'), ["Pizza Hut","PizzaHut","بيتزا هت"]],
  ['playstation', require('../../../assets/merchants/playstation.png'), ["PlayStation","PlayStation Network","PlayStation Plus","PSN","بلايستيشن"]],
  ['puma', require('../../../assets/merchants/puma.png'), ["Puma","Puma Store","بوما"]],
  ['qatarairways', require('../../../assets/merchants/qatarairways.png'), ["Qatar Airways","QatarAirways","الخطوط الجوية القطرية","الخطوط القطرية"]],
  ['reelcinemas', require('../../../assets/merchants/reelcinemas.png'), ["Reel Cinemas","Reel Cinemas Dubai","ريل سينما"]],
  ['salik', require('../../../assets/merchants/salik.png'), ["Salik","Salik Auto Recharge","Salik Recharge","سالك"]],
  ['sewa', require('../../../assets/merchants/sewa.png'), ["SEWA","SEWA Bill","Sharjah Electricity Water and Gas Authority","سيوا","هيئة كهرباء ومياه وغاز الشارقة"]],
  ['shahid', require('../../../assets/merchants/shahid.png'), ["Shahid","Shahid VIP","Shahid.net","شاهد","شاهد VIP"]],
  ['sharjahcoop', require('../../../assets/merchants/sharjahcoop.png'), ["Sharjah Coop","Sharjah Co-op","Sharjah Cooperative Society","تعاونية الشارقة"]],
  ['shein', require('../../../assets/merchants/shein.png'), ["SHEIN","SHEIN.com","شي ان","شي إن"]],
  ['steam', require('../../../assets/merchants/steam.png'), ["Steam","Steam Games","Steam Purchase","Steampowered.com"]],
  ['tabby', require('../../../assets/merchants/tabby.png'), ["Tabby","Tabby.ai","Tabby Installment","تابي"]],
  ['tamara', require('../../../assets/merchants/tamara.png'), ["Tamara","Tamara.co","تمارا"]],
  ['temu', require('../../../assets/merchants/temu.png'), ["Temu","Temu.com","تيمو"]],
  ['timhortons', require('../../../assets/merchants/timhortons.png'), ["Tim Hortons","TimHortons","تيم هورتنز"]],
  ['tripdotcom', require('../../../assets/merchants/tripdotcom.png'), ["Trip.com","Trip com"]],
  ['turkishairlines', require('../../../assets/merchants/turkishairlines.png'), ["Turkish Airlines","TurkishAirlines","الخطوط التركية"]],
  ['twitch', require('../../../assets/merchants/twitch.png'), ["Twitch","Twitch Interactive","Twitch.tv"]],
  ['udemy', require('../../../assets/merchants/udemy.png'), ["Udemy","Udemy.com","يوديمي"]],
  ['underarmour', require('../../../assets/merchants/underarmour.png'), ["Under Armour","UnderArmour","اندر ارمور"]],
  ['unioncoop', require('../../../assets/merchants/unioncoop.png'), ["Union Coop","Union Cooperative","تعاونية الاتحاد"]],
  ['upwork', require('../../../assets/merchants/upwork.png'), ["Upwork","Upwork.com"]],
  ['urbancompany', require('../../../assets/merchants/urbancompany.png'), ["Urban Company","UrbanClap","Urban Clap"]],
  ['vercel', require('../../../assets/merchants/vercel.png'), ["Vercel","Vercel Inc","Vercel Pro"]],
  ['vox', require('../../../assets/merchants/vox.png'), ["VOX","VOX Cinemas","فوكس سينما","فوكس سينماز"]],
  ['waitrose', require('../../../assets/merchants/waitrose.png'), ["Waitrose","Waitrose UAE","ويتروز"]],
  ['wizzair', require('../../../assets/merchants/wizzair.png'), ["Wizz Air","WizzAir","ويز اير"]],
  ['xbox', require('../../../assets/merchants/xbox.png'), ["Xbox","Xbox Game Pass","Xbox Live","Microsoft Xbox","اكس بوكس"]],
  ['zara', require('../../../assets/merchants/zara.png'), ["Zara","Zara.com","زارا"]],
  ['zomato', require('../../../assets/merchants/zomato.png'), ["Zomato","Zomato Gold","زوماتو"]],
  ['zoom', require('../../../assets/merchants/zoom.png'), ["Zoom","Zoom.us","Zoom Video Communications"]],
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

// Reviewed transparent, single-ink artwork. Colored brand marks retain their
// original pixels; only these silhouettes adapt to light/dark backgrounds.
const MONOCHROME_LOGOS = new Set([
  'adidas', 'apple', 'cursor', 'epicgames', 'github', 'nike', 'notion',
  'puma', 'steam', 'uber', 'underarmour', 'vercel', 'zara',
]);

const LOGOS = new Map<string, MerchantLogo>();
for (const [id, source, aliases] of ENTRIES) {
  const tint = MONOCHROME_LOGOS.has(id) ? 'theme' : id === 'qatarairways' ? 'dark' : undefined;
  const logo: MerchantLogo = Object.freeze({ id, source, ...(tint ? { tint } : {}) });
  for (const alias of aliases) {
    const key = keyFor(alias);
    if (LOGOS.has(key) && LOGOS.get(key)!.id !== id) throw new Error('merchant_logo_alias_conflict');
    LOGOS.set(key, logo);
  }
}

export function merchantLogoDecision(title: string): {
  logo: MerchantLogo | null; reason: 'exact-alias' | 'location-or-terminal' | 'unknown' | 'unsafe-text';
} {
  if (typeof title !== 'string' || title.length > 240 || !title.trim() ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(title)) {
    return { logo: null, reason: 'unsafe-text' };
  }
  let candidate = title.normalize('NFKC').trim();
  // Remove only known location/terminal tails, never arbitrary brand substrings
  // or payment-provider prefixes. "Cafe near Carrefour" stays an unknown cafe.
  for (let attempt = 0; attempt < 5; attempt++) {
    const logo = LOGOS.get(keyFor(candidate));
    if (logo) return { logo, reason: attempt === 0 ? 'exact-alias' : 'location-or-terminal' };
    // Trim only separately written location/terminal words. Stripping after
    // punctuation normalization made amazon.ae.dubai and apple.com/bill/123
    // impersonate known merchants. A host/path is not a location footer.
    const shorter = candidate.replace(/\s+(?:dubai|dxb|abu dhabi|sharjah|ajman|riyadh|jeddah|uae|are|ae|ksa|sau|sa|دبي|ابوظبي|ابو ظبي|الشارقة|الرياض|جدة|#?\d{3,12})$/i, '');
    if (shorter === candidate) return { logo: null, reason: 'unknown' };
    candidate = shorter;
  }
  const logo = LOGOS.get(keyFor(candidate)) ?? null;
  return { logo, reason: logo ? 'location-or-terminal' : 'unknown' };
}

export function merchantLogoFor(title: string): MerchantLogo | null {
  return merchantLogoDecision(title).logo;
}
