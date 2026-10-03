import { getMonthStartDay, toISODate } from '@/lib/format';
import { currentMonthPeriod, previousPeriod, type Period } from '@/lib/period';
import type { CategoryId } from '@/lib/types';
import type { AssistantToolRequest } from '@/lib/wafra-assistant';
import { isAssistantToolRequest } from '@/lib/wafra-assistant-ai';

/**
 * Ask Wafra: mapping for the small on-device question tagger.
 *
 * The tagger is one multilingual encoder with two heads over the same
 * tokenizer: a sequence intent classifier and a BIO slot tagger. It never
 * produces a number, an identifier or a date. It only says WHICH closed intent
 * the question has and WHICH character spans of the question name a category,
 * merchant, account, period, comparison period or result count.
 *
 * This module turns that output into the same `AssistantToolRequest` the
 * deterministic planner produces, or refuses (null). Every value comes from
 * the user's own words normalised against closed vocabularies below, or from
 * the ledger's own merchant/account names. The executor still computes every
 * figure. Rules always run first and the model never overrides them.
 */

export const ASK_INTENTS = [
  'spending_total',
  'income_total',
  'compare_periods',
  'top_merchants',
  'top_categories',
  'largest_purchases',
  'daily_average',
  'net_income_spending',
  'subscriptions',
  'upcoming_payments',
  'unusual_charges',
  'possible_duplicates',
  'recurring_changes',
  'month_forecast',
  'top_accounts',
  'account_inventory',
  'unknown',
] as const;
export type AskIntent = typeof ASK_INTENTS[number];

export const ASK_SLOT_LABELS = ['Q_CAT', 'Q_MER', 'Q_ACCT', 'Q_PERIOD', 'Q_CMP', 'Q_TOPN'] as const;
export type AskSlotLabel = typeof ASK_SLOT_LABELS[number];
/** BIO tag inventory for the slot head, in a fixed order (index = class id). */
export const ASK_BIO_LABELS: readonly string[] = ['O', ...ASK_SLOT_LABELS.flatMap((label) => [`B-${label}`, `I-${label}`])];

/** Which slot labels each intent may carry. A span outside this set refuses: its scope would be dropped. */
export const ASK_INTENT_SLOTS: Readonly<Record<AskIntent, readonly AskSlotLabel[]>> = {
  spending_total: ['Q_CAT', 'Q_MER', 'Q_ACCT', 'Q_PERIOD'],
  income_total: ['Q_ACCT', 'Q_PERIOD'],
  compare_periods: ['Q_CAT', 'Q_MER', 'Q_ACCT', 'Q_PERIOD', 'Q_CMP'],
  top_merchants: ['Q_CAT', 'Q_ACCT', 'Q_PERIOD', 'Q_TOPN'],
  top_categories: ['Q_ACCT', 'Q_PERIOD', 'Q_TOPN'],
  largest_purchases: ['Q_CAT', 'Q_MER', 'Q_ACCT', 'Q_PERIOD', 'Q_TOPN'],
  daily_average: ['Q_CAT', 'Q_MER', 'Q_ACCT', 'Q_PERIOD'],
  net_income_spending: ['Q_ACCT', 'Q_PERIOD'],
  subscriptions: [],
  upcoming_payments: [],
  unusual_charges: ['Q_MER', 'Q_ACCT', 'Q_PERIOD'],
  possible_duplicates: ['Q_MER', 'Q_ACCT', 'Q_PERIOD'],
  recurring_changes: ['Q_MER', 'Q_ACCT', 'Q_PERIOD'],
  month_forecast: ['Q_CAT', 'Q_MER', 'Q_ACCT', 'Q_PERIOD'],
  top_accounts: ['Q_CAT', 'Q_MER', 'Q_PERIOD', 'Q_TOPN'],
  account_inventory: [],
  unknown: [],
};

export const ASK_LANGUAGES = ['en', 'ar', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'tr', 'id', 'hi-Latn'] as const;
export type AskLanguage = typeof ASK_LANGUAGES[number];

export const ASK_FIXED_PERIOD_KEYS = ['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month',
  'this-year', 'last-year', 'all-time'] as const;
export type AskFixedPeriodKey = typeof ASK_FIXED_PERIOD_KEYS[number];
/** Normalised period key: a fixed key, `month:M`, `since-month:M` (M = 1..12) or `last-days:N` (N = 1..90). */
export type AskPeriodKey = AskFixedPeriodKey | `month:${number}` | `since-month:${number}` | `last-days:${number}`;

type Lexicon<K extends string> = Readonly<Record<AskLanguage, Partial<Record<K, readonly string[]>>>>;

/**
 * Category surface forms per language. Deliberately the whole-category words
 * only: narrow concepts (coffee, fuel, clothes …) are NOT aliases, matching
 * the deterministic planner's rule that a subset never becomes a broader total.
 */
