/**
 * How a reminder plan reaches the OS schedule — without importing the OS.
 *
 * `syncPaymentReminders` is called from six places (launch, every scan, Home,
 * the journal, and two "Remind me" buttons), and it used to do
 * cancel-everything then up to 24 sequential schedules, with random
 * identifiers and no lock. Two overlapping calls interleaved: A cancelled, B
 * cancelled, A scheduled 24, B scheduled 24 — and the user got every bill
 * twice. The same cancel-everything also took the nightly summary down with
 * it, and nothing put it back while a history import was running.
 *
 * Both halves of the fix live here, where the test harness can reach them:
 *
 * - Every reminder has a stable identifier derived from its reminder id, so
 *   scheduling it again REPLACES the pending one (expo-notifications keys its
 *   store by identifier on Android; iOS replaces a pending request with the
 *   same identifier). Overlap can no longer duplicate, only converge.
 * - Only reminders are cancelled: those with our prefix that are no longer in
 *   the plan, plus legacy ones from builds that scheduled with random ids. Any
 *   notification Wafra schedules under a `wafra-` identifier that is not a
 *   reminder — the nightly summary — is left alone.
 * - A latest-request-wins single flight: one sync runs at a time, a newer
 *   request supersedes an in-flight one at its next checkpoint, and requests
 *   that arrive while one runs collapse into one follow-up run with the newest
 *   state. Every caller's promise settles with the run that covered it.
 */
import type { PaymentReminder } from '@/lib/reminders';

/** Every identifier Wafra itself chooses starts with this. */
export const WAFRA_NOTIFICATION_PREFIX = 'wafra-';
/** Payment reminders specifically. */
export const REMINDER_ID_PREFIX = 'wafra-reminder-';

export function reminderNotificationId(reminderId: string): string {
  return `${REMINDER_ID_PREFIX}${reminderId}`;
}

/**
 * Whether a pending OS notification is a payment reminder that the new plan
 * does not contain. Identifiers without the `wafra-` prefix can only be
 * reminders scheduled by a build that let expo-notifications pick a random
 * id: nothing else Wafra schedules for later carries one (the charge banner
 * fires immediately and is never pending).
 */
export function isStaleReminderIdentifier(identifier: string, keep: ReadonlySet<string>): boolean {
  if (keep.has(identifier)) return false;
  if (identifier.startsWith(REMINDER_ID_PREFIX)) return true;
  return !identifier.startsWith(WAFRA_NOTIFICATION_PREFIX);
}

export interface ReminderSchedulerApi {
  getAllScheduled(): Promise<readonly { identifier: string }[]>;
  cancel(identifier: string): Promise<void>;
  schedule(identifier: string, reminder: PaymentReminder): Promise<void>;
}

export type ReminderApplyResult = 'applied' | 'superseded';

/**
 * Make the OS schedule match `plan`. Idempotent: applying the same plan twice
 * leaves exactly one pending notification per reminder. `isCurrent` is polled
 * between OS calls so a superseded run stops instead of finishing stale work.
 */
export async function applyReminderPlan(
  api: ReminderSchedulerApi,
  plan: readonly PaymentReminder[],
  isCurrent: () => boolean = () => true,
): Promise<ReminderApplyResult> {
  const wanted = new Map<string, PaymentReminder>();
  for (const reminder of plan) {
    const identifier = reminderNotificationId(reminder.id);
    // One identifier, one pending notification: the first (soonest) wins.
    if (!wanted.has(identifier)) wanted.set(identifier, reminder);
  }
  const keep = new Set(wanted.keys());

  const existing = await api.getAllScheduled();
  for (const { identifier } of existing) {
    if (!isCurrent()) return 'superseded';
    if (isStaleReminderIdentifier(identifier, keep)) await api.cancel(identifier);
  }
  for (const [identifier, reminder] of wanted) {
    if (!isCurrent()) return 'superseded';
    await api.schedule(identifier, reminder);
  }
  return 'applied';
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Serialise `run` so at most one executes at a time and the newest request
 * always wins. See the header for the contract.
 */
export function createLatestWinsRunner<A>(
  run: (arg: A, isCurrent: () => boolean) => Promise<void>,
): (arg: A) => Promise<void> {
  let generation = 0;
  let running = false;
  let queued: { arg: A; waiters: Waiter[] } | null = null;

  const launch = (arg: A, waiters: Waiter[]) => {
    const mine = generation;
    running = true;
    Promise.resolve()
      .then(() => run(arg, () => mine === generation))
      .then(
        () => finish(waiters, false, undefined),
        (error: unknown) => finish(waiters, true, error),
      );
  };

  const finish = (waiters: Waiter[], failed: boolean, error: unknown) => {
    running = false;
    if (queued) {
      // A newer request arrived. Its outcome is the outcome for everyone who
      // asked before it, too — including when this older run failed.
      const next = queued;
      queued = null;
      launch(next.arg, [...waiters, ...next.waiters]);
      return;
    }
    for (const waiter of waiters) {
      if (failed) waiter.reject(error);
      else waiter.resolve();
    }
  };

  return (arg: A) =>
    new Promise<void>((resolve, reject) => {
      generation += 1;
      const waiter = { resolve, reject };
      if (!running) {
        launch(arg, [waiter]);
      } else if (queued) {
        queued.arg = arg;
        queued.waiters.push(waiter);
      } else {
        queued = { arg, waiters: [waiter] };
      }
    });
}
