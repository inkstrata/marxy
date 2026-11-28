import { evaluate, lastReset } from '../../../../../scripts/auto/lib/merge-policy.mjs';
import { decide, slotsUntilReset, localParts } from '../../../../../scripts/auto/lib/governor.mjs';
const H = 'a'.repeat(40);
const base = (comments, extra = {}) => ({ number: 1, state: 'OPEN', isDraft: false, headRefName: 'agent/x', headRefOid: H, labels: [], files: ['a.md'],
  body: 'x\n<!-- marxy-author run=night-1 model=sonnet -->', comments, checks: [{ name: 'ci', conclusion: 'SUCCESS' }], mergeStateStatus: 'CLEAN', ...extra });
const c = (body, t) => ({ body, createdAt: new Date(t).toISOString() });
const T = Date.parse('2026-11-28T10:00:00Z');
const p = (n, r) => console.log(n, JSON.stringify(r));
// 1 review marker with no run, no model
p('1 review without run/model', evaluate(base([c(`<!-- marxy-review verdict=approve head=${H} -->`, T)])));
// 2 same second changes then approve
p('2 changes+approve same second', evaluate(base([c(`<!-- marxy-review verdict=changes head=${H} run=r1 model=opus -->`, T), c(`<!-- marxy-review verdict=approve head=${H} run=r2 model=opus -->`, T)])));
// 3 plan: owner comment containing the marker text after intake
const plan = (owner) => base([c(`<!-- marxy-intake head=${H} -->`, Date.parse('2026-11-29T09:00:00Z')), c(`<!-- marxy-review verdict=approve head=${H} run=r2 model=opus -->`, T), c(owner, Date.parse('2026-11-29T10:00:00Z'))], { labels: ['plan'] });
const now = new Date('2026-11-30T09:00:00Z');
p('3a owner plain', evaluate(plan('please change X'), { now }));
p('3b owner quoting marker', evaluate(plan('re <!-- marxy-intake head=abc --> please change X'), { now }));
p('3c owner no-space marker', evaluate(plan('<!--marxy-note-->'), { now }));
// 4 marker with extra suffix
p('4 marxy-review-foo', evaluate(base([c(`<!-- marxy-review-foo verdict=approve head=${H} run=r2 model=opus -->`, T)])));
// clocks
for (const s of ['2026-11-27T03:59:00Z','2026-11-28T03:59:00Z','2026-11-28T04:00:00Z','2026-03-07T04:00:00Z','2026-03-14T04:00:00Z','2026-11-01T03:59:00Z','2026-11-06T04:00:00Z','2026-11-07T04:00:00Z'])
  console.log('lastReset', s, lastReset(new Date(s)).toISOString(), 'slots', slotsUntilReset(new Date(s)));
