// Build the review packet for one story: node review.mjs KEY
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { ROOT, here, stories, state, pathsOf } from './lib.mjs';
const key = process.argv[2]; const st = stories().find(x => x.Key === key); if (!st) { console.error('unknown key'); process.exit(2); }
const rec = state().stories[key] ?? {}; const branch = rec.branch;
const sh = c => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { return `(failed: ${c})`; } };
sh('git fetch -q origin');
const files = branch ? sh(`git diff --name-only origin/main...${branch}`).split('\n').filter(Boolean) : [];
const allowed = [...pathsOf(st), 'CHANGELOG.md', 'docs/taste-review/queue.md', `orchestration/results/${key}.json`];
const outside = files.filter(f => !allowed.some(a => f === a || f.startsWith(a.replace(/\/$/, '') + '/') || f.startsWith(a)));
const contracts = files.filter(f => /packages\/[^/]+\/src\/contracts\//.test(f) || f === 'packages/theme/src/tokens.css');
const fixtures = files.filter(f => f.startsWith('fixtures/corpus/') || f.startsWith('fonts/'));
const result = existsSync(here(`results/${key}.json`)) ? JSON.parse(readFileSync(here(`results/${key}.json`), 'utf8')) : null;
const pr = result?.pr ? sh(`gh pr view ${result.pr} --json state,mergeable,statusCheckRollup,reviewDecision,additions,deletions --jq '{state,mergeable,reviewDecision,additions,deletions,checks:[.statusCheckRollup[]?|{name,conclusion}]}'`) : '(no PR)';
const attribution = branch ? sh(`git log origin/main..${branch} --format=%B | grep -i -E 'co-authored-by:.*(claude|cursor|gpt|grok|copilot)|generated with' || true`) : '';
console.log(`# Review packet — ${key}\n\n## Story\n- ${st.Summary}\n- Paths: ${st.Paths}\n- Labels: ${st.Labels}\n\n## Acceptance criteria\n${st.Acceptance}\n\n## Diff\n${branch ? sh(`git diff --stat origin/main...${branch}`) : '(no branch)'}\n\n## Boundary check\n- files outside paths: ${outside.length ? outside.join(', ') : 'none'}\n- contract files touched: ${contracts.length ? contracts.join(', ') : 'none'}\n- fixtures/fonts touched: ${fixtures.length ? fixtures.join(', ') : 'none'}\n- attribution trailers: ${attribution ? 'FOUND' : 'none'}\n\n## Implementor result\n${result ? JSON.stringify(result, null, 2) : '(missing — treat as failed)'}\n\n## PR\n${pr}\n\n## Decide\nmerge | return (write results/${key}.notes.md) | escalate`);
