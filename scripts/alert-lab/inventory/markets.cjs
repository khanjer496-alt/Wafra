'use strict';
// Launch-market definitions: the person's country and pinned ledger currency
// (what the app is configured with), the languages their bank writes in, how
// that market writes money and dates, and who the alert appears to come from.
//
// Sender ids: `banks[].senders` lists EQUIVALENT ids for one bank (the
// sender-equivalence invariance swaps between them). AE/SA banks marked
// `registered` must be recognised by the shipping launch registry
// (src/lib/markets.ts); the gate test checks that. Unregistered/fictional
// banks exercise the unproven (best-effort) seam.
const { S, NBSP, NNBSP } = require('../lib/money.cjs');

const usLike = (sym, iso) => [
  S('pre', sym, '', '.', ','), S('pre', iso, ' ', '.', ','), S('post', iso, ' ', '.', ','),
  S('pre', sym, '', '.', ',', { signOut: true }), S('pre', sym, '', '.', ',', { trim: true }), S('pre', iso, '', '.', ','),
];
const gulf = (iso, latinAlt, arabicTokens) => ({
  latin: [S('pre', iso, ' ', '.', ','), S('post', iso, ' ', '.', ','), S('pre', iso, '', '.', ','), S('pre', latinAlt, ' ', '.', ','), S('post', latinAlt, ' ', '.', ',')],
  ar: [...arabicTokens.map((t) => S('post', t, ' ', '.', ',')), S('pre', arabicTokens[0], ' ', '.', ','), S('post', iso, ' ', '.', ',')],
});

const D = (style, time, langs = null, w = 1) => ({ style, time, langs, w });
const usDates = [D('mon-d-y', 'at-12h'), D('mon-d', 'none'), D('mdy-slash', 'at-12h'), D('md-slash', 'none'), D('mdy-slash', 'none')];
const ukDates = [D('dmy-slash', 'none'), D('dmy2-slash', 'none'), D('d-mon-y', 'none'), D('d-mon', 'at-24h'), D('dm-slash', 'at-24h')];
const deDates = [D('dmy-dot', 'none'), D('dmy-dot', 'de-uhr', ['de']), D('dm-dot', 'none'), D('d.-mon-y', 'none', ['de']), D('dmy-dot', '24h')];
const latinEuDates = [D('dmy-slash', 'none'), D('d-mon-y', 'none'), D('dmy-slash', 'at-24h'), D('dm-slash', 'none')];
const gulfDates = [D('dmy-slash', '24h'), D('dmy-slash', 'none'), D('dd-Mon-yyyy', '24h'), D('iso', '24h'), D('d-mon-y', 'none', ['ar'])];
const nordicDates = [D('dmy-dot', 'none'), D('d-mon-y', 'none'), D('dm-dot', '24h'), D('iso', 'none')];

const B = (name, senders, extra = {}) => ({ name, senders, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, ''), ...extra });