export const ASK_CATEGORY_LEXICON: Lexicon<CategoryId> = {
  en: {
    groceries: ['groceries', 'grocery', 'supermarket', 'supermarkets'],
    dining: ['dining', 'restaurants', 'restaurant', 'eating out', 'food'],
    transport: ['transport', 'transportation', 'taxi', 'taxis'],
    utilities: ['utilities', 'electricity'],
    telecom: ['telecom', 'phone', 'mobile'],
    rent: ['rent'],
    shopping: ['shopping'],
    health: ['health', 'medical', 'pharmacy', 'doctor'],
    'personal-care': ['personal care', 'salon', 'barber'],
    'home-services': ['home services', 'cleaning', 'maintenance'],
    education: ['education', 'school', 'university'],
    travel: ['travel', 'flights', 'hotels'],
    entertainment: ['entertainment', 'movies', 'gaming'],
    software: ['software', 'apps'],
    charity: ['charity', 'donations'],
    government: ['government', 'visa fees'],
    loan: ['loan', 'loans', 'instalments'],
    investing: ['investing', 'investments', 'crypto'],
    'cash-withdrawal': ['cash withdrawals', 'atm'],
  },
  ar: {
    groceries: ['البقالة', 'السوبرماركت', 'المقاضي'],
    dining: ['المطاعم', 'المطعم', 'الأكل برا', 'الأكل في المطاعم'],
    transport: ['المواصلات', 'التاكسي', 'النقل'],
    utilities: ['الكهرباء والماء', 'الكهرباء', 'المرافق'],
    telecom: ['الاتصالات', 'الجوال', 'الهاتف'],
    rent: ['الإيجار', 'إيجار البيت'],
    shopping: ['التسوق', 'الشوبينق', 'الشوبينغ'],
    health: ['الصحة', 'العلاج', 'الصيدلية', 'المستشفى'],
    'personal-care': ['العناية الشخصية', 'الصالون', 'الحلاق'],
    'home-services': ['خدمات المنزل', 'التنظيف', 'الصيانة'],
    education: ['التعليم', 'المدارس', 'الجامعة', 'الدراسة'],
    travel: ['السفر', 'الطيران', 'الفنادق'],
    entertainment: ['الترفيه', 'السينما', 'الألعاب'],
    software: ['البرمجيات', 'التطبيقات'],
    charity: ['الصدقة', 'الصدقات', 'التبرعات'],
    government: ['الخدمات الحكومية', 'المعاملات الحكومية'],
    loan: ['القروض', 'القرض', 'الأقساط'],
    investing: ['الاستثمار', 'الأسهم', 'العملات الرقمية'],
    'cash-withdrawal': ['السحب النقدي', 'سحب الكاش', 'الصراف'],
  },
  es: {
    groceries: ['supermercado', 'comestibles'],
    dining: ['restaurantes', 'comer fuera', 'comida'],
    transport: ['transporte', 'taxi'],
    utilities: ['luz', 'electricidad', 'suministros'],
    telecom: ['teléfono', 'móvil'],
    rent: ['alquiler', 'renta'],
    shopping: ['shopping', 'ir de compras'],
    health: ['salud', 'farmacia', 'médico'],
    'personal-care': ['cuidado personal', 'peluquería'],
    'home-services': ['servicios del hogar', 'limpieza'],
    education: ['educación', 'colegio', 'universidad'],
    travel: ['viajes', 'vuelos', 'hoteles'],
    entertainment: ['entretenimiento', 'ocio', 'cine'],
    software: ['software', 'aplicaciones'],
    charity: ['donaciones', 'caridad'],
    government: ['gobierno', 'trámites'],
    loan: ['préstamo', 'préstamos', 'cuotas'],
    investing: ['inversiones', 'inversión'],
    'cash-withdrawal': ['retiros de efectivo', 'cajero'],
  },
  pt: {
    groceries: ['supermercado', 'mercado'],
    dining: ['restaurantes', 'comer fora', 'comida'],
    transport: ['transporte', 'táxi'],
    utilities: ['luz', 'energia', 'água e luz'],
    telecom: ['telefone', 'celular', 'telemóvel'],
    rent: ['aluguel', 'aluguer'],
    shopping: ['shopping', 'fazer compras'],
    health: ['saúde', 'farmácia', 'médico'],
    'personal-care': ['cuidados pessoais', 'salão', 'cabeleireiro'],
    'home-services': ['serviços domésticos', 'limpeza'],
    education: ['educação', 'escola', 'faculdade'],
    travel: ['viagens', 'passagens', 'hotéis'],
    entertainment: ['entretenimento', 'lazer', 'cinema'],
    software: ['software', 'aplicativos'],
    charity: ['doações', 'caridade'],
    government: ['governo'],
    loan: ['empréstimo', 'empréstimos', 'parcelas'],
    investing: ['investimentos'],
    'cash-withdrawal': ['saques', 'caixa eletrônico'],
  },
  fr: {
    groceries: ['courses', 'supermarché', 'épicerie'],
    dining: ['restaurants', 'restaurant', 'resto'],
    transport: ['transports', 'transport', 'taxi'],
    utilities: ['électricité', 'énergie'],
    telecom: ['téléphone', 'mobile'],
    rent: ['loyer'],
    shopping: ['shopping', 'lèche-vitrine'],
    health: ['santé', 'pharmacie', 'médecin'],
    'personal-care': ['soins personnels', 'coiffeur'],
    'home-services': ['services à domicile', 'ménage'],
    education: ['éducation', 'école', 'études'],
    travel: ['voyages', 'vols', 'hôtels'],
    entertainment: ['loisirs', 'divertissement', 'cinéma'],
    software: ['logiciels', 'applis'],
    charity: ['dons', 'charité'],
    government: ['administration'],
    loan: ['prêt', 'prêts'],
    investing: ['investissements', 'placements'],
    'cash-withdrawal': ['retraits', 'distributeur'],
  },
  de: {
    groceries: ['Lebensmittel', 'Supermarkt'],
    dining: ['Restaurants', 'Essen gehen', 'Essen'],
    transport: ['Transport', 'Taxi', 'Nahverkehr'],
    utilities: ['Strom', 'Nebenkosten', 'Energie'],
    telecom: ['Handy', 'Telefon', 'Mobilfunk'],
    rent: ['Miete'],
    shopping: ['Shopping', 'Einkaufen'],
    health: ['Gesundheit', 'Apotheke', 'Arzt'],
    'personal-care': ['Körperpflege', 'Friseur'],
    'home-services': ['Reinigung', 'Handwerker'],
    education: ['Bildung', 'Schule', 'Uni'],
    travel: ['Reisen', 'Flüge', 'Hotels'],
    entertainment: ['Unterhaltung', 'Freizeit', 'Kino'],
    software: ['Software', 'Apps'],
    charity: ['Spenden'],
    government: ['Behörden'],
    loan: ['Kredit', 'Kredite', 'Raten'],
    investing: ['Geldanlage', 'Investitionen', 'Aktien'],
    'cash-withdrawal': ['Bargeldabhebungen', 'Geldautomat'],
  },
  it: {
    groceries: ['supermercato', 'alimentari'],
    dining: ['ristoranti', 'mangiare fuori', 'cibo'],
    transport: ['trasporti', 'taxi'],
    utilities: ['luce e gas', 'utenze', 'elettricità'],
    telecom: ['telefono', 'cellulare'],
    rent: ['affitto'],
    shopping: ['shopping'],
    health: ['salute', 'farmacia', 'medico'],
    'personal-care': ['cura personale', 'parrucchiere'],
    'home-services': ['servizi per la casa', 'pulizie'],
    education: ['istruzione', 'scuola', 'università'],
    travel: ['viaggi', 'voli', 'hotel'],
    entertainment: ['intrattenimento', 'svago', 'cinema'],
    software: ['software', 'app'],
    charity: ['beneficenza', 'donazioni'],
    government: ['governo'],
    loan: ['prestito', 'prestiti', 'rate'],
    investing: ['investimenti'],
    'cash-withdrawal': ['prelievi', 'bancomat'],
  },
  nl: {
    groceries: ['boodschappen', 'supermarkt'],
    dining: ['restaurants', 'uit eten', 'eten'],
    transport: ['vervoer', 'openbaar vervoer', 'taxi'],
    utilities: ['energie', 'gas en licht', 'nutsvoorzieningen'],
    telecom: ['telefoon', 'mobiel'],
    rent: ['huur'],
    shopping: ['winkelen', 'shoppen'],
    health: ['gezondheid', 'apotheek', 'dokter'],
    'personal-care': ['persoonlijke verzorging', 'kapper'],
    'home-services': ['huishoudelijke diensten', 'schoonmaak'],
    education: ['onderwijs', 'school', 'studie'],
    travel: ['reizen', 'vluchten', 'hotels'],
    entertainment: ['entertainment', 'uitgaan', 'bioscoop'],
    software: ['software', 'apps'],
    charity: ['goede doelen', 'donaties'],
    government: ['overheid', 'gemeente'],
    loan: ['lening', 'leningen', 'aflossingen'],
    investing: ['beleggingen', 'beleggen'],
    'cash-withdrawal': ['geldopnames', 'pinautomaat'],
  },
  tr: {
    groceries: ['market alışverişi', 'market', 'bakkal'],
    dining: ['restoranlar', 'restoran', 'dışarıda yemek', 'yemek'],
    transport: ['ulaşım', 'taksi'],
    utilities: ['elektrik ve su', 'elektrik'],
    telecom: ['cep telefonu', 'telefon'],
    rent: ['kira'],
    shopping: ['alışveriş'],
    health: ['sağlık', 'eczane', 'doktor'],
    'personal-care': ['kişisel bakım', 'kuaför'],
    'home-services': ['ev hizmetleri', 'temizlik'],
    education: ['eğitim', 'okul', 'üniversite'],
    travel: ['seyahat', 'uçak bileti', 'otel'],
    entertainment: ['eğlence', 'sinema'],
    software: ['yazılım', 'uygulamalar'],
    charity: ['bağışlar', 'bağış'],
    government: ['resmi işlemler', 'devlet'],
    loan: ['krediler', 'kredi', 'taksitler'],
    investing: ['yatırımlar', 'yatırım'],
    'cash-withdrawal': ['nakit çekim', 'ATM'],
  },
  id: {
    groceries: ['sembako', 'supermarket', 'belanja dapur'],
    dining: ['restoran', 'makan di luar', 'makanan'],
    transport: ['transportasi', 'taksi', 'ojek'],
    utilities: ['listrik', 'listrik dan air', 'utilitas'],
    telecom: ['pulsa', 'telepon'],
    rent: ['sewa', 'kontrakan'],
    shopping: ['shopping', 'belanja online'],
    health: ['kesehatan', 'apotek', 'dokter'],
    'personal-care': ['perawatan diri', 'salon'],
    'home-services': ['jasa rumah tangga', 'kebersihan'],
    education: ['pendidikan', 'sekolah', 'kuliah'],
    travel: ['perjalanan', 'liburan', 'tiket pesawat', 'hotel'],
    entertainment: ['hiburan', 'bioskop'],
    software: ['aplikasi', 'software'],
    charity: ['donasi', 'sedekah', 'amal'],
    government: ['pemerintah'],
    loan: ['pinjaman', 'cicilan', 'kredit'],
    investing: ['investasi', 'saham'],
    'cash-withdrawal': ['tarik tunai', 'ATM'],
  },
  'hi-Latn': {
    groceries: ['kirana', 'grocery', 'ration'],
    dining: ['bahar ka khana', 'restaurants', 'food'],
    transport: ['transport', 'auto', 'taxi'],
    utilities: ['bijli', 'bijli pani', 'electricity'],
    telecom: ['mobile recharge', 'recharge', 'phone'],
    rent: ['kiraya', 'rent'],
    shopping: ['shopping'],
    health: ['dawai', 'doctor', 'medical'],
    'personal-care': ['salon', 'parlour'],
    'home-services': ['safai', 'home services'],
    education: ['padhai', 'school', 'college'],
    travel: ['travel', 'trip', 'flights'],
    entertainment: ['entertainment', 'movies'],
    software: ['apps', 'software'],
    charity: ['daan', 'donation'],
    government: ['sarkari kaam', 'government'],
    loan: ['EMI', 'loan'],
    investing: ['investment', 'SIP', 'shares'],
    'cash-withdrawal': ['ATM', 'cash nikalna'],
  },
};

