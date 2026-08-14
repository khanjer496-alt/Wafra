import type { LedgerMoneySpec } from '@/lib/ledger-money';
import type { AlertReviewTrayState } from '@/lib/alert-review-tray';

export type TransactionType = 'expense' | 'income';

export type CategoryId =
  | 'groceries'
  | 'dining'
  | 'transport'
  /** Cash taken from an ATM. The later use of that cash is not inferred. */
  | 'cash-withdrawal'
  | 'utilities'
  | 'telecom'
  | 'rent'
  | 'shopping'
  | 'health'
  /** Salons, barbers, spa, nails, laundry — spend on yourself, not on a shop. */
  | 'personal-care'
  /** Cleaning, maintenance, the maid, moving, pest control — work on the home. */
  | 'home-services'
  | 'education'
  | 'travel'
  | 'entertainment'
  /**
   * Software and online tooling billed per seat or per month — AI assistants,
   * design and document tools, domains, hosting, mailbox add-ons.
   *
   * These had no home, so the vocabulary parked them in `entertainment`, and
   * the file said so in a comment. A domain renewal is not a night out: a user
   * capping "fun money" was capping their work tools, and the two habits move
   * for completely unrelated reasons.
   */
  | 'software'
  /**
   * Money moved into a brokerage, a crypto on-ramp or a savings certificate.
   *
   * NOT consumption — this is wealth changing shape, not leaving. It used to be
   * mapped to `other` for exactly that reason, but `other` is also what the
   * parser says when it failed, and the user cannot tell those apart on screen:
   * thirty-odd eToro rows read as "the app could not understand this".
   */
  | 'investing'
  | 'charity'
  | 'government'
  /** Loan and finance instalments, usually paid by direct debit to a bank. */
  | 'loan'
  | 'salary'
  | 'business'
  | 'other';

