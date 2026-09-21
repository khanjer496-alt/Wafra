/**
 * Anchor questions for on-device Ask Wafra intent routing, one group per tool.
 *
 * NOT WIRED UP YET, AND THE BUILDER WILL TELL YOU WHY.
 *
 * `LOCAL_SEMANTIC_REGISTRY` in `src/lib/local-semantic-model.ts` is the
 * code-owned authority for which prototype ids mean anything. It maps each id
 * to a tool AND an argument policy, and `chooseLocalSemanticAssistantPlan`
 * refuses an id it does not know — correctly, because an index is data and data
 * does not get to invent an intent.
 *
 * The registry currently holds ELEVEN assistant intents. `ASSISTANT_TOOL_CATALOG`
 * holds twenty-five tools. Fifteen are therefore unreachable locally, and that
 * shows up as a wrong answer rather than a missing one: ask "how much did I blow
 * on food last month" and the nearest prototype is
 * `ask.income.total.current-scope`, because `category-breakdown` has no
 * prototype to be near. Measured at a margin of 0.004 against the shipped index.
 *
 * This file covers all twenty-five, so the fifteen gaps are written down and
 * ready. `build-assistant-index.mjs` reads the registry and REFUSES to emit an
 * index containing an id the registry lacks — it names the fifteen. Expanding
 * the intent set means adding registry entries first, each with a deliberate
 * argument policy, which is a source change for review rather than something an
 * asset regeneration can smuggle in.
 *
 * WHAT AN ANCHOR IS FOR
 *
 * Not training data. These are reference points in the embedding space, and a
 * question routes to whichever it lands nearest. So they cover the ways a
 * question is actually ASKED, not the ways a tool could be described. "How much
 * did I blow on food" and "what's my grocery spend" are one intent in two
 * registers, and both need to be here or neither is near.
 *
 * LANGUAGES
 *
 * Every group carries English, Arabic, and where it reads naturally, Arabizi —
 * Arabic in Latin script with digits for letters (3 for ع, 7 for ح), which is
 * how a great many people in the UAE and Saudi actually type. One embedding
 * space handles all three, which is the point of the encoder; a keyword router
 * would need three rule sets kept in step.
 *
 * MEASURED
 *
 * Built against the pinned encoder and scored on thirty questions worded
 * differently from every anchor here: 27/30 top-1. With gates at score 0.80 and
 * margin 0.02, twenty routed and ten asked for clarification — and all twenty
 * routed were correct, with all three misses inside the margin gate. ~5 ms per
 * question on x86 CPU. Note the registry's own thresholds for this domain are
 * 0.72/0.08, so re-measure against those if these are ever wired in.
 *
 * There is deliberately no group for `compare-accounts`: it is in the
 * `AssistantTool` union but not in `ASSISTANT_TOOL_CATALOG`, which is what
 * `isAssistantToolRequest` validates against, so it could only ever be refused.
 */

