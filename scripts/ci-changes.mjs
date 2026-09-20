// Change detection for CI: which categories of file changed between the base and HEAD, so jobs that
// cannot be affected are skipped, and whether the macOS/Linux gates jobs can reuse a prior real
// dual-OS success instead of rebuilding the desktop binary (MARXY-105). Writes GITHUB_OUTPUT and
// prints a line.
//
// usage:
//   node scripts/ci-changes.mjs <base-ref>   phase 1: classify base...HEAD, compute the gates hash
//   node scripts/ci-changes.mjs --resolve    phase 2: read the cache-restored record, decide `gates`
//   node scripts/ci-changes.mjs --selftest   pure-function and workflow-shape checks; no network
import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = `${ROOT}results`;
const STATE_PATH = `${RESULTS_DIR}/ci-changes.json`;
const RECORD_PATH = `${RESULTS_DIR}/gates-record.json`;
const WORKFLOW_PATH = `${ROOT}.github/workflows/ci.yml`;

const isDoc = f => /^(docs\/|orchestration\/|\.cursor\/|\.githooks\/|README\.md$|CONTRIBUTING\.md$|CHANGELOG\.md$|AGENTS\.md$|LICENSE$|\.editorconfig$|\.gitattributes$|fonts\/.*\/(LICENSE|README)|docs\/.*\.png$)/.test(f) || (/\.md$/.test(f) && !f.startsWith('fixtures/'));

// Unchanged from before MARXY-105: which broad categories a diff touches, so `fast` and `browser`
// keep skipping exactly as they did. `docs_only` is also "not-required" for the gates decision below.
export function classify(files) {
  const workflow = files.some(f => f.startsWith('.github/'));
  const rust = files.some(f => f.startsWith('apps/desktop/src-tauri/'));
  const web = files.some(f => /^(packages\/|apps\/desktop\/(src|index\.html|vite\.config|package\.json|scripts)|fixtures\/|scripts\/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|mise\.toml)/.test(f));
  const docs_only = !workflow && !rust && !web && files.length > 0 && files.every(isDoc);
  return { docs_only, web: web || workflow, rust: rust || workflow, workflow };
}

// Whether the macOS and Linux gates jobs need to run again. Pure — driven only by `docsOnly` (this
// PR's own base...HEAD diff), `currentHash` (this push's gates-relevant content hash) and `record`
// (whatever a content-hash-keyed cache restored, or null on a miss) — so --selftest never touches
// git, the cache action or the network (criterion 1).
//
// `record` shapes, all written by the workflow rather than this function:
//   { status: 'success', dualOS: true, hash }   a real build measured clean on both runner classes
//   { status: 'stand-in', hash }                a gates run that was itself skipped; not proof of anything
//   { status: 'in-progress', hash }              a real build for this exact content has not finished
// The cache is keyed by hash, so a mismatch should not happen — `record.hash` is checked again here
// anyway, so a record left over from a different push (a stale one, criterion 3) cannot be reused by
// mistake even if the wiring around this function is ever wrong. A record this function does not
// recognise, or one whose hash does not match, is treated the same as "must run": reuse is opt-in,
// never opt-out by default.
export function decideGates({ docsOnly, currentHash, record }) {
  if (docsOnly) return { gates: false, reason: 'not-required' };
  const relevant = record && (currentHash == null || record.hash === currentHash) ? record : null;
  if (relevant?.status === 'success' && relevant.dualOS === true) return { gates: false, reason: 'reuse' };
  if (relevant?.status === 'stand-in') return { gates: true, reason: 'refuse-stand-in' };
  if (relevant?.status === 'in-progress') return { gates: true, reason: 'in-progress' };
  return { gates: true, reason: relevant ? 'unrecognised-record' : record ? 'stale-record' : 'no-record' };
}

