/**
 * First run in design language E ("Your pattern"): the pure decisions behind
 * the five numbered steps. No React, no platform, no store — the gate calls
 * these and the repair suite executes them (onboarding-e.test.cjs).
 *
 * Money appears in two places only: `watchBudgetChanges`, which turns the
 * limits set on the Watch step into the ledger's ordinary monthly budgets
 * (minor units of the ledger currency, exactly what the Limit sheet writes),
 * and `watchedProgress`, which reads this month's real spending against one.
 */
import type { BandId } from '@/constants/theme';
import type { HomeWidgetId, HomeWidgetPreferences } from '@/lib/home-widget-preferences';
import { normalizeHomeWidgetPreferences } from '@/lib/home-widget-preferences';
import { allocationsOf, amountInCategory } from '@/lib/splits';
import { isLiveCapture } from '@/lib/transaction-source';
import type { Budget, CategoryId, GoalId, OnboardingAlertDelivery, OnboardingJourneyStage, Transaction } from '@/lib/types';
import { GOAL_IDS } from '@/lib/types';

/** The steps of the E journey, in order. `name` … `capture` are the five numbered ones. */
export type OnboardingEStep =
  | 'welcome'
  | 'name'
  | 'goals'
  | 'watch'
  | 'reminders'
  | 'capture'
  | 'live'
  | 'complete'
  | 'pattern'
  | 'paywall';

export const ONBOARDING_E_TOTAL_STEPS = 5;

/**
 * The colour each step wears (boards E1–E9): Welcome, the pattern and the
 * paywall are ink; Name clay; Goals and first payment green; Watch sand;
 * Reminders ochre. Band ids, so dark mode deepens them like the tabs.
 */
export const ONBOARDING_E_BANDS: Record<OnboardingEStep, BandId> = {
  welcome: 'home',
  name: 'spending',
  goals: 'flow',
  watch: 'settings',
  reminders: 'bills',
  capture: 'flow',
  live: 'flow',
  complete: 'flow',
  pattern: 'home',
  paywall: 'home',
};

/**
 * The progress dot a step lights, 1–5, or null for the unnumbered screens
 * (Welcome, the pattern reveal and the paywall). The capture result belongs
 * to step 5: it is the second half of "your first payment".
 */
export function onboardingEStepNumber(step: OnboardingEStep): number | null {
  switch (step) {
    case 'name': return 1;
    case 'goals': return 2;
    case 'watch': return 3;
    case 'reminders': return 4;
    case 'capture':
    case 'live':
    case 'complete': return 5;
    default: return null;
  }
}

/**
 * Which persisted stage each screen writes. The E journey reuses the stage
 * names older builds already know, so a profile saved here still resumes on a
 * build that predates it (and the store's sanitizer accepts it unchanged):
 * Goals took Focus's place, Watch took Tracking's, Reminders took Alerts'.
 * Name is part of Welcome, as it always was; the result, pattern and paywall
 * are all after capture, so they save `complete` like the old completion.
 */
export function onboardingEStage(step: OnboardingEStep): OnboardingJourneyStage {
  switch (step) {
    case 'welcome':
    case 'name': return 'welcome';
    case 'goals': return 'focus';
    case 'watch': return 'tracking';
    case 'reminders': return 'alerts';
    case 'capture':
    case 'live': return 'capture';
    default: return 'complete';
  }
}

/**
 * Where a saved stage resumes. The capture step is `live` on iPhone (the
 * Shortcuts checklist) and `capture` everywhere else. Stages only older
 * journeys wrote land on the first E question the person has not answered:
 * the old Intention/Preview/Privacy screens sat after Alerts, so they resume at
 * Reminders; a Superwall hand-off resumes at the name, as it always did.
 */
export function onboardingEResumeStep(
  stage: OnboardingJourneyStage | 'ios-setup',
  platform: string,
): OnboardingEStep {
  switch (stage) {
    case 'welcome': return 'welcome';
    case 'remote-handoff': return 'name';
    case 'focus': return 'goals';
    case 'tracking': return 'watch';
    case 'alerts':
    case 'intention':
    case 'preview':
    case 'privacy': return 'reminders';
    case 'complete': return 'complete';
    default: return platform === 'ios' ? 'live' : 'capture';
  }
}

/* ── Goals → Home ─────────────────────────────────────────────────────────
 *
 * "What should Wafra do?" reorders Home through the SAME preference Customize
 * Home edits (home-widget-preferences). Nothing is hidden and nothing new is
 * stored: the chosen goals only decide which existing sections come first.
 *
 *   bills          → Due payments, then Upcoming payments
 *   subscriptions  → Upcoming payments (renewals are listed there)
 *   spend-less     → Insight (the one observation about this period)
 *   salary         → Recent activity, then Insight (where the money went)
 *   cash-cards     → Recent activity (every account in one list), then Due
 *                    payments (card statements are due there)
 *
 * Goals are applied in this precedence, not in tap order, so the same answers
 * always give the same Home: money about to leave first, then spending, then
 * the overview. Sections no goal names keep their current relative order,
 * after the promoted ones. No goals leaves the order exactly as it was.
 */
