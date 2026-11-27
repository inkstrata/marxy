// `pnpm verify`: argument parsing, the change-to-test map, and the output parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allBrowserTests, catalog, changedPaths, classifyChanges, DESKTOP_UNIT_BROWSER, desktopUnitFiles, formatCounts, heavySpan, mapProblems, parseArgs, parseCounts, plan, slotCount, slotWaitSec, SUPPORT_SMOKE, table } from './verify.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const map = JSON.parse(readFileSync(join(ROOT, 'scripts/verify-map.json'), 'utf8'));
const synthetic = {
  fallback: ['smoke.test.mjs'],
  map: {
    'apps/desktop/src': ['top.test.mjs'],
    'apps/desktop/src/frame': ['frame-tabs.test.mjs', 'frame-pdf.test.mjs'],
    'apps/desktop/src/frame/model': ['model.test.mjs'],
    'apps/desktop/src-tauri': [],
    docs: [],
  },
};

test('parseArgs: defaults and every option', () => {
  const d = parseArgs([]);
  assert.equal(d.tier, 'quick');
  assert.equal(d.base, 'main');
  assert.equal(d.jobs, 1);
  const o = parseArgs(['--tier', 'changed', '--base=agent/integration', '--logs', 'C:/x', '--from', 'lint', '--only', 'lint, check', '--list', '--jobs', '3']);
  assert.equal(o.tier, 'changed');
  assert.equal(o.base, 'agent/integration');
  assert.equal(o.logs, 'C:/x');
  assert.equal(o.from, 'lint');
  assert.deepEqual(o.only, ['lint', 'check']);
  assert.equal(o.list, true);
  assert.equal(o.jobs, 3);
});

test('parseArgs: bad input is an error that says what to fix', () => {
  assert.throws(() => parseArgs(['--tier', 'huge']), /--tier must be one of quick, changed, full/);
  assert.throws(() => parseArgs(['--tier']), /--tier needs a value/);
  assert.throws(() => parseArgs(['--from', '--only', 'a']), /--from needs a value/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument --nope/);
  assert.throws(() => parseArgs(['--jobs', '0']), /--jobs/);
});

test('classifyChanges: the longest key owns a path, and its tests are chosen', () => {
  const c = classifyChanges(['apps/desktop/src/frame/model/outline.ts', 'apps/desktop/src/frame/tabs.ts'], synthetic);
  assert.deepEqual([...c.browser].sort(), ['frame-pdf.test.mjs', 'frame-tabs.test.mjs', 'model.test.mjs']);
  assert.deepEqual(c.unmapped, []);
  assert.deepEqual([...c.suites], ['desktop']);
});

test('classifyChanges: apps/desktop/src owns only the files directly in it', () => {
  const top = classifyChanges(['apps/desktop/src/app.ts'], synthetic);
  assert.deepEqual([...top.browser], ['top.test.mjs']);
  const nested = classifyChanges(['apps/desktop/src/kinds/log-view.ts'], synthetic);
  assert.deepEqual(nested.unmapped, ['apps/desktop/src/kinds/log-view.ts']);
  assert.deepEqual([...nested.browser], ['smoke.test.mjs']);
});

test('classifyChanges: unmapped paths fall back to the named set; covered paths do not', () => {
  const un = classifyChanges(['fixtures/odd/file.bin', 'apps/desktop/src/frame/a.ts'], synthetic);
  assert.deepEqual(un.unmapped, ['fixtures/odd/file.bin']);
  assert.ok(un.browser.has('smoke.test.mjs') && un.browser.has('frame-tabs.test.mjs'));
  const covered = classifyChanges(['docs/testing.md'], synthetic);
  assert.deepEqual(covered.unmapped, []);
  assert.equal(covered.browser.size, 0);
});

test('classifyChanges: Rust, packages, scripts, support files and test files', () => {
  const rust = classifyChanges(['apps/desktop/src-tauri/src/main.rs'], synthetic);
  assert.equal(rust.rust, true);
  assert.equal(rust.browser.size, 0);
  const pk = classifyChanges(['packages/core/src/parse/parse.ts', 'packages/theme/src/x.css', 'scripts/check.mjs'], synthetic);
  assert.deepEqual([...pk.suites].sort(), ['core', 'scripts', 'theme']);
  const helper = classifyChanges(['scripts/playwright-webkit.mjs'], synthetic);
  assert.deepEqual([...helper.browser], ['smoke.test.mjs']);
  const own = classifyChanges(['apps/desktop/test/save.test.mjs'], synthetic, () => true);
  assert.deepEqual([...own.browser], ['save.test.mjs']);
  const gone = classifyChanges(['apps/desktop/test/removed.test.mjs'], synthetic, () => false);
  assert.equal(gone.browser.size, 0);
  const lock = classifyChanges(['pnpm-lock.yaml'], synthetic);
  assert.deepEqual([...lock.suites].sort(), ['core', 'desktop', 'scripts', 'theme', 'typeset']);
});