// The paths whose content decides the built binary and the numbers measured against it. Identical
// content has either already been proven clean on both runner classes or is in the process of being
// proven, whichever branch it first arrived on — a rust, measure-startup or ci.yml change always
// changes this hash, because each lives under one of these paths (criterion 3).
export const GATES_HASH_PATHS = ['apps/desktop', 'packages', 'fixtures', 'scripts', '.github/workflows/ci.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'mise.toml'];

// Pure over the ls-tree text, so --selftest can drive it with a fixed string instead of running git.
export function hashTree(lsTreeText) {
  return createHash('sha256').update(lsTreeText).digest('hex').slice(0, 16);
}

function gitDiffNames(a, b) {
  try { return execSync(`git diff --name-only ${a}...${b}`, { encoding: 'utf8' }).split('\n').filter(Boolean); }
  catch { try { return execSync(`git diff --name-only ${a} ${b}`, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return ['<unknown>']; } }
}

function writeOutputs(out) {
  if (process.env.GITHUB_OUTPUT) for (const [k, v] of Object.entries(out)) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}

// Phase 1: classify the diff and compute the gates hash from the working tree — no knowledge yet of
// whether a matching record exists, because the cache lookup that fills one is a separate workflow
// step that runs after this one and needs `gates_hash` as its key.
function phaseDetect(base) {
  const files = gitDiffNames(base, 'HEAD');
  const { docs_only, web, rust, workflow } = classify(files);
  let gates_hash = 'unknown';
  try { gates_hash = hashTree(execSync(`git ls-tree -r HEAD -- ${GATES_HASH_PATHS.join(' ')}`, { encoding: 'utf8' })); }
  catch { /* a shallow or unusual checkout still gets a (docs_only-gated) decision; it just cannot reuse */ }
  writeOutputs({ docs_only, web, rust, workflow, gates_hash, changed: files.length });
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify({ docs_only, gates_hash })}\n`);
  console.log(`ci-changes: ${JSON.stringify({ docs_only, web, rust, workflow, gates_hash, changed: files.length })}${docs_only ? ' — docs only: build and browser jobs are skipped' : ''}`);
}

// Phase 2: read back phase 1's state and whatever the cache-restore step left at RECORD_PATH (absent
// on a miss), and write the final `gates` output.
function phaseResolve() {
  const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : null;
  const record = existsSync(RECORD_PATH) ? JSON.parse(readFileSync(RECORD_PATH, 'utf8')) : null;
  const docsOnly = state ? state.docs_only : false; // no phase-1 state on disk: err toward running the real jobs
  const currentHash = state ? state.gates_hash : null;
  const { gates, reason } = decideGates({ docsOnly, currentHash, record });
  writeOutputs({ gates });
  console.log(`ci-changes --resolve: gates=${gates} (${reason})`);
}

// Structural checks over .github/workflows/ci.yml itself, so the mechanism this story adds cannot
// silently drift: the real gates job's `if:`, the sibling that posts the same check names when it is
// skipped, the workflow-level concurrency block, and the job/matrix names branch protection has ever
// been told about. Reused by --selftest and its own mutation cases (criteria 2, 4, 6).
export function checkCiWorkflow(text) {
  const errors = [];
  const gatesJob = text.match(/\n  gates:\n([\s\S]*?)(?=\n  \S)/);
  const gatesBody = gatesJob ? gatesJob[1] : '';
  if (!/^\s*if:\s*needs\.changes\.outputs\.gates == 'true'\s*$/m.test(gatesBody)) {
    errors.push(".github/workflows/ci.yml: the gates job's if: is not exactly \"needs.changes.outputs.gates == 'true'\"");
  }
  if (/^    name:/m.test(gatesBody)) {
    errors.push('.github/workflows/ci.yml: the gates job carries its own job-level name:, which would change the check names it posts');
  }
  const gatesOsMatch = gatesBody.match(/os:\s*\[([^\]]+)\]/);
  const gatesOs = gatesOsMatch ? gatesOsMatch[1].split(',').map(s => s.trim()) : [];
  if (gatesOs.join(',') !== 'macos-latest,ubuntu-latest') {
    errors.push(`.github/workflows/ci.yml: the gates job matrix is ${JSON.stringify(gatesOs)}, expected [macos-latest, ubuntu-latest] (criterion 6)`);
  }

  const skipJob = text.match(/\n  gates-skip:\n([\s\S]*?)(?=\n  \S)/);
  if (!skipJob) {
    errors.push('.github/workflows/ci.yml: no gates-skip job posts the same check names when gates is skipped');
  } else {
    const body = skipJob[1];
    if (!/^\s*if:\s*needs\.changes\.outputs\.gates != 'true'\s*$/m.test(body)) {
      errors.push("gates-skip: if: is not exactly \"needs.changes.outputs.gates != 'true'\" (the exact negation of gates')");
    }
    if (!/^\s*name:\s*gates\s*$/m.test(body)) {
      errors.push('gates-skip: name: is not exactly "gates", so it would not post the same check names as the real job');
    }
    // gates-skip writes its matrix one value per line (see the comment above it in ci.yml) so its
    // otherwise-identical values do not collide with the flow-style line scripts/gate-perf.mjs greps
    // for; accept either shape here.
    const skipOsFlow = body.match(/os:\s*\[([^\]]+)\]/);
    const skipOsBlock = [...body.matchAll(/^\s+-\s*(macos-latest|ubuntu-latest|windows-latest)\s*$/gm)].map(m => m[1]);
    const skipOs = skipOsFlow ? skipOsFlow[1].split(',').map(s => s.trim()) : skipOsBlock;
    if (skipOs.join(',') !== gatesOs.join(',')) {
      errors.push(`gates-skip: matrix os is ${JSON.stringify(skipOs)}, must match the real gates job's ${JSON.stringify(gatesOs)}`);
    }
  }

  const concurrency = text.match(/^concurrency:\n([\s\S]*?)(?=^\S)/m);
  const concurrencyBody = concurrency ? concurrency[1] : '';
  if (!/group:\s*"ci-\$\{\{\s*github\.ref\s*\}\}"/.test(concurrencyBody)) {
    errors.push('.github/workflows/ci.yml: workflow-level concurrency.group is not exactly "ci-${{ github.ref }}"');
  }
  if (!/cancel-in-progress:\s*true/.test(concurrencyBody)) {
    errors.push('.github/workflows/ci.yml: workflow-level concurrency.cancel-in-progress is not true');
  }
  const otherConcurrency = [...text.matchAll(/^\s*concurrency:/gm)];
  if (otherConcurrency.length !== 1) {
    errors.push(`.github/workflows/ci.yml: expected exactly one concurrency: block, found ${otherConcurrency.length} (a per-job group would let the reuse mechanism race a cancellation)`);
  }

  for (const id of ['changes', 'conventions', 'fast', 'browser', 'gates', 'ci']) {
    if (!new RegExp(`^  ${id}:$`, 'm').test(text)) errors.push(`.github/workflows/ci.yml: job "${id}" is missing (criterion 6: required check names are not changed)`);
  }
  const ciJob = text.match(/\n  ci:\n([\s\S]*?)(?=\n  \S|$)/);
  const ciNeedsMatch = ciJob ? ciJob[1].match(/needs:\s*\[([^\]]*)\]/) : null;
  const ciNeeds = ciNeedsMatch ? ciNeedsMatch[1].split(',').map(s => s.trim()) : [];
  if (!ciNeeds.includes('gates')) {
    errors.push('.github/workflows/ci.yml: the ci job no longer needs gates');
  }
  if (/continue-on-error/.test(text)) errors.push('.github/workflows/ci.yml: continue-on-error appears in the workflow');
  return errors;
}

