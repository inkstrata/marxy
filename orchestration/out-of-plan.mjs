// Out-of-plan work in one pull request (MARXY-190): a key, a worktree, and the change's own board row.
//
//   node orchestration/out-of-plan.mjs start "summary" --paths "a, b" --acceptance "1. …" [--type chore]
//                                          [--phase ops|0-4] [--deps MARXY-1,MARXY-2] [--why "…"] [--dry-run]
//   node orchestration/out-of-plan.mjs row MARXY-n --paths "a, b" --acceptance "1. …" [--summary "…"]
//                                          [--phase ops|0-4] [--deps …] [--why "…"]
//
// `start` creates the Jira Task, cuts `../marxy-wt/KEY` on `type/KEY-slug` from origin/main, and writes
// the row there. `row` writes (or updates) the row for a key in the current branch — for a branch that
// already exists. Either way the row travels in the same PR as the work, the cycle adopts the PR when
// it opens, and the merge bar judges it against that row (scripts/lib/own-row.mjs). No second PR.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, parseCsv, slug } from './lib.mjs';

/** The epic each numbered phase's stories sit under; the ops lane sits under Phase 0's, as it always has. */
export const PHASE_EPIC = { ops: 'MARXY-4', 0: 'MARXY-4', 1: 'MARXY-18', 2: 'MARXY-32', 3: 'MARXY-40', 4: 'MARXY-50' };
const COLUMNS = ['Key', 'Type', 'Summary', 'Epic', 'Parent', 'Labels', 'Paths', 'Description', 'Acceptance'];
const TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'perf', 'test', 'ci', 'build'];