export type AccountKind = 'bank' | 'card' | 'cash';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Opening balance in fils (1 AED = 100 fils). Current balance is derived from transactions. */
  openingFils: number;
  color: string;
  /** Last 4 digits of the card/account number, when known from SMS. */
  last4?: string;
  /** Bank this card/account belongs to, learned from the SMS sender ID. */
  bankName?: string;
  /** For kind 'card': whether it's a credit or debit card. */
  cardType?: 'credit' | 'debit';
  /** Latest balance/limit figure the bank itself quoted in an SMS. */
  snapshotFils?: number;
  snapshotKind?: 'balance' | 'limit' | 'outstanding';
  /**
   * Total credit limit, entered by the user. Banks quote headroom ("Avl Cr.
   * limit") but never the limit itself, and some redact the figure entirely
   * ("Avl Bal AED ····9235.93"), which we refuse to read because the leading
   * digits are gone. Knowing the limit recovers headroom for those cards:
   * limit − outstanding, with no guessing.
   */
  creditLimitFils?: number;
  /** Timestamp (ms) of the SMS the snapshot came from — newest wins. */
  snapshotTs?: number;
  /** Hidden from lists (expired/unused card). Data stays; a new charge keeps it hidden until unhidden. */
  archived?: boolean;
  /**
   * The account id this card replaced, when the bank reissued it with new
   * digits. Set once the user confirms the link, so the app stops asking and
   * can still show where the history came from.
   *
   * Also set to the row's OWN id to mean "asked and answered — these are
   * different cards", which is the only way to stop offering a merge the
   * user has already declined.
   */
  renewedFrom?: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Amount in fils, always positive. */
  amountFils: number;
  /** Original bank-alert amount when the charge was denominated outside AED. */
  originalAmountMinor?: number;
  /** ISO 4217 code for `originalAmountMinor` (for example USD or EUR). */
  originalCurrency?: string;
  /** AED units per one unit of the original currency. */
  fxRate?: number;
  /** Effective date of a fetched reference rate. */
  fxRateDate?: string;
  /**
   * `bank`: the alert included its own AED equivalent; `reference`: a dated
   * public rate was fetched; `fallback`: parser used its offline approximation.
   */
  fxSource?: 'bank' | 'reference' | 'fallback';
  category: CategoryId;
  accountId: string;
  title: string;
  note?: string;
  /** ISO date string, e.g. 2026-07-18 */
  date: string;
  /**
   * When the bank said it happened, to the minute (epoch ms).
   *
   * `date` alone cannot answer "which of these two coffees was this?", and a
   * bank SMS always carries a clock. Optional because rows imported before
   * this existed have none — `transactionTime` recovers those from the SMS
   * fingerprint, which has always had the timestamp baked into it.
   */
  ts?: number;
  /** Where this entry came from. Undefined = manual (pre-v2 data). */
  source?: 'sms' | 'manual';
  /**
   * Fingerprint of the source SMS (timestamp + amount). Parser updates change
   * titles/accounts, so re-scans dedupe on this instead of parsed fields.
   */
  smsKey?: string;
  /**
   * Captured from a bank app's push notification rather than an SMS.
   *
   * A notification and the SMS about the same charge are a race, and the
   * notification is the poorer read — different wording, often truncated. The
   * flag lets the SMS replace this row when it arrives instead of landing
   * beside it as a second charge.
   */
  viaPush?: boolean;
  /**
   * A card settlement can generate two bank alerts: money leaving the current
   * account and the card acknowledging receipt. Keeping the side lets import
   * collapse that pair without collapsing two genuine equal payments.
   */
  cardPaymentSide?: 'debit' | 'receipt';
  /** Linked consumer-bill flow: internal funding or named biller receipt. */
  paymentFlowSide?: 'funding' | 'receipt';
  /**
   * Privacy-safe identity of the bill account named by a payment alert.
   *
   * Only a closed label and masked last four digits are stored. This lets a
   * bank's "consumer number" payment confirmation settle a provider reminder
   * that calls the same obligation an account or party ID, without retaining
   * the full customer number or guessing from amount/title alone.
   */
  billIdentity?: string;
  /**
   * Why the account shown for a named biller receipt is trustworthy.
   *
   * Receipt alerts that omit a card still need a ledger account, so import
   * attaches them to a fallback. That routing choice must never be presented
   * as "paid with" evidence. `alert` means the message stated an instrument;
   * `user` means the person explicitly changed the receipt's account.
   */
  paymentInstrumentSource?: 'alert' | 'user';
  /**
   * Date cash left the funding account for a card settlement.
   *
   * The card can acknowledge receipt after midnight or after a weekend. Its
   * row is the richer canonical settlement record, but reporting Cash out on
   * the receipt date moves the payment into the wrong month. Set only while
   * reconciling an independently observed debit-side alert.
   */
  cashOutDate?: string;
  /** Funding account used for Cash out when the canonical row is a card receipt/manual claim. */
  cashOutAccountId?: string;
  /** Credit-card payments etc — excluded from spending/income analytics. */
  isTransfer?: boolean;
  /**
   * The user changed this row by hand. Re-parsing on launch and on rescan
   * must leave it alone: a correction that gets overwritten by the next
   * launch is worse than no correction at all, because the user cannot tell
   * their edit was undone.
   */
  userEdited?: boolean;
  /**
   * The user replaced the parser's shop name by hand.
   *
   * Narrower than `userEdited` on purpose, and the narrowness is the whole
   * point. `userEdited` says "something on this row was decided by a human" —
   * an amount, a date, an account, or a bulk merchant rule that stamped
   * hundreds of rows the user never opened. Parser-coverage measurement needs
   * a different question: did the parser get this merchant's NAME right? A
   * hand-typed name must never be scored as a parser success, and a row whose
   * date was corrected must not be dropped from the measurement for it.
   *
   * Set only by the `editTransaction` reducer, and only when the patch carries
   * a title that differs from the row's current one. Once true it stays true.
   *
   * Optional and additive: every row written before this existed reads as
   * absent, which is the correct answer for them — nobody retyped their title.
   */
  titleEdited?: boolean;
  /**
   * Raw SMS body, kept ONLY when the parser wasn't confident (generic title
   * or fallback category) so the user can report unrecognized formats from
   * Settings → Improve accuracy. Never leaves the device unless shared.
   */
  raw?: string;
  /**
   * One charge that belongs to several categories — the Carrefour receipt that
   * is mostly groceries and partly a phone charger. The parts must sum to
   * amountFils exactly; see src/lib/splits.ts, which owns that invariant and
   * is the only thing analytics should read categories through.
   *
   * `category` stays populated on a split row and holds the largest part, so
   * every reader that has not been taught about splits still shows something
   * defensible rather than nothing.
   */
  splits?: TransactionSplit[];
}

export interface TransactionSplit {
  category: CategoryId;
  /** Fils, always positive. The parts sum to the parent's amountFils. */
  amountFils: number;
  note?: string;
}

export interface Budget {
  /** One budget per expense category, applies monthly. */
  category: CategoryId;
  limitFils: number;
}

