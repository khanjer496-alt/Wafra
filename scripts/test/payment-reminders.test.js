// Payment reminders: the month boundary (B5), the OS schedule converging
// instead of duplicating (B4), and the nightly summary surviving a reminder
// rebuild (B8). notifications.ts imports expo-notifications and cannot run
// here, so the logic it delegates to — reminders.ts and reminder-schedule.ts —
// is exercised directly, and the wiring is checked against its source.
const fs = require('fs');
const path = require('path');

const remind = require('./build/reminders');
const schedule = require('./build/reminder-schedule');
const { setMonthStartDay } = require('./build/format');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    got ${a}\n    want ${e}`); }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const remState = (over = {}) => ({
  accounts: [{ id: 'a', name: 'Current', kind: 'bank', openingFils: 0, color: '#fff' }],
  transactions: [], cardDues: [], bills: [], notSubscriptions: [], ...over,
});
const mkBill = (id, dueDay, over = {}) => ({
  id, title: id, category: 'utilities', amountFils: 20000, dueDay, paidMonths: [], ...over,
});
const billDates = (list) => list.filter((r) => r.kind === 'bill').map((r) => r.dateISO);

async function main() {
  // ── B5: the month boundary ──
  {
    // 30 January, noon, and a bill due on 1 February. Before the fix nothing
    // projected February, so neither reminder existed on the last days of the
    // month.
    const lateJan = new Date(2026, 0, 30, 12);
    eq('a bill due on the 1st is reminded across the month boundary',
      billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Rent', 1)] }), lateJan)),
      ['2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01']);

    // Last day of the month, before 09:00: the "tomorrow" reminder is still ahead.
    const lastDay = new Date(2026, 0, 31, 7);
    eq('on the last day of the month the day-before reminder still fires',
      billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Rent', 1)] }), lastDay)),
      ['2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01']);

    const paidAhead = remState({ bills: [mkBill('Rent', 1, { paidMonths: ['2026-02'] })] });
    eq('paying February only silences February, not March inside the same window',
      billDates(remind.buildPaymentReminders(paidAhead, lateJan)), ['2026-02-28', '2026-03-01']);

    const paidThis = remState({ bills: [mkBill('Rent', 1, { paidMonths: ['2026-01'] })] });
    eq('paying this month never silences next month',
      billDates(remind.buildPaymentReminders(paidThis, lateJan)), ['2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01']);

    eq('a 30-day window can span three calendar months',
      billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Rent', 1)] }), new Date(2026, 0, 31, 12))),
      ['2026-02-01', '2026-02-28', '2026-03-01']);
    eq('a due date just after the window still has a day-before reminder inside it',
      billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Rent', 3)] }), new Date(2026, 0, 31, 12))),
      ['2026-02-02', '2026-02-03', '2026-03-02']);
    eq('leap February also projects the third month when it is in range',
      billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Rent', 1)] }), new Date(2028, 0, 31, 12))),
      ['2028-02-01', '2028-02-29', '2028-03-01']);
    setMonthStartDay(25);
    try {
      eq('salary-day months project every due date inside the 30-day reminder window',
        billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Rent', 25)] }), new Date(2026, 1, 23, 12))),
        ['2026-02-24', '2026-02-25', '2026-03-24', '2026-03-25']);
    } finally { setMonthStartDay(1); }

    // 1 Feb: the 28th of February is inside 30 days, the 28th of March is not.
    const firstFeb = new Date(2026, 1, 1, 12);
    eq('next month is only projected inside the 30-day window',
      billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Gym', 28)] }), firstFeb)),
      ['2026-02-27', '2026-02-28']);

    // 20 Feb: this month's 5th is gone, March's 4th/5th are inside the window.
    const febNow = new Date(2026, 1, 20);
    eq('a due date already gone this month rolls to next month',
      billDates(remind.buildPaymentReminders(remState({ bills: [mkBill('Salik', 5)] }), febNow)),
      ['2026-03-04', '2026-03-05']);

    // Both months carry the bill. Its reminder id becomes the OS identifier,
    // so the two months must never share one.
    const twoMonths = remind.buildPaymentReminders(
      remState({ bills: [mkBill('Water', 15)] }), new Date(2026, 1, 14, 12));
    const ids = twoMonths.map((r) => r.id);
    ok('reminder ids are unique across projected months',
      new Set(ids).size === ids.length && ids.length === 3, JSON.stringify(ids));
  }

  // ── B4/B8: identifiers and stale cancellation ──
  {
    const id = schedule.reminderNotificationId('bill-x-2026-02-01--1');
    ok('reminder identifiers are stable and prefixed',
      id === 'wafra-reminder-bill-x-2026-02-01--1' &&
        id === schedule.reminderNotificationId('bill-x-2026-02-01--1'));
    const keep = new Set(['wafra-reminder-keep']);
    ok('a reminder no longer in the plan is stale',
      schedule.isStaleReminderIdentifier('wafra-reminder-gone', keep));
    ok('a reminder still in the plan is kept',
      !schedule.isStaleReminderIdentifier('wafra-reminder-keep', keep));
    ok('the nightly summary is never a stale reminder',
      !schedule.isStaleReminderIdentifier('wafra-daily-summary', keep));
    ok('legacy random-id reminders from older builds are cleaned up',
      schedule.isStaleReminderIdentifier('2b0c6f0e-5d7a-4b43-9d1e-000000000000', keep));
  }

  // A fake OS schedule keyed by identifier, as expo-notifications is.
  const fakeOs = (initial = []) => {
    const pending = new Map(initial.map((identifier) => [identifier, { identifier }]));
    let inFlight = 0, maxInFlight = 0;
    const log = [];
    const tick = () => new Promise((r) => setImmediate(r));
    return {
      pending, log, get maxInFlight() { return maxInFlight; },
      api: {
        async getAllScheduled() { await tick(); return [...pending.values()]; },
        async cancel(identifier) { await tick(); log.push(['cancel', identifier]); pending.delete(identifier); },
        async schedule(identifier, reminder) {
          inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
          await tick();
          log.push(['schedule', identifier]);
          pending.set(identifier, { identifier, dateISO: reminder.dateISO });
          inFlight--;
        },
      },
    };
  };
  const plan = (...ids) => ids.map((id) => ({ id, kind: 'bill', dateISO: '2026-03-01', date: new Date(2026, 2, 1, 9), title: id, body: '' }));

  {
    const os = fakeOs(['wafra-daily-summary', 'legacy-uuid', 'wafra-reminder-old']);
    const result = await schedule.applyReminderPlan(os.api, plan('a', 'b'));
    eq('applying a plan replaces reminders but keeps the summary',
      [result, [...os.pending.keys()].sort()],
      ['applied', ['wafra-daily-summary', 'wafra-reminder-a', 'wafra-reminder-b']]);
    await schedule.applyReminderPlan(os.api, plan('a', 'b'));
    await schedule.applyReminderPlan(os.api, plan('a', 'b'));
    eq('re-applying the same plan never duplicates',
      [...os.pending.keys()].sort(), ['wafra-daily-summary', 'wafra-reminder-a', 'wafra-reminder-b']);
    ok('a kept reminder is never cancelled, only replaced',
      !os.log.some(([op, identifier]) => op === 'cancel' && identifier === 'wafra-reminder-a'));
  }

  {
    const os = fakeOs();
    await schedule.applyReminderPlan(os.api, plan('dup', 'dup', 'x'));
    eq('duplicate reminder ids in one plan schedule once',
      os.log.filter(([op]) => op === 'schedule').length, 2);
  }

  {
    const os = fakeOs(['wafra-daily-summary', 'legacy-uuid', 'wafra-reminder-sub-netflix',
      'wafra-reminder-card-paid-0', 'wafra-reminder-bill-paid-0']);
    await schedule.applyReminderPlan(os.api, plan('card-new-0'), () => true, 'obligations');
    eq('a background obligation refresh cancels paid dues but preserves subscription and digest schedules',
      [...os.pending.keys()].sort(),
      ['legacy-uuid', 'wafra-daily-summary', 'wafra-reminder-card-new-0', 'wafra-reminder-sub-netflix']);
  }

  {
    const os = fakeOs();
    let calls = 0;
    const result = await schedule.applyReminderPlan(os.api, plan('a', 'b', 'c'), () => ++calls <= 1);
    ok('a superseded apply stops scheduling', result === 'superseded' && os.pending.size <= 1,
      `${result} ${os.pending.size}`);
  }

  // ── B4: the single flight ──
  {
    const os = fakeOs(['wafra-daily-summary']);
    const ran = [];
    let concurrent = 0, maxConcurrent = 0;
    const runner = schedule.createLatestWinsRunner(async (ids, isCurrent) => {
      concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
      ran.push(ids.join(','));
      try {
        await new Promise((r) => setTimeout(r, 5));
        await schedule.applyReminderPlan(os.api, plan(...ids), isCurrent);
      } finally { concurrent--; }
    });
    const settled = [];
    const calls = [
      runner(['a', 'b']).then(() => settled.push(1)),
      runner(['a', 'c']).then(() => settled.push(2)),
      runner(['a', 'd']).then(() => settled.push(3)),
    ];
    await Promise.all(calls);
    ok('never more than one sync at a time', maxConcurrent === 1, String(maxConcurrent));
    eq('intermediate requests collapse; the newest state runs last', ran, ['a,b', 'a,d']);
    eq('the schedule converges on the latest plan only',
      [...os.pending.keys()].sort(), ['wafra-daily-summary', 'wafra-reminder-a', 'wafra-reminder-d']);
    eq('every caller settles', settled.length, 3);

    // Six simultaneous callers (launch, scan, Home, journal, two sheets).
    const os2 = fakeOs();
    const runner2 = schedule.createLatestWinsRunner((ids, isCurrent) =>
      schedule.applyReminderPlan(os2.api, plan(...ids), isCurrent).then(() => {}));
    await Promise.all(Array.from({ length: 6 }, () => runner2(['a', 'b', 'c'])));
    ok('six overlapping syncs leave one notification per reminder',
      os2.pending.size === 3 && os2.log.filter(([op]) => op === 'schedule').length === 3,
      `${os2.pending.size} pending`);
  }

  {
    let attempt = 0;
    const runner = schedule.createLatestWinsRunner(async () => {
      attempt++;
      if (attempt === 1) throw new Error('os refused');
    });
    let error = null;
    await runner('x').catch((e) => { error = e; });
    ok('a failed sync rejects its caller', error && error.message === 'os refused');
    let ok2 = false;
    await runner('y').then(() => { ok2 = true; });
    ok('the runner recovers after a failure', ok2);

    const runner3 = schedule.createLatestWinsRunner(async (arg) => {
      await new Promise((r) => setTimeout(r, 2));
      if (arg === 'old') throw new Error('stale failure');
    });
    const outcomes = await Promise.allSettled([runner3('old'), runner3('new')]);
    eq('an older failure is superseded by the newer run for every waiter',
      outcomes.map((o) => o.status), ['fulfilled', 'fulfilled']);

    const runner4 = schedule.createLatestWinsRunner(async (arg) => {
      await new Promise((r) => setTimeout(r, 2));
      if (arg === 'new') throw new Error('latest failed');
    });
    const failedLatest = await Promise.allSettled([runner4('old'), runner4('new')]);
    eq('when the newest run fails, every merged waiter learns it',
      failedLatest.map((o) => o.status), ['rejected', 'rejected']);
  }

  // ── Wiring in the native half ──
  {
    const notifications = stripComments(read('src/lib/notifications.ts'));
    ok('notifications.ts no longer cancels every scheduled notification',
      !/cancelAllScheduledNotificationsAsync/.test(notifications));
    ok('payment reminders are scheduled with a stable identifier through applyReminderPlan',
      /applyReminderPlan\(/.test(notifications) &&
        /identifier,\s*\n?\s*content:/.test(notifications) &&
        /createLatestWinsRunner\(/.test(notifications));
    // The real exported sync's coalescing is exercised by
    // repair/card-reminder-notifications.test.cjs, including mixed scopes.
    for (const sheet of ['src/components/bill-detail-sheet.tsx', 'src/components/card-payment-sheet.tsx']) {
      const src = stripComments(read(sheet));
      ok(`${path.basename(sheet)}: Remind me handles a failed sync visibly`,
        /try \{[\s\S]*await syncPaymentReminders\(state\)[\s\S]*\} catch \{[\s\S]*reminderFailed/.test(src));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
