# Independent credit-settlement regression corpus

`credit-settlement-sweep.json` preserves all 443 synthetic cases supplied by the independent GPT-family reviewer on 14 November 2026 (reviewed release a51d0be2). S0001–S0349 are the original sweep; X0001–X0094 cover status headlines, grammatical requests, orthography, SA/SAR and real credits beside requests. No customer messages are included.

`credit-settlement-closure.test.cjs` exercises every row through parseSms, createLaunchAlertSession and the committed native JS bundle. The repair CI suite discovers this test automatically. The additional focused controls cover the original F1–F4 triggers, historical settlement, fraud footers, independent status subjects, request-owned completion and line-break scope.

Expected source directions and the 25000-minor-unit amount are explicit. A contingent credit must produce no automatic movement on all three paths (Review and ignore are both non-posting). A request beside an independent debit must preserve that debit and cannot credit it. Native may retain its established ignore policy for a valid source debit; `no-credit` states that exception explicitly. Native must retain its previously supported settled controls. Six AlRajhi controls intentionally use AE/AED: their source posting remains valid, while the session's country mismatch and native Review route remain non-posting. Those exceptions are explicit per-path expectations, not treated as successful postings.

Evidence supplied by the reviewer: Shared/Transfers/746b7a38-eb7f-4181-93c4-9159fdfdb616/{sweep.md,evidence.zip}. Expectations describe the required fixed behavior; the review's observed false incomes are not accepted as golden results.
