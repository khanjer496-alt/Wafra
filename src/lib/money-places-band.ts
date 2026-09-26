/**
 * Pure layout figures for the design-language-E money screens: the Bills band
 * (its total, count and timeline pins), the Accounts band chips, the card
 * block's usage status and the goal ring.
 *
 * Nothing here computes money that a screen did not already compute: every
 * amount is read from the agenda rows, the account list or the goal as they
 * are. Paid rows never count toward what is due, and a pin is only drawn for
 * something that falls due inside the window it names.
 */
import { daysBetweenISO } from '@/lib/format';
import { limitStatus, type LimitStatus } from '@/lib/limit-status';
import type { CardUsage } from '@/lib/money-places';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';
import type { Account, CategoryId } from '@/lib/types';

/** What the Bills band says: the open total, how many payments, and how many are estimates. */
export interface AgendaSummary {
  totalFils: number;
  count: number;
  estimated: number;
}

/** The band's figure for the rows the current view shows. Paid rows are history, not something due. */
export function openAgendaSummary(items: readonly Pick<PaymentAgendaItem, 'amountFils' | 'paid' | 'estimated'>[]): AgendaSummary {
  let totalFils = 0;
  let count = 0;
  let estimated = 0;
  for (const item of items) {
    if (item.paid) continue;
    totalFils += item.amountFils;
    count += 1;
    if (item.estimated) estimated += 1;
  }
  return { totalFils, count, estimated };
}

export interface BillsPin {
  key: string;
  /** Days from today; 0 is today. */
  dayOffset: number;
  title: string;
  category: CategoryId;
  amountFils: number;
  estimated: boolean;
}

/**
 * The timeline's pins: every unpaid payment dated from today to the end of
 * the window, in date order. The day is counted from the payment's own date,
 * as the list below dates it. What is already late stays in that list — the
 * strip starts at today and a pin before it would sit on nothing — and so
 * does anything past the window its label names.
 */
export function billsTimelinePins(items: readonly PaymentAgendaItem[], todayISO: string, days = 30): BillsPin[] {
  const pins: BillsPin[] = [];
  for (const item of items) {
    if (item.paid) continue;
    const dayOffset = daysBetweenISO(todayISO, item.dateISO);
    if (!Number.isFinite(dayOffset) || dayOffset < 0 || dayOffset > days) continue;
    pins.push({
      key: item.id, dayOffset, title: item.title, category: item.category,
      amountFils: item.amountFils, estimated: item.estimated,
    });
  }
  return pins.sort((a, b) => a.dayOffset - b.dayOffset || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

/**
 * The Accounts band's two facts: how many accounts can hold a balance, and
 * how many credit cards are kept apart from it (their dues are never netted
 * against the balances — see the no-merged-net decision in wallet.tsx).
 */
export function accountsBandCounts(accounts: readonly Pick<Account, 'archived' | 'cardType'>[]): { accounts: number; creditCards: number } {
  let balances = 0;
  let creditCards = 0;
  for (const account of accounts) {
    if (account.archived) continue;
    if (account.cardType === 'credit') creditCards += 1;
    else balances += 1;
  }
  return { accounts: balances, creditCards };
}

/** The card block's usage bar colour is status only: within, near (≥85%) or over the user's limit. */
export function cardUsageStatus(usage: Pick<CardUsage, 'usedFils' | 'limitFils'>): LimitStatus {
  return limitStatus(usage.usedFils, usage.limitFils);
}

/** Ring geometry for a goal: the arc never runs past a full turn and never goes negative. */
export function goalRingGeometry(size: number, stroke: number, ratio: number): {
  radius: number; circumference: number; dashOffset: number; drawn: boolean;
} {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  return { radius, circumference, dashOffset: circumference * (1 - clamped), drawn: clamped > 0 };
}