const MARKETS = [
  { id: 'US', ledger: 'USD', langs: [['en', 9], ['es', 1]], money: { latin: usLike('$', 'USD').concat([S('pre', 'US$', '', '.', ',')]) }, dates: usDates,
    banks: [B('Chase', ['Chase', '24273']), B('Bank of America', ['BofA', '73981']), B('Wells Fargo', ['WellsFargo', '93557']), B('Capital One', ['CapitalOne', '227898']), B('Northfield Bank', ['Northfield', '55120'], { fictional: true })],
    push: ['Venmo', 'Cash App', 'Chime'], phone: '1-800-555-0199', personal: '+1 415 555 0134', short: '24273' },
  { id: 'CA', ledger: 'CAD', langs: [['en', 3], ['fr', 1]],
    money: { latin: usLike('$', 'CAD').concat([S('pre', 'C$', '', '.', ','), S('pre', 'CA$', '', '.', ','), S('post', '$', ' ', ',', ' ', { lang: 'fr', core: true }), S('post', '$', NBSP, ',', NBSP, { lang: 'fr' })]) },
    dates: [D('iso', 'none'), D('mon-d-y', 'at-12h', ['en']), D('d-mon-y', 'none', ['fr']), D('dmy-slash', '24h'), D('mon-d', 'none', ['en'])],
    banks: [B('RBC', ['RBC', '722722']), B('TD', ['TD', '83393']), B('Scotiabank', ['Scotiabank', '72642']), B('Maple Trust', ['MapleTrust', '61234'], { fictional: true })],
    push: ['KOHO', 'Wealthsimple'], phone: '1-888-555-0142', personal: '+1 416 555 0187', short: '722722' },
  { id: 'GB', ledger: 'GBP', langs: [['en', 1]], money: { latin: [S('pre', '£', '', '.', ','), S('pre', 'GBP', ' ', '.', ','), S('post', 'GBP', ' ', '.', ','), S('pre', '£', '', '.', ',', { trim: true }), S('pre', '£', '', '.', ',', { signOut: true })] }, dates: ukDates,
    banks: [B('Barclays', ['Barclays', 'BARCLAYS']), B('HSBC UK', ['HSBC', 'HSBCUK']), B('Lloyds', ['Lloyds', 'LLOYDSBANK']), B('Nationwide', ['Nationwide', 'NWIDE']), B('Thamesbank', ['Thamesbank', 'THAMESBK'], { fictional: true })],
    push: ['Monzo', 'Revolut', 'Starling'], phone: '020 7946 0000', personal: '+44 7700 900123', short: '60011' },
  { id: 'IE', ledger: 'EUR', langs: [['en', 1]], money: { latin: [S('pre', '€', '', '.', ','), S('pre', 'EUR', ' ', '.', ','), S('post', 'EUR', ' ', '.', ','), S('pre', '€', '', '.', ',', { signOut: true })] }, dates: ukDates,
    banks: [B('AIB', ['AIB', 'AIBAlerts']), B('Bank of Ireland', ['BOI', 'BankofIrl']), B('Liffey Bank', ['LiffeyBank', 'LIFFEY'], { fictional: true })],
    push: ['Revolut', 'N26'], phone: '01 555 0100', personal: '+353 85 555 0101', short: '50100' },
  { id: 'DE', ledger: 'EUR', langs: [['de', 1]], money: { latin: [S('post', '€', ' ', ',', '.'), S('post', '€', NBSP, ',', '.'), S('post', 'EUR', ' ', ',', '.'), S('pre', 'EUR', ' ', ',', '.'), S('post', 'EUR', ' ', ',', ''), S('post', '€', '', ',', '.')] }, dates: deDates,
    banks: [B('Sparkasse', ['Sparkasse', 'S-Push']), B('Deutsche Bank', ['DeutscheBank', 'DB-Info']), B('Commerzbank', ['Commerzbank', 'CoBa']), B('ING', ['ING', 'ING-DiBa']), B('Rheintal Bank', ['RheintalBank', 'RHEINTAL'], { fictional: true })],
    push: ['N26', 'Revolut', 'C24'], phone: '030 1234567', personal: '+49 151 23456789', short: '89000' },
  { id: 'AT', ledger: 'EUR', langs: [['de', 1]], money: { latin: [S('pre', '€', ' ', ',', '.'), S('post', 'EUR', ' ', ',', '.'), S('pre', 'EUR', ' ', ',', '.'), S('post', '€', ' ', ',', '.')] }, dates: deDates,
    banks: [B('Erste Bank', ['ErsteBank', 'Erste']), B('Raiffeisen', ['Raiffeisen', 'RBI-Info']), B('BAWAG', ['BAWAG', 'BAWAGPSK'])],
    push: ['George', 'N26'], phone: '05 0100 0000', personal: '+43 664 1234567', short: '0800' },
  { id: 'CH', ledger: 'CHF', langs: [['de', 3], ['fr', 1], ['it', 1]],
    money: { latin: [S('pre', 'CHF', ' ', '.', "'"), S('post', 'CHF', ' ', '.', "'"), S('pre', 'CHF', ' ', '.', ''), S('pre', 'Fr.', ' ', '.', "'"), S('pre', 'CHF', ' ', '.', '’'), S('pre', 'CHF', ' ', ',', ' ', { lang: 'fr' })] },
    dates: [D('dmy-dot', 'none'), D('dmy-dot', '24h'), D('d.-mon-y', 'none', ['de']), D('dm-dot', 'none')],
    banks: [B('UBS', ['UBS', 'UBS-Alert']), B('PostFinance', ['PostFinance', 'PF-Info']), B('Raiffeisen CH', ['RaiffeisenCH', 'RAIF-CH'])],
    push: ['TWINT', 'neon'], phone: '0848 000 000', personal: '+41 79 123 45 67', short: '488' },
  { id: 'FR', ledger: 'EUR', langs: [['fr', 1]], money: { latin: [S('post', '€', NBSP, ',', NNBSP), S('post', '€', ' ', ',', ' '), S('post', 'EUR', ' ', ',', ' '), S('pre', 'EUR', ' ', ',', ' '), S('post', '€', '', ',', '')] },
    dates: [D('dmy-slash', 'none'), D('dmy-slash', 'fr-h'), D('d-mon-y', 'none'), D('dm-slash', 'at-24h')],
    banks: [B('BNP Paribas', ['BNPParibas', 'BNP']), B('Crédit Agricole', ['CA-Alerte', 'CreditAgri']), B('Société Générale', ['SG-Info', 'SocGen'])],
    push: ['Lydia', 'Boursorama'], phone: '01 23 45 67 89', personal: '+33 6 12 34 56 78', short: '38800' },
  { id: 'BE', ledger: 'EUR', langs: [['fr', 1], ['nl', 1]], money: { latin: [S('pre', '€', ' ', ',', '.'), S('post', 'EUR', ' ', ',', '.'), S('post', '€', ' ', ',', '.'), S('post', '€', NBSP, ',', NNBSP, { lang: 'fr' })] },
    dates: [D('dmy-slash', 'none'), D('dmy-dash', 'none', ['nl']), D('d-mon-y', 'none'), D('dmy-slash', 'at-24h')],
    banks: [B('KBC', ['KBC', 'KBC-Info']), B('BNP Paribas Fortis', ['BNPFortis', 'Fortis']), B('Belfius', ['Belfius', 'BELFIUS'])],
    push: ['Payconiq'], phone: '02 555 00 00', personal: '+32 470 12 34 56', short: '8811' },
  { id: 'NL', ledger: 'EUR', langs: [['nl', 1]], money: { latin: [S('pre', '€', ' ', ',', '.'), S('pre', '€', '', ',', '.'), S('pre', 'EUR', ' ', ',', '.'), S('post', 'EUR', ' ', ',', '.')] },
    dates: [D('dmy-dash', 'none'), D('d-mon-y', 'none'), D('dmy-dash', 'at-24h'), D('d-mon', 'none')],
    banks: [B('ING', ['ING', 'INGBank']), B('Rabobank', ['Rabobank', 'Rabo']), B('ABN AMRO', ['ABNAMRO', 'ABN'])],
    push: ['bunq', 'Tikkie'], phone: '020 555 0000', personal: '+31 6 12345678', short: '3010' },
  { id: 'ES', ledger: 'EUR', langs: [['es', 1]], money: { latin: [S('post', '€', ' ', ',', '.'), S('post', 'EUR', ' ', ',', '.'), S('post', '€', '', ',', '.'), S('pre', 'EUR', ' ', ',', '.')] }, dates: latinEuDates,
    banks: [B('Santander', ['Santander', 'BSCH']), B('BBVA', ['BBVA', 'BBVA-Info']), B('CaixaBank', ['CaixaBank', 'LaCaixa'])],
    push: ['Bizum', 'Revolut'], phone: '900 100 000', personal: '+34 612 34 56 78', short: '217171' },
  { id: 'PT', ledger: 'EUR', langs: [['pt', 1]], money: { latin: [S('post', '€', ' ', ',', '.'), S('post', 'EUR', ' ', ',', ' '), S('pre', 'EUR', ' ', ',', '.'), S('post', '€', '', ',', ' ')] }, dates: latinEuDates,
    banks: [B('Millennium bcp', ['Millennium', 'BCP']), B('CGD', ['CGD', 'CaixaGeral']), B('Novo Banco', ['NovoBanco', 'NB-Info'])],
    push: ['MB WAY'], phone: '707 50 24 24', personal: '+351 912 345 678', short: '3838' },
  { id: 'IT', ledger: 'EUR', langs: [['it', 1]], money: { latin: [S('post', '€', ' ', ',', '.'), S('pre', '€', ' ', ',', '.'), S('pre', 'EUR', ' ', ',', '.'), S('post', 'EUR', ' ', ',', '.')] }, dates: latinEuDates,
    banks: [B('Intesa Sanpaolo', ['IntesaSP', 'Intesa']), B('UniCredit', ['UniCredit', 'UCI-Info']), B('Poste', ['PosteInfo', 'Poste'])],
    push: ['Satispay'], phone: '800 303 303', personal: '+39 312 345 6789', short: '48000' },
  { id: 'PL', ledger: 'PLN', langs: [['pl', 1]], money: { latin: [S('post', 'zł', ' ', ',', ' '), S('post', 'PLN', ' ', ',', ' '), S('post', 'zł', NBSP, ',', NBSP), S('pre', 'PLN', ' ', ',', '')] },
    dates: [D('dmy-dot', 'none'), D('iso', '24h'), D('d-mon-y', 'none'), D('dmy-dot', '24h')],
    banks: [B('PKO BP', ['PKOBP', 'PKO']), B('mBank', ['mBank', 'mBank-Info']), B('Pekao', ['Pekao', 'PekaoSA'])],
    push: ['BLIK'], phone: '800 302 302', personal: '+48 512 345 678', short: '7020' },
  { id: 'SE', ledger: 'SEK', langs: [['sv', 1]], money: { latin: [S('post', 'kr', ' ', ',', ' '), S('post', 'SEK', ' ', ',', ' '), S('post', 'kr', ' ', ',', '.'), S('pre', 'SEK', ' ', ',', ' '), S('post', 'kr', NBSP, ',', NBSP)] },
    dates: [D('iso', 'none'), D('iso', '24h'), D('d-mon', 'none'), D('d-mon-y', 'none')],
    banks: [B('Swedbank', ['Swedbank', 'SWED']), B('SEB', ['SEB', 'SEB-Info']), B('Handelsbanken', ['Handelsbanken', 'SHB'])],
    push: ['Swish', 'Klarna'], phone: '0771-22 11 22', personal: '+46 70 123 45 67', short: '71000' },
  { id: 'DK', ledger: 'DKK', langs: [['da', 1]], money: { latin: [S('post', 'kr.', ' ', ',', '.'), S('post', 'DKK', ' ', ',', '.'), S('pre', 'DKK', ' ', ',', '.'), S('post', 'kr', ' ', ',', '.')] }, dates: nordicDates,
    banks: [B('Danske Bank', ['DanskeBank', 'Danske']), B('Nordea', ['Nordea', 'NordeaDK']), B('Jyske Bank', ['JyskeBank', 'JYSKE'])],
    push: ['MobilePay'], phone: '70 12 34 56', personal: '+45 20 12 34 56', short: '1919' },
  { id: 'NO', ledger: 'NOK', langs: [['nb', 1]], money: { latin: [S('post', 'kr', ' ', ',', ' '), S('post', 'NOK', ' ', ',', ' '), S('pre', 'kr', ' ', ',', ' '), S('pre', 'NOK', ' ', ',', '.')] }, dates: nordicDates,
    banks: [B('DNB', ['DNB', 'DNB-Info']), B('SpareBank 1', ['SpareBank1', 'SB1']), B('Nordea', ['Nordea', 'NordeaNO'])],
    push: ['Vipps'], phone: '915 04800', personal: '+47 412 34 567', short: '2222' },
  { id: 'CZ', ledger: 'CZK', langs: [['cs', 1]], money: { latin: [S('post', 'Kč', ' ', ',', ' '), S('post', 'CZK', ' ', ',', ' '), S('post', 'Kč', NBSP, ',', NBSP), S('pre', 'CZK', ' ', ',', '')] },
    dates: [D('d. m. y', 'none'), D('dmy-dot', '24h'), D('dmy-dot', 'none')],
    banks: [B('Česká spořitelna', ['CSAS', 'Sporitelna']), B('ČSOB', ['CSOB', 'CSOB-Info']), B('Komerční banka', ['KB-Info', 'KomercniBanka'])],
    push: ['George', 'Revolut'], phone: '800 207 207', personal: '+420 601 234 567', short: '9020' },
  { id: 'AE', ledger: 'AED', langs: [['en', 2], ['ar', 1]], money: gulf('AED', 'Dhs', ['د.إ', 'درهم']), dates: gulfDates,
    banks: [B('Emirates NBD', ['EmiratesNBD', 'ENBD'], { registered: 'AE' }), B('ADCB', ['ADCB', 'ADCBAlert'], { registered: 'AE' }), B('FAB', ['FAB', 'FAB-Bank'], { registered: 'AE' }), B('Mashreq', ['Mashreq', 'MashreqBank'], { registered: 'AE' }), B('Falcon Bank', ['FalconBank', 'FALCONBK'], { fictional: true })],
    push: ['Wio', 'Liv'], phone: '600 54 0000', personal: '+971 50 123 4567', short: '4440' },
  { id: 'SA', ledger: 'SAR', langs: [['ar', 2], ['en', 2]], money: (() => { const g = gulf('SAR', 'SR', ['ر.س', 'ريال']); g.ar.push(S('post', 'ريال', ' ', '.', ',', { digits: 'arabic' })); return g; })(), dates: gulfDates,
    banks: [B('Al Rajhi', ['AlRajhiBank', 'ALRAJHI'], { registered: 'SA' }), B('SNB', ['SNB-AlAhli', 'SNB'], { registered: 'SA' }), B('Riyad Bank', ['RiyadBank', 'Riyad Bank'], { registered: 'SA' }), B('Alinma', ['alinma', 'AlinmaBank'], { registered: 'SA' }), B('Najd Bank', ['NajdBank', 'NAJDBK'], { fictional: true })],
    push: ['STCPay', 'urpay'], phone: '920 000 000', personal: '+966 55 123 4567', short: '88990' },
  { id: 'QA', ledger: 'QAR', langs: [['en', 2], ['ar', 1]], money: gulf('QAR', 'QR', ['ر.ق', 'ريال قطري']), dates: gulfDates,
    banks: [B('QNB', ['QNB', 'QNBAlerts']), B('CBQ', ['CBQ', 'CBQ-Alerts']), B('Pearl Bank', ['PearlBank', 'PEARLBK'], { fictional: true })],
    push: ['Ooredoo Money'], phone: '4440 0000', personal: '+974 5512 3456', short: '92632' },
  { id: 'KW', ledger: 'KWD', langs: [['en', 2], ['ar', 1]], money: gulf('KWD', 'KD', ['د.ك', 'دينار كويتي']), dates: gulfDates,
    banks: [B('NBK', ['NBK', 'NBKAlerts']), B('KFH', ['KFH', 'KFH-Info']), B('Boubyan', ['Boubyan', 'BoubyanBank'])],
    push: ['WAMD'], phone: '1801801', personal: '+965 5012 3456', short: '1801' },
  { id: 'BH', ledger: 'BHD', langs: [['en', 2], ['ar', 1]], money: gulf('BHD', 'BD', ['د.ب', 'دينار بحريني']), dates: gulfDates,
    banks: [B('BBK', ['BBK', 'BBKAlerts']), B('NBB', ['NBB', 'NBBank']), B('Dilmun Bank', ['DilmunBank', 'DILMUN'], { fictional: true })],
    push: ['BenefitPay'], phone: '1722 0000', personal: '+973 3312 3456', short: '80008' },
  { id: 'OM', ledger: 'OMR', langs: [['en', 2], ['ar', 1]], money: gulf('OMR', 'RO', ['ر.ع', 'ريال عماني']), dates: gulfDates,
    banks: [B('Bank Muscat', ['BankMuscat', 'BMUSCAT']), B('NBO', ['NBO', 'NBOman']), B('Sohar Bank', ['SoharBank', 'SOHARBK'], { fictional: true })],
    push: ['Thawani'], phone: '2479 5555', personal: '+968 9123 4567', short: '90090' },
  { id: 'JO', ledger: 'JOD', langs: [['ar', 1], ['en', 1]], money: gulf('JOD', 'JD', ['د.أ', 'دينار']), dates: [D('dmy-slash', 'none'), D('dmy-slash', 'at-24h'), D('d-mon-y', 'none', ['ar']), D('iso', '24h')],
    banks: [B('Arab Bank', ['ArabBank', 'Arab Bank']), B('Housing Bank', ['HBTF', 'HousingBank']), B('Petra Bank', ['PetraBank', 'PETRABK'], { fictional: true })],
    push: ['CliQ'], phone: '06 500 0000', personal: '+962 79 123 4567', short: '94444' },
  { id: 'EG', ledger: 'EGP', langs: [['ar', 2], ['en', 1]],
    money: { latin: [S('pre', 'EGP', ' ', '.', ','), S('post', 'EGP', ' ', '.', ','), S('pre', 'LE', ' ', '.', ','), S('pre', 'E£', '', '.', ',')], ar: [S('post', 'جنيه', ' ', '.', ','), S('post', 'جم', ' ', '.', ','), S('post', 'ج.م', ' ', '.', ','), S('post', 'جنيه', ' ', '.', ',', { digits: 'arabic' }), S('pre', 'EGP', ' ', '.', ',')] },
    dates: [D('dmy-slash', 'none'), D('dmy-slash', 'at-24h'), D('d-mon-y', 'none', ['ar']), D('iso', '24h')],
    banks: [B('NBE', ['NBE', 'NBE-Alerts']), B('CIB', ['CIB', 'CIBEG']), B('Banque Misr', ['BanqueMisr', 'BM-Info'])],
    push: ['InstaPay', 'VF-Cash'], phone: '19623', personal: '01098765432', short: '19623' },
];

// How strongly each market's alerts come from each sender style.
const SENDER_STYLES = {
  default: [['alpha', 6], ['push', 1.5], ['blank', 2]],
  US: [['short', 5], ['alpha', 1], ['push', 1.5], ['blank', 2]],
  CA: [['short', 4], ['alpha', 2], ['push', 1], ['blank', 2]],
  GB: [['alpha', 5], ['short', 1], ['push', 2], ['blank', 2]],
};

// The currency a "$"/"kr" token means is always the market's ledger here;
// foreign-currency purchases name their ISO code explicitly.
const FOREIGN = {
  default: ['USD', 'EUR', 'GBP'],
  US: ['EUR', 'GBP', 'JPY', 'MXN'], CA: ['USD', 'EUR'], GB: ['EUR', 'USD'],
  AE: ['USD', 'EUR', 'SAR', 'IQD'], SA: ['USD', 'AED', 'EUR', 'IQD'], KW: ['USD', 'IQD', 'EUR'], JO: ['USD', 'IQD', 'EUR'],
};

const byId = Object.fromEntries(MARKETS.map((m) => [m.id, m]));

module.exports = { MARKETS, byId, SENDER_STYLES, FOREIGN };
