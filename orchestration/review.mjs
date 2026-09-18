// Build the review packet for one story: node review.mjs KEY
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { ROOT, here, stories, state, pathsOf } from './lib.mjs';
const key = process.argv[2]; const st = stories().find(x => x.Key === key); if (!st) { console.error('unknown key'); process.exit(2); }
const rec = state().stories[key] ?? {}; const localBranch = rec.branch;
const sh = c => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) { return `(failed: ${c})`; } };
sh('git fetch -q origin');
// Review the commit the pull request actually contains, not the local branch or the worktree. A local
// commit that was never pushed, or a pushed one built from a stale index, is a different tree with the
// same subject: MARXY-63's pushed head deleted 1,097 lines of MARXY-19's merged work while its worktree
// was clean, and a packet diffed against the local ref reported no files outside the story's paths.
const prNumber = (existsSync(here(`results/${key}.json`)) ? JSON.parse(readFileSync(here(`results/${key}.json`), 'utf8')).pr : null) ?? rec.pr;
const head = prNumber ? sh(`gh pr view ${prNumber} --json headRefOid --jq .headRefOid`) : '';
const rev = /^[0-9a-f]{40}$/.test(head) ? head : localBranch;
const drift = rev === head && localBranch && sh(`git rev-parse ${localBranch}`) !== head
  ? `the PR head ${head.slice(0, 7)} is not ${localBranch} (${sh(`git rev-parse --short ${localBranch}`)}); this packet describes the PR`
  : '';
const files = rev ? sh(`git diff --name-only origin/main...${rev}`).split('\n').filter(Boolean) : [];
const deleted = rev ? sh(`git diff --diff-filter=D --name-only origin/main...${rev}`).split('\n').filter(Boolean) : [];
const allowed = [...pathsOf(st), 'CHANGELOG.md', 'docs/taste-review/queue.md', `orchestration/results/${key}.json`];
const outside = files.filter(f => !allowed.some(a => f === a || f.startsWith(a.replace(/\/$/, '') + '/') || f.startsWith(a)));
const contracts = files.filter(f => /packages\/[^/]+\/src\/contracts\//.test(f) || f === 'packages/theme/src/tokens.css');
const fixtures = files.filter(f => f.startsWith('fixtures/corpus/') || f.startsWith('fonts/'));
const result = existsSync(here(`results/${key}.json`)) ? JSON.parse(readFileSync(here(`results/${key}.json`), 'utf8')) : null;
const pr = result?.pr ? sh(`gh pr view ${result.pr} --json state,mergeable,statusCheckRollup,reviewDecision,additions,deletions --jq '{state,mergeable,reviewDecision,additions,deletions,checks:[.statusCheckRollup[]?|{name,conclusion}]}'`) : '(no PR)';
const attribution = rev ? sh(`git log origin/main..${rev} --format=%B | grep -i -E 'co-authored-by:.*(claude|cursor|gpt|grok|copilot)|generated with' || true`) : '';
console.log(`# Review packet — ${key}\n\n## Story\n- ${st.Summary}\n- Paths: ${st.Paths}\n- Labels: ${st.Labels}\n\n## Acceptance criteria\n${st.Acceptance}\n\n## Diff\n${rev ? sh(`git diff --stat origin/main...${rev}`) : '(no branch)'}\n\n## Boundary check\n- files outside paths: ${outside.length ? outside.join(', ') : 'none'}\n- contract files touched: ${contracts.length ? contracts.join(', ') : 'none'}\n- fixtures/fonts touched: ${fixtures.length ? fixtures.join(', ') : 'none'}\n- files this branch deletes: ${deleted.length ? deleted.join(', ') : 'none'}\n- attribution trailers: ${attribution ? 'FOUND' : 'none'}${drift ? `\n- WARNING: ${drift}` : ''}\n\n## Implementor result\n${result ? JSON.stringify(result, null, 2) : '(missing — treat as failed)'}\n\n## PR\n${pr}\n\n## Decide\nmerge | return (write results/${key}.notes.md) | escalate`);
