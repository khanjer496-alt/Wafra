'use strict';
// Grammar from a user-provided Emirates NBD screenshot. All amounts/account
// identifiers are replaced; these are synthetic equivalents, not bank-wide proof.
module.exports = [
  { type: 'income', minor: 482015, balance: 1430025, body: 'Dear Customer, AED 4,820.15 has been credited to your account 202XXX55XXX02 towards instant transfer. The available balance is AED 14,300.25.' },
  { type: 'expense', minor: 488025, balance: null, body: 'Dear Customer, AED 4,880.25 has been deducted from your account 6382 for Fund Transfer through Online Banking.' },
  { type: 'expense', minor: 171450, balance: 678550, body: 'AED 1,714.50 has been deducted from your account 202XXX55XXX02 for issuance of Telegraphic Transfer. The available balance is AED 6,785.50.' },
  { type: 'income', minor: 171450, balance: 850000, body: 'AED 1,714.50 has been transferred to your account 202XXX55XXX02. The available balance is AED 8,500.00.' },
];
