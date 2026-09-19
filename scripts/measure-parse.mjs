// Measures parse of fixtures/corpus/01-long-technical.md and writes only results/perf-parse.json
// so both gates runners feed MARXY-59 without touching the perf gate (ADR-0022).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMarkdown } from '../packages/core/src/parse/parse.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export const FIXTURE_REL = 'fixtures/corpus/01-long-technical.md';
export const SNAPSHOT_REL = 'results/perf-parse.json';
export const SNAPSHOT_KEY = 'parse_long_technical_ms';
export const FORBIDDEN_WRITE_REL = 'results/perf.json';
export const UNTOUCHED_PATHS = [
  'scripts/gate-perf.mjs',
  'fixtures/perf-budgets.json',
  'packages/core/src/parse/parse.test.ts',
];
// Same shape as the unit probe MARXY-59 will replace: a short warmup, then an odd sample so the
// median is one observation, not an average of two.
export const WARMUP_N = 25;
export const RUNS_N = 25;

export const SELFTEST_CASE_NAMES = [
  'workflow: a missing measure-parse step is rejected',
  'workflow: a measure-parse step after pnpm gate:perf is rejected',
  'workflow: a conditional measure-parse step is rejected',
  'workflow: a swallowed measure-parse step is rejected',
  'workflow: a dropped runner class is rejected',
  'snapshot: a missing snapshot is rejected',
  'snapshot: a non-numeric snapshot is rejected',
  'write: a write to results/perf.json is rejected',
  'diff: the three-dot range must not contain gate-perf, budgets, or parse.test.ts',
];

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function snapshotProblems(data) {
  if (data == null) return [`${SNAPSHOT_REL} is missing`];
  if (!(SNAPSHOT_KEY in data)) return [`${SNAPSHOT_KEY} is missing from ${SNAPSHOT_REL}`];
  const v = data[SNAPSHOT_KEY];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return [`${SNAPSHOT_KEY} is ${JSON.stringify(v)}; it must be a finite number`];
  }
  const extra = Object.keys(data).filter((k) => k !== SNAPSHOT_KEY);
  if (extra.length) {
    return [`${SNAPSHOT_REL} has extra keys ${extra.join(', ')}; write only { "${SNAPSHOT_KEY}": <median> }`];
  }
  return [];
}

export function writeTargetProblems(rel) {
  if (rel === FORBIDDEN_WRITE_REL) {
    return [`must not write ${FORBIDDEN_WRITE_REL}; that file is the startup measurement`];
  }
  if (rel !== SNAPSHOT_REL) return [`would write ${rel}; the only allowed write is ${SNAPSHOT_REL}`];
  return [];
}

export function forbiddenInDiff(names) {
  const set = new Set(names);
  return UNTOUCHED_PATHS.filter((p) => set.has(p));
}

