export type ScheduledDebitScheme =
  | 'upi-autopay'
  | 'nach'
  | 'ecs'
  | 'sepa-direct-debit'
  | 'bacs-direct-debit'
  | 'ach-debit'
  | 'standing-order'
  | 'unknown';

export type ScheduledDebitEvent =
  | 'created'
  | 'modified'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'scheduled'
  | 'executed'
  | 'posted'
  | 'failed'
  | 'reversed'
  | 'funds-released'
  | 'unknown';

export interface ScheduledDebitEvidence {
  subject: 'mandate' | 'standing-instruction' | 'direct-debit' | 'merchant-agreement';
  scheme: ScheduledDebitScheme;
  event: ScheduledDebitEvent;
  amountRole: 'maximum' | 'scheduled' | 'posted' | 'none';
  amountCandidateIndex: number | null;
  /** A stable mandate/reference label exists, but its value is never copied into the review. */
  hasReference: boolean;
}

export interface AlertFeeEvidence {
  scope: 'bank' | 'account' | 'card';
  event: 'scheduled' | 'posted' | 'failed' | 'unknown';
}

export interface AlertUtilityEvidence {
  event: 'due' | 'posted' | 'failed' | 'unknown';
}

export interface AlertInstrumentEvidence {
  kind: 'card' | 'account' | 'wallet';
  /** Last four digits only; null when the alert does not ground an instrument identity. */
  last4: string | null;
}

export interface AlertEventEvidence {
  scheduledDebit: ScheduledDebitEvidence | null;
  fee: AlertFeeEvidence | null;
  utility: AlertUtilityEvidence | null;
  instrument: AlertInstrumentEvidence | null;
}

interface EventEvidenceContext {
  recurringTerm: string | null;
  utilityTerm: string | null;
  primaryCandidateIndex: number | null;
}

const MANDATE = /\b(?:e[ -]?mandate|upi mandate|autopay mandate|mandate)\b|تفويض|[أا]مر دفع/i;
const STANDING_ORDER = /\b(?:standing order|standing instruction|dauerauftrag|ordine permanente)\b|[أا]مر مستديم/i;
const DIRECT_DEBIT = /\b(?:direct debit|sepa direct debit|pr[eé]l[eè]vement|lastschrift|domiciliaci[oó]n|addebito diretto|automatische incasso|nach|ecs)\b|خصم مباشر/i;
const SCHEDULED = /\b(?:pre[ -]?debit|will be (?:debited|charged|deducted|collected)|will apply|scheduled debit|next debit|upcoming debit|collect request|due on)\b|سيتم (?:الخصم|السحب|التحصيل)|خصم قادم/i;
const CREATED = /\b(?:created|registered|set up|setup successful|activated|approved)\b|تم (?:[إا]نشاء|تسجيل|تفعيل|الموافق[ةه])/i;
const MODIFIED = /\b(?:modified|amended|updated)\b|تم (?:تعديل|تحديث)/i;
const PAUSED = /\b(?:paused|suspended)\b|تم (?:تعليق|[إا]يقاف مؤقت)/i;
const RESUMED = /\b(?:resumed|reactivated)\b|تم (?:استئناف|[إا]عاده التفعيل)/i;
const CANCELLED = /\b(?:cancelled|canceled|revoked|stopped|deactivated|terminated)\b|تم (?:[إا]لغاء|[إا]يقاف)|ملغ[يى]/i;
const FAILED = /\b(?:failed|declined|rejected|unsuccessful|returned unpaid)\b|فشل|مرفوض/i;
const REVERSED = /\b(?:reversed|refunded|returned)\b|تم (?:العكس|الاسترداد|الرد)/i;
const FUNDS_RELEASED = /\b(?:funds?|amount) (?:unblocked|released)\b|تم (?:فك الحجز|تحرير المبلغ)/i;
const EXECUTED = /\bexecuted\b|تم التنفيذ/i;
const POSTED = /\b(?:charged|debited|paid|posted|processed|completed|successful)\b|تم (?:الخصم|الدفع|التنفيذ)/i;
const MOVEMENT = /\b(?:charged|debited|credited|paid|withdrawn|deposited)\b|تم (?:الخصم|الدفع|الإيداع)/i;
const REFERENCE = /\b(?:mandate id|mandate reference|umn|unique mandate reference|instruction id|reference)\b|رقم (?:التفويض|المرجع)/i;

const FEE = /\b(?:annual|monthly|maintenance|service|membership|renewal|overdraft|late payment)(?:\s+(?:bank|account|card|maintenance|service|membership)){0,3}\s+(?:fee|charge)\b|\b(?:bank|account|card)\s+(?:fee|charge)\b|رسوم (?:سنوي[ةه]|شهري[ةه]|حساب|بطاق[ةه]|خدم[ةه])/i;
const CARD_SCOPE = /\b(?:credit|debit)?\s*card\b|بطاق[ةه]/i;
const ACCOUNT_SCOPE = /\b(?:bank )?account\b|\ba\/?c\b|حساب/i;
const WALLET_SCOPE = /\bwallet\b|محفظه/i;

const CARD_LAST4 = /\bcard(?:\s+(?:ending(?:\s+in)?|no\.?|number))?\s*[*xX•-]*(\d{4})\b/i;
const ACCOUNT_LAST4 = /\b(?:account|a\/?c)(?:\s+(?:ending(?:\s+in)?|no\.?|number))?\s*[*xX•-]*(\d{4})\b/i;
const WALLET_LAST4 = /\bwallet(?:\s+(?:ending(?:\s+in)?|no\.?|number))?\s*[*xX•-]*(\d{4})\b/i;
const ARABIC_CARD_LAST4 = /بطاق[ةه].{0,24}(?:تنتهي|[آا]خر\s*(?:4|[أا]ربع[ةه])|رقم)\s*[*xX•-]*(\d{4})/i;
const ARABIC_ACCOUNT_LAST4 = /حساب.{0,24}(?:ينتهي|[آا]خر\s*(?:4|[أا]ربع[ةه])|رقم)\s*[*xX•-]*(\d{4})/i;

