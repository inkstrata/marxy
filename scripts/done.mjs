// Definition of done, as one command: runs precheck, checks the story boundary over the whole
// branch, drafts the PR body once, and — from the criterion → check table an implementor fills
// into it — writes the acceptance array in the result file. `--open` then opens the PR through
// open-pr.mjs, records its number and moves the Jira issue, so the handshake is written once
// instead of by hand twice, and a body check-pr would reject never reaches gh (MARXY-121).
// usage: pnpm done MARXY-n [--open] [--dry-run]
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, storyKey, story, changedFiles, fix } from './lib/repo.mjs';
import { lintPrBody } from './check-pr.mjs';
import { openPr, pushBranch } from './open-pr.mjs';
// The hand-off lives in the fleet store, one location whichever worktree this runs in (ADR-0034).
import { resultPath as fleetResultPath } from '../orchestration/store.mjs';

function cells(line) {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

/** The criterion → check table an implementor filled into a PR body (results/KEY.pr.md). */
export function acceptanceFromBody(body) {
  const table = (String(body ?? '').split('Acceptance criteria')[1] || '').split('\n').filter(l => /^\|/.test(l)).slice(2);
  return table.map(cells).filter(c => c[0]).map(([criterion, checkedBy]) => ({ criterion, checkedBy: checkedBy ?? '' }));
}

/** A row nobody has filled yet: empty, too short to be a real path, or literally "TODO". */
export const isTodo = checkedBy => !checkedBy || checkedBy.trim().length < 3 || /^TODO$/i.test(checkedBy.trim());

/** The acceptance array plus the first still-unfilled row, if any. */
export function checkAcceptance(body) {
  const acceptance = acceptanceFromBody(body);
  return { acceptance, todo: acceptance.find(r => isTodo(r.checkedBy)) };
}

/** A patch applied to an existing result file without disturbing its other fields. */
export function mergeResult(existing, patch) {
  return { ...existing, ...patch };
}

/** The three steps `--open` runs, for `--dry-run` to print and a reader to recognise. */
export function openSteps(key, number = '<number>') {
  return [
    'git push -u origin HEAD:refs/heads/<branch> (skipped when origin/<branch> is up to date)',
    `node scripts/open-pr.mjs ${key}`,
    `record the PR number in the fleet result (node orchestration/fleet.mjs path result ${key})`,
    `node orchestration/jira.mjs pr ${key} ${number}`,
  ];
}

function defaultJiraRun(argv) {
  return spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
}

/**
 * `--open`: lint the body first so one check-pr would reject never reaches `gh`, then open the
 * PR, record its number and move Jira. `gh` and `jiraRun` are injected so tests can record
 * calls instead of touching the network or the real CLI.
 */
export function runOpen({ key, body, bodyFile, dryRun = false, gh, push, jiraRun = defaultJiraRun }) {
  const problems = lintPrBody(body, { key });
  if (problems.length) return { ok: false, problems, opened: false };
  if (dryRun) return { ok: true, dryRun: true, steps: openSteps(key) };
  const opened = openPr({ body, key, bodyFile, gh, ...(push ? { push } : {}) });
  if (!opened.ok || opened.number == null) {
    return {
      ok: false,
      problems: opened.problems.length ? opened.problems : ['gh pr create finished but no PR number was found in its output'],
      opened: false,
    };
  }
  const jira = jiraRun(['node', 'orchestration/jira.mjs', 'pr', key, String(opened.number)]);
  const jiraOk = (jira.status ?? 0) === 0;
  return {
    ok: jiraOk,
    number: opened.number,
    opened: true,
    jira,
    problems: jiraOk ? [] : [`node orchestration/jira.mjs pr ${key} ${opened.number} exited ${jira.status}`],
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const key = process.argv[2] && /^MARXY-/.test(process.argv[2]) ? process.argv[2] : storyKey(process.argv);
  if (!key) { console.error('usage: pnpm done MARXY-n [--open] [--dry-run] (or run on a type/MARXY-n-slug branch)'); process.exit(2); }
  const OPEN = process.argv.includes('--open');
  const DRY = process.argv.includes('--dry-run');

  const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MARXY_STORY: key } });
  const steps = [['story boundary (whole branch)', run('node', ['scripts/check-story.mjs', '--key', key, '--strict'])], ['precheck', run('node', ['scripts/precheck.mjs'])]];
  let ok = true;
  for (const [name, r] of steps) { const good = r.status === 0; ok &&= good; console.log(`${good ? '✓' : '✗'} ${name}`); if (!good) console.log((r.stdout + r.stderr).trim().split('\n').slice(-12).map(l => '      ' + l).join('\n')); }
  const row = story(key); const card = existsSync(join(ROOT, `docs/plan/tasks/${key}.md`)) ? readFileSync(join(ROOT, `docs/plan/tasks/${key}.md`), 'utf8') : '';
  const criteria = (row?.Acceptance || '').split(/;\s+|\n/).map(s => s.trim()).filter(Boolean);
  const commits = execSync('git log --format=%s origin/main..HEAD', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const files = changedFiles().sort();
  const gates = steps[1][1].stdout.split('\n').filter(l => /^[✓✗]/.test(l)).map(l => l.trim()).join('\n');
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  const bodyPath = join(ROOT, `results/${key}.pr.md`);
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();

  // Draft once. Redrafting on every run would erase the criterion → check table `--open` reads.
  if (!existsSync(bodyPath)) {
    const title = commits[0] || `type(scope): subject (${key})`;
    const draft = `<!-- Title: ${title} -->

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
${JSON.stringify({ key, status: 'done', branch }, null, 2)}
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
    writeFileSync(bodyPath, draft);
  }
  const body = readFileSync(bodyPath, 'utf8');
  const { acceptance, todo } = checkAcceptance(body);

  const resultPath = fleetResultPath(key);
  const existingResult = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, 'utf8')) : {
    key, status: ok ? 'done' : 'failed', branch,
    gates: Object.fromEntries(gates.split('\n').filter(Boolean).map(l => [l.slice(2).trim(), l.startsWith('✓') ? 'ok' : 'failed'])),
    acceptance: [], outsidePaths: [], needsAdr: false, queueEntry: false, notes: '',
  };
  let result = mergeResult(existingResult, { acceptance });
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');

  if (todo) console.log(`✗ acceptance row still TODO: "${todo.criterion}"${fix(`fill "Checked by" in results/${key}.pr.md, then run again`)}`);

  if (!OPEN) {
    const leftover = lintPrBody(body, { key });
    if (leftover.length) {
      console.log(`\nresults/${key}.pr.md — still unfilled:`);
      for (const l of leftover) console.log(`  · ${l.split('\n')[0]}`);
    }
    console.log(`\nFill every TODO, then run:\n  pnpm done ${key} --open`);
    console.log(`result file: ${resultPath}`);
    if (!card) console.log(`note: no task card at docs/plan/tasks/${key}.md`);
    process.exit(ok && !todo ? 0 : 1);
  }

  if (!ok || todo) {
    console.log('\n✗ cannot open: fix the above first');
    process.exit(1);
  }

  const outcome = runOpen({ key, body, bodyFile: bodyPath, dryRun: DRY, push: pushBranch });
  if (!outcome.ok) {
    for (const p of outcome.problems ?? []) console.log(`✗ ${p}`);
    process.exit(1);
  }
  if (outcome.dryRun) {
    for (const s of outcome.steps) console.log(s);
    process.exit(0);
  }
  result = mergeResult(result, { pr: outcome.number });
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`✓ opened PR #${outcome.number}, moved ${key} to In Review`);
  process.exit(0);
}
