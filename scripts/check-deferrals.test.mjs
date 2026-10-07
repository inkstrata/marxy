// The deferral gate must fail on landed or keyless markers and ignore tests and testing/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  findDeferrals,
  landedKeys,
  checkDeferrals,
  isProductSource,
  isAllowlisted,
  MARKER_RE,
} from './check-deferrals.mjs';

test('a marker naming a landed key is a violation', () => {
  const deferrals = findDeferrals([
    { file: 'apps/desktop/src/app.ts', content: '// placeholder until MARXY-1\n' },
  ]);
  const landed = new Set(['MARXY-1']);
  const lines = checkDeferrals({
    deferrals,
    allowlist: [],
    landed,
    readContent: () => '',
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /landed MARXY-1/);
  assert.match(lines[0], /name the story that removes this/);
});

test('a marker with no board key is a violation', () => {
  const deferrals = findDeferrals([
    { file: 'packages/core/src/foo.ts', content: '// a later story registers this\n' },
  ]);
  const lines = checkDeferrals({
    deferrals,
    allowlist: [],
    landed: new Set(),
    readContent: () => '',
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /names no board key/);
});

test('a marker naming an unlanded key passes', () => {
  const deferrals = findDeferrals([
    { file: 'apps/desktop/src/app.ts', content: '// placeholder until MARXY-999\n' },
  ]);
  const lines = checkDeferrals({
    deferrals,
    allowlist: [],
    landed: new Set(['MARXY-1']),
    readContent: () => '',
  });
  assert.deepEqual(lines, []);
});

test('markers in tests and testing/ are ignored by the product scan', () => {
  assert.equal(isProductSource('apps/desktop/src/palette/palette.test.ts'), false);
  assert.equal(isProductSource('packages/core/testing/harness.ts'), false);
  assert.equal(isProductSource('apps/desktop/src/app.ts'), true);
  const inTest = findDeferrals([
    {
      file: 'apps/desktop/src/palette/palette.test.ts',
      content: "test('placeholder until MARXY-42', () => {});\n",
    },
  ]);
  assert.equal(inTest.length, 1, 'findDeferrals still sees text; isProductSource excludes the path');
});

test('allow-list entry whose marker is gone fails as stale', () => {
  const allowlist = [{ file: 'apps/x.ts', marker: 'placeholder until MARXY-9', removedBy: 'MARXY-10' }];
  const lines = checkDeferrals({
    deferrals: [],
    allowlist,
    landed: new Set(),
    readContent: () => '// nothing here\n',
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /stale allow-list/);
});

test('landedKeys reads squash subjects from git log', () => {
  const landed = landedKeys({
    logSubjects: () => ['feat: x (MARXY-1) (#1)', 'chore: y (MARXY-2)'],
  });
  assert.deepEqual([...landed].sort(), ['MARXY-1', 'MARXY-2']);
});

test('isAllowlisted matches file and marker substring on the hit line', () => {
  const hit = {
    file: 'apps/desktop/src-tauri/src/main.rs',
    line: 1,
    text: '/// Phase 0 placeholder until MARXY-34 registers',
    keys: ['MARXY-34'],
  };
  const allowlist = [
    { file: 'apps/desktop/src-tauri/src/main.rs', marker: 'Phase 0 placeholder until MARXY-34', removedBy: 'MARXY-194' },
  ];
  assert.ok(isAllowlisted(hit, allowlist));
});

test('adding // placeholder until MARXY-34 to apps/desktop/src/app.ts turns the check red', () => {
  const app = readFileSync('apps/desktop/src/app.ts', 'utf8');
  const mutated = `// placeholder until MARXY-34\n${app}`;
  const deferrals = findDeferrals([{ file: 'apps/desktop/src/app.ts', content: mutated }]);
  const landed = landedKeys({ logSubjects: () => ['feat: shell (MARXY-34) (#24)'] });
  const lines = checkDeferrals({
    deferrals,
    allowlist: JSON.parse(readFileSync('scripts/allowlists/deferrals.json', 'utf8')),
    landed,
    readContent: f => (f === 'apps/desktop/src/app.ts' ? mutated : readFileSync(f, 'utf8')),
  });
  assert.ok(lines.some(l => l.includes('apps/desktop/src/app.ts') && /MARXY-34/.test(l)));
});

test('node scripts/check-deferrals.mjs is green on the committed tree', () => {
  const run = spawnSync(process.execPath, ['scripts/check-deferrals.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /deferrals ok/);
});

test('pnpm check runs the deferrals check, and precheck runs pnpm check for every change', () => {
  assert.match(readFileSync('scripts/check.mjs', 'utf8'), /check-deferrals\.mjs/);
  assert.ok(JSON.parse(readFileSync('scripts/gates-by-path.json', 'utf8')).always.includes('check'));
});

test('MARKER_RE matches the documented phrases case-insensitively', () => {
  assert.ok(MARKER_RE.test('Placeholder until MARXY-1'));
  assert.ok(MARKER_RE.test('later story wires'));
  assert.ok(MARKER_RE.test('not yet wired'));
});

const run = (content, { landed = new Set(), allowlist = [] } = {}) =>
  checkDeferrals({
    deferrals: findDeferrals([{ file: 'apps/desktop/src/app.ts', content }]),
    allowlist,
    landed,
    readContent: () => content,
  });

test('a marker naming a story id passes, with or without a sub-story', () => {
  assert.deepEqual(run('// placeholder until B-13\n'), []);
  assert.deepEqual(run('// placeholder until A-14.1 wires it.\n'), []);
  assert.deepEqual(run('// a later story (A-07) registers this\n'), []);
});

test('a marker naming a malformed story id is a violation', () => {
  for (const bad of ['b-13', 'B-1', 'F-01', 'B-123']) {
    const lines = run(`// placeholder until ${bad}\n`);
    assert.equal(lines.length, 1, bad);
    assert.match(lines[0], /names no board key/, bad);
  }
});

test('a marker naming a landed story id is a violation', () => {
  const landed = landedKeys({ logSubjects: () => ['feat(core): x (B-13) (#9)', 'fix: y (A-14.1)'] });
  assert.deepEqual([...landed].sort(), ['A-14.1', 'B-13']);
  assert.match(run('// placeholder until B-13\n', { landed })[0], /landed B-13/);
  assert.match(run('// placeholder until A-14.1\n', { landed })[0], /landed A-14\.1/);
});

test('a story-id marker is allow-listed the same way a MARXY- key is', () => {
  const content = '// a later story wires B-13 in\n';
  const landed = new Set(['B-13']);
  assert.equal(run(content, { landed }).length, 1);
  const allowlist = [{ file: 'apps/desktop/src/app.ts', marker: 'a later story wires B-13', removedBy: 'B-14' }];
  assert.deepEqual(run(content, { landed, allowlist }), []);
});
