import { inspectAlertInstitutionGrammar } from '@/lib/alert-institution-grammars';
import type { UniversalMarket } from '@/lib/alert-market-pack-types';
import type {
  UniversalBankEvent,
  UniversalField,
  UniversalInstrument,
  UniversalMoney,
} from '@/lib/universal-types';
import { missingUniversalField } from '@/lib/universal-types';

/**
 * EXACT PER-BANK ALERT TEMPLATES FOR BRAZIL, COLOMBIA, MEXICO AND PERU.
 *
 * LatAm card alerts are sent when the card is AUTHORISED ("Compra aprovada",
 * "Aprobado(a)", "Compra autorizada") and no later posting alert follows. The
 * generic parser therefore refuses them: an approval is not, in general, a
 * settled movement. By the product decision recorded in
 * docs/universal-parser-rollout.md ("LatAm authorisation-time templates"),
 * approval wording may count as posted ONLY here, and only when:
 *
 *  - the WHOLE message matches one bank's anchored template below
 *    (`mode: 'approval'`);
 *  - the template captured a masked card or account (its last four digits);
 *  - nothing outside the captured merchant/name text is negation, a two-step
 *    confirmation ("confirme", "responda"), pending/hold/scheduled wording,
 *    a decline, a code/OTP/token, a loan, an offer or a promotion, or a link.
 *
 * Templates whose own verb states completion ("Compraste", "Você enviou",
 * "Retiraste") are `mode: 'posted'` and pass through the same guards.
 * `mode: 'review'` templates only ground the money for Review; they never post
 * (weak or synthetic evidence, a heading with no completion verb, or approval
 * wording without a masked card).
 *
 * Nothing here authorises an import by itself: a posted template event still
 * goes through the best-effort policy (SMS) or template certification
 * (notifications), the import planner's duplicate guard and the ledger
 * currency gate. Every wording is Wafra's own abstraction of public
 * descriptions; no bank or open-source message text is copied.
 */

export type LatamMarket = Extract<UniversalMarket, 'BR' | 'CO' | 'MX' | 'PE'>;
type LatamCurrency = 'BRL' | 'COP' | 'MXN' | 'PEN';
type TemplateFamily = 'purchase' | 'transfer' | 'cash-withdrawal' | 'refund';
type TemplateMode = 'posted' | 'approval' | 'review';

interface LatamTemplate {
  /** Stable code-owned id; never derived from message text. */
  id: string;
  market: LatamMarket;
  institution: string;
  /**
   * `self`: the body names the bank or carries a currency/rail that fixes the
   * market (R$, S/, SPEI, "con Nequi"), so the template applies with no sender.
   * `required`: a bare `$` (or a bare number) needs the institution grammar to
   * have identified `institution` from the sender or body first.
   */
  identity: 'self' | 'required';
  family: TemplateFamily;
  direction: 'debit' | 'credit';
  mode: TemplateMode;
  currency: LatamCurrency;
  pattern: RegExp;
  /** A transfer between the person's own products (card bill, cash advance). */
  ownTransfer?: true;
  /** Yape's payee-side receipt check: exempt from the code guard, never kept. */
  receiptCode?: true;
}

// Template grammar tokens. A literal space means one or more whitespace
// characters and `~` means optional whitespace, so line-wrapped notifications
// still match while the wording itself stays exact.
const TOKENS: Readonly<Record<string, string>> = {
  '{BRL}': String.raw`R\$~(?<amount>\d[\d.]*,\d{2})`,
  '{COP}': String.raw`(?:\$|COP)~(?<amount>\d[\d.,]*\d|\d)`,
  '{MXN}': String.raw`\$~(?<amount>\d[\d.,]*\d|\d)(?: MXN)?`,
  '{PEN}': String.raw`S/\.?~(?<amount>\d[\d.,]*\d|\d)`,
  '{M}': String.raw`(?<merchant>\S.{0,78}?)`,
  '{N}': String.raw`(?<name>\S.{0,78}?)`,
  '{P}': String.raw`(?<payee>\S.{0,78}?)`,
  '{DATE}': String.raw`(?<date>\d{2}/\d{2}/\d{4})`,
  '{DATE2}': String.raw`(?<date>\d{2}/\d{2}/\d{2})`,
  '{TIME}': String.raw`(?<time>\d{2}:\d{2}(?::\d{2})?)`,
  '{BAL_BRL}': String.raw`R\$~(?<balance>\d[\d.]*,\d{2})`,
  '{BAL_COP}': String.raw`\$~(?<balance>\d[\d.,]*\d)`,
  '{FOOT}': String.raw`(?<footer>\s[\s\S]{0,240})?`,
  '{NU}': String.raw`(?:Nubank(?:~[:·-])? )?`,
};

const compile = (template: string): RegExp => {
  let source = template;
  for (const [token, value] of Object.entries(TOKENS)) source = source.split(token).join(value);
  source = source.replace(/ /g, String.raw`\s+`).replace(/~/g, String.raw`\s*`);
  return new RegExp(String.raw`^\s*${source}\s*$`, 'u');
};

const t = (
  id: string, market: LatamMarket, institution: string, identity: LatamTemplate['identity'],
  family: TemplateFamily, direction: LatamTemplate['direction'], mode: TemplateMode,
  pattern: string, extra: Partial<Pick<LatamTemplate, 'ownTransfer' | 'receiptCode'>> = {},
): LatamTemplate => ({
  id, market, institution, identity, family, direction, mode,
  currency: market === 'BR' ? 'BRL' : market === 'CO' ? 'COP' : market === 'MX' ? 'MXN' : 'PEN',
  pattern: compile(pattern), ...extra,
});

