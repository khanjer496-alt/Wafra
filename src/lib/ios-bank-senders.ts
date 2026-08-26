import { IOS_BANK_SENDER_ALIASES } from '@/lib/ios-bank-senders.generated';

export interface IosBankSenderAlias {
  alias: string;
  market: 'AE' | 'SA';
  bankId: string;
  evidence: string;
}

export interface IosBankSenderRegistry {
  v: 1;
  aliases: IosBankSenderAlias[];
}

export function normalizeIosBankSender(value: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) return null;
  if (/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(value)) return null;
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[ ._-]/g, '');
  return normalized.length === 0 || normalized.length > 80 ? null : normalized;
}

export function iosBankSenderIdentity(
  value: string,
  registry: IosBankSenderRegistry = { v: 1, aliases: IOS_BANK_SENDER_ALIASES },
): { market: 'AE' | 'SA'; bankId: string } | null {
  const key = normalizeIosBankSender(value);
  if (key === null) return null;
  const entry = registry.aliases.find((candidate) =>
    normalizeIosBankSender(candidate.alias) === key);
  return entry ? { market: entry.market, bankId: entry.bankId } : null;
}
