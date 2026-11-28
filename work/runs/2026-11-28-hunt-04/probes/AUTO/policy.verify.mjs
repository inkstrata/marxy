import { evaluate, parseMarkers } from '../../../../../scripts/auto/lib/merge-policy.mjs';
import { presence, parseKdeIdle } from '../../../../../scripts/auto/lib/presence.mjs';
const H = 'b'.repeat(40);
const c = (body, t) => ({ body, createdAt: new Date(t).toISOString() });
const pr = (comments, extra = {}) => ({ state: 'OPEN', isDraft: false, headRefName: 'agent/x', headRefOid: H, labels: [], files: ['a.md'],
  body: '<!-- marxy-author run=night-1 model=sonnet -->', comments, checks: [{ name: 'ci', conclusion: 'SUCCESS' }], mergeStateStatus: 'CLEAN', ...extra });
const T = Date.parse('2026-11-28T10:00:00Z');
const out = (n, r) => console.log(n, JSON.stringify(r));
// 03: model attr missing, run attr present and different
out('03a no run/model', evaluate(pr([c(`<!-- marxy-review verdict=approve head=${H} -->`, T)])));
out('03b run only', evaluate(pr([c(`<!-- marxy-review verdict=approve head=${H} run=r2 -->`, T)])));
out('03c control same model', evaluate(pr([c(`<!-- marxy-review verdict=approve head=${H} run=r2 model=sonnet -->`, T)])));
// 04
const ap = `<!-- marxy-review verdict=approve head=${H} run=r2 model=opus -->`, ch = `<!-- marxy-review verdict=changes head=${H} run=r3 model=opus -->`;
out('04a changes same second', evaluate(pr([c(ap, T), c(ch, T)])));
out('04b changes 1s later (control)', evaluate(pr([c(ap, T), c(ch, T + 1000)])));
out('04c review-foo kind', parseMarkers(`<!-- marxy-review-foo verdict=approve head=${H} run=r2 model=opus -->`));
// 02
const now = new Date('2026-11-30T09:00:00Z');
const plan = (o) => pr([c(`<!-- marxy-intake head=${H} -->`, Date.parse('2026-11-29T09:00:00Z')), c(ap, T), c(o, Date.parse('2026-11-29T10:00:00Z'))], { labels: ['plan'] });
out('02a plain veto', evaluate(plan('do not merge'), { now }));
out('02b veto mentioning marker', evaluate(plan('why does <!-- marxy-hold --> not work? do not merge'), { now }));
out('02c quote-reply of bot comment', evaluate(plan(`> <!-- marxy-review verdict=approve -->\nno, stop`), { now }));
// 05
const boom = () => { throw new Error('timeout'); };
for (const p of ['win32', 'darwin', 'linux']) out('05 ' + p + ' all fail', presence({ platform: p, run: boom }));
out('05 kde 5000 -> ms', parseKdeIdle('5000'));
out('05 kde 5000000 -> ms', parseKdeIdle('5000000'));
out('05 linux qdbus says 5000', presence({ platform: 'linux', run: (cmd) => cmd === 'qdbus' ? '5000' : '' }));
out('05 linux qdbus says 5 (sec)', presence({ platform: 'linux', run: (cmd) => cmd === 'qdbus' ? '5' : '' }));
