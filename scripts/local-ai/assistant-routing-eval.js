/**
 * Held-out questions for `npm run eval:assistant-routing`.
 *
 * NONE of these appear in `assistant-anchors.js`. Scoring the anchors against
 * an index built from the anchors measures nothing — every one is its own
 * nearest neighbour at cosine 1.0. These are the same intents worded the way a
 * different person would word them, which is the only thing the number can mean.
 *
 * `tool` is the tool that must be reached. `null` means the question is out of
 * Wafra's scope and any routed answer is a failure — clarification is the
 * correct outcome, and these carry the weight, because a confident wrong tool
 * is worse than a request to rephrase.
 *
 * `note` records why a row is here when that is not obvious from reading it.
 */
const heldOut = Object.freeze([
  // ---- in scope, English ------------------------------------------------
  { q: 'whats my outgoing for the month', tool: 'spending-total' },
  { q: 'add up everything i paid out', tool: 'spending-total' },
  { q: 'total earnings credited to me', tool: 'income-total' },
  { q: 'what came into my account', tool: 'income-total' },
  { q: 'list the services billing me every month', tool: 'subscriptions' },
  { q: 'what is auto renewing', tool: 'subscriptions' },
  { q: 'bills landing soon', tool: 'upcoming-payments' },
  { q: 'what do i owe in the next few weeks', tool: 'upcoming-payments' },
  { q: 'who takes the biggest share of my money', tool: 'top-merchants' },
  { q: 'rank the places i pay', tool: 'top-merchants' },
  { q: 'split my outgoings by type', tool: 'top-categories' },
  { q: 'which kind of spending dominates', tool: 'top-categories' },
  { q: 'was i charged the same thing twice', tool: 'possible-duplicates' },
  { q: 'repeated identical charges', tool: 'possible-duplicates' },
  { q: 'look over my accounts for problems', tool: 'money-review' },
  { q: 'sanity check my finances', tool: 'money-review' },
  { q: 'how much of my history did you manage to read', tool: 'data-coverage' },
  { q: 'are there gaps in what you imported', tool: 'data-coverage' },
  { q: 'am i worse off than the month before', tool: 'compare-periods' },
  { q: 'stack this period against the last one', tool: 'compare-periods' },
  { q: 'my priciest transactions', tool: 'largest-purchases' },
  { q: 'the few biggest hits to my balance', tool: 'largest-purchases' },
  { q: 'typical outgoing per day', tool: 'daily-average' },
  { q: 'what do i get through in 24 hours', tool: 'daily-average' },
  { q: 'did i end up ahead or behind', tool: 'net-income-spending' },
  { q: 'earnings minus outgoings', tool: 'net-income-spending' },
  { q: 'money i pulled from the machine', tool: 'category-breakdown', note: 'cash-withdrawal category' },
  { q: 'notes i took out over the counter', tool: 'category-breakdown', note: 'cash-withdrawal category' },
  { q: 'where will i land by month end', tool: 'month-forecast' },
  { q: 'at this pace what is my total going to be', tool: 'month-forecast' },
  { q: 'is this a heavy month by my standards', tool: 'historical-baseline' },
  { q: 'against what i normally get through', tool: 'historical-baseline' },
  { q: 'how many payment methods are stored', tool: 'account-inventory' },
  { q: 'what have i registered in here', tool: 'account-inventory' },
  { q: 'which plastic gets the heaviest use', tool: 'top-accounts' },
  { q: 'order my accounts by how much leaves them', tool: 'top-accounts' },
  { q: 'are my cards clear', tool: 'credit-card-settlement-summary' },
  { q: 'anything outstanding across my credit cards', tool: 'credit-card-settlement-summary' },
  { q: 'have my regular charges crept up', tool: 'recurring-changes' },
  { q: 'any of my standing payments cost more now', tool: 'recurring-changes' },
  { q: 'flag anything out of the ordinary', tool: 'unusual-charges' },
  { q: 'charges that look off to you', tool: 'unusual-charges' },
  { q: 'what sort of thing can i ask', tool: 'help' },
  { q: 'explain what you are able to tell me', tool: 'help' },

  // ---- in scope, Arabic --------------------------------------------------
  { q: 'ما مقدار ما خرج من حسابي', tool: 'spending-total' },
  { q: 'مجموع ما وصلني من أموال', tool: 'income-total' },
  { q: 'ما الخدمات التي تسحب مني شهرياً', tool: 'subscriptions' },
  { q: 'ما المدفوعات القادمة قريباً', tool: 'upcoming-payments' },
  { q: 'من يأخذ أكبر نصيب من مالي', tool: 'top-merchants' },
  { q: 'وزع مصاريفي على الأنواع', tool: 'top-categories' },
  { q: 'هل خُصم نفس المبلغ أكثر من مرة', tool: 'possible-duplicates' },
  { q: 'دقق في حساباتي', tool: 'money-review' },
  { q: 'هل هناك فجوات في ما استوردته', tool: 'data-coverage' },
  { q: 'هل حالي أسوأ من الفترة السابقة', tool: 'compare-periods' },
  { q: 'أغلى العمليات لدي', tool: 'largest-purchases' },
  { q: 'المعدل الوسطي لصرفي في اليوم', tool: 'daily-average' },
  { q: 'هل انتهيت رابحاً أم خاسراً', tool: 'net-income-spending' },
  { q: 'المبالغ التي أخذتها من الماكينة', tool: 'category-breakdown', note: 'cash-withdrawal category' },
  { q: 'إلى أين سأصل بنهاية الشهر', tool: 'month-forecast' },
  { q: 'هل هذا شهر ثقيل بمقاييسي', tool: 'historical-baseline' },
  { q: 'كم وسيلة دفع مسجلة هنا', tool: 'account-inventory' },
  { q: 'أي بطاقة يخرج منها أكثر مال', tool: 'top-accounts' },
  { q: 'هل بطاقاتي خالية من المستحقات', tool: 'credit-card-settlement-summary' },
  { q: 'هل زادت تكلفة مدفوعاتي الثابتة', tool: 'recurring-changes' },
  { q: 'أشر إلى أي شيء خارج عن المألوف', tool: 'unusual-charges' },
  { q: 'اشرح ما تستطيع إخباري به', tool: 'help' },

  // ---- in scope, Arabizi -------------------------------------------------
  { q: 'majmoo3 masareefi hatha el shahar', tool: 'spending-total' },
  { q: 'kam wasalni feloos', tool: 'income-total' },
  { q: 'shu el services elli tokhod menni kol shahar', tool: 'subscriptions' },
  { q: 'shu el dafa3at el jaya', tool: 'upcoming-payments' },
  { q: 'meen akhad akbar nasib min masaari', tool: 'top-merchants' },
  { q: 'hal in5asam nafs el mablagh marra tanya', tool: 'possible-duplicates' },
  { q: 'kam akhadt cash min el machine', tool: 'category-breakdown', note: 'cash-withdrawal category' },
  { q: 'hal hatha shahar ta3eeb 3alay', tool: 'historical-baseline' },
  { q: 'kam wasilat dafa3 3indi', tool: 'account-inventory' },

  // ---- out of scope: must NOT route --------------------------------------
  { q: 'what is the weather in dubai tomorrow', tool: null },
  { q: 'book me a flight to riyadh', tool: null },
  { q: 'should i buy bitcoin right now', tool: null, note: 'advice, not a ledger query' },
  { q: 'is my bank account safe from fraud', tool: null, note: 'security reassurance, not a tool' },
  { q: 'transfer 500 to my brother', tool: null, note: 'an instruction to move money; Wafra reads, never moves' },
  { q: 'delete all my transactions', tool: null, note: 'destructive instruction' },
  { q: 'what is my account number', tool: null, note: 'credential-shaped; no tool returns this' },
  { q: 'increase my credit limit', tool: null },
  { q: 'how do i lower my taxes', tool: null },
  { q: 'give me a loan', tool: null },
  { q: 'what is 15 percent of 240', tool: null, note: 'arithmetic, not a ledger question' },
  { q: 'who won the match last night', tool: null },
  { q: 'ما هو سعر الدولار اليوم', tool: null, note: 'live FX rate; Wafra has no market data' },
  { q: 'حول ألف درهم إلى حسابي الآخر', tool: null, note: 'an instruction to move money' },
  { q: 'هل يجب أن أستثمر في الأسهم', tool: null, note: 'investment advice' },
  { q: 'احذف كل معاملاتي', tool: null, note: 'destructive instruction' },
  { q: 'shu ra2yak fi el bitcoin', tool: null },
  { q: 'ma hu el ta2s bukra', tool: null },
  { q: 'thanks that is all', tool: null, note: 'conversational close' },
  { q: 'hello there', tool: null, note: 'greeting; the planner answers this deterministically' },

  // ---- out of scope, ADVERSARIAL ----------------------------------------
  // Financial vocabulary, financial register, and no tool that answers them.
  // These are the rows that decide the margin threshold: a question about
  // money that Wafra cannot answer sits far closer to every prototype than
  // "who won the match" ever will, so the gate's headroom is whatever these
  // leave. Each one is the kind of thing a user of a spending tracker asks.
  { q: 'why did my bank charge me a fee', tool: null, note: 'asks for a reason Wafra has no record of' },
  { q: 'is this merchant charging me correctly', tool: null, note: 'asks for a judgement about a third party' },
  { q: 'should i cancel netflix to save money', tool: null, note: 'advice; the ledger cannot recommend' },
  { q: 'how much should i be spending on groceries', tool: null, note: 'a norm, not a record' },
  { q: 'what will my salary be next year', tool: null, note: 'unrecorded future income' },
  { q: 'can i afford a car', tool: null, note: 'affordability judgement' },
  { q: 'set me a budget for dining', tool: null, note: 'an instruction to create something' },
  { q: 'remind me to pay my rent', tool: null, note: 'an instruction to create a reminder' },
  { q: 'categorise this transaction as groceries', tool: null, note: 'an edit instruction' },
  { q: 'mark netflix as not a subscription', tool: null, note: 'an edit instruction' },
  { q: 'split this bill with my flatmate', tool: null, note: 'unsupported feature' },
  { q: 'export my spending to a spreadsheet', tool: null, note: 'an instruction, not a question' },
  { q: 'what does my credit score look like', tool: null, note: 'data Wafra never holds' },
  { q: 'which bank has the best interest rate', tool: null, note: 'market information' },
  { q: 'convert my spending to dollars', tool: null, note: 'needs a live FX rate' },
  { q: 'is my spending normal compared to other people', tool: null, note: 'peer comparison; Wafra knows one ledger' },
  { q: 'how much did my friend spend', tool: null, note: 'another person\u2019s ledger' },
  { q: 'why is my balance wrong', tool: null, note: 'asks for a cause, not a total' },
  { q: 'contact my bank for me', tool: null, note: 'an instruction to act outside the app' },
  { q: 'dispute the charge from that shop', tool: null, note: 'an instruction to act outside the app' },
  { q: 'لماذا خصم البنك مني رسوماً', tool: null, note: 'asks for a reason Wafra has no record of' },
  { q: 'كم يجب أن أصرف على البقالة', tool: null, note: 'a norm, not a record' },
  { q: 'هل أستطيع تحمل شراء سيارة', tool: null, note: 'affordability judgement' },
  { q: 'ضع لي ميزانية للمطاعم', tool: null, note: 'an instruction to create something' },
  { q: 'صنف هذه العملية كبقالة', tool: null, note: 'an edit instruction' },
  { q: 'ما هو أفضل بنك للفوائد', tool: null, note: 'market information' },
  { q: 'كم صرف صديقي', tool: null, note: 'another person\u2019s ledger' },
  { q: 'لماذا رصيدي خاطئ', tool: null, note: 'asks for a cause, not a total' },
  { q: 'laish el bank khasam menni', tool: null, note: 'asks for a reason Wafra has no record of' },
  { q: 'hal aqdar ashtari sayara', tool: null, note: 'affordability judgement' },
  { q: 'sajjel li mizaniya lil akl', tool: null, note: 'an instruction to create something' },
  { q: 'kam sarraf sadeeqi', tool: null, note: 'another person\u2019s ledger' },
]);

module.exports = heldOut;
