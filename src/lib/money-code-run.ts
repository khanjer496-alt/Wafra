/** Isolate the whole Arabic amount/code pair so surrounding RTL prose cannot split its order. */
export function moneyCodeRun(amount: string, code: string, language: string): string {
  return language === 'ar' ? `\u2066${amount}\u00a0${code}\u2069` : `${code} ${amount}`;
}
