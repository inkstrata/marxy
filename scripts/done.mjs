// Definition of done, as one command: runs precheck, checks the story boundary over the whole branch,
// drafts the PR body from the task card and the branch, writes the result file, and tells you what
// is still missing. usage: pnpm done MARXY-n
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, storyKey, story, changedFiles } from './lib/repo.mjs';
import { lintPrBody } from './check-pr.mjs';
const key = process.argv[2] && /^MARXY-/.test(process.argv[2]) ? process.argv[2] : storyKey(process.argv);
if (!key) { console.error('usage: pnpm done MARXY-n (or run on a type/MARXY-n-slug branch)'); process.exit(2); }
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MARXY_STORY: key } });
const steps = [['story boundary (whole branch)', run('node', ['scripts/check-story.mjs', '--key', key, '--strict'])], ['precheck', run('node', ['scripts/precheck.mjs'])]];
let ok = true;
for (const [name, r] of steps) { const good = r.status === 0; ok &&= good; console.log(`${good ? '✓' : '✗'} ${name}`); if (!good) console.log((r.stdout + r.stderr).trim().split('\n').slice(-12).map(l => '      ' + l).join('\n')); }
const row = story(key); const card = existsSync(join(ROOT, `docs/plan/tasks/${key}.md`)) ? readFileSync(join(ROOT, `docs/plan/tasks/${key}.md`), 'utf8') : '';
const criteria = (row?.Acceptance || '').split(/;\s+|\n/).map(s => s.trim()).filter(Boolean);
const commits = execSync('git log --format=%s origin/main..HEAD', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const files = changedFiles().sort();
const gates = steps[1][1].stdout.split('\n').filter(l => /^[✓✗]/.test(l)).map(l => l.trim()).join('\n');
mkdirSync(join(ROOT, 'results'), { recursive: true }); mkdirSync(join(ROOT, 'orchestration/results'), { recursive: true });
const title = commits[0] || `type(scope): subject (${key})`;
const pr = `<!-- Title: ${title} -->

## Summary

<!-- TODO: two to four plain sentences: what a reader of marxy notices or a developer can now do, and why. -->

## Changes

${commits.map(c => `- ${c.replace(/\s*\(MARXY-\w+\)$/, '')}`).join('\n') || '- '}

## Verification

\`\`\`
${gates || 'pnpm precheck'}
\`\`\`

## For the reviewer

<!-- TODO: trade-offs, decisions the story did not specify, ADRs relied on, screenshots if visible. -->

<details>
<summary>Agent detail</summary>

**Acceptance criteria → checks**

| Criterion | Checked by |
| --- | --- |
${criteria.map(c => `| ${c.replace(/\|/g, '\\|')} | TODO |`).join('\n') || '|  |  |'}

**Files by path**

${files.map(f => `- \`${f}\``).join('\n')}

**Result**

\`\`\`json
${JSON.stringify({ key, status: 'done', branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() }, null, 2)}
\`\`\`

</details>

## Checklist

- [${ok ? 'x' : ' '}] Only the story's listed paths are touched
- [ ] Every acceptance criterion has a test or gate in this PR
- [${execSync('git diff origin/main...HEAD -- CHANGELOG.md', { cwd: ROOT, encoding: 'utf8' }).includes(key) ? 'x' : ' '}] \`CHANGELOG.md\` has an entry under \`Unreleased\`
- [ ] Queue entry in \`docs/taste-review/queue.md\` if anything visible changed
- [ ] No contract files changed, or an ADR is included
- [x] No attribution trailers
`;
writeFileSync(join(ROOT, `results/${key}.pr.md`), pr);
const resultPath = join(ROOT, `orchestration/results/${key}.json`);
if (!existsSync(resultPath)) writeFileSync(resultPath, JSON.stringify({ key, status: ok ? 'done' : 'failed', branch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(), gates: Object.fromEntries(gates.split('\n').filter(Boolean).map(l => [l.slice(2).trim(), l.startsWith('✓') ? 'ok' : 'failed'])), acceptance: criteria.map(c => ({ criterion: c, checkedBy: 'TODO' })), outsidePaths: [], needsAdr: false, queueEntry: false, notes: '' }, null, 2) + '\n');
const leftover = lintPrBody(pr, { key });
if (leftover.length) {
  console.log(`\nPR body drafted at results/${key}.pr.md — still unfilled:`);
  for (const l of leftover) console.log(`  · ${l.split('\n')[0]}`);
}
console.log(`\nFill every TODO, then open the PR with the drafted file (never gh pr create --body):\n  node scripts/open-pr.mjs ${key}`);
console.log(`result file: orchestration/results/${key}.json (set acceptance[].checkedBy)`);
if (!card) console.log(`note: no task card at docs/plan/tasks/${key}.md`);
process.exit(ok ? 0 : 1);
