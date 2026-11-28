import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  browserDue, deviceOk, failedBrowserFiles, isFresh, linuxOnExternalPower, macLowPower, macOnAc, makeResult,
  pacificDate, rerunAlone, rerunVerdict, shouldRun, sleepInWindow, summarizeVerify,
} from './device.mjs';

const AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining present: true\n";
const BATT = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging; 3:10 remaining present: true\n";

test('pmset power state', () => {
  assert.equal(macOnAc(AC), true);
  assert.equal(macOnAc(BATT), false);
  assert.equal(macLowPower('System-wide power settings:\n lowpowermode         1\n sleep 1\n'), true);
  assert.equal(macLowPower(' lowpowermode         0\n'), false);
  assert.equal(macLowPower(' sleep 1\n'), false);
});

function supply(spec) {
  const root = mkdtempSync(join(tmpdir(), 'ps-'));
  for (const [name, type, online] of spec) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'type'), `${type}\n`);
    if (online !== undefined) writeFileSync(join(root, name, 'online'), `${online}\n`);
  }
  return root;
}

test('linux power supplies', () => {
  const dirs = [];
  const mk = s => { const d = supply(s); dirs.push(d); return d; };
  try {
    assert.equal(linuxOnExternalPower(mk([['BAT1', 'Battery'], ['ACAD', 'Mains', 1]])), true);
    assert.equal(linuxOnExternalPower(mk([['BAT1', 'Battery'], ['ACAD', 'Mains', 0]])), false);
    assert.equal(linuxOnExternalPower(mk([['BAT1', 'Battery'], ['ucsi', 'USB', 1]])), true);
    assert.equal(linuxOnExternalPower(mk([['ACAD', 'Mains', 0]])), true, 'no battery: a desktop');
    assert.equal(linuxOnExternalPower(join(tmpdir(), 'no-such-supply-dir')), true);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

const LOG = [
  '2026-11-27 02:00:00 -0800 Sleep               Entering Sleep state due to \'Maintenance Sleep\'',
  '2026-11-27 03:10:00 -0800 Assertions          PID 1(caffeinate) Created PreventUserIdleSystemSleep',
  '2026-11-27 03:20:00 -0800 Wake                DarkWake from Normal Sleep',
  '2026-11-27 04:30:00 -0800 Sleep               Entering Sleep state',
].join('\n');

test('sleep inside a window, not outside it', () => {
  const at = s => new Date(s);
  assert.equal(sleepInWindow(LOG, at('2026-11-27T03:00:00-08:00'), at('2026-11-27T03:15:00-08:00')).length, 0, 'assertion line ignored');
  assert.equal(sleepInWindow(LOG, at('2026-11-27T03:00:00-08:00'), at('2026-11-27T03:30:00-08:00')).length, 1);
  assert.equal(sleepInWindow(LOG, at('2026-11-27T03:21:00-08:00'), at('2026-11-27T04:00:00-08:00')).length, 0, 'earlier entries ignored');
  assert.equal(sleepInWindow(LOG, at('2026-11-27T01:00:00-08:00'), at('2026-11-27T05:00:00-08:00')).length, 3);
});

test('alone-rerun verdict', async () => {
  assert.equal(rerunVerdict(3), 'load');
  assert.equal(rerunVerdict(2), 'real');
  assert.equal(rerunVerdict(0), 'real');
  assert.deepEqual(await rerunAlone('test/a.test.mjs', async () => true), { file: 'test/a.test.mjs', verdict: 'load', passes: 3 });
  let n = 0;
  assert.deepEqual(await rerunAlone('test/b.test.mjs', async () => ++n < 2), { file: 'test/b.test.mjs', verdict: 'real', passes: 1 });
});

test('failed browser files from a log', () => {
  const log = [
    '▶ test/a.test.mjs', '✖ test/a.test.mjs (12ms)', 'ok 2 - test/b.test.mjs', 'not ok 3 - test/c.test.mjs',
    'ℹ failing tests:', 'test at test/a.test.mjs:10:3', 'test at src/source/frame.test.mjs:5:1',
  ].join('\n');
  assert.deepEqual(failedBrowserFiles(log), ['test/a.test.mjs', 'test/c.test.mjs', 'src/source/frame.test.mjs']);
  assert.deepEqual(failedBrowserFiles('all passed'), []);
});

test('result shape', () => {
  const t = new Date('2026-11-27T13:15:00Z');
  const summary = { rows: [{ name: 'lint', status: 'pass', seconds: 1.4 }, { name: 'browser', status: 'FAIL', seconds: 90.6 }] };
  const verify = summarizeVerify(summary, 1);
  assert.deepEqual(verify, { ok: false, steps: [{ name: 'lint', ok: true, seconds: 1 }, { name: 'browser', ok: false, seconds: 91 }] });
  assert.equal(summarizeVerify(null, 0).ok, false);
  const r = makeResult({ os: 'windows', sha: 'abc', startedAt: t, finishedAt: t, verify, reruns: [], install: { ok: true, notes: 'x' } });
  assert.deepEqual(Object.keys(r), ['os', 'sha', 'startedAt', 'finishedAt', 'verify', 'reruns', 'install']);
  assert.equal(makeResult({ os: 'macos', sha: 'a', startedAt: t, finishedAt: t, install: { ok: true, notes: '' }, slept: false }).slept, false);
  assert.equal(pacificDate(new Date('2026-11-27T05:00:00Z')), '2026-11-26');
});

test('freshness: 20 hours and good', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const res = (hoursAgo, extra = {}) => ({ finishedAt: new Date(now - hoursAgo * 3600e3).toISOString(), install: { ok: true }, ...extra });
  assert.equal(isFresh(res(19), now), true);
  assert.equal(isFresh(res(21), now), false);
  assert.equal(isFresh(res(1, { install: { ok: false } }), now), false);
  assert.equal(isFresh(res(1, { slept: true }), now), false);
  assert.equal(isFresh(null, now), false);
  assert.equal(deviceOk(res(1)), true);
  assert.equal(shouldRun({ onPower: true, prev: res(2), now }).run, false);
  assert.equal(shouldRun({ onPower: true, prev: res(30), now }).run, true);
  assert.equal(shouldRun({ onPower: false, prev: null, now }).run, false);
  assert.equal(shouldRun({ onPower: true, lowPower: true, prev: null, now }).run, false);
  assert.equal(shouldRun({ onPower: false, lowPower: true, prev: res(2), now, force: true }).run, true);
  assert.equal(browserDue(null, now), true);
  assert.equal(browserDue({ lastBrowser: { at: new Date(now - 3 * 864e5).toISOString() } }, now), false);
  assert.equal(browserDue({ lastBrowser: { at: new Date(now - 8 * 864e5).toISOString() } }, now), true);
});