/** Ordered: the first matching template wins, so narrower shapes come first. */
const TEMPLATES: readonly LatamTemplate[] = [
  // ── Brazil ── R$ is unique to Brazil, so every BRL template carries its market.
  t('br-nubank-card-purchase-v1', 'BR', 'nubank-brasil', 'self', 'purchase', 'debit', 'approval',
    // An instalment purchase books its TOTAL; the per-instalment figure is not money moved now.
    String.raw`{NU}Compra de {BRL}(?: em (?<installments>\d{1,2})x(?: de R\$~(?<parcel>\d[\d.]*,\d{2}))?)? APROVADA em {M} para o cartão(?: adicional)? com final (?<last4>\d{4})\.?`),
  t('br-nubank-feed-purchase-v1', 'BR', 'nubank-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`{BRL} em {M} com Nubank final (?<last4>\d{4})\.?`),
  t('br-nubank-approved-short-v1', 'BR', 'nubank-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`{NU}Compra aprovada no seu Nubank de {BRL} em {M}(?:\. Saldo disponível: {BAL_BRL})?\.?`),
  t('br-nubank-debit-purchase-v1', 'BR', 'nubank-brasil', 'self', 'purchase', 'debit', 'posted',
    String.raw`Olá,? (?<name>[^\s,.!]{1,40})[,.!]? você acaba de comprar no débito (?:no|na|em) {M} o valor de {BRL}\.?`),
  t('br-nubank-credit-purchase-v1', 'BR', 'nubank-brasil', 'self', 'purchase', 'debit', 'posted',
    String.raw`(?:Olá,? (?<name>[^\s,.!]{1,40})[,.!] )?Você acaba de comprar {BRL} em {M}\. A compra foi no crédito nacional, com o cartão final (?<last4>\d{4})\.?`),
  t('br-nubank-pix-out-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'debit', 'posted',
    String.raw`{NU}(?:Transferência enviada[.!]? )?Você enviou {BRL} para {N} via Pix\.?`),
  t('br-nubank-pix-out-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'debit', 'posted',
    String.raw`{NU}Você enviou {BRL} via Pix para {N}\.?`),
  t('br-nubank-pix-in-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'credit', 'posted',
    String.raw`{NU}Você recebeu {BRL} de {N} via Pix\.?`),
  t('br-nubank-pix-in-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'credit', 'posted',
    String.raw`{NU}Você recebeu uma transferência(?: Pix)? de {BRL} de {N}\.?`),
  t('br-nubank-pix-in-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'credit', 'posted',
    String.raw`{NU}Transferência recebida de {N} no valor de {BRL}\.?`),
  t('br-nubank-refund-v1', 'BR', 'nubank-brasil', 'self', 'refund', 'credit', 'posted',
    String.raw`{NU}Estorno de compra de {BRL} em {M} creditado\.?`),
  // A card-bill payment settles the card; it is never spending or income.
  t('br-nubank-card-bill-payment-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'debit', 'posted',
    String.raw`{NU}Pagamento da fatura de {BRL} confirmado\.?`, { ownTransfer: true }),
  t('br-nubank-card-bill-payment-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'debit', 'posted',
    String.raw`{NU}Recebemos o pagamento de {BRL} da sua fatura\.?`, { ownTransfer: true }),
  t('br-nubank-card-bill-payment-v1', 'BR', 'nubank-brasil', 'self', 'transfer', 'debit', 'posted',
    String.raw`{NU}Recebemos o pagamento da sua fatura de {BRL}\.?`, { ownTransfer: true }),
  // A boleto can settle anything (a shop, a loan, a utility): never guessed as a bill.
  t('br-nubank-boleto-paid-v1', 'BR', 'nubank-brasil', 'self', 'purchase', 'debit', 'posted',
    String.raw`{NU}O pagamento do seu boleto no valor de {BRL} foi realizado com sucesso\.?`),
  t('br-itau-card-purchase-v2', 'BR', 'itau-brasil', 'self', 'purchase', 'debit', 'approval',
    String.raw`Itaú: Compra aprovada no cartão final (?<last4>\d{4}) valor {BRL} (?:no|na|em) {M}(?:\. Saldo em conta: {BAL_BRL})?\.?`),
  t('br-itau-itaucard-purchase-v1', 'BR', 'itau-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`(?:Itaú: )?Compra de {BRL} aprovada no cartão Itaucard em {M}(?:\. Limite disponível: {BAL_BRL})?\.?`),
  t('br-itau-pix-out-v1', 'BR', 'itau-brasil', 'self', 'transfer', 'debit', 'posted',
    String.raw`Itaú: Você enviou um Pix de {BRL} para {N}\.?`),
  t('br-itau-pix-out-v1', 'BR', 'itau-brasil', 'self', 'transfer', 'debit', 'posted',
    String.raw`Itaú: Pix de {BRL} realizado para {N}\.?`),
  t('br-itau-pix-in-v1', 'BR', 'itau-brasil', 'self', 'transfer', 'credit', 'posted',
    String.raw`Itaú: Você recebeu um Pix de {BRL} de {N}\.?`),
  t('br-itau-pix-in-v1', 'BR', 'itau-brasil', 'self', 'transfer', 'credit', 'posted',
    String.raw`Itaú: TED recebida no valor de {BRL} de {N}\.?`),
  // Approval wording with no masked card: Review only (the user decision).
  t('br-bradesco-card-purchase-v1', 'BR', 'bradesco-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`Bradesco Cartões: Compra de {BRL} aprovada em {M}(?:\. Saldo: {BAL_BRL})?\.?`),
  t('br-bb-ourocard-purchase-v1', 'BR', 'banco-do-brasil', 'self', 'purchase', 'debit', 'approval',
    String.raw`BB: Compra com Ourocard (?<brand>[A-Za-z]{2,16}) final (?<last4>\d{4}) aprovada no valor de {BRL} em {M}(?:\. Saldo da conta: {BAL_BRL})?\.?`),
  t('br-bb-short-purchase-v1', 'BR', 'banco-do-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`BB: Compra aprovada de {BRL} em {M}\.?`),
  t('br-caixa-card-purchase-v1', 'BR', 'caixa-brasil', 'self', 'purchase', 'debit', 'approval',
    String.raw`CAIXA: Compra aprovada {BRL} em {M} no cartao final (?<last4>\d{4})(?:\. Saldo disponível: {BAL_BRL})?\.?`),
  t('br-inter-card-purchase-v1', 'BR', 'inter-brasil', 'self', 'purchase', 'debit', 'approval',
    String.raw`Inter: Compra aprovada no cartao final (?<last4>\d{4}) de {BRL} em {M}\.?`),
  t('br-inter-mastercard-purchase-v1', 'BR', 'inter-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`Inter: Compra de {BRL} aprovada no Inter Mastercard em {M}(?:\. Seu saldo é {BAL_BRL})?\.?`),
  t('br-inter-pix-in-v1', 'BR', 'inter-brasil', 'self', 'transfer', 'credit', 'posted',
    String.raw`Inter: Você recebeu um Pix de {BRL} de {N}\.?`),
  t('br-c6-card-purchase-v1', 'BR', 'c6-bank-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`C6 Bank: Compra aprovada no valor de {BRL} em {M}(?:\. Saldo em conta: {BAL_BRL})?\.?`),
  t('br-santander-card-purchase-v1', 'BR', 'santander-brasil', 'self', 'purchase', 'debit', 'approval',
    String.raw`Santander: Compra aprovada de {BRL} no cartao (?<product>[A-Za-z0-9]{1,16}) final (?<last4>\d{4}) em {M}(?:\. Saldo em conta: {BAL_BRL})?\.?`),
  t('br-mercadopago-payment-v1', 'BR', 'mercado-pago-brasil', 'self', 'purchase', 'debit', 'posted',
    String.raw`Mercado Pago: Você pagou {BRL} (?:em|a) {M}(?:\. Saldo disponível: {BAL_BRL})?\.?`),
  // "próxima fatura" says which card bill the posted purchase lands on; it is not a future charge.
  t('br-mercadopago-card-purchase-v1', 'BR', 'mercado-pago-brasil', 'self', 'purchase', 'debit', 'posted',
    String.raw`(?:Mercado Pago: )?Você pagou {BRL} a {M} - O valor vai entrar na próxima fatura do seu Cartão Mercado Pago\.?`),
  t('br-mercadopago-refund-v1', 'BR', 'mercado-pago-brasil', 'self', 'refund', 'credit', 'posted',
    String.raw`Mercado Pago: Reembolso de {BRL} creditado em sua conta\.?`),
  t('br-picpay-payment-v1', 'BR', 'picpay-brasil', 'self', 'purchase', 'debit', 'review',
    String.raw`PicPay: Pagamento de {BRL} aprovado em {M}(?:\. Saldo em carteira: {BAL_BRL})?\.?`),

  // ── Colombia ── "$" is COP here only because the body names a Colombian issuer.
  t('co-bancolombia-card-purchase-v1', 'CO', 'bancolombia', 'self', 'purchase', 'debit', 'posted',
    String.raw`Bancolombia: Compraste {COP} en {M} con tu T\.(?:Cred|Deb) \*(?<last4>\d{4}), el {DATE} a las {TIME}\.{FOOT}`),
  t('co-bancolombia-card-purchase-v1', 'CO', 'bancolombia', 'self', 'purchase', 'debit', 'posted',
    String.raw`Bancolombia: Compraste {COP} en {M}, el {DATE} a las {TIME}\. Esta compra esta asociada a T\.(?:Cred|Deb) \*(?<last4>\d{4})\.{FOOT}`),
  t('co-bancolombia-atm-v1', 'CO', 'bancolombia', 'self', 'cash-withdrawal', 'debit', 'posted',
    String.raw`Bancolombia: Retiraste {COP} en (?<place>\S.{0,40}?) de tu T\.Deb \*{1,2}(?<last4>\d{4}) el {DATE} a las {TIME}\.{FOOT}`),
  t('co-bancolombia-transfer-out-v1', 'CO', 'bancolombia', 'self', 'transfer', 'debit', 'posted',
    String.raw`Bancolombia: Transferiste {COP} desde tu cuenta \*?(?<last4>\d{4}) a la cuenta \*(?<counterpart>\d{4,16}) el {DATE} a las {TIME}\.{FOOT}`),
  t('co-bancolombia-breb-out-v1', 'CO', 'bancolombia', 'self', 'transfer', 'debit', 'posted',
    String.raw`Bancolombia: {N}, transferiste {COP} a la llave (?<key>\S{1,40}) desde tu cuenta \*(?<last4>\d{4}) a {P} el {DATE2} a las {TIME}\.{FOOT}`),
  t('co-bancolombia-qr-payment-v1', 'CO', 'bancolombia', 'self', 'purchase', 'debit', 'posted',
    String.raw`Bancolombia: {N} pagaste {COP} por codigo QR desde tu cuenta \*(?<last4>\d{4}) a la llave (?<key>\S{1,40}) el {DATE} a las {TIME}\.{FOOT}`),
  // Botón Bancolombia says "Transferiste" but pays a merchant.
  t('co-bancolombia-boton-payment-v1', 'CO', 'bancolombia', 'self', 'purchase', 'debit', 'posted',
    String.raw`Bancolombia: Transferiste {COP} por Boton Bancolombia a {M} desde producto \*(?<last4>\d{4})\. {DATE} {TIME}\.?{FOOT}`),
  // Before the bill template: both open with "Pagaste".
  t('co-bancolombia-card-payment-v1', 'CO', 'bancolombia', 'self', 'transfer', 'debit', 'posted',
    String.raw`Bancolombia: Pagaste {COP} en la tarjeta de credito \*(?<card>\d{4}) desde la cuenta \*(?<last4>\d{4}), el {DATE} {TIME}\.{FOOT}`,
    { ownTransfer: true }),
  t('co-bancolombia-bill-payment-v1', 'CO', 'bancolombia', 'self', 'purchase', 'debit', 'posted',
    String.raw`Bancolombia: Pagaste {COP} a {M} desde tu producto \*?(?<last4>\d{4}) el {DATE} {TIME}\.{FOOT}`),
  // The bank also sends "Recibiste una transferencia" for the same money; both
  // legs are transfers, so the pair can never be counted as income.
  t('co-bancolombia-cash-advance-v1', 'CO', 'bancolombia', 'self', 'transfer', 'debit', 'posted',
    String.raw`Bancolombia: Hiciste un avance de {COP} en tu (?<place>\S.{0,40}?) el {TIME} {DATE} desde tu T\.Credito \*(?<last4>\d{4}) a la cuenta \*(?<counterpart>\d{4})\.{FOOT}`,
    { ownTransfer: true }),
  t('co-bancolombia-transfer-in-v1', 'CO', 'bancolombia', 'self', 'transfer', 'credit', 'posted',
    String.raw`Bancolombia: Recibiste una transferencia por {COP} de {N} en tu cuenta \*{1,2}(?<last4>\d{4}), el {DATE} a las {TIME}\.{FOOT}`),
  t('co-bancolombia-breb-in-v1', 'CO', 'bancolombia', 'self', 'transfer', 'credit', 'posted',
    String.raw`Bancolombia: {N}, recibiste una transferencia de {P} por {COP} en tu cuenta \*(?<last4>\d{4}) conectada a la llave (?<key>\S{1,40}) el {DATE2} a las {TIME}\.{FOOT}`),
  t('co-bancolombia-payroll-v1', 'CO', 'bancolombia', 'self', 'transfer', 'credit', 'posted',
    String.raw`Bancolombia: Recibiste un pago de Nomina de {N} por {COP} en tu cuenta de Ahorros el {DATE} a las {TIME}\.{FOOT}`),
  // The older "le informa" generation has community and synthetic evidence only.
  t('co-bancolombia-legacy-purchase-v1', 'CO', 'bancolombia', 'self', 'purchase', 'debit', 'review',
    String.raw`Bancolombia le informa [Cc]ompra por {COP}(?: con T\.(?:Deb|Cred) \*(?<last4>\d{4}))? en {M}(?: a las {TIME}\. {DATE})?(?:\. Saldo {BAL_COP})?\.?`),
  t('co-bancolombia-legacy-atm-v1', 'CO', 'bancolombia', 'self', 'cash-withdrawal', 'debit', 'review',
    String.raw`Bancolombia le informa retiro por {COP} en (?<place>\S.{0,40}?) a las {TIME}\. {DATE}(?:\. Saldo {BAL_COP})?\.?`),
  t('co-bancolombia-legacy-transfer-in-v1', 'CO', 'bancolombia', 'self', 'transfer', 'credit', 'review',
    String.raw`Bancolombia le informa transferencia recibida de {N} por {COP}(?: el {DATE})?\.?`),
  t('co-davivienda-purchase-v1', 'CO', 'davivienda', 'self', 'purchase', 'debit', 'approval',
    String.raw`DAVIVIENDA: Compra~\.~Aprobado\(a\),~{COP},~Tarjeta \*(?<last4>\d{4}),~Hora {TIME},~Lugar~{M}~\.`),
  t('co-davivienda-advance-v1', 'CO', 'davivienda', 'self', 'cash-withdrawal', 'debit', 'approval',
    String.raw`DAVIVIENDA: Avance~\.~Aprobado\(a\),~{COP},~Tarjeta \*(?<last4>\d{4}),~Hora {TIME},~Lugar~(?<place>\S.{0,40}?)~\.`),
  t('co-nequi-payment-v1', 'CO', 'nequi', 'self', 'purchase', 'debit', 'posted',
    String.raw`(?:Nequi:? )?Pagaste {COP} a {M} con Nequi(?:\. Tu saldo disponible es {BAL_COP})?\.?`),
  t('co-nequi-send-v1', 'CO', 'nequi', 'required', 'transfer', 'debit', 'posted',
    String.raw`(?:Nequi:? )?Enviaste {COP} a {N}\.?`),
  t('co-nequi-receive-v1', 'CO', 'nequi', 'required', 'transfer', 'credit', 'posted',
    String.raw`(?:Nequi:? )?Te enviaron {COP} de parte de {N}\.(?: ¡Disfrútalos!)?`),
  t('co-daviplata-send-v1', 'CO', 'daviplata', 'self', 'transfer', 'debit', 'posted',
    String.raw`DaviPlata le informa que paso plata por {COP} a (?<phone>\d{7,12})\. Nuevo saldo {BAL_COP}\.?`),
  // Nu's single app package also serves Brazil and Mexico: a bare "$" (or no
  // currency at all) is COP only once the sender or body names Nu Colombia.
  t('co-nu-purchase-v1', 'CO', 'nu-colombia', 'required', 'purchase', 'debit', 'approval',
    String.raw`(?:Nu(?: Colombia)?:? )?Compra aprobada por {COP}\.? Tu compra en {M} por \$~(?<amount2>\d[\d.,]*\d) con tu tarjeta (?:débito|crédito) terminada en (?<last4>\d{4})\.?`),
  t('co-nu-purchase-body-v1', 'CO', 'nu-colombia', 'required', 'purchase', 'debit', 'review',
    String.raw`(?:Nu(?: Colombia)?:? )?Tu compra en {M} por {COP} con tu tarjeta (?:débito|crédito) terminada en (?<last4>\d{4})\.?`),
  t('co-nu-transfer-in-v1', 'CO', 'nu-colombia', 'required', 'transfer', 'credit', 'posted',
    String.raw`(?:Nu(?: Colombia)?:? )?{N} te envió (?<amount>\d{1,3}(?:\.\d{3})*,\d{2})\.?`),
  t('co-banco-de-bogota-purchase-v1', 'CO', 'banco-de-bogota', 'self', 'purchase', 'debit', 'review',
    String.raw`Banco de Bogot[aá]: compra por {COP} en {M}(?:\. Saldo {BAL_COP})?\.?`),

  // ── Mexico ── "$" is MXN only with BBVA México identity or the SPEI rail.
  t('mx-bbva-spei-out-v1', 'MX', 'bbva-mexico', 'self', 'transfer', 'debit', 'posted',
    String.raw`(?:BBVA México:? )?Enviaste {MXN} a {N} vía SPEI\.?`),
  t('mx-bbva-atm-v1', 'MX', 'bbva-mexico', 'required', 'cash-withdrawal', 'debit', 'posted',
    String.raw`(?:BBVA México:? )?Retiraste {MXN} en Cajero(?: Automático| BBVA)?\.?`),
  t('mx-bbva-transfer-out-v1', 'MX', 'bbva-mexico', 'required', 'transfer', 'debit', 'posted',
    String.raw`(?:BBVA México:? )?Transferencia enviada por {MXN} a {N}(?: concepto (?<concept>\S.{0,60}?))?\.?`),
  t('mx-bbva-transfer-in-v1', 'MX', 'bbva-mexico', 'required', 'transfer', 'credit', 'posted',
    String.raw`(?:BBVA México:? )?Transferencia recibida por {MXN} de {N}(?: concepto (?<concept>\S.{0,60}?))?\.?`),
  // Headings ("Compra por"), approvals without a card, a cardless-withdrawal
  // code and an own-account move with no side: Review only.
  t('mx-bbva-purchase-v1', 'MX', 'bbva-mexico', 'required', 'purchase', 'debit', 'review',
    String.raw`(?:BBVA México:? )?Compra por {MXN} en {M} con tarjeta(?: (?:débito|crédito))? \*(?<last4>\d{4})(?: el {DATE} a las {TIME} hrs)?\.?`),
  t('mx-bbva-authorized-purchase-v1', 'MX', 'bbva-mexico', 'required', 'purchase', 'debit', 'review',
    String.raw`(?:BBVA México:? )?Compra autorizada por {MXN} en {M}\.?`),
  t('mx-bbva-approved-purchase-v1', 'MX', 'bbva-mexico', 'required', 'purchase', 'debit', 'review',
    String.raw`(?:BBVA México:? )?Tu compra en {M} por {MXN} fue aprobada\.?`),
  t('mx-bbva-cardless-withdrawal-v1', 'MX', 'bbva-mexico', 'required', 'cash-withdrawal', 'debit', 'review',
    String.raw`(?:BBVA México:? )?Retiro sin tarjeta por {MXN} en Cajero BBVA el {DATE}\.?`),
  t('mx-bbva-own-transfer-v1', 'MX', 'bbva-mexico', 'required', 'transfer', 'debit', 'review',
    String.raw`(?:BBVA México:? )?Traspaso entre tus cuentas por {MXN} de (?<from>\S.{0,40}?) a (?<to>\S.{0,40}?)\.?`),

  // ── Peru ── S/ is unique to Peru.
  t('pe-yape-received-v1', 'PE', 'yape', 'self', 'transfer', 'credit', 'posted',
    String.raw`(?:Yape!? )?{N} te (?:ha enviado|envió|envio|envío) un pago (?:por|de) {PEN}\.?(?: (?<codeClause>(?:El )?[Cc]ód(?:igo|\.) de seguridad(?: es)?:~(?<code>\d{3})\.?))?`,
    { receiptCode: true }),
  t('pe-yape-received-v1', 'PE', 'yape', 'self', 'transfer', 'credit', 'posted',
    String.raw`Te yape(?:ó|o) {PEN} {N}\.?`),
  t('pe-yape-received-v1', 'PE', 'yape', 'self', 'transfer', 'credit', 'posted',
    String.raw`¡Te yapearon!~{PEN}\.?`),
  t('pe-yape-received-v1', 'PE', 'yape', 'self', 'transfer', 'credit', 'posted',
    String.raw`Recibiste un yape de {PEN} de {N}\.?`),
  t('pe-yape-sent-v1', 'PE', 'yape', 'self', 'transfer', 'debit', 'posted',
    String.raw`¡Genial! Tu pago ha sido enviado a {N} por {PEN}\.?`),
  t('pe-yape-sent-v1', 'PE', 'yape', 'self', 'transfer', 'debit', 'posted',
    String.raw`Yapeaste {PEN} a {N}\.?`),
  t('pe-yape-sent-v1', 'PE', 'yape', 'self', 'transfer', 'debit', 'posted',
    String.raw`Has enviado el monto de {PEN}\.?(?:~[\p{Extended_Pictographic}\u{FE0F}]+)?`),
  t('pe-bcp-consumo-v1', 'PE', 'bcp', 'self', 'purchase', 'debit', 'posted',
    String.raw`(?:BCP: )?Realizaste un consumo de {PEN} en {M} con tu tarjeta \*{4}(?<last4>\d{4})\.?`),
  t('pe-bcp-card-purchase-v1', 'PE', 'bcp', 'self', 'purchase', 'debit', 'review',
    String.raw`(?:BCP: )?Compra con tarjeta BCP(?: (?:débito|crédito))? por {PEN} en {M}\.?`),
  t('pe-bcp-transfer-out-v1', 'PE', 'bcp', 'self', 'transfer', 'debit', 'review',
    String.raw`(?:BCP: )?Transferencia efectuada por {PEN} a {N}\.?`),
  t('pe-bcp-transfer-in-v1', 'PE', 'bcp', 'self', 'transfer', 'credit', 'review',
    String.raw`(?:BCP: )?Transferencia recibida por {PEN} de {N}\.?`),
  t('pe-plin-received-v1', 'PE', 'plin', 'self', 'transfer', 'credit', 'review',
    String.raw`Plin: Recibiste {PEN} de {N}\.?`),
  t('pe-plin-received-v1', 'PE', 'plin', 'self', 'transfer', 'credit', 'review',
    String.raw`{N} te envió un plin de {PEN}\.?`),
  t('pe-plin-sent-v1', 'PE', 'plin', 'self', 'transfer', 'debit', 'review',
    String.raw`(?:Plin: )?Le enviaste {PEN} a {N}\.?`),
];

// Cheap superset: every template above needs one of these.
const PREFILTER = /R\$|\$|COP|S\/|te envi[oóí]|\d,\d{2}/u;

// ── Guards ──────────────────────────────────────────────────────────────────
// Applied to the message with the captured free text (merchant, names, keys,
// places, concepts) blanked, so "NO FRILLS STORE" or a payee called PROMO
// cannot veto, and any of these words anywhere else can.
// Portuguese "no" is a preposition ("no cartão", "no valor de"), so the
// stand-alone negation words differ by language.
const NEGATION = /rechaz|recus|negad[oa]|insuficient|declin|fallid|falh|cancelad|anulad|revertid|estornad|bloquead|bloquea/iu;
const NEGATION_PT = /(?<![\p{L}\p{N}])(?:n[ãa]o|nunca|jamais)(?![\p{L}\p{N}])/iu;
const NEGATION_ES = /(?<![\p{L}\p{N}])(?:no|nunca|jam[aá]s|ni)(?![\p{L}\p{N}])/iu;
const CONFIRMATION = /(?<![\p{L}])(?:confirme|confirmar|confirma(?=\s)|responda|responde|reconoces|reconhece|autorizas|autoriza\s+esta|sim)(?![\p{L}])|foi\s+voc[eê]|fuiste\s+t[uú]|toque\s+aqui|clique|haz\s+clic|ingresa\s+aqu|[?¿]/iu;
// Bancolombia's help footer opens with "¿Dudas?"; it asks nothing about the payment.
const HELP_QUESTION = /¿\s*dudas\s*\?/giu;
const PENDING_OR_HOLD = /pendent|pendient|en\s+proceso|em\s+processamento|em\s+an[aá]lise|retenid|reservad|pr[eé]-?autoriz|preautoriz|agendad|programad|(?<![\p{L}])ser[aá](?![\p{L}])|se\s+(?:cargar|debitar|abonar)[aá]|en\s+espera|aguardando|por\s+aceptar|(?<![\p{L}])(?:acepta|aceita|hold)(?![\p{L}])/iu;
const CODE_OR_OTP = /c[óo]d(?:igo|\.)|token|(?<![\p{L}])otp(?![\p{L}])|clave|senha|contrase[ñn]a|verificaci|verifica[çc]/iu;
const OFFER_OR_LOAN = /empr[eé]stimo|pr[eé]-?aprova|pr[eé]-?aproba|cashback|cup[oó]n|cupom|promo|oferta|ganhe|ganha|gan[aá]ste|garant|simul|invist|invierte|meses\s+sin\s+intereses|desconto|descuento|l[ií]mite|(?<![\p{L}])cupo(?![\p{L}])|pr[eé]stamo|cr[eé]dito\s+(?:pre|dispon)/iu;
const LINK = /https?:\/\/|www\.|(?<![\p{L}])bit\.ly|\.(?:com|co|pe|mx|br)\/\S/iu;
// "por codigo QR" names the payment channel; it is not a security code.
const QR_CHANNEL = /c[óo]digo\s+QR/giu;

const FREE_TEXT_GROUPS = ['merchant', 'name', 'payee', 'key', 'place', 'concept', 'from', 'to', 'brand', 'product'] as const;

export interface LatamTemplateMatch {
  templateId: string;
  market: LatamMarket;
  institution: string;
  family: TemplateFamily;
  direction: 'debit' | 'credit';
  /** `posted` only for a certified template whose guards all passed. */
  status: 'posted' | 'unknown';
  money: UniversalMoney | null;
  /** Why the money could not be used (Review), when it could not. */
  amountIssue: 'amount-format-conflict' | 'amount-implausible' | null;
  merchant: string | null;
  /** Offset of the amount figure in the source, for its field span. */
  amountStart: number;
  last4: string | null;
  instrumentKind: UniversalInstrument['kind'] | null;
  transactionDate: string | null;
  balance: UniversalMoney | null;
  ownTransfer: boolean;
  /**
   * The message with Yape's receipt check removed. Callers hand this, never
   * the original, to wording guards and to anything that might be stored.
   */
  policySource: string;
}

export interface LatamTemplateContext {
  market?: UniversalMarket;
  sender?: string | null;
  /** An institution the caller's router already identified from sender or body. */
  institution?: string | null;
}

// ── Money ───────────────────────────────────────────────────────────────────
type Parsed = { minor: bigint } | 'conflict';
const toMinor = (integer: string, fraction: string): bigint =>
  BigInt(integer) * 100n + BigInt((fraction + '00').slice(0, 2));

/**
 * COP (spec §3): a 3-digit run after `.` or `,` is always grouping, so
 * `$45.000` is 45,000 pesos; a final separator followed by exactly two digits
 * is the decimal mark, whichever character it is (`$33.335,00`,
 * `$1,111,111.00`). Bancolombia mixes both styles. A one-digit fraction or a
 * malformed group (`$1.25.000`, `$45.5`) is a conflict and goes to Review.
 */
export const parseCopFigure = (figure: string): Parsed => {
  if (/^\d+$/.test(figure)) return { minor: toMinor(figure, '') };
  const match = /^(\d{1,3})((?:([.,])\d{3})(?:\3\d{3})*)?(?:([.,])(\d{2}))?$/.exec(figure);
  if (!match) return 'conflict';
  const [, head, groups = '', groupSep, decimalSep, fraction = ''] = match;
  if (!groups && !decimalSep) return 'conflict';
  if (groupSep && decimalSep && groupSep === decimalSep) return 'conflict';
  return { minor: toMinor(head + groups.replace(/[.,]/g, ''), fraction) };
};

/** MXN: comma thousands, dot decimals. Dot grouping (`$45.000`) is a format conflict. */
export const parseMxnFigure = (figure: string): Parsed => {
  const match = /^(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?$/.exec(figure);
  return match ? { minor: toMinor(match[1].replace(/,/g, ''), match[2] ?? '') } : 'conflict';
};

/** PEN: comma thousands, dot decimals; Yape prints whole soles with no decimals. */
export const parsePenFigure = (figure: string): Parsed => {
  const match = /^(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?$/.exec(figure);
  return match ? { minor: toMinor(match[1].replace(/,/g, ''), match[2] ?? '') } : 'conflict';
};

/** BRL: dot thousands, comma and exactly two decimals. */
export const parseBrlFigure = (figure: string): Parsed => {
  const match = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(figure);
  return match ? { minor: toMinor(match[1].replace(/\./g, ''), match[2]) } : 'conflict';
};

const parseFigure = (currency: LatamCurrency, figure: string): Parsed =>
  currency === 'COP' ? parseCopFigure(figure)
    : currency === 'MXN' ? parseMxnFigure(figure)
      : currency === 'PEN' ? parsePenFigure(figure) : parseBrlFigure(figure);

const money = (currency: LatamCurrency, minor: bigint): UniversalMoney =>
  ({ currency, minorUnits: minor.toString(), exponent: 2 });

// ── Dates ───────────────────────────────────────────────────────────────────
const isoDate = (value: string | undefined): string | null => {
  if (!value) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// ── Identity ────────────────────────────────────────────────────────────────
const identified = (
  source: string,
  template: LatamTemplate,
  sender: string,
  institution: string | null | undefined,
): boolean => {
  if (template.identity === 'self' || institution === template.institution) return true;
  const review = inspectAlertInstitutionGrammar(source, template.market, sender);
  return review.decision === 'identified' && review.institution === template.institution;
};

const blankGroups = (text: string, match: RegExpExecArray): string => {
  let out = text;
  for (const group of FREE_TEXT_GROUPS) {
    const value = match.groups?.[group];
    if (!value) continue;
    const at = out.indexOf(value, match.index);
    if (at >= 0) out = out.slice(0, at) + ' '.repeat(value.length) + out.slice(at + value.length);
  }
  return out;
};

const guardsPass = (guardText: string, market: LatamMarket): boolean => {
  const text = guardText.replace(QR_CHANNEL, ' ').replace(HELP_QUESTION, ' ');
  return !NEGATION.test(text) && !(market === 'BR' ? NEGATION_PT : NEGATION_ES).test(text) &&
    !CONFIRMATION.test(text) && !PENDING_OR_HOLD.test(text) &&
    !CODE_OR_OTP.test(text) && !OFFER_OR_LOAN.test(text) && !LINK.test(text);
};

/** Where the amount figure sits: the first copy right after a currency token. */
const figureStart = (source: string, match: RegExpExecArray, figure: string | undefined): number => {
  if (!figure) return -1;
  let at = source.indexOf(figure, match.index);
  const first = at;
  while (at >= 0) {
    if (/(?:R\$|\$|COP|S\/\.?)\s*$/u.test(source.slice(Math.max(0, at - 6), at))) return at;
    at = source.indexOf(figure, at + 1);
  }
  return first;
};

const cleanMerchant = (value: string | undefined): string | null => {
  const merchant = value?.replace(/\s+/gu, ' ').trim();
  return merchant && /\p{L}/u.test(merchant) ? merchant : null;
};

/** The first anchored template this message matches, with its decision. */
export function matchLatamTemplate(
  source: string,
  context: LatamTemplateContext = {},
): LatamTemplateMatch | null {
  if (typeof source !== 'string' || source.length > 1024 || !PREFILTER.test(source)) return null;
  const sender = context.sender?.slice(0, 256) ?? '';
  for (const template of TEMPLATES) {
    if (context.market && context.market !== template.market) continue;
    const match = template.pattern.exec(source);
    if (!match || !identified(source, template, sender, context.institution)) continue;
    const groups = match.groups ?? {};
    const parsed = parseFigure(template.currency, groups.amount ?? '');
    // A zero amount is not a movement; leave it to the generic refusal.
    if (parsed !== 'conflict' && parsed.minor <= 0n) return null;
    let amountIssue: LatamTemplateMatch['amountIssue'] = parsed === 'conflict' ? 'amount-format-conflict' : null;
    // Nu Colombia repeats the amount in the title and body: both must agree.
    if (parsed !== 'conflict' && groups.amount2) {
      const second = parseFigure(template.currency, groups.amount2);
      if (second === 'conflict' || second.minor !== parsed.minor) amountIssue = 'amount-format-conflict';
    }
    // A sub-50-peso card purchase is a sign that "45.000" was mangled to "45".
    if (!amountIssue && parsed !== 'conflict' && template.currency === 'COP' &&
      template.family === 'purchase' && parsed.minor < 5000n) amountIssue = 'amount-implausible';
    const policySource = template.receiptCode && groups.codeClause
      ? source.replace(groups.codeClause, '').trim()
      : source;
    const guardText = blankGroups(template.receiptCode && groups.codeClause
      ? source.replace(groups.codeClause, ' '.repeat(groups.codeClause.length))
      : source, match);
    const last4 = groups.last4 && /^\d{4}$/.test(groups.last4) ? groups.last4 : null;
    const guarded = guardsPass(guardText, template.market);
    // Approval wording counts as posted only inside its exact template, with a
    // masked card or account and no vetoing wording (the user decision).
    const certified = template.mode === 'posted' || (template.mode === 'approval' && last4 !== null);
    if (template.mode !== 'review' && !guarded) return null;
    const balanceParsed = groups.balance ? parseFigure(template.currency, groups.balance) : null;
    return {
      templateId: template.id,
      market: template.market,
      institution: template.institution,
      family: template.family,
      direction: template.direction,
      status: certified && guarded && !amountIssue ? 'posted' : 'unknown',
      money: parsed === 'conflict' ? null : money(template.currency, parsed.minor),
      amountIssue,
      merchant: template.family === 'transfer' ? null : cleanMerchant(groups.merchant),
      amountStart: figureStart(source, match, groups.amount),
      last4,
      instrumentKind: last4
        ? new RegExp(String.raw`(?:cuenta|producto|conta)\s*\*{0,2}${last4}(?!\d)`, 'iu').test(match[0]) ? 'account' : 'card'
        : null,
      transactionDate: isoDate(groups.date),
      balance: balanceParsed && balanceParsed !== 'conflict' ? money(template.currency, balanceParsed.minor) : null,
      ownTransfer: !!template.ownTransfer,
      policySource,
    };
  }
  return null;
}

/** The message a wording guard or a stored excerpt may see (Yape code removed). */
export const latamPolicySource = (source: string, context: LatamTemplateContext = {}): string =>
  matchLatamTemplate(source, context)?.policySource ?? source;

const explicit = <T>(value: T, source: string, text: string | null): UniversalField<T> => {
  const at = text ? source.indexOf(text) : -1;
  return {
    value, evidence: 'explicit', alternatives: [], issues: [],
    spans: at >= 0 && text ? [{ start: at, end: at + text.length }] : [],
  };
};

/**
 * The universal event a matched template stands for. Field spans point into
 * the original source, as the generic parser's do; no source text is kept.
 */
export function latamTemplateEvent(source: string, match: LatamTemplateMatch): UniversalBankEvent {
  const figure = match.amountStart >= 0
    ? /^\d[\d.,]*\d|^\d/u.exec(source.slice(match.amountStart))?.[0] ?? null
    : null;
  const amount: UniversalField<UniversalMoney> = match.money && !match.amountIssue
    ? {
        value: match.money, evidence: 'explicit', alternatives: [], issues: [],
        spans: figure ? [{ start: match.amountStart, end: match.amountStart + figure.length }] : [],
      }
    : {
        value: null,
        evidence: match.money ? 'ambiguous' : 'missing',
        spans: [],
        alternatives: match.money ? [match.money] : [],
        issues: [match.amountIssue ?? 'amount-format-conflict'],
      };
  const balance = match.balance ? explicit(match.balance, source, null) : missingUniversalField<UniversalMoney>();
  const observations = [
    { role: 'transaction' as const, field: amount },
    ...(match.balance ? [{ role: 'balance' as const, field: balance }] : []),
  ];
  const posted = match.status === 'posted';
  return {
    version: 1,
    decision: 'review',
    family: match.family,
    status: match.status,
    direction: match.direction,
    amount,
    statementTotal: missingUniversalField(),
    minimumDue: missingUniversalField(),
    balance,
    creditLimit: missingUniversalField(),
    merchant: match.merchant ? explicit(match.merchant, source, match.merchant) : missingUniversalField('merchant-unresolved'),
    transactionDate: match.transactionDate
      ? { value: match.transactionDate, evidence: 'explicit', spans: [], alternatives: [], issues: [] }
      : missingUniversalField(),
    dueDate: missingUniversalField(),
    statementDate: missingUniversalField(),
    instrument: match.last4 && match.instrumentKind
      ? { value: { kind: match.instrumentKind, last4: match.last4 }, evidence: 'explicit', spans: [], alternatives: [], issues: [] }
      : missingUniversalField(),
    observations,
    issues: [
      ...(posted ? [] : ['posting-status-unresolved', 'latam-template-review-only']),
      ...(match.amountIssue ? [match.amountIssue] : []),
      ...(match.merchant ? [] : ['merchant-unresolved']),
      ...(match.transactionDate ? [] : ['transaction-date-unresolved']),
    ],
  };
}

/**
 * Certified LatAm template id for template certification, or null. The
 * notification path additionally requires the router to have identified the
 * same institution: a template the body alone matches is not issuer proof.
 */
export function certifiedLatamTemplateId(
  source: string,
  market: UniversalMarket,
  institution: string | null,
  event: UniversalBankEvent,
): string | null {
  if (!institution || event.status !== 'posted') return null;
  const match = matchLatamTemplate(source, { market, institution });
  if (!match || match.status !== 'posted' || match.institution !== institution ||
    match.family !== event.family || match.direction !== event.direction) return null;
  return match.templateId;
}

/**
 * Banks with synthetic-only evidence (or none). Their alerts may be routed and
 * reviewed, but nothing they send posts: a generic reading of "posted" is
 * downgraded to Review. Plin is a rail hosted by several banks.
 */
const REVIEW_ONLY_IDENTITIES: readonly { market: LatamMarket; institutions: readonly string[] }[] = [
  { market: 'PE', institutions: ['plin', 'interbank', 'bbva-peru', 'scotiabank-peru'] },
  { market: 'MX', institutions: ['santander-mexico', 'citibanamex'] },
];

export function isReviewOnlyLatamInstitution(source: string, sender?: string | null): boolean {
  for (const { market, institutions } of REVIEW_ONLY_IDENTITIES) {
    const review = inspectAlertInstitutionGrammar(source, market, sender);
    if (review.candidates.some((candidate) => institutions.includes(candidate.institution))) return true;
  }
  return false;
}

/** Stable ids only; for diagnostics and tests. */
export const latamTemplateIds = (mode?: TemplateMode): string[] =>
  [...new Set(TEMPLATES.filter((template) => !mode || template.mode === mode).map((template) => template.id))];
