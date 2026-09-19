// Fixture-board runner and docs checks for the review-order computer (MARXY-80).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeOrder, PhaseError, realReadCount } from '../review-order.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const BOARD_DIR = join(here, 'review-order');
const DEFAULT_NOW = '2026-09-18T12:00:00.000Z';
const DEFAULT_CREATED = '2026-09-17T12:00:00.000Z';
const REQUIRED_BOARDS = [
  'sort: phase decides while disturbs, ageHours and key would not',
  'sort: disturbs decides while phase ties',
  'sort: ageHours decides while phase and disturbs tie',
  'sort: key decides while phase, disturbs and ageHours tie',
  'conflict: DIRTY with mergeable not CONFLICTING appears only in excluded, with why naming the conflict',
];

function expandStory(rec) {
  if (rec == null) return { status: 'in_review' };
  if (typeof rec === 'number') return { status: 'in_review', pr: rec };
  return rec;
}

function expandPull(rec) {
  const files = Array.isArray(rec) ? rec : rec.files;
  return {
    files,
    mergeStateStatus: rec.mergeStateStatus ?? 'CLEAN',
    mergeable: rec.mergeable ?? 'MERGEABLE',
    createdAt: rec.createdAt ?? DEFAULT_CREATED,
  };
}

function expandBoard(raw) {
  return {
    name: raw.name,
    now: raw.now ?? DEFAULT_NOW,
    deps: raw.deps?.phases ? raw.deps : { phases: raw.deps || {} },
    state: {
      stories: Object.fromEntries(
        Object.entries(raw.stories || raw.state?.stories || {}).map(([k, v]) => [k, expandStory(v)]),
      ),
    },
    pulls: Object.fromEntries(Object.entries(raw.pulls || {}).map(([k, v]) => [k, expandPull(v)])),
    expect: raw.expect || {},
  };
}

function matchFields(got, expect) {
  for (const [k, v] of Object.entries(expect)) {
    if (got[k] !== v) return `${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(v)}`;
  }
  return null;
}

function runBoard(raw) {
  const board = expandBoard(raw);
  const readPr = pr => {
    const rec = board.pulls[String(pr)] ?? board.pulls[pr];
    if (!rec) throw new Error(`no fixture pull ${pr}`);
    return rec;
  };
  try {
    const got = computeOrder({ s: board.state, d: board.deps, readPr, now: Date.parse(board.now) });
    if (board.expect.exit === 1) return { ok: false, detail: 'exited 0, want 1' };
    const exp = board.expect;
    if (exp.orderKeys) {
      const keys = got.order.map(r => r.key);
      if (JSON.stringify(keys) !== JSON.stringify(exp.orderKeys)) {
        return { ok: false, detail: `order ${JSON.stringify(keys)}, want ${JSON.stringify(exp.orderKeys)}` };
      }
    }
    for (const want of exp.order || []) {
      const row = got.order.find(r => r.key === want.key);
      if (!row) return { ok: false, detail: `${want.key} missing from order` };
      const miss = matchFields(row, want);
      if (miss) return { ok: false, detail: `${want.key} ${miss}` };
    }
    for (const want of exp.excluded || []) {
      const row = got.excluded.find(r => r.key === want.key);
      if (!row) return { ok: false, detail: `${want.key} missing from excluded` };
      if (want.why && !String(row.why).includes(want.why)) {
        return { ok: false, detail: `${want.key} why ${JSON.stringify(row.why)}, want ${JSON.stringify(want.why)}` };
      }
      if (want.notInOrder && got.order.some(r => r.key === want.key)) {
        return { ok: false, detail: `${want.key} is in order; a conflicted PR must not be` };
      }
    }
    for (const key of exp.notInOrder || []) {
      if (got.order.some(r => r.key === key)) return { ok: false, detail: `${key} must not appear in order` };
    }
    for (const key of exp.notListed || []) {
      if (got.order.some(r => r.key === key) || got.excluded.some(r => r.key === key)) {
        return { ok: false, detail: `${key} must not appear in order or excluded` };
      }
    }
    return { ok: true, got };
  } catch (e) {
    if (board.expect.exit === 1) {
      const needle = board.expect.errorIncludes;
      if (needle && !String(e.message).includes(needle)) {
        return { ok: false, detail: `error ${JSON.stringify(e.message)}, want ${JSON.stringify(needle)}` };
      }
      if (!(e instanceof PhaseError)) return { ok: false, detail: `threw ${e.name || e.constructor.name}, want PhaseError` };
      return { ok: true };
    }
    return { ok: false, detail: e.message };
  }
}