function selftest() {
  let bad = 0;
  let ran = 0;
  const report = (ok, name, detail) => { ran++; if (ok) console.log(`selftest ok: ${name}`); else { bad++; console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`); } };

  // --- classify() / docs_only, unchanged behaviour ---------------------------------------------
  report(classify(['docs/foo.md']).docs_only === true, 'classify: a docs-only diff is docs_only');
  report(classify(['apps/desktop/src-tauri/src/main.rs']).docs_only === false, 'classify: a rust diff is not docs_only');
  report(classify(['.github/workflows/ci.yml']).docs_only === false, 'classify: a workflow diff is not docs_only');
  report(classify(['.github/notes.md']).docs_only === false, 'classify: an .md file under .github/ is still workflow, not docs_only');

  // --- decideGates(): the four named scenarios (criterion 1) --------------------------------------
  report(
    decideGates({ docsOnly: true, record: null }).gates === false,
    'decideGates: not-required — a docs-only diff never runs gates, with or without a record',
  );
  report(
    decideGates({ docsOnly: true, record: { status: 'success', dualOS: true } }).gates === false,
    'decideGates: not-required wins even over a present record',
  );
  report(
    decideGates({ docsOnly: false, record: { status: 'success', dualOS: true } }).gates === false,
    'decideGates: reuse of a real dual-OS success skips gates',
  );
  report(
    decideGates({ docsOnly: false, record: { status: 'success', dualOS: false } }).gates === true,
    'decideGates: a "success" that was not proven on both OSes is not reusable',
  );
  report(
    decideGates({ docsOnly: false, record: { status: 'stand-in' } }).gates === true,
    'decideGates: refusal to reuse a stand-in success',
  );
  report(
    decideGates({ docsOnly: false, record: { status: 'in-progress' } }).gates === true,
    'decideGates: in-progress is not reusable — run rather than gamble on an unfinished result',
  );
  report(
    decideGates({ docsOnly: false, record: null }).gates === true,
    'decideGates: no record at all still runs gates',
  );
  report(
    decideGates({ docsOnly: false, record: { status: 'something-else' } }).gates === true,
    'decideGates: an unrecognised record status is treated as must-run, not as permission',
  );
  for (const [name, reason] of [['not-required', 'not-required'], ['reuse', 'reuse'], ['refuse-stand-in', 'refuse-stand-in'], ['in-progress', 'in-progress']]) {
    const inputs = {
      'not-required': { docsOnly: true, record: null },
      reuse: { docsOnly: false, record: { status: 'success', dualOS: true } },
      'refuse-stand-in': { docsOnly: false, record: { status: 'stand-in' } },
      'in-progress': { docsOnly: false, record: { status: 'in-progress' } },
    }[name];
    report(decideGates(inputs).reason === reason, `decideGates: reason for "${name}" is named "${reason}"`);
  }

  // --- criterion 3: rust / measure-startup(web) / ci.yml still set gates=true ---------------------
  for (const files of [['apps/desktop/src-tauri/src/lib.rs'], ['scripts/measure-startup.mjs'], ['.github/workflows/ci.yml']]) {
    const { docs_only } = classify(files);
    report(
      decideGates({ docsOnly: docs_only, currentHash: 'after', record: null }).gates === true,
      `criterion 3: ${files[0]} still sets gates=true with no record`,
      docs_only ? 'classify() marked it docs_only, which cannot be right' : undefined,
    );
    // The change moved the content, so any cached success necessarily belongs to the hash it had
    // *before* this change — a stale record the change detection must not reuse.
    report(
      decideGates({ docsOnly: docs_only, currentHash: 'after', record: { status: 'success', dualOS: true, hash: 'before' } }).gates === true,
      `criterion 3: ${files[0]} still sets gates=true even if a stale (mismatched-hash) reuse record is present`,
    );
  }

  // --- hashTree(): pure and stable, no git --------------------------------------------------------
  report(hashTree('a\nb\n') === hashTree('a\nb\n'), 'hashTree: deterministic for identical input');
  report(hashTree('a\nb\n') !== hashTree('a\nb\nc\n'), 'hashTree: different input, different hash');
  report(/^[0-9a-f]{16}$/.test(hashTree('x')), 'hashTree: a 16-hex-char digest');

  // --- checkCiWorkflow(): the workflow shape this story adds, plus mutation cases -----------------
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  const realErrors = checkCiWorkflow(workflow);
  report(realErrors.length === 0, 'workflow: ci.yml satisfies the MARXY-105 shape', realErrors.join('; '));

  for (const [what, mutated] of [
    ["gates' if: widened to always run", workflow.replace("if: needs.changes.outputs.gates == 'true'", "if: true")],
    ['gates-skip job removed entirely', workflow.replace(/\n  gates-skip:\n[\s\S]*?(?=\n  \S)/, '\n')],
    ['gates-skip name does not match the real job', workflow.replace('name: gates\n', 'name: gates-skip\n')],
    ['gates-skip matrix drops macos-latest', workflow.replace(/(gates-skip:[\s\S]*?os:\n)(\s+- macos-latest\n)/, '$1')],
    ['workflow concurrency cancel-in-progress turned off', workflow.replace('cancel-in-progress: true', 'cancel-in-progress: false')],
    ['workflow concurrency group narrowed to a per-job scope', workflow.replace('group: "ci-${{ github.ref }}"', 'group: "ci-${{ github.job }}-${{ github.ref }}"')],
    ['a second concurrency block added', workflow.replace('\njobs:\n', '\nconcurrency:\n  group: "extra"\n  cancel-in-progress: true\njobs:\n')],
    ['the gates job matrix drops a runner class (criterion 6)', workflow.replace(/(\n  gates:\n[\s\S]*?os:\s*\[)macos-latest, ubuntu-latest(\])/, '$1ubuntu-latest$2')],
    ['the ci job stops needing gates', workflow.replace('needs: [changes, conventions, fast, browser, gates, gates-skip, gates-record]', 'needs: [changes, conventions, fast, browser, gates-skip, gates-record]')],
  ]) {
    const errs = checkCiWorkflow(mutated);
    report(errs.length > 0, `workflow: ${what} is rejected`, errs.length ? undefined : 'checkCiWorkflow() found nothing wrong');
  }

  // --- criterion 5: this PR's own diff does not touch gate-perf.mjs, and it still passes ----------
  try {
    const threeDot = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8', cwd: ROOT }).split('\n').filter(Boolean);
    report(!threeDot.includes('scripts/gate-perf.mjs'), 'criterion 5: the three-dot diff does not touch scripts/gate-perf.mjs', threeDot.join(', '));
  } catch { report(true, 'criterion 5: origin/main is unavailable in this checkout; skipped rather than falsely failed'); }

  // --- criterion 1, restated: this whole selftest never shells to a network-facing command --------
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const selftestBody = src.slice(src.indexOf('function selftest()'));
  report(!/\bgh\s|fetch\(|https?:\/\//.test(selftestBody), 'selftest: no network-facing call appears in the selftest body');

  if (ran < 25) { bad++; console.error(`selftest FAIL: ${ran} named cases, which must be at least 25`); }
  if (bad) { console.error(`ci-changes selftest failed: ${bad} case(s)`); process.exit(1); }
  console.log(`ci-changes selftest ok: ${ran} named cases`);
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
else if (args.includes('--resolve')) phaseResolve();
else phaseDetect(args[0]);