const scheduledDebitEvent = (text: string): ScheduledDebitEvent => {
  if (CANCELLED.test(text)) return 'cancelled';
  if (PAUSED.test(text)) return 'paused';
  if (RESUMED.test(text)) return 'resumed';
  if (MODIFIED.test(text)) return 'modified';
  if (FAILED.test(text)) return 'failed';
  if (FUNDS_RELEASED.test(text)) return 'funds-released';
  if (REVERSED.test(text)) return 'reversed';
  if (CREATED.test(text)) return 'created';
  if (SCHEDULED.test(text)) return 'scheduled';
  if (EXECUTED.test(text)) return 'executed';
  if (POSTED.test(text)) return 'posted';
  return 'unknown';
};

const scheduledDebitScheme = (text: string): ScheduledDebitScheme => {
  if (/\bupi(?:\s+autopay)?\b/i.test(text)) return 'upi-autopay';
  if (/\bnach\b/i.test(text)) return 'nach';
  if (/\becs\b/i.test(text)) return 'ecs';
  if (/\bsepa(?:\s+direct debit)?\b|pr[eé]l[eè]vement|lastschrift|domiciliaci[oó]n|addebito diretto|automatische incasso/i.test(text)) {
    return 'sepa-direct-debit';
  }
  if (/\bbacs\b/i.test(text)) return 'bacs-direct-debit';
  if (/\bach\b/i.test(text)) return 'ach-debit';
  if (STANDING_ORDER.test(text)) return 'standing-order';
  return 'unknown';
};

const scheduledDebitFor = (
  text: string,
  recurringTerm: string | null,
  primaryCandidateIndex: number | null,
): ScheduledDebitEvidence | null => {
  let subject: ScheduledDebitEvidence['subject'] | null = null;
  if (MANDATE.test(text)) subject = 'mandate';
  else if (STANDING_ORDER.test(text)) subject = 'standing-instruction';
  else if (DIRECT_DEBIT.test(text)) subject = 'direct-debit';
  else if (SCHEDULED.test(text) && recurringTerm) subject = 'merchant-agreement';
  if (!subject) return null;
  const event = scheduledDebitEvent(text);
  const amountRole = event === 'scheduled' ? 'scheduled' :
    event === 'executed' && MOVEMENT.test(text) ? 'posted' :
    event === 'posted' || event === 'reversed' ? 'posted' :
      event === 'created' || event === 'modified' ? 'maximum' : 'none';
  return {
    subject,
    scheme: scheduledDebitScheme(text),
    event,
    amountRole,
    amountCandidateIndex: amountRole === 'none' ? null : primaryCandidateIndex,
    hasReference: REFERENCE.test(text),
  };
};

const feeFor = (text: string): AlertFeeEvidence | null => {
  if (!FEE.test(text)) return null;
  const event = FAILED.test(text) ? 'failed' : SCHEDULED.test(text) ? 'scheduled' :
    POSTED.test(text) ? 'posted' : 'unknown';
  return {
    scope: CARD_SCOPE.test(text) ? 'card' : ACCOUNT_SCOPE.test(text) ? 'account' : 'bank',
    event,
  };
};

const utilityFor = (text: string, utilityTerm: string | null): AlertUtilityEvidence | null => {
  if (!utilityTerm) return null;
  const event = FAILED.test(text) ? 'failed' : POSTED.test(text) ? 'posted' :
    SCHEDULED.test(text) || /\b(?:amount due|payment due|bill due)\b|مستحق/i.test(text) ?
      'due' : 'unknown';
  return { event };
};

const instrumentFor = (text: string): AlertInstrumentEvidence | null => {
  const card = CARD_LAST4.exec(text);
  if (card) return { kind: 'card', last4: card[1] };
  const account = ACCOUNT_LAST4.exec(text);
  if (account) return { kind: 'account', last4: account[1] };
  const wallet = WALLET_LAST4.exec(text);
  if (wallet) return { kind: 'wallet', last4: wallet[1] };
  const arabicCard = ARABIC_CARD_LAST4.exec(text);
  if (arabicCard) return { kind: 'card', last4: arabicCard[1] };
  const arabicAccount = ARABIC_ACCOUNT_LAST4.exec(text);
  if (arabicAccount) return { kind: 'account', last4: arabicAccount[1] };
  if (CARD_SCOPE.test(text)) return { kind: 'card', last4: null };
  if (ACCOUNT_SCOPE.test(text)) return { kind: 'account', last4: null };
  if (WALLET_SCOPE.test(text)) return { kind: 'wallet', last4: null };
  return null;
};

/**
 * Extract non-monetary evidence that may support later subscription, bill and
 * fee review. The result contains no source text or full identifiers and never
 * decides whether an amount is safe to import.
 */
export const inspectAlertEventEvidence = (
  normalizedText: string,
  context: EventEvidenceContext,
): AlertEventEvidence => ({
  scheduledDebit: scheduledDebitFor(
    normalizedText,
    context.recurringTerm,
    context.primaryCandidateIndex,
  ),
  fee: feeFor(normalizedText),
  utility: utilityFor(normalizedText, context.utilityTerm),
  instrument: instrumentFor(normalizedText),
});