export interface Bill {
  id: string;
  title: string;
  category: CategoryId;
  /**
   * Optional non-secret provider/account discriminator learned from an alert.
   * It contains only a closed kind plus masked tail (never a full account or
   * transaction reference) and keeps two accounts at one utility distinct.
   */
  importIdentity?: string;
  /** Expected amount in fils. */
  amountFils: number;
  /** Day of month the bill is due (1–31). */
  dueDay: number;
  /**
   * A bill that falls due ONCE A YEAR, on this date's month and day.
   *
   * Absent — which is every bill written before this field existed — means the
   * ordinary thing: monthly, on `dueDay`. `dueDay` stays populated either way
   * and always equals this date's day, so every reader that predates yearly
   * bills still shows a defensible figure.
   *
   * One nullable field rather than a `cadence` enum plus a separate anchor,
   * because two fields have an invalid combination — `cadence: 'yearly'` with
   * no anchor — and there is no honest thing to do with such a record. A bill
   * with no anniversary cannot be placed in a year, and one placed in every
   * month is the defect this exists to fix: a yearly Amazon Prime charge of
   * AED 310 was filed as a MONTHLY reminder at AED 310, twelve times the money,
   * in the Reminders list and in every notification derived from it.
   *
   * Weekly is deliberately not representable. `paidMonths` is keyed by money
   * month and `billsForMonth` returns one row per bill, so a bill that falls
   * due four times a month has nowhere to live; the screens that create bills
   * therefore do not offer to make one.
   */
  yearlyOnISO?: string;
  accountId?: string;
  /** True when created from a detected SMS/recurring pattern. */
  autoDetected?: boolean;
  /** Month keys (YYYY-MM) already marked as paid. */
  paidMonths: string[];
}

/** A credit-card statement obligation parsed from SMS (or entered manually). */
export interface CardDue {
  id: string;
  accountId: string;
  totalDueFils: number;
  minDueFils: number;
  /**
   * True when no minimum was stated in the SMS and `minDueFils` is either a
   * market-specific fallback estimate or zero when no honest estimate exists.
   * The bank's terms decide the real minimum; without one quoted, the app must
   * not tell the user it knows what theirs is.
   */
  minDueEstimated?: boolean;
  /** ISO date the payment is due by. */
  dueDate: string;
  /** Fils paid toward this due so far. */
  paidFils: number;
  /** ISO date settled (paid >= min or total), if settled. */
  settledAt?: string;
}

export interface Goal {
  id: string;
  title: string;
  emoji: string;
  targetFils: number;
  savedFils: number;
}

/**
 * Currency-free choices collected during first-run setup.
 *
 * They deliberately do not contain money. A fresh install has not yet proved
 * whether its ledger is AED or SAR, so the matching budgets and goal targets
 * are materialised only after the first real money entry pins that fact.
 */
export interface OnboardingPlanPreferences {
  goalIds: ('emergency' | 'travel' | 'home')[];
  budgetId: 'essentials' | 'balanced' | 'flexible';
}

export interface AppState {
  hydrated: boolean;
  /** Explicit meaning of every legacy `*Fils` integer; null before a ledger has money. */
  ledgerMoney: LedgerMoneySpec | null;
  /** Encrypted, structured global alerts awaiting an explicit user decision. */
  reviewTray: AlertReviewTrayState;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  bills: Bill[];
  cardDues: CardDue[];
  goals: Goal[];
  /** First-run plan waiting for a real ledger currency before activation. */
  onboardingPlan: OnboardingPlanPreferences | null;
  /** Local currency explicitly observed in an imported bank alert. */
  onboardingCurrencyEvidence: 'AED' | 'SAR' | null;
  /** Learned merchant → category corrections, keyed by lowercased merchant. */
  merchantOverrides: Record<string, CategoryId>;
  /** Card/account last4 → accountId, learned from SMS. */
  accountHints: Record<string, string>;
  /** Merchants (lowercased) the user marked as NOT a subscription. */
  notSubscriptions: string[];
  /** Epoch ms of the newest SMS already scanned. */
  lastScanTs: number;
  /**
   * The parser version the stored rows were read with. When it falls behind
   * `PARSER_VERSION` the next scan re-reads the whole inbox so the improvements
   * reach data already imported. Absent on states written before this existed,
   * which correctly reads as "older than any version".
   */
  parserVersion?: number;
  /** Whether the first-run onboarding has completed. */
  onboarded: boolean;
  userName: string;
  appLock: boolean;
  /** Day of month the reporting month begins (salary day). 1 = calendar months. */
  monthStartDay: number;
  /** Cached Wafra Pro entitlement supplied by the platform stores via RevenueCat. */
  pro: boolean;
  /**
   * Strict local-only posture. Enabling it removes every retained diagnostic
   * message body and prevents future imports from keeping raw text.
   *
   * Android capture is already local. On iOS the settings flow also disconnects
   * the Shortcuts relay, because an HTTP Shortcut cannot be called "local-only".
   */
  privateMode: boolean;
  /**
   * Explicit automatic-capture opt-out. This is separate from Private Mode:
   * on Android, Private Mode may still parse structured alerts locally while
   * dropping raw diagnostic text, whereas this flag forbids inbox collection
   * even when the OS still holds a previously granted SMS permission.
   */
  captureOptOut: boolean;
  /**
   * The nightly spend digest. Off until asked for: it is an interruption, the
   * same standing as the per-charge banner, and a finance app that pushes
   * uninvited is a finance app that gets muted along with its bill reminders.
   */
  dailySummary: boolean;
  /** Epoch ms when the free Pro trial started (first launch). */
  trialStartTs: number;
  /** Market pack id (country). Auto-detected on first launch; user-changeable. */
  marketId: string;
  /** UI language ('en' | 'ar'). Auto-detected on first launch. */
  language: string;
  /** Palette choice: 'system' follows the OS, 'light'/'dark' pin it. */
  themePreference: string;
}

