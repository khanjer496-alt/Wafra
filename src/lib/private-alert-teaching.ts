import { dateOrderForCountry } from '@/lib/country';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import { inspectUniversalAlert } from '@/lib/alert-market-detection';
import { universalSourceParseContext } from '@/lib/launch-alert-parser';
import type { LearnInput } from '@/lib/learned-alert-formats';
import { extractUniversalMoney } from '@/lib/universal-money';
import type { UniversalMoney, UniversalMoneyRole, UniversalParseContext } from '@/lib/universal-types';

/** Share the source-owned calendar convention without widening the sealed
 * format's currency aliases or treating a body bank mention as an issuer. */
export function privateAlertSourceDateContext(source: string, sender: string | null | undefined,
  fallback: { country?: string | null; dateOrder?: UniversalParseContext['dateOrder'] | null } = {}) {
  const country = fallback.country ?? null;
  const textSender = sender ?? '';
  const inspection = hasUniversalInstitutionSender(textSender) ? inspectUniversalAlert({ source, sender: textSender }) : null;
  // With no country fallback, the shared reader supplies an order only when
  // the exact issuer and its owned principal currency corroborate it.
  const scoped = universalSourceParseContext(inspection, textSender, null);
  if (scoped.dateOrder) return { country, dateOrder: scoped.dateOrder, issuerConflict: false };
  const route = inspection?.route;
  if (route?.decision === 'ambiguous' && route.reasons.some(reason =>
    reason === 'overlapping-sender' || reason === 'sender-institution-conflict' || reason === 'multiple-institutions')) {
    // The closed matcher otherwise falls back from null dateOrder to country.
    return { country: null, dateOrder: null, issuerConflict: true };
  }
  return { country, dateOrder: fallback.dateOrder !== undefined ? fallback.dateOrder : dateOrderForCountry(country), issuerConflict: false };
}

export interface PrivateTeachingChoice {
  id: string;
  role: UniversalMoneyRole;
  money: UniversalMoney | null;
  selectable: boolean;
}

/** Ephemeral UI facts. Never put this inspection or its source in AppState. */
export function privateTeachingChoices(source: string, country: string | null = null, sender: string | null = null): {
  money: PrivateTeachingChoice[]; reason: 'too-long' | 'empty' | null;
} {
  if (!source.trim()) return { money: [], reason: 'empty' };
  if (source.length > 1000) return { money: [], reason: 'too-long' };
  const sourceContext = privateAlertSourceDateContext(source, sender, { country });
  const extracted = extractUniversalMoney(source, { dateOrder: sourceContext.dateOrder ?? undefined });
  const hasPrincipal = extracted.observations.some(row => ['transaction', 'unknown'].includes(row.role));
  return { reason: null, money: extracted.observations.map((observation, index) => {
    const money = observation.field.value;
    return {
      id: `money-${index}`, role: observation.role, money,
      selectable: observation.field.evidence === 'explicit' && !!money &&
        /^(?:[1-9]\d*)$/.test(money.minorUnits) && Number.isSafeInteger(Number(money.minorUnits)) &&
        (['transaction', 'unknown'].includes(observation.role) || (observation.role === 'fee' && !hasPrincipal)) &&
        !observation.field.issues.includes('aggregate-money-field'),
    };
  }) };
}

export function teachingMoneyLabel(money: UniversalMoney): string {
  const padded = money.minorUnits.padStart(money.exponent + 1, '0');
  const number = money.exponent === 0 ? padded
    : `${padded.slice(0, -money.exponent)}.${padded.slice(-money.exponent)}`;
  return `${money.currency} ${number}`;
}

export function buildPrivateTeachingInput(input: {
  source: string; sender: string; choiceId: string; direction: string;
  merchant: string; date: string; country: string | null; now: number;
}): { ok: true; input: LearnInput } | { ok: false; reason: string } {
  const inspection = privateTeachingChoices(input.source, input.country, input.sender);
  if (inspection.reason) return { ok: false, reason: inspection.reason };
  const chosen = inspection.money.find(row => row.id === input.choiceId && row.selectable);
  if (!chosen?.money) return { ok: false, reason: 'choose-amount' };
  if (input.direction !== 'debit' && input.direction !== 'credit') return { ok: false, reason: 'choose-direction' };
  if (input.sender.length > 80 || !Number.isFinite(input.now)) return { ok: false, reason: 'invalid-input' };
  const merchant = input.merchant.trim();
  if (merchant && (merchant.length > 96 || !input.source.includes(merchant) ||
    input.source.indexOf(merchant) !== input.source.lastIndexOf(merchant))) return { ok: false, reason: 'merchant-not-grounded' };
  const date = input.date.trim();
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'date-not-grounded' };
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return { ok: false, reason: 'date-not-grounded' };
  }
  const sourceContext = privateAlertSourceDateContext(input.source, input.sender, { country: input.country });
  return { ok: true, input: {
    source: input.source, sender: input.sender.trim() || null, now: input.now,
    context: { country: sourceContext.country, dateOrder: sourceContext.dateOrder },
    confirmed: { amountMinor: chosen.money.minorUnits, currency: chosen.money.currency,
      exponent: chosen.money.exponent, direction: input.direction,
      ...(merchant ? { merchant } : {}), ...(date ? { date } : {}) },
  } };
}