/** Named cases for `node orchestration/review-order.mjs --selftest`. Returns the process exit code. */
export function selftest() {
  let bad = 0;
  let ran = 0;
  const names = [];
  const report = (ok, name, detail) => {
    ran += 1;
    names.push(name);
    if (ok) console.log(`selftest ok: ${name}`);
    else {
      bad += 1;
      console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  for (const file of readdirSync(BOARD_DIR).filter(f => f.endsWith('.json')).sort()) {
    const board = JSON.parse(readFileSync(join(BOARD_DIR, file), 'utf8'));
    const { ok, detail } = runBoard(board);
    report(ok, board.name || file, detail);
  }
  for (const name of REQUIRED_BOARDS) {
    report(names.includes(name), `required board is present: ${name}`, names.includes(name) ? null : 'missing');
  }

  const source = readFileSync(join(root, 'orchestration/review-order.mjs'), 'utf8');
  const readerSrc = (source.match(/export function readPullRequest[\s\S]*?\nexport /) || [''])[0];
  const token = ["'", 'gh', "'"].join('');
  const ghInFile = source.split(token).length - 1;
  const ghInReader = readerSrc.split(token).length - 1;
  report(
    ghInReader === 1 && ghInFile === 1 && !source.includes('fetch(') && !/\bhttps\b/.test(source),
    'GitHub is read through exactly one injectable function',
    `gh in file=${ghInFile} in reader=${ghInReader}`,
  );
  report(realReadCount() === 0, 'selftest: the real GitHub reader is called zero times and makes no network request', `realReadCount=${realReadCount()}`);

  const sdlc = readFileSync(join(root, 'docs/sdlc.md'), 'utf8');
  const section = '## Review order and the review WIP limit';
  const chunk = sdlc.includes(section) ? sdlc.split(section)[1].split('\n## ')[0] : '';
  report(sdlc.includes(section), 'docs: sdlc.md has the Review order section');
  report(/phase/i.test(chunk) && /disturb/i.test(chunk) && /age/i.test(chunk) && /descend/i.test(chunk), 'docs: the section states the three sort keys and why disturbance is descending');
  report(/conflicted/i.test(chunk) && /returned rather than queued/i.test(chunk), 'docs: a conflicted PR is returned rather than queued');
  report(/does not count against the review WIP/i.test(chunk) && /same unit of work/i.test(chunk), 'docs: a returned story does not count against the review WIP');
  report(/original age/i.test(chunk) && /not at the\s+head/i.test(chunk), 'docs: a returned story re-enters at its own phase, disturbance and original age');

  const adr = readFileSync(join(root, 'docs/adr/0025-review-order-and-review-wip.md'), 'utf8');
  const adrIndex = readFileSync(join(root, 'docs/adr/README.md'), 'utf8');
  report(/\*\*Status:\*\*\s*accepted/i.test(adr), 'docs: ADR-0025 is accepted');
  report(/\[0025\]\(0025-review-order-and-review-wip\.md\).*\baccepted\b/.test(adrIndex), 'docs: ADR-0025 is listed in docs/adr/README.md');
  const unreleased = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split('## Unreleased')[1]?.split('\n## ')[0] || '';
  report(/MARXY-80/.test(unreleased), 'docs: CHANGELOG.md has a MARXY-80 line under Unreleased');

  if (ran < 12) {
    bad += 1;
    console.error(`selftest FAIL: case count ${ran} is below 12`);
  }
  if (bad) {
    console.error(`review-order selftest failed: ${bad} case(s)`);
    return 1;
  }
  console.log(`review-order selftest ok: ${ran} named cases`);
  return 0;
}

test('review-order --selftest is green and prints a case count of at least 12', () => {
  const r = spawnSync(process.execPath, ['orchestration/review-order.mjs', '--selftest'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const m = /review-order selftest ok: (\d+) named cases/.exec(r.stdout);
  assert.ok(m, r.stderr || r.stdout);
  assert.ok(Number(m[1]) >= 12, `case count ${m[1]} is below 12`);
});

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked && process.argv.includes('--run-selftest')) process.exit(selftest());