export const ASK_PERIOD_LEXICON: Lexicon<AskFixedPeriodKey> = {
  en: {
    today: ['today'], yesterday: ['yesterday'], 'this-week': ['this week'], 'last-week': ['last week'],
    'this-month': ['this month', 'current month'], 'last-month': ['last month', 'previous month'],
    'this-year': ['this year'], 'last-year': ['last year'], 'all-time': ['all time', 'ever'],
  },
  ar: {
    today: ['اليوم'], yesterday: ['أمس', 'البارحة'],
    'this-week': ['هذا الأسبوع', 'هالأسبوع'], 'last-week': ['الأسبوع الماضي', 'الأسبوع اللي فات'],
    'this-month': ['هذا الشهر', 'هالشهر', 'الشهر الحالي'], 'last-month': ['الشهر الماضي', 'الشهر اللي فات', 'الشهر اللي راح'],
    'this-year': ['هذه السنة', 'هالسنة', 'هذا العام'], 'last-year': ['السنة الماضية', 'العام الماضي', 'السنة اللي فاتت'],
    'all-time': ['طوال الوقت', 'من البداية'],
  },
  es: {
    today: ['hoy'], yesterday: ['ayer'], 'this-week': ['esta semana'], 'last-week': ['la semana pasada'],
    'this-month': ['este mes'], 'last-month': ['el mes pasado'], 'this-year': ['este año'], 'last-year': ['el año pasado'],
    'all-time': ['desde siempre', 'de todos los tiempos'],
  },
  pt: {
    today: ['hoje'], yesterday: ['ontem'], 'this-week': ['esta semana', 'essa semana'], 'last-week': ['semana passada'],
    'this-month': ['este mês', 'esse mês'], 'last-month': ['mês passado'], 'this-year': ['este ano', 'esse ano'],
    'last-year': ['ano passado'], 'all-time': ['desde sempre', 'desde o início'],
  },
  fr: {
    today: ["aujourd'hui"], yesterday: ['hier'], 'this-week': ['cette semaine'], 'last-week': ['la semaine dernière'],
    'this-month': ['ce mois-ci', 'ce mois'], 'last-month': ['le mois dernier'], 'this-year': ['cette année'],
    'last-year': ["l'année dernière"], 'all-time': ['depuis toujours', 'depuis le début'],
  },
  de: {
    today: ['heute'], yesterday: ['gestern'], 'this-week': ['diese Woche'], 'last-week': ['letzte Woche', 'vergangene Woche'],
    'this-month': ['diesen Monat', 'dieser Monat'], 'last-month': ['letzten Monat', 'letzter Monat', 'vorigen Monat'],
    'this-year': ['dieses Jahr'], 'last-year': ['letztes Jahr', 'letzten Jahr'], 'all-time': ['insgesamt', 'seit Beginn'],
  },
  it: {
    today: ['oggi'], yesterday: ['ieri'], 'this-week': ['questa settimana'], 'last-week': ['la settimana scorsa'],
    'this-month': ['questo mese'], 'last-month': ['il mese scorso'], 'this-year': ["quest'anno"],
    'last-year': ["l'anno scorso"], 'all-time': ['da sempre', 'in totale'],
  },
  nl: {
    today: ['vandaag'], yesterday: ['gisteren'], 'this-week': ['deze week'], 'last-week': ['vorige week'],
    'this-month': ['deze maand'], 'last-month': ['vorige maand'], 'this-year': ['dit jaar'], 'last-year': ['vorig jaar'],
    'all-time': ['ooit', 'sinds het begin'],
  },
  tr: {
    today: ['bugün'], yesterday: ['dün'], 'this-week': ['bu hafta'], 'last-week': ['geçen hafta'],
    'this-month': ['bu ay'], 'last-month': ['geçen ay'], 'this-year': ['bu yıl', 'bu sene'],
    'last-year': ['geçen yıl', 'geçen sene'], 'all-time': ['tüm zamanlar', 'şimdiye kadar'],
  },
  id: {
    today: ['hari ini'], yesterday: ['kemarin'], 'this-week': ['minggu ini'], 'last-week': ['minggu lalu'],
    'this-month': ['bulan ini'], 'last-month': ['bulan lalu', 'bulan kemarin'], 'this-year': ['tahun ini'],
    'last-year': ['tahun lalu'], 'all-time': ['sepanjang waktu', 'selama ini'],
  },
  'hi-Latn': {
    today: ['aaj', 'today'], yesterday: ['kal', 'yesterday'], 'this-week': ['is hafte', 'this week'],
    'last-week': ['pichle hafte', 'last week'], 'this-month': ['is mahine', 'iss mahine', 'this month'],
    'last-month': ['pichle mahine', 'last month'], 'this-year': ['is saal', 'iss saal', 'this year'],
    'last-year': ['pichle saal', 'last year'], 'all-time': ['ab tak', 'shuru se'],
  },
};

