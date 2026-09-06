from pathlib import Path
import sys
r=Path(sys.argv[1]);p=r/'scripts/e2e/e2e-smoke.mjs';s=p.read_text()
s=s.replace("!!(await visibleText(page, /^SPENT$/i))", "await page.locator('[data-testid=\"reference-month-cards\"]').getByText('Spending',{exact:true}).count() === 1")
s=s.replace('/^COMING UP$/i','/^(Upcoming|Coming up)$/i').replace('/ENTRY DETAIL/i','/TRANSACTION DETAILS/i').replace("'EDIT ENTRY'","'Edit transaction'")
a=s.index("ok('flow shows limits'");b=s.index('// ── Bills',a)
s=s[:a]+r'''// Categories own budgets now. Keep exact money and drill-down checks.
ok('Spending shows category limits with their spending', !!(await visibleText(page,/Categories with limits/i)));
{
  const rows=await page.locator('[data-testid="spending-categories"] [role="button"][aria-label]').evaluateAll(nodes=>nodes
    .map(n=>({label:n.getAttribute('aria-label'),text:n.textContent}))
    .filter(n=>/\. AED /.test(n.label)));
  const amounts=rows.map(n=>money(n.label.match(/\. (AED [\d,]+(?:\.\d+)?)/)?.[1]||''));
  ok(`Spending category rows reconcile to exact total (${rows.length} rows)`,rows.length>=5 && amounts.every(Number.isFinite) &&
    Math.round(amounts.reduce((a,b)=>a+b,0)*100)===Math.round(money(flowTotalHeading)*100));
  const row=rows[0];ok('Spending offers a category to inspect',!!row);
  if(row){
    const want=money(row.label.match(/\. (AED [\d,]+(?:\.\d+)?)/)?.[1]||'');
    await tapLabel(page,row.label);await tapText(page,'View activity',1500);
    ok('Category detail opens a scoped expense ledger', /category=/.test(page.url())&&/type=expense/.test(page.url()));
    const total=await page.evaluate(()=>[...document.querySelectorAll('div,span')].filter(n=>n.childElementCount===0&&n.getBoundingClientRect().width>0)
      .map(n=>(n.textContent||'').trim()).find(x=>/^[+−-]\s?AED/.test(x))||'');
    ok('Category ledger total equals the category amount',Math.round(Math.abs(money(total))*100)===Math.round(want*100));
    await tapLabel(page,'Back',1200);await tapTab(page,'Spending');
  }
}
await tapText(page,'Trends',800);
ok('Trends owns six-month cashflow',!!(await visibleText(page,/Income & spending/i)));
const months=await page.locator('[data-testid="spending-trends"] [role="button"][aria-label]').evaluateAll(nodes=>nodes
  .map(n=>({label:n.getAttribute('aria-label'),selected:n.getAttribute('aria-selected'),text:n.textContent}))
  .filter(n=>/Income:.*Spending:|No recorded activity/.test(n.label)));
ok('All six months expose readable cashflow or no-data',months.length===6);
ok('Exactly one month is selected',months.filter(m=>m.selected==='true').length===1);
ok('Trends includes merchant and change analysis',!!(await visibleText(page,'Top merchants'))&&!!(await visibleText(page,'What changed')));
await tapText(page,'Categories',700);
await tapLabel(page,/^Transport\. AED /,800);
await tapText(page,'Edit limits',800);
ok('Category limit editor remains reachable',!!(await visibleText(page,/MONTHLY LIMIT/i)));
ok('Limit editor preserves its merchant detail',!!(await visibleText(page,/WHERE IT WENT/i)));
await tapLabel(page,'Close',500);await tapLabel(page,'Close',500);

'''+s[b:]
a=s.index("ok('bills segments recurring");b=s.index('// The subscription sheet',a)
s=s[:a]+r'''ok('Bills has Upcoming and All views',!!(await visibleText(page,'Upcoming'))&&!!(await visibleText(page,'All')));
const agenda=page.locator('[data-testid="payment-agenda"]');
await agenda.waitFor({state:'visible'});
ok('Agenda states that recording a payment does not move money',/Recording a payment does not move money/.test(await agenda.innerText()));
await tapText(page,'All',600);
const rows=await agenda.locator('[role="button"][aria-label]').evaluateAll(nodes=>nodes.map(n=>({label:n.getAttribute('aria-label'),text:n.textContent})));
ok('Chronological agenda contains named obligations',rows.length>0 && rows.every(n=>/AED [\d,]+/.test(n.label)));
ok('Agenda amounts are exactly visible in their own rows',rows.every(n=>{
 const amount=n.label.match(/AED ([\d,]+(?:\.\d+)?)/)?.[1];
 return amount && n.text.replace(/\s/g,'').includes(amount);
}));
// Monthly-equivalent headings and three buckets are intentionally retired.
// Verify estimates are identified and preserve the actual charge-history sum below.
ok('Predicted recurring charges remain identified as estimates',rows.some(n=>/Estimated/.test(n.label)));

'''+s[b:]
a=s.index("await tapText(page, /Fixed \\d/i",s.index('// The subscription sheet'));b=s.index('// ── Wallet',a)
s=s[:a]+s[b:]
s=s.replace("ok('wallet groups accounts and cards as money sources', !!(await visibleText(page, /MONEY SOURCES/i)));", "ok('Accounts separates bank and credit accounts', !!(await visibleText(page, /^Bank accounts$/i)) && !!(await visibleText(page, /^Credit cards$/i)));")
a=s.index("ok('settings leads with Pro'");b=s.index('/**\n * Appearance.',a)
s=s[:a]+r'''{
 const panels=await Promise.all(['Preferences','Imports','Privacy & data','Help'].map(x=>visibleText(page,x)));
 ok('Settings exposes all four task panels',panels.every(Boolean));
}
await tapText(page,'Help',500);
ok('Help keeps Pro and trial status reachable',!!(await visibleText(page,'Wafra Pro'))&&!!(await visibleText(page,/Free trial · \d day/)));
ok('Help keeps feedback reachable',!!(await visibleText(page,'Send feedback')));
await tapText(page,'Privacy & data',500);
ok('Privacy retains app lock',!!(await visibleText(page,'App lock')));
await tapText(page,'Preferences',500);

'''+s[b:]
s=s.replace("await tapText(page, 'Improve accuracy', 1200);", "await tapText(page,'Imports',500);\nawait tapText(page, 'Improve accuracy', 1200);")
s=s.replace("await tapText(page, 'Wafra Pro', 1400);", "await tapText(page,'Help',500);\nawait tapText(page, 'Wafra Pro', 1400);")
s=s.replace("await tapText(page, 'Wafra Pro', 1200);", "await tapText(page,'Help',500);\nawait tapText(page, 'Wafra Pro', 1200);")
s=s.replace("const about = await visibleText(page, 'Know where it goes');", "await tapText(page,'Help',500);\nconst about = await visibleText(page, 'Know where it goes');")
p.write_text(s)
print('Migrated browser owner/label contracts; preserved editing, totals, subscription history, privacy, import and entitlement checks.')
