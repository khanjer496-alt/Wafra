import {
  CANONICAL_NUMBER_CONVENTIONS,
  formatMinorUnits,
  type LedgerMoneySpec,
  typicalMinorAmount,
} from '@/lib/ledger-money';

/**
 * The launch-tested UAE sample. Kept byte-for-byte: the AED ledger's "Try a
 * sample" has always posted exactly these three rows.
 */
export const AED_PASTE_SAMPLE = `Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 12,345.67

AED 55.00 was debited from your account for payment to SALIK RECHARGE on 16/07/2026

Salary of AED 18,500.00 has been credited to your account ending 5678`;

/**
 * "Try a sample" text in the ledger's own currency.
 *
 * A fixed AED sample was refused outright on any other ledger (the import
 * boundary will not post AED into a USD ledger), so the button only ever
 * showed a currency-mismatch error. The sample now names the ledger currency
 * with amounts sized to it (AED 187.50 → ¥18,750, KWD 18.750) and written in
 * canonical bank-alert form, never the device's display format: it is input
 * to the parser, which reads bank text, not the user's locale. Outside the
 * launch-tested AED/SAR packs the parser routes these to review rather than
 * posting them — the honest global behaviour, which the sample then shows.
 */
export function pasteSampleForLedger(spec: LedgerMoneySpec | null | undefined): string {
  if (!spec || spec.currency === 'AED') return AED_PASTE_SAMPLE;
  const unit = typicalMinorAmount(spec, 1);
  const amount = (hundredths: number) => formatMinorUnits(Math.round((unit * hundredths) / 100), spec, {
    decimals: true,
    conventions: CANONICAL_NUMBER_CONVENTIONS,
  });
  const code = spec.currency;
  return `Purchase of ${code} ${amount(18_750)} with Debit Card ending 1234 at CITY SUPERMARKET on 17/07/2026. Avl balance ${code} ${amount(1_234_567)}

${code} ${amount(5_500)} was debited from your account for payment to TRANSIT CARD TOP-UP on 16/07/2026

Salary of ${code} ${amount(1_850_000)} has been credited to your account ending 5678`;
}