const anchors = Object.freeze([
  {
    id: 'ask.help', tool: 'help',
    phrasings: [
      'what can you do', 'what can I ask you', 'help', 'how does this work',
      'what questions can you answer', 'show me what you can do',
      'ماذا يمكنك أن تفعل', 'كيف أستخدم هذا', 'مساعدة', 'ما الأسئلة التي يمكنك الإجابة عليها',
      'shu fee 3indak', 'kaif asta5dem hatha',
    ],
  },
  {
    id: 'ask.spending.total.current-month', tool: 'spending-total',
    phrasings: [
      'how much did I spend this month', 'what did I spend so far',
      'total spending this month', 'how much money have I spent',
      'what are my expenses this month', 'how much went out this month',
      'كم صرفت هذا الشهر', 'ما مجموع مصروفاتي', 'كم أنفقت',
      'إجمالي المصاريف هذا الشهر',
      'kam sarafat hatha el shahar', 'kam masareefi',
    ],
  },
  {
    id: 'ask.income.total.current-scope', tool: 'income-total',
    phrasings: [
      'how much did I earn this month', 'what was my income', 'total income',
      'how much money came in', 'what did I receive this month',
      'كم دخلي هذا الشهر', 'ما مجموع الدخل', 'كم استلمت هذا الشهر', 'الراتب الذي استلمته',
      'kam da5li hatha el shahar',
    ],
  },
  {
    id: 'ask.merchant.breakdown', tool: 'merchant-breakdown',
    phrasings: [
      'how much did I spend at Carrefour', 'what did I spend at Starbucks',
      'my total at Amazon', 'how much have I paid this shop',
      'spending at one store', 'how much goes to that merchant',
      'how much has this shop taken', 'what have I paid that company',
      'كم صرفت في كارفور', 'كم دفعت لهذا المتجر', 'مجموع مشترياتي من أمازون',
      'kam sarafat fi carrefour',
    ],
  },
  {
    id: 'ask.category.breakdown', tool: 'category-breakdown',
    phrasings: [
      'how much did I blow on food last month', 'what do I spend on groceries',
      'how much goes to transport', 'my spending on dining out',
      'how much did I spend on bills', 'total for that category',
      'what am I spending on utilities', 'how much on entertainment',
      'كم صرفت على الطعام', 'كم أنفق على المواصلات', 'مصروف البقالة',
      'كم صرفت على الفواتير',
      'kam sarafat 3ala akl', 'kam 3ala grocery',
    ],
  },
  {
    id: 'ask.subscriptions.active', tool: 'subscriptions',
    phrasings: [
      'what subscriptions am I paying for', 'list my subscriptions',
      'what recurring payments do I have', 'my monthly subscriptions',
      'what am I subscribed to', 'how much do subscriptions cost me',
      'ما هي اشتراكاتي', 'اشتراكاتي الشهرية', 'ما الاشتراكات المتكررة',
      'ishtirakati el shahriya',
    ],
  },
  {
    id: 'ask.compare.periods', tool: 'compare-periods',
    phrasings: [
      'am I spending more than last month', 'compare this month to last month',
      'is my spending up or down', 'how does this month compare',
      'did I spend more this year than last', 'versus the previous period',
      'هل صرفت أكثر من الشهر الماضي', 'قارن هذا الشهر بالشهر الماضي',
      'هل زادت مصاريفي',
      'sarafat akthar min el shahar elli faat',
    ],
  },
  {
    id: 'ask.top-merchants.current-scope', tool: 'top-merchants',
    phrasings: [
      'where do I spend the most money', 'which shops do I spend most at',
      'my biggest merchants', 'top stores by spending',
      'which businesses take most of my money', 'who do I pay the most',
      'أين أصرف أكثر', 'ما هي أكثر المتاجر التي أصرف فيها', 'أكبر المتاجر',
      'wain asraf akthar',
    ],
  },
  {
    id: 'ask.top-categories.current-scope', tool: 'top-categories',
    phrasings: [
      'what do I spend the most on', 'my biggest spending categories',
      'which category costs me most', 'where is my money going',
      'break my spending down by category', 'top categories',
      'على ماذا أصرف أكثر', 'ما هي أكبر فئات الإنفاق', 'أين تذهب أموالي',
      'wain trooh feloosi',
    ],
  },
  {
    id: 'ask.largest-purchases', tool: 'largest-purchases',
    phrasings: [
      'what were my biggest purchases', 'show my largest transactions',
      'my most expensive buys this month', 'what did I spend the most on in one go',
      'biggest single charges',
      'ما هي أكبر مشترياتي', 'أغلى عملية شراء', 'أكبر المعاملات',
      'akbar mushtarayati',
    ],
  },
  {
    id: 'ask.daily-average', tool: 'daily-average',
    phrasings: [
      'how much do I spend per day', 'what is my daily average spend',
      'average spending a day', 'my daily burn rate',
      'كم أصرف يومياً', 'ما معدل صرفي اليومي', 'المتوسط اليومي',
      'kam asraf youmiyan',
    ],
  },
  {
    id: 'ask.net-income-spending', tool: 'net-income-spending',
    phrasings: [
      'am I saving money', 'did I spend more than I earned',
      'what is left after expenses', 'income minus spending',
      'am I in the red this month', 'how much did I keep',
      'did I save anything', 'how much is left over', 'anything put by',
      'هل أدخر', 'هل صرفت أكثر مما دخلت', 'كم تبقى بعد المصاريف',
      'كم وفرت هذا الشهر',
      'hal wafart hatha el shahar',
    ],
  },
  {
    id: 'ask.upcoming.default-window', tool: 'upcoming-payments',
    phrasings: [
      'what bills are due soon', 'what do I owe coming up',
      'upcoming payments', 'what is due this week',
      'when is my card payment due', 'what needs paying',
      'what do I owe this week', 'anything to pay soon', 'what must I pay',
      'ما الفواتير المستحقة قريباً', 'ما المدفوعات القادمة', 'متى موعد دفع البطاقة',
      'shu el fawateer elli jaya',
    ],
  },
  {
    id: 'ask.cash-outflow', tool: 'cash-outflow',
    phrasings: [
      'how much cash did I withdraw', 'my ATM withdrawals',
      'how much cash have I taken out', 'total cash out',
      'كم سحبت نقداً', 'مسحوباتي من الصراف', 'كم أخرجت كاش',
      'kam sahabt cash',
    ],
  },
  {
    id: 'ask.month-forecast', tool: 'month-forecast',
    phrasings: [
      'how much will I spend this month', 'am I on track this month',
      'what will my total be at this rate', 'forecast my spending',
      'projected spend for the month', 'what will I end up spending',
      'كم سأصرف هذا الشهر', 'هل أنا على المسار الصحيح', 'توقع مصروفي',
      'kam bsaraf hatha el shahar',
    ],
  },
  {
    id: 'ask.historical-baseline', tool: 'historical-baseline',
    phrasings: [
      'is this normal for me', 'how does this compare to my history',
      'what do I usually spend', 'is this more than my average month',
      'compared to previous months',
      'هل هذا طبيعي بالنسبة لي', 'كم أصرف عادة', 'مقارنة بالأشهر السابقة',
      'hal hatha 3adi 3alay',
    ],
  },
  {
    id: 'ask.account-inventory', tool: 'account-inventory',
    phrasings: [
      'how many cards do I have', 'list my accounts',
      'what accounts are set up', 'which banks do I have here',
      'do I have an Emirates NBD account', 'show my cards',
      'كم بطاقة لدي', 'ما هي حساباتي', 'أي بنوك مسجلة لدي',
      'kam card 3indi',
    ],
  },
  {
    id: 'ask.top-accounts', tool: 'top-accounts',
    phrasings: [
      'which card do I use the most', 'which account do I spend from most',
      'my most used card', 'rank my cards by spending',
      'أي بطاقة أستخدم أكثر', 'من أي حساب أصرف أكثر', 'البطاقة الأكثر استخداماً',
      'ay card astakhdem akthar',
    ],
  },
  {
    id: 'ask.obligation-status', tool: 'obligation-status',
    phrasings: [
      'did I pay my card bill', 'is my statement settled',
      'have I paid that bill yet', 'what is the status of my card payment',
      'do I still owe on the statement',
      'هل دفعت فاتورة البطاقة', 'هل تمت تسوية كشف الحساب', 'هل سددت الفاتورة',
      'hal dafa3t el faatura',
    ],
  },
  {
    id: 'ask.credit-card-settlement-summary', tool: 'credit-card-settlement-summary',
    phrasings: [
      'are all my credit cards paid off', 'is everything settled',
      'do I owe anything on my cards', 'all statements cleared',
      'هل جميع بطاقاتي مسددة', 'هل علي أي مستحقات على البطاقات',
    ],
  },
  {
    id: 'ask.recurring-changes', tool: 'recurring-changes',
    phrasings: [
      'did any subscription get more expensive', 'have my recurring bills changed',
      'which regular payments went up', 'any price increases on subscriptions',
      'هل ارتفعت أسعار اشتراكاتي', 'هل تغيرت المدفوعات المتكررة',
      'ay ishtirak ghala',
    ],
  },
  {
    id: 'ask.unusual-charges', tool: 'unusual-charges',
    phrasings: [
      'any unusual charges', 'did anything odd come out',
      'show me strange transactions', 'anything bigger than normal',
      'unexpected spending',
      'هل هناك عمليات غير معتادة', 'أي مصاريف غريبة', 'شيء أكبر من المعتاد',
      'fee ay shay ghareeb',
    ],
  },
  {
    id: 'ask.duplicates.current-scope', tool: 'possible-duplicates',
    phrasings: [
      'was I charged twice', 'any duplicate transactions',
      'did the same payment go out twice', 'check for double charges',
      'هل تم خصم المبلغ مرتين', 'هل هناك معاملات مكررة', 'خصم مزدوج',
      'hal in5asam marratain',
    ],
  },
  {
    id: 'ask.money-review.current-scope', tool: 'money-review',
    phrasings: [
      'check my money', 'is anything wrong with my spending',
      'review my transactions', 'anything I should look at',
      'give my finances a health check',
      'راجع أموالي', 'هل هناك خطأ في مصاريفي', 'افحص معاملاتي',
      'raje3 floosi',
    ],
  },
  {
    id: 'ask.data-coverage.current-scope', tool: 'data-coverage',
    phrasings: [
      'what data do you have', 'how complete is my history',
      'which accounts are being tracked', 'is everything imported',
      'what is missing from my records',
      'ما البيانات المتوفرة لديك', 'هل السجل كامل', 'ماذا ينقص من بياناتي',
      'shu el data elli 3indak',
    ],
  },
]);

module.exports = anchors;
