// Every subprocess is bounded, and long ones die as a whole group (ADR-0034).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { run, spawnDetached, killGroup, stopGroup, stillRunning, pidAlive } from './proc.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'marxy-proc-'));
const until = (cond, ms = 5000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) spawnSync('sleep', ['0.05']); return cond(); };

test('run never hangs past its ceiling and says it timed out', () => {
  const t0 = Date.now();
  const r = run(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 5000);
});

test('run returns output and never throws on a failing command', () => {
  assert.equal(run(process.execPath, ['-e', 'console.log("hi")']).out, 'hi');
  const bad = run(process.execPath, ['-e', 'process.exit(3)']);
  assert.deepEqual([bad.ok, bad.code], [false, 3]);
  assert.equal(run('/definitely/not/a/command', []).ok, false);
});

test('spawnDetached: the child outlives the process that started it and writes to its log', () => {
  const log = join(tmp(), 'child.log');
  const proc = pathToFileURL(join(import.meta.dirname, 'proc.mjs')).href;
  const parent = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { spawnDetached } from ${JSON.stringify(proc)};
    const pid = spawnDetached(process.execPath, ['-e', 'setTimeout(() => console.log("survived"), 300)'], { log: ${JSON.stringify(log)} });
    console.log(pid);`], { encoding: 'utf8' });
  const pid = Number(parent.stdout.trim());
  assert.ok(pid > 0, parent.stderr);
  assert.equal(pidAlive(pid), true, 'child alive after its parent exited');
  until(() => !pidAlive(pid));
  assert.match(readFileSync(log, 'utf8'), /survived/);
});

test('stopGroup stops a detached process and the grandchild it started', async () => {
  const log = join(tmp(), 'tree.log');
  // A leader that starts a grandchild in its own group and prints the grandchild's pid.
  const leader = spawnDetached(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
    console.log(g.pid); setTimeout(() => {}, 60_000);`], { log });
  assert.ok(until(() => /\d+/.test(readFileSync(log, 'utf8'))));
  const grandchild = Number(readFileSync(log, 'utf8').trim());
  assert.equal(pidAlive(grandchild), true);
  await stopGroup(leader, { graceMs: 2000 });
  assert.ok(until(() => !pidAlive(leader) && !pidAlive(grandchild)), 'the whole group is gone');
});

test('killGroup signals the negative pid, and reports a missing group', () => {
  const sent = [];
  assert.equal(killGroup(77, 'SIGTERM', (pid, sig) => sent.push([pid, sig])), true);
  assert.deepEqual(sent, [[-77, 'SIGTERM']]);
  assert.equal(killGroup(79, 'SIGTERM', () => { throw new Error('ESRCH'); }), false);
  assert.equal(killGroup(0), false);
});

test('stillRunning: a recycled pid running something else is not the run', () => {
  assert.equal(stillRunning({ pid: 5, match: 'worker.mjs --run X' }, { alive: () => true, command: () => 'node worker.mjs --run X' }), true);
  assert.equal(stillRunning({ pid: 5, match: 'worker.mjs --run X' }, { alive: () => true, command: () => 'vim notes.md' }), false);
  assert.equal(stillRunning({ pid: 5, match: 'x' }, { alive: () => true, command: () => null }), true, 'unreadable: never reap');
  assert.equal(stillRunning({ pid: 5 }, { alive: () => false }), false);
  assert.equal(stillRunning({}), false);
});