/** Month names, index 0 = January. Each entry lists accepted variants. */
export const ASK_MONTH_NAMES: Readonly<Record<AskLanguage, readonly (readonly string[])[]>> = {
  en: [['January', 'Jan'], ['February', 'Feb'], ['March'], ['April'], ['May'], ['June'], ['July'], ['August'],
    ['September', 'Sept'], ['October'], ['November'], ['December']],
  ar: [['يناير', 'كانون الثاني'], ['فبراير', 'شباط'], ['مارس', 'آذار'], ['أبريل', 'نيسان'], ['مايو', 'أيار'],
    ['يونيو', 'حزيران'], ['يوليو', 'تموز'], ['أغسطس'], ['سبتمبر', 'أيلول'], ['أكتوبر', 'تشرين الأول'],
    ['نوفمبر', 'تشرين الثاني'], ['ديسمبر', 'كانون الأول']],
  es: [['enero'], ['febrero'], ['marzo'], ['abril'], ['mayo'], ['junio'], ['julio'], ['agosto'], ['septiembre'],
    ['octubre'], ['noviembre'], ['diciembre']],
  pt: [['janeiro'], ['fevereiro'], ['março'], ['abril'], ['maio'], ['junho'], ['julho'], ['agosto'], ['setembro'],
    ['outubro'], ['novembro'], ['dezembro']],
  fr: [['janvier'], ['février'], ['mars'], ['avril'], ['mai'], ['juin'], ['juillet'], ['août'], ['septembre'],
    ['octobre'], ['novembre'], ['décembre']],
  de: [['Januar'], ['Februar'], ['März'], ['April'], ['Mai'], ['Juni'], ['Juli'], ['August'], ['September'],
    ['Oktober'], ['November'], ['Dezember']],
  it: [['gennaio'], ['febbraio'], ['marzo'], ['aprile'], ['maggio'], ['giugno'], ['luglio'], ['agosto'], ['settembre'],
    ['ottobre'], ['novembre'], ['dicembre']],
  nl: [['januari'], ['februari'], ['maart'], ['april'], ['mei'], ['juni'], ['juli'], ['augustus'], ['september'],
    ['oktober'], ['november'], ['december']],
  tr: [['Ocak'], ['Şubat'], ['Mart'], ['Nisan'], ['Mayıs'], ['Haziran'], ['Temmuz'], ['Ağustos'], ['Eylül'],
    ['Ekim'], ['Kasım'], ['Aralık']],
  id: [['Januari'], ['Februari'], ['Maret'], ['April'], ['Mei'], ['Juni'], ['Juli'], ['Agustus'], ['September'],
    ['Oktober'], ['November'], ['Desember']],
  'hi-Latn': [['January'], ['February'], ['March'], ['April'], ['May'], ['June'], ['July'], ['August'], ['September'],
    ['October'], ['November'], ['December']],
};

