const fs = require('node:fs'), path = require('node:path');
const { loadCorpus, evaluateRows, runCapturePath } = require(process.cwd() + '/scripts/universal-launch-eval/evaluate.cjs');
const dir = process.cwd() + '/scripts/universal-launch-eval/corpus';
const rows = loadCorpus(fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => path.join(dir, x)));
const result = evaluateRows(rows);
const missed = result.results.filter(x => x.verdict === 'miss').map(r => {
 const row = rows.find(x => x.id === r.id), c = runCapturePath(row, r.path);
 return { id: r.id, path: r.path, expected: row.expectByPath?.[r.path] ?? row.expect,
  review: c.review?.map(x => ({family:x.family ?? x.event?.family,status:x.event?.status,direction:x.event?.direction,
    amount:x.event?.amount,issues:x.event?.issues})), counts:c.counts };
});
fs.writeFileSync('retention-diagnostic.json', JSON.stringify({tally:result.tally,missed}, null, 2));