const cell = v => (/[",\n\r]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));

/** The row an out-of-plan change carries, as a parsed-row object. */
export function outOfPlanRow({ key, summary, phase = 'ops', paths, acceptance, why }) {
  if (!/^MARXY-\d+$/.test(key ?? '')) throw new Error(`not a Jira key: ${key}`);
  if (!String(paths ?? '').trim()) throw new Error('--paths is required: the files this change may touch');
  if (!String(acceptance ?? '').trim()) throw new Error('--acceptance is required: how a machine checks it is done (docs/sdlc.md, definition of ready)');
  if (!(String(phase) in PHASE_EPIC)) throw new Error(`--phase must be one of ${Object.keys(PHASE_EPIC).join(', ')}`);
  return {
    Key: key, Type: 'Story', Summary: summary ?? key, Epic: '', Parent: PHASE_EPIC[phase],
    // no-dispatch: this work arrives with its own PR; ready.mjs never sends an implementor after it.
    Labels: `${phase === 'ops' ? 'ops' : `phase-${phase}`},out-of-plan,no-dispatch`,
    Paths: String(paths).split(',').map(s => s.trim()).filter(Boolean).join(', '),
    Description: why ?? summary ?? '', Acceptance: acceptance,
  };
}

/**
 * The CSV text with `row` appended, or with the existing row for its key replaced in place. Every
 * other line is left byte for byte as it was, so the diff is the one row.
 */
export function upsertRow(csvText, row) {
  const line = COLUMNS.map(c => cell(row[c])).join(',');
  const lines = csvText.split('\n');
  // A row can span lines when a quoted cell holds a newline; find the key's line by parsing.
  const index = parseCsv(csvText).findIndex(r => r.Key === row.Key);
  if (index < 0) return csvText.replace(/\n?$/, '\n') + line + '\n';
  let seen = -1, start = -1, end = -1, quoted = false;
  for (let i = 1, begin = 1; i < lines.length; i++) {
    for (const ch of lines[i]) if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    seen++;
    if (seen === index) { start = begin; end = i; break; }
    begin = i + 1;
  }
  if (start < 0) throw new Error(`could not locate ${row.Key}'s line`);
  return [...lines.slice(0, start), line, ...lines.slice(end + 1)].join('\n');
}

/** deps.json with `key` in exactly one phase and its dependency list set. */
export function withDeps(d, key, phase = 'ops', dependsOn = []) {
  const next = structuredClone(d);
  next.phases ??= {};
  for (const keys of Object.values(next.phases)) {
    const i = (keys ?? []).indexOf(key);
    if (i >= 0) keys.splice(i, 1);
  }
  (next.phases[String(phase)] ??= []).push(key);
  next.deps ??= {};
  next.deps[key] = [...dependsOn];
  return next;
}

/** Write the row and the deps entry into the checkout at `root`. */
export function writeBoard(root, opts) {
  const csvPath = join(root, 'docs/plan/jira-issues.csv');
  const depsPath = join(root, 'orchestration/deps.json');
  const row = outOfPlanRow(opts);
  writeFileSync(csvPath, upsertRow(readFileSync(csvPath, 'utf8'), row));
  const d = JSON.parse(readFileSync(depsPath, 'utf8'));
  writeFileSync(depsPath, JSON.stringify(withDeps(d, opts.key, opts.phase ?? 'ops', opts.deps ?? []), null, 2) + '\n');
  return row;
}

/** The checkout that owns the git directory: story worktrees sit beside it in `marxy-wt/`. */
function mainCheckout(root = ROOT) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  return dirname(common);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const NEXT = (key, wt) => `
Next, in ${wt}:
  1. do the work; add a CHANGELOG.md line ending (${key})
  2. commit with the key in the subject: type(scope): subject (${key})
  3. pnpm done ${key}            # boundary + precheck, drafts results/${key}.pr.md
  4. fill the TODOs, then: pnpm done ${key} --open   # pushes, opens the PR, links Jira
The cycle adopts the PR when it opens (In Review) and lands it once a reviewer signs it.`;

function run(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  const o = parseArgs(rest);
  const opts = { summary: o.summary, phase: o.phase ?? 'ops', paths: o.paths, acceptance: o.acceptance, why: o.why,
    deps: (o.deps ?? '').split(',').map(s => s.trim()).filter(Boolean) };
  if (cmd === 'row') {
    const key = o._[0];
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (branch === 'main') { console.error('✗ refusing to write a board row on main: run this in the branch that does the work'); process.exit(2); }
    if (!branch.includes(key ?? '\0')) console.error(`· branch ${branch} does not name ${key}; check-story --strict reads the key from the branch`);
    const existing = parseCsv(readFileSync(join(ROOT, 'docs/plan/jira-issues.csv'), 'utf8')).find(r => r.Key === key);
    const row = writeBoard(ROOT, { ...opts, key, summary: opts.summary ?? existing?.Summary });
    console.log(`${key}: row written (${row.Labels}; paths ${row.Paths})`);
    return;
  }
  if (cmd === 'start') {
    const summary = o._[0];
    const type = o.type ?? 'chore';
    if (!summary) { console.error('usage: out-of-plan.mjs start "summary" --paths "…" --acceptance "…"'); process.exit(2); }
    if (!TYPES.includes(type)) { console.error(`--type must be one of ${TYPES.join(', ')}`); process.exit(2); }
    outOfPlanRow({ ...opts, key: 'MARXY-0', summary }); // validate before creating anything
    const jira = o.dryRun ? { status: 0, stdout: 'MARXY-0\n' }
      : spawnSync(process.execPath, [join(ROOT, 'orchestration/jira.mjs'), 'task', summary, opts.why ?? ''], { encoding: 'utf8' });
    const key = (jira.stdout ?? '').trim().split('\n').pop();
    if (jira.status !== 0 || !/^MARXY-\d+$/.test(key)) { console.error(`✗ jira.mjs task failed:\n${jira.stderr ?? ''}${jira.stdout ?? ''}`); process.exit(1); }
    const branch = `${type}/${key}-${slug(summary)}`;
    const wt = resolve(mainCheckout(), '..', 'marxy-wt', key);
    if (o.dryRun) {
      console.log(`[dry-run] jira task → ${key}\n[dry-run] git worktree add --no-track -b ${branch} ${wt} origin/main\n[dry-run] row: ${JSON.stringify(outOfPlanRow({ ...opts, key, summary }))}`);
      return;
    }
    if (existsSync(wt)) { console.error(`✗ ${wt} already exists`); process.exit(1); }
    execFileSync('git', ['fetch', '-q', 'origin'], { cwd: ROOT });
    execFileSync('git', ['worktree', 'add', '-q', '--no-track', '-b', branch, wt, 'origin/main'], { cwd: ROOT });
    const row = writeBoard(wt, { ...opts, key, summary });
    console.log(`${key}: ${branch} at ${wt}; row written (${row.Labels}; paths ${row.Paths})${NEXT(key, wt)}`);
    return;
  }
  console.error(`usage:
  out-of-plan.mjs start "summary" --paths "a, b" --acceptance "…" [--type chore] [--phase ops|0-4] [--deps K,K] [--why "…"] [--dry-run]
  out-of-plan.mjs row MARXY-n --paths "a, b" --acceptance "…" [--summary "…"] [--phase …] [--deps …] [--why "…"]`);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run();