export const GOAL_HOME_SECTIONS: Record<GoalId, readonly HomeWidgetId[]> = {
  bills: ['due', 'upcoming'],
  subscriptions: ['upcoming'],
  'spend-less': ['insight'],
  salary: ['activity', 'insight'],
  'cash-cards': ['activity', 'due'],
};
export const GOAL_HOME_PRECEDENCE: readonly GoalId[] = ['bills', 'subscriptions', 'spend-less', 'salary', 'cash-cards'];

export function homeOrderForGoals(
  goals: readonly GoalId[],
  current: HomeWidgetPreferences,
): HomeWidgetPreferences {
  const base = normalizeHomeWidgetPreferences(current);
  const chosen = new Set(goals.filter((goal) => (GOAL_IDS as readonly string[]).includes(goal)));
  if (chosen.size === 0) return base;
  const promoted: HomeWidgetId[] = [];
  for (const goal of GOAL_HOME_PRECEDENCE) {
    if (!chosen.has(goal)) continue;
    for (const section of GOAL_HOME_SECTIONS[goal]) {
      if (!promoted.includes(section)) promoted.push(section);
    }
  }
  const rest = base.order.filter((section) => !promoted.includes(section));
  return { order: [...promoted, ...rest], hidden: [...base.hidden] };
}

/** The section the chosen goals put at the top of Home, for the Goals step's hint. */
export function firstHomeSectionForGoals(goals: readonly GoalId[]): HomeWidgetId | null {
  for (const goal of GOAL_HOME_PRECEDENCE) {
    if (goals.includes(goal)) return GOAL_HOME_SECTIONS[goal][0] ?? null;
  }
  return null;
}

/** Toggle one goal, keeping the canonical order `sanitizeGoalIds` stores. */
export function toggleGoal(goals: readonly GoalId[], goal: GoalId): GoalId[] {
  const next = new Set(goals);
  if (next.has(goal)) next.delete(goal);
  else next.add(goal);
  return GOAL_IDS.filter((id) => next.has(id));
}

/* ── Watch → budgets ──────────────────────────────────────────────────── */

/** The everyday categories the Watch step offers, as drawn on the board. */
export const WATCH_CATEGORIES: readonly CategoryId[] = ['dining', 'groceries', 'transport', 'shopping', 'entertainment', 'health'];

export interface WatchDraft {
  category: CategoryId;
  /** Monthly limit in ledger minor units; 0 = picked but not set yet. */
  limitMinor: number;
}

/** The Watch step's starting state: the offered categories that already have a limit. */
export function watchDraftFromBudgets(budgets: readonly Budget[]): WatchDraft[] {
  return WATCH_CATEGORIES.flatMap((category) => {
    const budget = budgets.find((item) => item.category === category);
    return budget && budget.limitFils > 0 ? [{ category, limitMinor: budget.limitFils }] : [];
  });
}

/**
 * What saving the Watch step writes: an upsert for every picked category with
 * a limit, and a delete for an offered category that had a limit and was
 * unpicked (or turned back to nothing) — Back and forth through onboarding
 * must not leave a limit the person removed. Categories outside the Watch
 * list are never touched. A picked category with no limit is not a budget.
 */
export function watchBudgetChanges(
  draft: readonly WatchDraft[],
  existing: readonly Budget[],
): { upsert: Budget[]; remove: CategoryId[] } {
  const upsert: Budget[] = [];
  const remove: CategoryId[] = [];
  for (const category of WATCH_CATEGORIES) {
    const picked = draft.find((item) => item.category === category);
    const limit = picked && Number.isSafeInteger(picked.limitMinor) && picked.limitMinor > 0 ? picked.limitMinor : 0;
    const before = existing.find((item) => item.category === category);
    if (limit > 0) {
      if (!before || before.limitFils !== limit) upsert.push({ category, limitFils: limit });
    } else if (before) {
      remove.push(category);
    }
  }
  return { upsert, remove };
}

/** Pick or unpick a category; a newly picked one starts with no limit. */
export function toggleWatch(draft: readonly WatchDraft[], category: CategoryId): WatchDraft[] {
  if (draft.some((item) => item.category === category)) {
    return draft.filter((item) => item.category !== category);
  }
  return WATCH_CATEGORIES.flatMap((id) => {
    if (id === category) return [{ category, limitMinor: 0 }];
    const kept = draft.find((item) => item.category === id);
    return kept ? [kept] : [];
  });
}

export function setWatchLimit(draft: readonly WatchDraft[], category: CategoryId, limitMinor: number): WatchDraft[] {
  const safe = Number.isSafeInteger(limitMinor) && limitMinor > 0 ? limitMinor : 0;
  return draft.map((item) => item.category === category ? { ...item, limitMinor: safe } : item);
}

