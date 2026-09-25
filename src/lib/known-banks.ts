import { MARKETS } from '@/lib/markets';
import type { Account } from '@/lib/types';

/**
 * The banks the user said text them ("Which banks text you?").
 *
 * iOS 26's Find Messages entity exposes no sender, and some banks never name
 * themselves in an alert body (Emirates NBD, ADCB and FAB purchase formats),
 * so an iOS history import can mint an account with no bank at all. The
 * user's own answer is the only bank identity such an account can have. It is
 * used only when it is unambiguous: exactly one known bank. Two known banks
 * say nothing about which one sent a given alert, so the account is left for
 * the picker instead of guessed.
 */
export interface KnownBank {
  name: string;
  color: string;
  domain?: string;
}

const MAX_KNOWN_BANKS = 12;

function bankByName(name: string): KnownBank | null {
  for (const market of MARKETS) {
    for (const bank of market.banks) {
      if (bank.name === name) return { name: bank.name, color: bank.color, domain: bank.domain };
    }
  }
  return null;
}

/**
 * The banks a market pack knows, in pack order, for a picker. A country with
 * no launch pack has none to offer: falling back to the UAE list showed a
 * user in Germany Emirates NBD and FAB as "your bank".
 */
export function knownBankOptions(marketId: string | undefined): KnownBank[] {
  const market = MARKETS.find((candidate) => candidate.id === marketId);
  return market ? market.banks.map((bank) => ({ name: bank.name, color: bank.color, domain: bank.domain })) : [];
}

/** Only real bank names, each once, in the order given; anything else is dropped. */
export function sanitizeKnownBanks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !bankByName(entry) || names.includes(entry)) continue;
    names.push(entry);
    if (names.length >= MAX_KNOWN_BANKS) break;
  }
  return names;
}

/** The one known bank, or null when none or several are known. */
export function singleKnownBank(names: readonly string[] | undefined): KnownBank | null {
  const known = sanitizeKnownBanks(names);
  return known.length === 1 ? bankByName(known[0]) : null;
}

/** Picker order: the user's known banks first, then the rest of the market. */
export function bankPickerOptions(knownBanks: readonly string[] | undefined, marketId: string | undefined): KnownBank[] {
  const known = sanitizeKnownBanks(knownBanks);
  const options = knownBankOptions(marketId);
  return [
    ...known.map((name) => bankByName(name)).filter((bank): bank is KnownBank => bank !== null),
    ...options.filter((bank) => !known.includes(bank.name)),
  ];
}

/**
 * Bank and card accounts with no bank labelled with `bank`; cash and every
 * labelled account untouched.
 * The account's name is left alone: it is the user's or the planner's label,
 * and the bank badge and logo render from `bankName`.
 */
export function accountsLabelledWithBank(accounts: readonly Account[], bank: KnownBank | null): Account[] {
  if (!bank) return [...accounts];
  return accounts.map((account) =>
    account.bankName || (account.kind !== 'bank' && account.kind !== 'card')
      ? account
      : { ...account, bankName: bank.name, color: bank.color });
}
