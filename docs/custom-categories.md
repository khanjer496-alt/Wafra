# Custom categories

In a transaction, bill, merchant rule or budget category picker, choose **New
category**, enter a name and choose **Create category**. The new category is
selected immediately; save the transaction, bill, rule or limit to apply it.
Expense and income categories stay separate. Filters select existing categories.

Names contain 1–40 Unicode code points, with whitespace normalized. Controls,
duplicate built-in names (English or Arabic), and duplicate custom names are
rejected. A ledger can contain up to 100 custom categories. Category identity is
an opaque random ID, independent of its saved name.

The catalog is persisted with the local ledger and included in full backups.
A restore validates all custom references before replacing the ledger. Historical
rows with damaged or missing local catalog metadata retain their amounts and
show “Custom category”; new assignments to an unregistered ID are rejected.
Orphan automation rules are disabled so they cannot keep assigning missing IDs.

Custom names appear in transaction details, budgets, spending views, filters,
search, CSV and expense reports. CSV formula escaping and HTML escaping apply
to names. Deterministic Ask Wafra category questions resolve against this ledger;
model schemas remain limited to built-in categories. A custom category name in
an unrecognized question keeps the request local instead of dropping its scope.

Rename/delete management is not part of this release. Creating a category does
not change amounts, dates, accounts, payment allocation or statement evidence.

Focused checks: `custom-category-core.test.cjs`, `custom-category-store.test.cjs`,
`custom-category-consumers.test.cjs`, and `e2e-custom-categories.mjs`. The browser
flow creates expense and income categories, verifies unchanged monetary fields,
checks filter removability, searches saved names, and restores a real exported
backup in both themes. Browser verification is
not physical iPhone/Android evidence.