function stepRunIs(step, cmd) {
  return new RegExp(`^\\s*run:\\s*${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(step);
}

// The measurement step is the run of measure-parse.mjs that is not --selftest. `|| true` must
// still count as that step, or swallowing the exit code looks like the step vanished.
function isMeasureStep(step) {
  return step.split('\n').some((line) => (
    /^\s*run:\s*node scripts\/measure-parse\.mjs(?!\s+--selftest)/.test(line)
  ));
}

// The parse measurement has to stay required on both runner classes and run before the gate
// that will read it. A step that can skip, swallow, or land after gate:perf is how required:true
// becomes theatre (the failure that discarded MARXY-59's first PR).
export function checkWorkflow(text) {
  const errors = [];
  const start = text.indexOf('\n  gates:');
  if (start < 0) return ['.github/workflows/ci.yml: no gates job'];
  const gates = text.slice(start);
  for (const os of ['macos-latest', 'ubuntu-latest']) {
    if (!new RegExp(`os:.*${os}`).test(gates)) {
      errors.push(`.github/workflows/ci.yml: the gates matrix does not include ${os}`);
    }
  }
  const steps = gates.split(/\n      - /).slice(1);
  const measureIdx = steps.findIndex((s) => isMeasureStep(s));
  const perfIdx = steps.findIndex((s) => stepRunIs(s, 'pnpm gate:perf'));
  if (measureIdx < 0) {
    errors.push('.github/workflows/ci.yml: no gates step runs node scripts/measure-parse.mjs');
    return errors;
  }
  if (perfIdx < 0) {
    errors.push('.github/workflows/ci.yml: no gates step runs pnpm gate:perf');
  } else if (measureIdx >= perfIdx) {
    errors.push('.github/workflows/ci.yml: node scripts/measure-parse.mjs must appear before pnpm gate:perf');
  }
  const step = steps[measureIdx];
  const head = (/^name:\s*(.+)$/m.exec(step)?.[1] ?? step.split('\n')[0]).trim();
  if (/continue-on-error/.test(step) || /\|\|\s*true/.test(step)) {
    errors.push(`.github/workflows/ci.yml: "${head}" swallows its exit code`);
  }
  if (/^\s*if:/m.test(step)) {
    errors.push(`.github/workflows/ci.yml: "${head}" is conditional, so it is not required on both runner classes`);
  }
  return errors;
}

export function measureParse(bytes, { parse = parseMarkdown, now = () => performance.now() } = {}) {
  const file = '01-long-technical.md';
  for (let i = 0; i < WARMUP_N; i++) parse(bytes, { file });
  const runs = [];
  for (let i = 0; i < RUNS_N; i++) {
    const started = now();
    parse(bytes, { file });
    runs.push(now() - started);
  }
  return median(runs);
}

export function writeSnapshot(value, { destRel = SNAPSHOT_REL, mkdir = mkdirSync, write = writeFileSync } = {}) {
  const problems = writeTargetProblems(destRel);
  if (problems.length) return { ok: false, problems };
  const record = { [SNAPSHOT_KEY]: value };
  const shape = snapshotProblems(record);
  if (shape.length) return { ok: false, problems: shape };
  const dest = join(root, destRel);
  mkdir(dirname(dest), { recursive: true });
  write(dest, `${JSON.stringify(record)}\n`);
  return { ok: true, problems: [], destRel, record };
}

function threeDotNames() {
  try {
    return execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
      encoding: 'utf8',
      cwd: root,
    }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function selftest() {
  let bad = 0;
  const report = (ok, name, detail) => {
    if (ok) console.log(`selftest ok: ${name}`);
    else {
      bad++;
      console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const measureBlock = '      - name: Parse measurement (01-long-technical.md)\n        run: node scripts/measure-parse.mjs\n';

  report(
    checkWorkflow(workflow).length === 0,
    'workflow: the shipped gates job measures parse before the perf gate on both runner classes',
    checkWorkflow(workflow).join('; '),
  );

  const missing = workflow.replace(measureBlock, '');
  report(
    checkWorkflow(missing).some((e) => /no gates step runs node scripts\/measure-parse\.mjs/.test(e)),
    SELFTEST_CASE_NAMES[0],
  );

  const late = workflow.replace(measureBlock, '').replace(
    '        run: pnpm gate:perf\n',
    `        run: pnpm gate:perf\n${measureBlock}`,
  );
  report(
    checkWorkflow(late).some((e) => /must appear before pnpm gate:perf/.test(e)),
    SELFTEST_CASE_NAMES[1],
  );

  const conditional = workflow.replace(
    measureBlock,
    '      - name: Parse measurement (01-long-technical.md)\n        if: runner.os == \'Linux\'\n        run: node scripts/measure-parse.mjs\n',
  );
  report(
    checkWorkflow(conditional).some((e) => /is conditional/.test(e)),
    SELFTEST_CASE_NAMES[2],
  );

  const swallowed = workflow.replace(
    '        run: node scripts/measure-parse.mjs\n',
    '        run: node scripts/measure-parse.mjs || true\n',
  );
  const continued = workflow.replace(
    measureBlock,
    '      - name: Parse measurement (01-long-technical.md)\n        continue-on-error: true\n        run: node scripts/measure-parse.mjs\n',
  );
  report(
    checkWorkflow(swallowed).some((e) => /swallows its exit code/.test(e))
      && checkWorkflow(continued).some((e) => /swallows its exit code/.test(e)),
    SELFTEST_CASE_NAMES[3],
  );

  const dropped = workflow.replace('os: [macos-latest, ubuntu-latest]', 'os: [ubuntu-latest]');
  report(
    checkWorkflow(dropped).some((e) => /does not include macos-latest/.test(e)),
    SELFTEST_CASE_NAMES[4],
  );

  report(snapshotProblems(null).some((e) => /is missing/.test(e)), SELFTEST_CASE_NAMES[5]);
  report(
    snapshotProblems({ [SNAPSHOT_KEY]: 'fast' }).some((e) => /finite number/.test(e))
      && snapshotProblems({ [SNAPSHOT_KEY]: Number.NaN }).some((e) => /finite number/.test(e)),
    SELFTEST_CASE_NAMES[6],
  );

  const forbiddenWrite = writeSnapshot(4.2, { destRel: FORBIDDEN_WRITE_REL });
  const allowedWrite = writeSnapshot(4.2, {
    destRel: SNAPSHOT_REL,
    mkdir() {},
    write() {},
  });
  report(
    !forbiddenWrite.ok && forbiddenWrite.problems.some((e) => /must not write results\/perf\.json/.test(e))
      && allowedWrite.ok,
    SELFTEST_CASE_NAMES[7],
    `forbidden=${JSON.stringify(forbiddenWrite.problems)} allowed=${JSON.stringify(allowedWrite.problems)}`,
  );

  const planted = forbiddenInDiff(['scripts/gate-perf.mjs', 'README.md']);
  const names = threeDotNames();
  const live = names == null ? ['could not read origin/main...HEAD'] : forbiddenInDiff(names);
  report(
    planted.length === 1 && planted[0] === 'scripts/gate-perf.mjs' && live.length === 0,
    SELFTEST_CASE_NAMES[8],
    names == null ? 'could not read origin/main...HEAD' : live.join(', ') || undefined,
  );

  if (!existsSync(join(root, FIXTURE_REL))) {
    bad++;
    console.error(`selftest FAIL: missing ${FIXTURE_REL}`);
  } else {
    const fakeNow = (() => { let t = 0; return () => { t += 2; return t; }; })();
    const ms = measureParse(new Uint8Array([0x61]), {
      parse() {},
      now: fakeNow,
    });
    report(ms === 2, 'measure: median of a constant sample is that constant', `got ${ms}`);
  }

  if (bad) {
    console.error(`measure-parse selftest failed: ${bad} case(s)`);
    process.exit(1);
  }
  console.log(`measure-parse selftest ok: ${SELFTEST_CASE_NAMES.length} named cases`);
  process.exit(0);
}

if (isMain && process.argv.includes('--selftest')) selftest();

if (isMain) {
  const fixture = join(root, FIXTURE_REL);
  if (!existsSync(fixture)) {
    console.error(`measure-parse: ${FIXTURE_REL} is missing`);
    process.exit(1);
  }
  const bytes = new Uint8Array(readFileSync(fixture));
  const ms = measureParse(bytes);
  const written = writeSnapshot(ms);
  if (!written.ok) {
    console.error('measure-parse failed:\n - ' + written.problems.join('\n - '));
    process.exit(1);
  }
  const onDisk = JSON.parse(readFileSync(join(root, SNAPSHOT_REL), 'utf8'));
  const problems = snapshotProblems(onDisk);
  if (problems.length) {
    console.error('measure-parse failed:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  console.log(`parse ${FIXTURE_REL.split('/').pop()}: ${ms} ms median → ${SNAPSHOT_REL}`);
}