/**
 * A correction a rescan makes to a row already imported. Only the fields that
 * genuinely changed are present; an absent field is left alone.
 */
export interface TxHealUpdate {
  id: string;
  title?: string;
  category?: CategoryId;
  /**
   * The DIRECTION, when a rescan proves the old one wrong.
   *
   * A card payment imported before the parser recognized its wording landed as
   * an expense carrying a transfer hint. Healing set the hint and stopped
   * there, so the row stayed an expense — and `allocatePayments` credits
   * income-side transfers only, which meant a card the user had actually paid
   * stayed open forever. The message can never be re-imported either, because
   * its fingerprint is already known. Only a direction correction reaches it.
   */
  type?: TransactionType;
  isTransfer?: boolean;
  /** Authoritative account/card learned from the fuller SMS after a push. */
  accountId?: string;
  /** Replace the push clock/fingerprint with the bank SMS identity. */
  ts?: number;
  smsKey?: string;
  viaPush?: boolean;
  cardPaymentSide?: 'debit' | 'receipt';
  paymentFlowSide?: 'funding' | 'receipt';
  billIdentity?: string;
  paymentInstrumentSource?: 'alert' | 'user';
  /**
   * The stored source text, or `null` to CLEAR it.
   *
   * Clearing matters as much as setting. Source text is kept only so the
   * accuracy report can show formats the parser cannot read; once a rescan
   * reads one properly, leaving the text behind means the report goes on
   * listing a format that now works. Without a clear, that count can only ever
   * grow, and every parser improvement makes the report look worse.
   */
  raw?: string | null;
  /** The message no longer parses as a transaction (e.g. it's a statement reminder) — drop the row. */
  remove?: boolean;
}

/**
 * One import scan, as a single applyable batch.
 *
 * Lives here rather than in store.tsx because the code that BUILDS it must be
 * testable, and store.tsx is a React module the test harness cannot transpile.
 */
export interface ImportBatchInput {
  transactions: Omit<Transaction, 'id'>[];
  newAccounts: Omit<Account, 'id'>[];
  /** last4 → index into newAccounts OR existing accountId. */
  newHints: Record<string, string>;
  newDues: Omit<CardDue, 'id'>[];
  /** Fresh utility/telecom reminders learned by this same durable scan. */
  newBills?: Omit<Bill, 'id' | 'paidMonths'>[];
  /** accountRef → newest bank-quoted balance/limit figure from the scan. */
  snapshots: Record<string, { fils: number; kind: 'balance' | 'limit' | 'outstanding'; ts: number }>;
  /** accountRef → bank name learned from the SMS sender (backfill only). */
  bankNames: Record<string, string>;
  /**
   * accountRef → strongest card type learned in this scan.
   * Credit is monotonic: a statement/payment can upgrade the parser's debit
   * fallback, while a later debit-worded purchase never downgrades it.
   */
  cardTypes?: Record<string, 'credit' | 'debit'>;
  /** Supported local currency explicitly observed in this bank-alert batch. */
  confirmedLedgerCurrency?: 'AED' | 'SAR';
  /**
   * True only when Android completed a scan from the beginning of the SMS
   * inbox for the current parser. Incremental scans must never set this: an
   * older backup can be restored while one is in flight, and treating that
   * partial scan as migration proof permanently strands older messages.
   */
  parserRereadComplete?: boolean;
  lastScanTs: number;
  updates?: TxHealUpdate[];
}