/** Words that turn a month inside a period span into "since that month". */
export const ASK_SINCE_WORDS: Readonly<Record<AskLanguage, readonly string[]>> = {
  en: ['since', 'from'], ar: ['منذ', 'من'], es: ['desde'], pt: ['desde'], fr: ['depuis'], de: ['seit', 'ab'],
  it: ['da', 'dal', 'dall'], nl: ['sinds', 'vanaf'], tr: ['beri', 'itibaren'], id: ['sejak', 'dari'], 'hi-Latn': ['se', 'since'],
};

/** Day nouns for "last N days". */
export const ASK_DAY_WORDS: Readonly<Record<AskLanguage, readonly string[]>> = {
  en: ['day', 'days'], ar: ['يوم', 'أيام', 'ايام'], es: ['día', 'días'], pt: ['dia', 'dias'], fr: ['jour', 'jours'],
  de: ['Tag', 'Tage', 'Tagen'], it: ['giorno', 'giorni'], nl: ['dag', 'dagen'], tr: ['gün'], id: ['hari'],
  'hi-Latn': ['din', 'day', 'days'],
};

/** Cardinal words 1..10 (index 0 = one). Numbers are read from the user's words, never generated. */
export const ASK_NUMBER_WORDS: Readonly<Record<AskLanguage, readonly (readonly string[])[]>> = {
  en: [['one'], ['two'], ['three'], ['four'], ['five'], ['six'], ['seven'], ['eight'], ['nine'], ['ten']],
  ar: [['واحد'], ['اثنين', 'اثنان'], ['ثلاث', 'ثلاثة'], ['أربع', 'أربعة'], ['خمس', 'خمسة'], ['ست', 'ستة'],
    ['سبع', 'سبعة'], ['ثمان', 'ثمانية'], ['تسع', 'تسعة'], ['عشر', 'عشرة']],
  es: [['uno', 'una'], ['dos'], ['tres'], ['cuatro'], ['cinco'], ['seis'], ['siete'], ['ocho'], ['nueve'], ['diez']],
  pt: [['um', 'uma'], ['dois', 'duas'], ['três'], ['quatro'], ['cinco'], ['seis'], ['sete'], ['oito'], ['nove'], ['dez']],
  fr: [['un', 'une'], ['deux'], ['trois'], ['quatre'], ['cinq'], ['six'], ['sept'], ['huit'], ['neuf'], ['dix']],
  de: [['eins'], ['zwei'], ['drei'], ['vier'], ['fünf'], ['sechs'], ['sieben'], ['acht'], ['neun'], ['zehn']],
  it: [['uno'], ['due'], ['tre'], ['quattro'], ['cinque'], ['sei'], ['sette'], ['otto'], ['nove'], ['dieci']],
  nl: [['een'], ['twee'], ['drie'], ['vier'], ['vijf'], ['zes'], ['zeven'], ['acht'], ['negen'], ['tien']],
  tr: [['bir'], ['iki'], ['üç'], ['dört'], ['beş'], ['altı'], ['yedi'], ['sekiz'], ['dokuz'], ['on']],
  id: [['satu'], ['dua'], ['tiga'], ['empat'], ['lima'], ['enam'], ['tujuh'], ['delapan'], ['sembilan'], ['sepuluh']],
  'hi-Latn': [['ek'], ['do'], ['teen'], ['char'], ['paanch'], ['chhe'], ['saat'], ['aath'], ['nau'], ['das']],
};

/** Card nouns; only used to choose top-accounts' closed accountKind, never an identifier. */
export const ASK_CARD_WORDS: readonly string[] = ['card', 'cards', 'بطاقة', 'بطاقات', 'البطاقة', 'البطاقات', 'كرت', 'الكرت',
  'tarjeta', 'tarjetas', 'cartão', 'cartões', 'carte', 'cartes', 'Karte', 'Karten', 'carta', 'kaart', 'kaarten',
  'kart', 'kartı', 'kartım', 'kartu'];

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const ARABIC_DIGITS = /[٠-٩۰-۹]/gu;
function asciiDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function normalizeArabicWord(word: string): string {
  let w = word;
  if (/^هال./u.test(w)) return `هذا ${w.slice(3)}`;
  w = w.replace(/^(?:و|ف)?(?:بال|كال|لل|ال)(?=..)/u, '');
  return w;
}

/**
 * Lower-case, accent-, diacritic- and article-insensitive word tokens. The
 * same function normalises both the lexicons and the question, so every
 * lexicon match is a whole-word match in the user's own text.
 */
