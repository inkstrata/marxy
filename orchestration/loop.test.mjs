// loop.sh stopped between cycles leaves nothing running behind it (MARXY-210).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const sleepers = interval =>
  execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map(l => l.trim().match(/^(\d+)\s+(.*)$/))
    .filter(m => m && m[2] === `sleep ${interval}`)
    .map(m => Number(m[1]));

const until = async (cond, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return true;
};

test('stopping the loop mid-sleep stops the sleep too', async () => {
  // A copy of the loop beside a cycle that does nothing, so the test runs no real cycle.
  const root = mkdtempSync(join(tmpdir(), 'marxy-loop-'));
  mkdirSync(join(root, 'orchestration'));
  copyFileSync(join(import.meta.dirname, 'loop.sh'), join(root, 'orchestration/loop.sh'));
  writeFileSync(join(root, 'orchestration/cycle.mjs'), '');
  // An interval no other process on the machine is sleeping for, so the sleep is findable by name.
  const interval = 86_400 + (process.pid % 10_000);
  const env = { ...process.env, INTERVAL: String(interval), PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
  const loop = spawn('bash', [join(root, 'orchestration/loop.sh'), 'run'], { cwd: root, env, stdio: 'ignore' });
  const exited = new Promise(r => loop.on('exit', r));
  try {
    assert.ok(await until(() => sleepers(interval).length > 0), 'the loop reached its sleep');
    loop.kill('SIGTERM');
    await exited;
    assert.ok(await until(() => sleepers(interval).length === 0, 2_000), `sleep ${interval} outlived the loop`);
    assert.equal(existsSync(join(root, 'orchestration/results/loop.lease')), false, 'the lease is removed');
  } finally {
    loop.kill('SIGKILL');
    for (const pid of sleepers(interval)) try { process.kill(pid); } catch { /* gone */ }
  }
});
