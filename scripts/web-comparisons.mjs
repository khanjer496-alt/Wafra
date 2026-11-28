// English editorial copy for the static comparison pages. Competitor facts
// are attributed to publisher documentation on each page.
import { COMPARISON_SLUGS } from '../src/marketing/site-events.mjs';

export const comparisonPages = [
  {
    slug: COMPARISON_SLUGS.wallet,
    title: 'Wafra vs Wallet by BudgetBakers | Android Budget Apps',
    heading: 'Wafra vs Wallet by BudgetBakers',
    competitor: 'Wallet by BudgetBakers',
    description: 'Compare Wafra and Wallet by BudgetBakers on bank connections, alert imports, budgeting, and backups. Find the Android expense tracker that fits your routine.',
    summary: 'How bank sync, manual accounts, and phone-based alerts change the way you keep a budget.',
    rows: [
      ['Bank account connection', 'No bank login or direct bank feed. Start with manual entries, pasted alerts, or a supported import.', 'Manual accounts are available. Premium bank sync connects to supported institutions.'],
      ['Automatic entry', 'Opt-in capture of supported bank SMS or app notifications on Android. Availability varies by bank and alert format.', 'Bank sync downloads transactions from connected accounts. BudgetBakers also documents Google Pay notification integration and SMS Pay Sync for supported banks in India.'],
      ['Budget routine', 'Category budgets, spending views, bills, card dues and savings goals.', 'Category budgets, reports and planned payments. Premium Group Sharing is available for shared finances.'],
      ['Keeping a copy', 'The main ledger is encrypted on your phone. You can create and restore a backup file you control.', 'Wallet documents syncing across devices and premium transaction export on Android and web.'],
    ],
    article: `
Wafra and Wallet by BudgetBakers both help you organize spending on Android. The biggest decision is how you want transactions to arrive. Wallet gives you a manual option and an optional bank connection. Wafra works without a bank login and can optionally read supported financial alerts your Android phone already receives. Which approach saves you time depends on your bank, how you pay, and whether you want a shared budget.

## When a connected bank feed makes sense

[BudgetBakers' bank sync guide](https://support.budgetbakers.com/hc/en-us/articles/7076796545554-Connect-disconnect-or-reconnect-your-bank) describes adding a supported institution and completing the bank's authentication steps. It lists bank sync as a Premium feature. If you want a feed of cleared transactions, check whether the exact account type you use is supported. A bank that appears in the directory may still handle refreshes or pending payments differently from another bank.

Wallet can also be used manually. [Its account guide](https://support.budgetbakers.com/hc/en-us/articles/34453128217618-Adding-an-Account) describes manual accounts, web file imports, and Apple Pay and Google Pay integration. The [SMS Pay Sync guide](https://support.budgetbakers.com/hc/en-us/articles/39631628971666-SMS-Pay-Sync) lists India and explains how to select supported banks. Check each option for your device and payment method. [Wallet's product page](https://budgetbakers.com/en/products/wallet/) lists Premium Group Sharing, which is worth looking at if two people need to manage a household budget together.

## When alerts fit your routine

If your card already sends useful alerts, Wafra gives you a way to start with the information on your phone. Set a ledger currency, enter a cash purchase manually, then paste a sample alert to see how Wafra reads it. You can keep SMS and notification permissions off while trying manual entry or pasting. Enable automatic capture only if your alerts contain enough information to make it useful.

An alert-led ledger still needs a check against your statement. An alert might omit the merchant, fail to arrive, or describe a pending charge or a refund. Wafra's coverage depends on the actual message format. Review unfamiliar entries and add anything missing by hand. Automatic capture is included for the first three days, then requires Wafra Pro. Manual entry, pasted alerts, and backup and restore remain free.

## How to choose without moving your whole history

Make a short list of purchases you actually need to track: a card purchase, a recurring bill, and a cash expense. In Wallet, check the bank connection and export options you would use. In Wafra, try one manually entered expense and one pasted alert from the account you care about. Compare how much correction is needed and whether each app makes it easy to see the category total you want. Run both tests before migrating old records.

If you already use Wallet, keep its original records and export a copy if your plan supports it. [BudgetBakers' export instructions](https://help.budgetbakers.com/wallet/a/how-to-export-transactions-from-wallet-7151606064018) explain the supported formats. Start a new Wafra ledger with a small sample or from the current month. A Wallet export and a native Wafra backup serve different purposes.
`,
    faqs: [
      ['Does Wallet require a bank connection?', 'Wallet supports manual accounts. Bank sync is optional and BudgetBakers lists it as a Premium feature.'],
      ['Can Wafra replace a complete bank feed?', 'Wafra records what you enter and what it can read from supported alerts or imports. Check records against your bank statement for completeness.'],
    ],
  },
  {
    slug: COMPARISON_SLUGS.moneyManager,
    title: 'Wafra vs Money Manager by Realbyte | Android',
    heading: 'Wafra vs Money Manager by Realbyte',
    competitor: 'Money Manager by Realbyte',
    description: 'Compare Wafra and Realbyte Money Manager for logging everyday expenses, reviewing bank alerts, checking monthly budgets, and keeping a backup on Android.',
    summary: 'Which expense tracker fits if you like entering purchases by hand or want help from bank alerts?',
    rows: [
      ['Everyday entry', 'Record expenses and income by hand, paste alerts, or enable supported Android automatic capture.', 'Log expenses and income manually. Realbyte’s Korean listing also describes automatic reading of supported bank and card SMS.'],
      ['Budget and reports', 'Category budgets, spending trends, bills, card dues and recurring charges.', 'Budget-versus-expense graphs and category statistics, as described in the Play listing.'],
      ['Account workflow', 'Set up accounts and cards in a ledger that needs no bank login.', 'Realbyte describes double-entry bookkeeping that updates tracked assets as income and expenses are recorded.'],
      ['Backups', 'Create a Wafra backup file and restore it in Wafra.', 'Realbyte documents local, Google Drive and email backup and restore options.'],
    ],
    article: `
Realbyte Money Manager and Wafra can both help you track expenses and income on Android. Realbyte's app supports a routine where you record purchases yourself and see them reflected in the account and budget. Its Korean listing also describes bank and card SMS capture. Wafra offers manual entry, pasted alerts, and optional automatic capture of supported Android bank alerts.

## What the Realbyte workflow looks like

[Realbyte's Google Play listing](https://play.google.com/store/apps/details?id=com.realbyteapps.moneymanagerfree) describes double-entry bookkeeping, category statistics, and budget and expense graphs. If you like treating a purchase as something to check off, first try entering a cash expense and a card expense, then see how each affects the asset account and category total. Those two entries tell you more about the routine than a feature checklist does. If automation matters to you, [Realbyte’s Korean Play listing](https://play.google.com/store/apps/details?hl=ko&id=com.realbyteapps.moneymanagerfree) describes automatic reading of received bank and card SMS. Check the listing and options on your device before you rely on support for your own alerts.

Money Manager's value is easy to assess with a week of your own categories. Set a limit you already know, such as a monthly groceries target, using [Realbyte's budget setup guide](https://help.realbyteapps.com/hc/en-us/articles/360042842974-How-to-set-up-modify-delete-a-budget). Enter each relevant purchase during the test week, including cash. At the end of the week, look at whether the budget chart helps you answer the question you started with. This is particularly useful if your goal is to build more awareness of each purchase through manual recording.

## When Wafra's alert workflow helps

If the purchases you forget are mostly on a card, try pasting one genuine bank alert into Wafra. Check the amount, currency, date and merchant before accepting the result. The main ledger is encrypted on your device. Manual entry and pasting do not require SMS inbox access. If you later decide to try automatic capture, supported bank SMS and bank-app notifications on Android are optional and need permission.

The distinction matters most for mixed spending. Keep entering cash by hand while using supported alerts where they save time. An unfamiliar message can need review or manual entry. Pending, reversed or missing notices are another reason to reconcile with a statement. Automatic capture is included for three days and then requires Wafra Pro. You can keep tracking by hand, pasting alerts, and backing up without upgrading.

## Protect the records you already have

[Realbyte's Android backup instructions](https://help.realbyteapps.com/hc/en-us/articles/360042747934-How-to-backup-and-restore-data) describe ways to keep a copy locally or through services such as Google Drive and email. If you currently use Money Manager, create a backup before trying a different budget app. A local backup on the same phone is useful for restoring the app but can be lost with the phone. Store your own copy somewhere you control.

Keep Realbyte backups for restoring in Money Manager. In Wafra, start with the current month or a small test set, check the results against your statement, and create a separate Wafra backup. You can learn which workflow you'll stick with without changing the ledger you already trust.
`,
    faqs: [
      ['Can I use Wafra as a manual expense tracker?', 'Yes. Manual entry works without turning on SMS or notification access and remains available without Wafra Pro.'],
      ['Can I restore a Realbyte backup directly in Wafra?', 'Restore a Realbyte backup using Money Manager. Wafra backup and restore uses its own format.'],
    ],
  },
];

export const comparisonRoutes = [
  'compare',
  ...comparisonPages.map(({ slug }) => `compare/${slug}`),
];