export function askTokens(value: string): string[] {
  const base = asciiDigits(value.normalize('NFKC'))
    .replace(/[ً-ٰٟـ]/gu, '')
    .replace(/[أإآ]/gu, 'ا').replace(/ة/gu, 'ه').replace(/ى/gu, 'ي')
    .toLocaleLowerCase('en-US')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '').normalize('NFC')
    .replace(/[’'`´-]/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!base) return [];
  return base.split(/\s+/u).flatMap((word) => (/\p{Script=Arabic}/u.test(word) ? normalizeArabicWord(word).split(' ') : [word]))
    .filter(Boolean);
}

function indexOfPhrase(haystack: readonly string[], needle: readonly string[]): number {
  if (!needle.length || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

interface PhraseEntry<K> { tokens: string[]; key: K }
function phraseTable<K extends string>(lexicon: Lexicon<K>): PhraseEntry<K>[] {
  const table: PhraseEntry<K>[] = [];
  for (const language of ASK_LANGUAGES) {
    for (const [key, surfaces] of Object.entries(lexicon[language]) as [K, readonly string[]][]) {
      for (const surface of surfaces) {
        const tokens = askTokens(surface);
        if (tokens.length) table.push({ tokens, key });
      }
    }
  }
  return table;
}

let categoryTable: PhraseEntry<CategoryId>[] | null = null;
let periodTable: PhraseEntry<AskFixedPeriodKey>[] | null = null;
let monthTable: PhraseEntry<number>[] | null = null;
let numberTable: Map<string, number> | null = null;
let wordSets: { since: Set<string>; day: Set<string>; card: Set<string> } | null = null;

function tables() {
  if (!categoryTable) categoryTable = phraseTable(ASK_CATEGORY_LEXICON);
  if (!periodTable) periodTable = phraseTable(ASK_PERIOD_LEXICON);
  if (!monthTable) {
    monthTable = [];
    for (const language of ASK_LANGUAGES) {
      ASK_MONTH_NAMES[language].forEach((variants, index) => {
        for (const variant of variants) monthTable!.push({ tokens: askTokens(variant), key: index + 1 });
      });
    }
  }
  if (!numberTable) {
    numberTable = new Map();
    for (const language of ASK_LANGUAGES) {
      ASK_NUMBER_WORDS[language].forEach((variants, index) => {
        for (const variant of variants) for (const token of askTokens(variant)) numberTable!.set(token, index + 1);
      });
    }
  }
  if (!wordSets) {
    const set = (values: readonly string[]) => new Set(values.flatMap(askTokens));
    wordSets = {
      since: set(ASK_LANGUAGES.flatMap((language) => ASK_SINCE_WORDS[language])),
      day: set(ASK_LANGUAGES.flatMap((language) => ASK_DAY_WORDS[language])),
      card: set(ASK_CARD_WORDS),
    };
  }
  return { categoryTable, periodTable, monthTable, numberTable, wordSets };
}

/** Longest whole-phrase match; ties between different keys are ambiguous (null). */
function longestMatch<K>(tokens: readonly string[], table: readonly PhraseEntry<K>[]): K | null | undefined {
  let best: PhraseEntry<K>[] = [];
  for (const entry of table) {
    if (indexOfPhrase(tokens, entry.tokens) < 0) continue;
    if (!best.length || entry.tokens.length > best[0].tokens.length) best = [entry];
    else if (entry.tokens.length === best[0].tokens.length) best.push(entry);
  }
  if (!best.length) return undefined;
  const keys = new Set(best.map((entry) => entry.key));
  return keys.size === 1 ? best[0].key : null;
}

/** Category id named by a span, or null when absent or ambiguous. */
export function normalizeAskCategory(text: string): CategoryId | null {
  const tokens = askTokens(text);
  if (!tokens.length) return null;
  const exact = longestMatch(tokens, tables().categoryTable);
  if (exact !== undefined) return exact;
  // Inflected single words (Turkish case suffixes, German plurals): a lexicon
  // word of 4+ letters that prefixes exactly one span word, one category only.
  const hits = new Set<CategoryId>();
  for (const entry of tables().categoryTable) {
    if (entry.tokens.length !== 1 || entry.tokens[0].length < 4) continue;
    if (tokens.some((token) => token !== entry.tokens[0] && token.startsWith(entry.tokens[0]) && token.length - entry.tokens[0].length <= 4)) {
      hits.add(entry.key);
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

function numberIn(tokens: readonly string[]): number[] {
  const values: number[] = [];
  const numbers = tables().numberTable;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) values.push(Number(token));
    else if (numbers.has(token)) values.push(numbers.get(token)!);
  }
  return values;
}

/** Result count named by a span (1..10), or null. */
export function normalizeAskTopN(text: string): number | null {
  const values = numberIn(askTokens(text));
  if (values.length !== 1) return null;
  return Number.isSafeInteger(values[0]) && values[0] >= 1 && values[0] <= 10 ? values[0] : null;
}

/** Normalised period key named by a span, or null when absent, ambiguous or unsupported. */
export function normalizeAskPeriodKey(text: string): AskPeriodKey | null {
  const tokens = askTokens(text);
  if (!tokens.length) return null;
  const { wordSets: words, monthTable: months, periodTable: periods } = tables();
  const digits = tokens.filter((token) => /^\d+$/.test(token));
  const values = numberIn(tokens);
  // "Today" is a day noun in Arabic (اليوم) and Indonesian (hari ini): only a
  // day noun WITH a count is a "last N days" window.
  if (values.length && tokens.some((token) => words.day.has(token))) {
    if (values.length !== 1) return null;
    return values[0] >= 1 && values[0] <= 90 ? `last-days:${values[0]}` : null;
  }
  // Explicit years, day numbers and ranges belong to the deterministic planner.
  if (digits.length) return null;
  const monthHits = new Set<number>();
  for (const entry of months) {
    const at = indexOfPhrase(tokens, entry.tokens);
    if (at >= 0) monthHits.add(entry.key);
    else if (entry.tokens.length === 1 && entry.tokens[0].length >= 4 &&
      tokens.some((token) => token.startsWith(entry.tokens[0]) && token.length - entry.tokens[0].length <= 5)) {
      // Turkish/Hinglish attached suffixes such as "Mart'ta", "Ocak ayından".
      monthHits.add(entry.key);
    }
  }
  if (monthHits.size > 1) return null;
  if (monthHits.size === 1) {
    const month = [...monthHits][0];
    return tokens.some((token) => words.since.has(token)) ? `since-month:${month}` : `month:${month}`;
  }
  const fixed = longestMatch(tokens, periods);
  return fixed ?? null;
}

/** Same resolution as the deterministic planner, including salary-day months. */
export function resolveAskPeriod(key: string, now: Date): Period | null {
  const today = toISODate(now);
  const shift = (days: number) => { const date = new Date(now); date.setDate(date.getDate() + days); return toISODate(date); };
  const range = (from: string, to: string): Period | null => (from <= to ? { mode: 'range', from, to } : null);
  const monthYear = (month: number) => (month - 1 > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear());
  switch (key) {
    case 'today': return range(today, today);
    case 'yesterday': return range(shift(-1), shift(-1));
    case 'this-week': return range(shift(-((now.getDay() + 6) % 7)), today);
    case 'last-week': {
      const endOffset = -((now.getDay() + 6) % 7) - 1;
      return range(shift(endOffset - 6), shift(endOffset));
    }
    case 'this-month': return currentMonthPeriod(now);
    case 'last-month': return previousPeriod(currentMonthPeriod(now));
    case 'this-year': return { mode: 'year', year: now.getFullYear() };
    case 'last-year': return { mode: 'year', year: now.getFullYear() - 1 };
    case 'all-time': return { mode: 'all' };
    default: break;
  }
  const match = /^(month|since-month|last-days):(\d+)$/.exec(key);
  if (!match) return null;
  const value = Number(match[2]);
  if (match[1] === 'last-days') return value >= 1 && value <= 90 ? range(shift(-(value - 1)), today) : null;
  if (value < 1 || value > 12) return null;
  const year = monthYear(value);
  const mm = String(value).padStart(2, '0');
  if (match[1] === 'since-month') return range(`${year}-${mm}-01`, today);
  if (getMonthStartDay() === 1) return { mode: 'month', key: `${year}-${mm}` };
  return { mode: 'range', from: `${year}-${mm}-01`, to: toISODate(new Date(year, value, 0, 12)) };
}

// ---------------------------------------------------------------------------
// Model output -> request
// ---------------------------------------------------------------------------

export interface AskModelSpan {
  label: string;
  /** UTF-16 offsets into the question, end exclusive. */
  start: number;
  end: number;
  /** Ignored: the slice of the question is authoritative. */
  text?: string;
  p?: number;
}

export interface AskModelOutput {
  intent: string;
  intentP: number;
  spans: readonly AskModelSpan[];
}

export interface AskUnderstandingContext {
  now: Date;
  /** The screen's selected period, used when the question names none. */
  defaultPeriod?: Period;
  /** Ledger merchant titles. A merchant span must equal exactly one of them. */
  knownMerchants?: readonly string[];
  /** Live accounts. An account span must equal exactly one name. */
  knownAccounts?: readonly { id: string; name: string }[];
  /** Minimum intent probability (default 0.8). */
  intentThreshold?: number;
  /** Minimum per-span probability when provided (default 0.5). */
  slotThreshold?: number;
  /** A follow-up turn keeps the deterministic planner's answer. */
  previousRequest?: AssistantToolRequest | null;
}

export const DEFAULT_ASK_INTENT_THRESHOLD = 0.8;
export const DEFAULT_ASK_SLOT_THRESHOLD = 0.5;

const sameName = (a: string, b: string) => askTokens(a).join(' ') === askTokens(b).join(' ');
function mentions(questionTokens: readonly string[], name: string): boolean {
  const tokens = askTokens(name);
  return tokens.length > 0 && tokens.join('').length >= 2 && indexOfPhrase(questionTokens, tokens) >= 0;
}

/**
 * Model output -> the executor's request, or null (refuse). Refuses when the
 * intent is unknown or below threshold, a span is malformed or low-confidence,
 * a span is not allowed for the intent, any span cannot be resolved to a known
 * id or period, the question names a known merchant/account or a number that
 * no span carries (the scope would silently widen), or the final request fails
 * the executor's validator.
 */
export function mapAskModelOutput(output: AskModelOutput | null | undefined, question: string, context: AskUnderstandingContext): AssistantToolRequest | null {
  if (!output || typeof output !== 'object' || typeof output.intent !== 'string') return null;
  const intent = output.intent as AskIntent;
  if (!ASK_INTENTS.includes(intent) || intent === 'unknown') return null;
  const threshold = context.intentThreshold ?? DEFAULT_ASK_INTENT_THRESHOLD;
  if (typeof output.intentP !== 'number' || !Number.isFinite(output.intentP) || output.intentP < threshold) return null;
  if (typeof question !== 'string' || !question.trim() || question.length > 500) return null;
  const spans = Array.isArray(output.spans) ? [...output.spans] : [];
  const slotThreshold = context.slotThreshold ?? DEFAULT_ASK_SLOT_THRESHOLD;
  const allowed = ASK_INTENT_SLOTS[intent];

  spans.sort((a, b) => a.start - b.start);
  const byLabel = new Map<AskSlotLabel, string[]>();
  let lastEnd = -1;
  for (const span of spans) {
    if (!span || !ASK_SLOT_LABELS.includes(span.label as AskSlotLabel)) return null;
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 ||
      span.end <= span.start || span.end > question.length || span.start < lastEnd) return null;
    if (span.p !== undefined && !(typeof span.p === 'number' && span.p >= slotThreshold)) return null;
    const label = span.label as AskSlotLabel;
    if (!allowed.includes(label)) return null;
    const text = question.slice(span.start, span.end).trim();
    if (!text) return null;
    byLabel.set(label, [...(byLabel.get(label) ?? []), text]);
    lastEnd = span.end;
  }

  // Nothing the user wrote may be silently dropped from the scope.
  const outside = question.split('');
  for (const span of spans) for (let i = span.start; i < span.end; i++) outside[i] = ' ';
  const outsideText = outside.join('');
  if (/[0-9٠-٩۰-۹]/u.test(outsideText)) return null;
  const outsideTokens = askTokens(outsideText);
  if ((context.knownMerchants ?? []).some((name) => mentions(outsideTokens, name))) return null;
  if ((context.knownAccounts ?? []).some((account) => mentions(outsideTokens, account.name))) return null;

  const categories: CategoryId[] = [];
  for (const text of byLabel.get('Q_CAT') ?? []) {
    const id = normalizeAskCategory(text);
    if (!id) return null;
    if (!categories.includes(id)) categories.push(id);
  }
  const merchants: string[] = [];
  for (const text of byLabel.get('Q_MER') ?? []) {
    const matches = (context.knownMerchants ?? []).filter((name) => sameName(name, text));
    const unique = [...new Set(matches)];
    if (unique.length !== 1) return null;
    if (!merchants.includes(unique[0])) merchants.push(unique[0]);
  }
  const accountIds: string[] = [];
  for (const text of byLabel.get('Q_ACCT') ?? []) {
    const matches = (context.knownAccounts ?? []).filter((account) => sameName(account.name, text));
    if (matches.length !== 1) return null;
    if (!accountIds.includes(matches[0].id)) accountIds.push(matches[0].id);
  }
  const periodTexts = byLabel.get('Q_PERIOD') ?? [];
  const comparisonTexts = byLabel.get('Q_CMP') ?? [];
  if (periodTexts.length > 1 || comparisonTexts.length > 1) return null;
  let period: Period = context.defaultPeriod ?? currentMonthPeriod(context.now);
  if (periodTexts.length) {
    const key = normalizeAskPeriodKey(periodTexts[0]);
    const resolved = key ? resolveAskPeriod(key, context.now) : null;
    if (!resolved) return null;
    period = resolved;
  }
  let comparisonPeriod: Period | undefined;
  if (comparisonTexts.length) {
    const key = normalizeAskPeriodKey(comparisonTexts[0]);
    const resolved = key ? resolveAskPeriod(key, context.now) : null;
    if (!resolved) return null;
    comparisonPeriod = resolved;
  }
  const topTexts = byLabel.get('Q_TOPN') ?? [];
  if (topTexts.length > 1) return null;
  let limit: number | undefined;
  if (topTexts.length) {
    const value = normalizeAskTopN(topTexts[0]);
    if (value === null) return null;
    limit = value;
  }

  const filters: Record<string, unknown> = {};
  if (accountIds.length) filters.accountIds = accountIds;
  if (merchants.length === 1) filters.merchant = merchants[0];
  else if (merchants.length > 1) filters.merchants = merchants;
  if (categories.length === 1) filters.category = categories[0];
  else if (categories.length > 1) filters.categories = categories;
  const questionTokens = askTokens(question);
  const withLimit = limit !== undefined ? { limit } : {};

  let candidate: Record<string, unknown>;
  switch (intent) {
    case 'spending_total':
      if (merchants.length === 1 && !categories.length) candidate = { tool: 'merchant-breakdown', period, ...filters };
      else if (categories.length === 1 && !merchants.length) candidate = { tool: 'category-breakdown', period, ...filters };
      else candidate = { tool: 'spending-total', period, ...filters };
      break;
    case 'income_total': candidate = { tool: 'income-total', period, ...filters }; break;
    case 'compare_periods':
      if (period.mode === 'all') return null;
      candidate = { tool: 'compare-periods', period, ...filters, ...(comparisonPeriod ? { comparisonPeriod } : {}) };
      break;
    case 'top_merchants': candidate = { tool: 'top-merchants', period, ...filters, ...withLimit }; break;
    case 'top_categories': candidate = { tool: 'top-categories', period, ...filters, ...withLimit }; break;
    case 'largest_purchases': candidate = { tool: 'largest-purchases', period, ...filters, limit: limit ?? 5 }; break;
    case 'daily_average': candidate = { tool: 'daily-average', period, ...filters }; break;
    case 'net_income_spending': candidate = { tool: 'net-income-spending', period, ...filters }; break;
    case 'subscriptions': candidate = { tool: 'subscriptions' }; break;
    case 'upcoming_payments': candidate = { tool: 'upcoming-payments', withinDays: 30 }; break;
    case 'unusual_charges': candidate = { tool: 'unusual-charges', period, ...filters }; break;
    case 'possible_duplicates': candidate = { tool: 'possible-duplicates', period, ...filters }; break;
    case 'recurring_changes': candidate = { tool: 'recurring-changes', period, ...filters }; break;
    case 'month_forecast': {
      // A pace forecast exists only for the current month.
      const current = currentMonthPeriod(context.now);
      if (periodTexts.length && JSON.stringify(period) !== JSON.stringify(current)) return null;
      candidate = { tool: 'month-forecast', period: current, ...filters };
      break;
    }
    case 'top_accounts': {
      const card = questionTokens.some((token) => tables().wordSets.card.has(token));
      candidate = { tool: 'top-accounts', period, ...filters, accountKind: card ? 'card' : 'all', metric: 'amount', ...withLimit };
      break;
    }
    case 'account_inventory': {
      const card = questionTokens.some((token) => tables().wordSets.card.has(token));
      candidate = { tool: 'account-inventory', accountKind: card ? 'card' : 'all' };
      break;
    }
    default: return null;
  }
  return isAssistantToolRequest(candidate) ? candidate : null;
}

const UNRECOGNIZED_HELP_KEYS = new Set(['tool', 'clarification', 'suggestions', 'unrecognized']);
/**
 * The rule planner's "did not understand": plain Help or its explicit
 * unrecognised Help. Safety clarifications (unsupported condition, unknown
 * merchant, ambiguous date …) are answers, not gaps, and are never overridden.
 * Mirrors `isExactPlainHelp` in on-device-assistant.ts, which is not imported
 * here because it pulls the native platform-model bridge.
 */
export function rulesDidNotUnderstand(request: AssistantToolRequest): boolean {
  if (request.tool !== 'help') return false;
  const keys = Object.keys(request);
  if (keys.length === 1) return true;
  return (request as { unrecognized?: unknown }).unrecognized === true && keys.every((key) => UNRECOGNIZED_HELP_KEYS.has(key));
}

export type AskUnderstanding =
  | { source: 'rules'; request: AssistantToolRequest }
  | { source: 'model'; request: AssistantToolRequest }
  | { source: 'refused'; request: AssistantToolRequest; reason: string };

/**
 * Rules first. The model is consulted only when the rules did not understand
 * a fresh question; a model refusal keeps the rules' own Help answer.
 */
export function understandAskQuestion(
  question: string,
  rules: AssistantToolRequest,
  model?: AskModelOutput | null,
  context: AskUnderstandingContext = { now: new Date() },
): AskUnderstanding {
  if (!rulesDidNotUnderstand(rules)) return { source: 'rules', request: rules };
  if (context.previousRequest) return { source: 'refused', request: rules, reason: 'conversation-context-present' };
  if (!model) return { source: 'refused', request: rules, reason: 'no-model-output' };
  const request = mapAskModelOutput(model, question, context);
  return request ? { source: 'model', request } : { source: 'refused', request: rules, reason: 'model-output-rejected' };
}