/* ── First payment → the alert-delivery answer ───────────────────────────
 *
 * The E journey no longer asks "How does your bank reach you?"; the capture
 * step answers it from what the person actually chose, so the same field that
 * onboardingHistoryGap(), the first-run statement offer and Settings'
 * statement row read stays true:
 *
 *   sms            Android SMS reading on (with or without bank-app
 *                  notifications), or the iPhone Messages automation → 'sms'.
 *                  Their bank texts them; the inbox is the archive.
 *   notifications  Android bank-app notifications only → 'notifications'
 *                  (future capture, no history: the statement offer shows).
 *   statements     "Import statements" → 'unsure': the person is filling the
 *                  past from statements and has said nothing about how the
 *                  bank reaches them, so Settings shows the statement route
 *                  and keeps the question open for them to answer.
 *   manual         "I'll add by hand" → 'neither': nothing reaches Wafra on
 *                  its own, so no screen promises automatic future capture.
 *
 * The latest choice wins: opening statements and then turning on SMS ends at
 * 'sms'.
 */
export type OnboardingCaptureChoice = 'sms' | 'notifications' | 'statements' | 'manual';

export function alertsAnswerForCaptureChoice(choice: OnboardingCaptureChoice): OnboardingAlertDelivery {
  switch (choice) {
    case 'sms': return 'sms';
    case 'notifications': return 'notifications';
    case 'statements': return 'unsure';
    case 'manual': return 'neither';
  }
}

/* ── The first payment that arrived by itself ────────────────────────────
 *
 * Step 5's result shows the newest spending row that arrived on its own — a
 * bank text, a bank-app notification or Apple Pay (transaction-source.ts
 * isLiveCapture; statement and email rows are imports, not arrivals) — and,
 * when a limit was set, that category's spending this month against it. Real
 * rows only: nothing is shown until one exists.
 */
type CapturedRow = Pick<Transaction, 'id' | 'source' | 'date' | 'ts' | 'category' | 'amountFils' | 'type' | 'splits' |
  'viaPush' | 'captureSource' | 'smsKey' | 'walletBound'>;

export function arrivedPayment<T extends CapturedRow>(
  transactions: readonly T[],
  isSpending: (transaction: T) => boolean,
): T | null {
  let newest: T | null = null;
  for (const transaction of transactions) {
    if (!isLiveCapture(transaction) || !isSpending(transaction)) continue;
    if (!newest) { newest = transaction; continue; }
    const a = transaction.ts ?? Date.parse(`${transaction.date}T00:00:00`);
    const b = newest.ts ?? Date.parse(`${newest.date}T00:00:00`);
    if (a > b) newest = transaction;
  }
  return newest;
}

/**
 * The watched category to show beside the arrived payment: its own category
 * when it has a limit, else the first watched category (Watch order) with
 * one. Spending is this month's, per allocation, spending rows only.
 */
export function watchedProgress<T extends CapturedRow>(
  arrived: T | null,
  budgets: readonly Budget[],
  transactions: readonly T[],
  isSpending: (transaction: T) => boolean,
  inThisMonth: (dateISO: string) => boolean,
): { category: CategoryId; spentMinor: number; limitMinor: number } | null {
  const limited = budgets.filter((budget) => budget.limitFils > 0);
  const own = arrived ? limited.find((budget) => allocationsOf(arrived as unknown as Transaction)
    .some((part) => part.category === budget.category)) : undefined;
  const pick = own ?? WATCH_CATEGORIES.map((category) => limited.find((budget) => budget.category === category))
    .find((budget): budget is Budget => !!budget);
  if (!pick) return null;
  let spent = 0;
  for (const transaction of transactions) {
    if (inThisMonth(transaction.date) && isSpending(transaction)) {
      spent += amountInCategory(transaction as unknown as Transaction, pick.category);
    }
  }
  return { category: pick.category, spentMinor: spent, limitMinor: pick.limitFils };
}

/**
 * iPhone: Shortcuts setup (ios-setup) decides the source and finishes
 * onboarding itself, so the answer is read from what it recorded once it
 * returns: turned off → 'neither'; the Messages automation → 'sms'; the
 * bank-app notification automation → 'notifications'; Apple Pay alone (or
 * nothing recorded) says nothing about how the bank reaches them → 'unsure'.
 */
export function alertsAnswerForIosSetup(
  captureOptOut: boolean,
  source: 'message' | 'notification' | 'apple-pay' | null | undefined,
): OnboardingAlertDelivery {
  if (captureOptOut) return 'neither';
  if (source === 'message') return 'sms';
  if (source === 'notification') return 'notifications';
  return 'unsure';
}

/* ── Paywall trial honesty ───────────────────────────────────────────────
 *
 * The trial is Wafra's own: TRIAL_DAYS from first launch, no card, no store
 * trial (purchases.ts). When it ends, automatic capture pauses; nothing is
 * charged and the ledger stays. There is no trial-ending notification in the
 * app (payment reminders are rebuilt with cancelAll on every sync, which would
 * wipe one), so the timeline never promises a reminder.
 */
export interface TrialTimelineEntry {
  key: 'today' | 'end';
  /** Days after today at which this happens; 0 for today. */
  day: number;
}

export function trialTimeline(daysLeft: number): TrialTimelineEntry[] {
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return [];
  return [{ key: 'today', day: 0 }, { key: 'end', day: Math.floor(daysLeft) }];
}
