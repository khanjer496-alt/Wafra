export type TransactionType = 'expense' | 'income';

export type CategoryId =
  | 'groceries'
  | 'dining'
  | 'transport'
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
   * Raw SMS body, kept ONLY when the parser wasn't confident (generic title
   * or fallback category) so the user can report unrecognized formats from
   * Settings → Improve accuracy. Never leaves the device unless shared.
   */
  raw?: string;
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
  /** Expected amount in fils. */
  amountFils: number;
  /** Day of month the bill is due (1–31). */
  dueDay: number;
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
   * True when no minimum was stated in the SMS and `minDueFils` is a fallback
   * estimate. The bank's terms decide the real minimum; without one quoted,
   * the app must not tell the user it knows what theirs is.
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

export interface AppState {
  hydrated: boolean;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  bills: Bill[];
  cardDues: CardDue[];
  goals: Goal[];
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
  /** Wafra Pro entitlement (Play Billing purchase, or founder unlock on side-loads). */
  pro: boolean;
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