test('classifyChanges: Windows separators are accepted', () => {
  const c = classifyChanges(['apps\\desktop\\src\\frame\\tabs.ts'], synthetic);
  assert.ok(c.browser.has('frame-tabs.test.mjs'));
});

test('the shipped map names only files that exist and lists every browser test', () => {
  const p = mapProblems(map, ROOT);
  assert.deepEqual(p.stale, [], 'stale names in scripts/verify-map.json');
  assert.deepEqual(p.noKey, [], 'source folders with no key in scripts/verify-map.json');
  assert.deepEqual(p.unlisted, [], 'browser test files in no entry of scripts/verify-map.json (run verify --check-map)');
});

test('mapProblems names a browser test file that no map entry lists', () => {
  const p = mapProblems({ fallback: [], map: { 'apps/desktop/src': [] } }, ROOT);
  assert.ok(p.unlisted.includes('save.test.mjs'));
});

test('the full tier lists every browser test file, whatever the map says', () => {
  const out = spawnSync(process.execPath, ['scripts/verify.mjs', '--tier', 'full', '--list'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  const line = out.split('\n').find(l => l.includes('scripts/browser-tests.mjs'));
  const listed = line.match(/test\/[\w.-]+\.test\.mjs/g);
  assert.equal(listed.length, readdirSync(join(ROOT, 'apps/desktop/test')).filter(f => f.endsWith('.test.mjs')).length);
  assert.equal(listed.length, allBrowserTests(ROOT).length);
  assert.match(line, /--jobs 3 /);
});

test('parseArgs: jobs default to 3 in the full tier, 2 in changed and 1 in quick; --jobs overrides', () => {
  assert.equal(parseArgs(['--tier', 'full']).jobs, 3);
  assert.equal(parseArgs(['--tier', 'full', '--jobs', '1']).jobs, 1);
  assert.equal(parseArgs(['--tier', 'changed']).jobs, 2);
  assert.equal(parseArgs(['--tier', 'changed', '--jobs', '1']).jobs, 1);
  assert.equal(parseArgs(['--tier', 'quick']).jobs, 1);
});

test('parseArgs: unit jobs default to a few and --unit-jobs overrides', () => {
  const d = parseArgs([]).unitJobs;
  assert.ok(Number.isInteger(d) && d >= 1 && d <= 4, String(d));
  assert.equal(parseArgs(['--unit-jobs', '2']).unitJobs, 2);
  assert.throws(() => parseArgs(['--unit-jobs', '0']), /--unit-jobs/);
});

test('a change under test/support runs a declared smoke set that spans the areas; the files exist and are mapped', () => {
  const c = classifyChanges(['apps/desktop/test/support/two-pane.mjs'], map, t => existsSync(join(ROOT, 'apps/desktop/test', t)));
  assert.deepEqual([...c.browser].sort(), [...SUPPORT_SMOKE].sort());
  assert.deepEqual(c.unmapped, []);
  assert.ok(c.suites.has('desktop'), 'desktop unit files import support helpers too');
  assert.ok(SUPPORT_SMOKE.includes('tauri-subscriptions.test.mjs'), 'a user of the Tauri stubs is in the smoke set');
  assert.ok(SUPPORT_SMOKE.length >= 25 && SUPPORT_SMOKE.length <= 35, String(SUPPORT_SMOKE.length));
  assert.equal(new Set(SUPPORT_SMOKE).size, SUPPORT_SMOKE.length);
  for (const f of map.fallback) assert.ok(SUPPORT_SMOKE.includes(f), `${f} (fallback) is in the smoke set`);
  const listed = new Set(Object.values(map.map).flat());
  for (const f of SUPPORT_SMOKE) assert.ok(listed.has(f), `${f} is in the map`);
});

test('a change under apps/desktop/scripts runs no browser file and counts as covered', () => {
  const c = classifyChanges(['apps/desktop/scripts/shots.mjs'], map);
  assert.equal(c.browser.size, 0);
  assert.ok(c.suites.has('desktop'), 'its own tests run in the desktop unit step');
  assert.deepEqual(c.unmapped, []);
});

test('desktop unit files: those that start WebKit run apart, and every such file is declared', () => {
  const { plain, browser } = desktopUnitFiles(ROOT);
  assert.deepEqual(browser, [...DESKTOP_UNIT_BROWSER].sort());
  assert.ok(plain.length > 100 && plain.every(f => /^(src|scripts)\/.+\.test\.(ts|mjs)$/.test(f)));
  assert.ok(plain.includes('scripts/shots.test.mjs'), 'the tests of apps/desktop/scripts run with the Node-only files');
  // Matches static and dynamic imports alike, and every support helper that starts a browser or Vite.
  const starts = /['"](?:playwright|playwright-core|@playwright\/test|vite)['"]|playwright-webkit\.mjs|support\/(?:two-pane|shared-vite|shared-browser|frame|split-same)\.mjs/;
  for (const f of plain) assert.ok(!starts.test(readFileSync(join(ROOT, 'apps/desktop', f), 'utf8')), `${f} starts a browser or a server: add it to DESKTOP_UNIT_BROWSER in scripts/verify.mjs`);
});

test('plan: the Node-only desktop files run side by side and the browser ones one at a time', () => {
  const ctx = { root: ROOT, tier: 'quick', change: { suites: new Set(['desktop']), rust: false, browser: new Set(), unmapped: [] }, jobs: 1, unitJobs: 3, lockWait: 0, map };
  const steps = plan(ctx, {});
  const plainStep = steps.find(s => s.name === 'unit-desktop');
  const browserStep = steps.find(s => s.name === 'unit-desktop-browser');
  assert.ok(plainStep.args.includes('--test-concurrency=3'));
  assert.ok(browserStep.args.includes('--test-concurrency=1'));
  assert.ok(DESKTOP_UNIT_BROWSER.every(f => browserStep.args.includes(f) && !plainStep.args.includes(f)));
});

test('the shipped map keys are folders that exist', () => {
  for (const k of Object.keys(map.map)) assert.ok(existsSync(join(ROOT, k)), `${k} does not exist`);
});

test('plan: tiers add steps; only and from select', () => {
  const change = { suites: new Set(['desktop']), rust: false, browser: new Set(['a.test.mjs']), unmapped: [] };
  const ctx = { root: ROOT, tier: 'quick', change, jobs: 1, lockWait: 0, map, platform: 'win32' };
  const names = t => plan({ ...ctx, tier: t }, {}).map(s => s.name);
  assert.deepEqual(names('quick'), ['install', 'typecheck', 'lint', 'check', 'golden', 'fidelity', 'licences', 'unit-desktop', 'unit-desktop-browser']);
  assert.ok(names('changed').includes('browser') && !names('changed').includes('cargo'));
  assert.ok(names('full').includes('tauri') && names('full').includes('cargo') && names('full').includes('build'));
  assert.ok(!plan({ ...ctx, tier: 'full', platform: 'darwin' }, {}).some(s => s.name === 'tauri'), 'the real-window check is Windows only');
  assert.deepEqual(plan(ctx, { only: ['lint', 'check'] }).map(s => s.name), ['lint', 'check']);
  assert.deepEqual(plan(ctx, { from: 'golden' }).map(s => s.name), ['golden', 'fidelity', 'licences', 'unit-desktop', 'unit-desktop-browser']);
  assert.throws(() => plan(ctx, { only: ['nope'] }), /unknown step nope/);
  assert.deepEqual(names('quick').filter(n => n !== 'unit-desktop-browser'), plan(ctx, { skip: ['unit-desktop-browser'] }).map(s => s.name), 'skip takes steps out of the tier and keeps its change gating');
  assert.ok(!plan({ ...ctx, tier: 'changed' }, { skip: ['browser'] }).some(s => s.name === 'browser' || s.name === 'cargo'));
  assert.throws(() => plan(ctx, { skip: ['nope'] }), /unknown step nope/);
  assert.throws(() => plan(ctx, { from: 'cargo' }), /not in this run/);
  const rust = plan({ ...ctx, tier: 'changed', change: { ...change, rust: true } }, {}).map(s => s.name);
  assert.ok(rust.includes('cargo') && rust.includes('lint-rust'));
});

test('catalog: the browser step goes through the shared-server runner', () => {
  const change = { suites: new Set(), rust: false, browser: new Set(['a.test.mjs']), unmapped: [] };
  const step = catalog({ root: ROOT, tier: 'changed', change, jobs: 3, lockWait: 0, map }).find(s => s.name === 'browser');
  assert.deepEqual(step.args, ['scripts/browser-tests.mjs', '--jobs', '3', 'test/a.test.mjs']);
});

test('catalog: check:tauri keeps the lock wait inside its timeout', () => {
  const ctx = { root: ROOT, tier: 'full', change: { suites: new Set(), rust: false, browser: new Set(), unmapped: [] }, jobs: 1, lockWait: 600, map };
  assert.equal(catalog(ctx).find(s => s.name === 'tauri').timeout, 2400);
});

test('parseCounts: node runner, cargo, check and check:tauri output', () => {
  assert.deepEqual(parseCounts('ℹ tests 12\nℹ suites 1\nℹ pass 10\nℹ fail 1\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\n'), { pass: 10, fail: 1, skip: 1 });
  assert.deepEqual(parseCounts('# tests 3\n# pass 3\n# fail 0\n# skipped 0\n'), { pass: 3, fail: 0, skip: 0 });
  assert.deepEqual(
    parseCounts('test result: ok. 400 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out\ntest result: ok. 30 passed; 0 failed; 0 ignored; 0 measured\n'),
    { pass: 430, fail: 0, skip: 2 },
  );
  assert.deepEqual(parseCounts('✓ a\ncheck: 9/9 passed\n'), { pass: 9, fail: 0, skip: 0 });
  assert.deepEqual(parseCounts('PASS a\nPASS b\nFAIL c\nno page errors\n'), { pass: 2, fail: 1, skip: 0 });
  assert.equal(parseCounts('nothing to count'), null);
  assert.equal(formatCounts({ pass: 5, fail: 0, skip: 0 }), '5 pass, 0 fail');
  assert.equal(formatCounts({ pass: 5, fail: 1, skip: 2 }), '5 pass, 1 fail, 2 skip');
});

test('table: aligned rows and a total', () => {
  const t = table([
    { name: 'lint', status: 'pass', seconds: 1.25, tests: '' },
    { name: 'unit-core', status: 'FAIL', seconds: 10, tests: '9 pass, 1 fail' },
  ]);
  const lines = t.split('\n');
  assert.match(lines[0], /^step\s+result\s+wall\s+tests$/);
  assert.match(t, /unit-core\s+FAIL\s+10\.0s\s+9 pass, 1 fail/);
  assert.match(lines.at(-1), /^total\s+11\.3s$/);
});

test('heavy span: the first and last step that load the machine; none for a run of cheap steps', () => {
  const names = ['install', 'typecheck', 'unit-core', 'unit-scripts', 'tauri'];
  assert.deepEqual(heavySpan(names.map(name => ({ name }))), { first: 2, last: 3 });
  assert.equal(heavySpan(['install', 'lint', 'check'].map(name => ({ name }))), null);
});

test('slot count: two by default, MARXY_VERIFY_SLOTS overrides, nonsense is refused', () => {
  assert.equal(slotCount({}), 2);
  assert.equal(slotCount({ MARXY_VERIFY_SLOTS: '1' }), 1);
  assert.throws(() => slotCount({ MARXY_VERIFY_SLOTS: '0' }), /MARXY_VERIFY_SLOTS/);
  assert.throws(() => slotCount({ MARXY_VERIFY_SLOTS: 'x' }), /MARXY_VERIFY_SLOTS/);
});

test('--no-lock is parsed', () => {
  assert.equal(parseArgs([]).noLock, false);
  assert.equal(parseArgs(['--no-lock']).noLock, true);
});

test('slot wait: three hours by default, a bad MARXY_VERIFY_SLOT_WAIT_SEC is refused', () => {
  assert.equal(slotWaitSec({}), 10800);
  assert.equal(slotWaitSec({ MARXY_VERIFY_SLOT_WAIT_SEC: '0' }), 0);
  assert.equal(slotWaitSec({ MARXY_VERIFY_SLOT_WAIT_SEC: '30' }), 30);
  for (const bad of ['soon', '-5', 'Infinity']) assert.throws(() => slotWaitSec({ MARXY_VERIFY_SLOT_WAIT_SEC: bad }), /MARXY_VERIFY_SLOT_WAIT_SEC/);
});

test('changedPaths: a bare base that is only a remote branch (a CI checkout) resolves as origin/<base>', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-base-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  g('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'a');
  g('add', '.');
  g('commit', '-q', '-m', 'a');
  g('update-ref', 'refs/remotes/origin/main', g('rev-parse', 'HEAD'));
  g('checkout', '-q', '-b', 'topic');
  g('branch', '-D', 'main');
  writeFileSync(join(dir, 'b.txt'), 'b');
  g('add', '.');
  g('commit', '-q', '-m', 'b');
  assert.deepEqual(changedPaths(dir, 'main'), ['b.txt']);
  assert.throws(() => changedPaths(dir, 'nope'), /base ref nope not found/);
});
