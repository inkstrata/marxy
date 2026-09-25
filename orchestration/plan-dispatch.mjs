// Start the planner headlessly through the Cursor CLI when the cycle says it is due (MARXY-200).
// usage: node plan-dispatch.mjs [--wait]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, models } from './lib.mjs';
import { isAuthFailure, noteAuthFailure, resolveAgentBin } from './dispatch.mjs';
import { ageMinutes, leaseHeld, newLease, readLease, spawnDetached } from './lease.mjs';

/** argv for `spawn(bin, tail)` — exported so tests need not run the CLI. */
export function plannerSpawnArgs({ m = models(), bin = resolveAgentBin(), prompt = '' } = {}) {
  const role = m.planner;
  const args = ['-p', '--force', '--model', role.model, '--output-format', 'text'];
  if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
  args.push(prompt);
  return { bin, args };
}

export const PLANNER_LEASE = here('results/planner.lease');
export const PLANNER_LOG = here('results/planner.log');

/**
 * Whether to start a planner now. One runs at a time (its lease is held — matched on the planner
 * prompt in its command line, so neither a recycled pid nor an implementor's cursor-agent passes
 * for it, and a planner that slept through the night is still the planner), and a finished one is
 * not followed by another for cooldownMinutes: a cadence-only "due" is true every cycle until a
 * plan lands, and the cycle runs every two minutes (MARXY-208).
 */
export function plannerGate({ lease, held, nowMs = Date.now(), cooldownMinutes = 240 }) {
  if (!lease) return { run: true, why: 'no planner has run from here' };
  const age = ageMinutes(lease.started, nowMs);
  if (held === true) return { run: false, why: `planner running (pid ${lease.pid} since ${lease.started})` };
  if (age < cooldownMinutes) return { run: false, why: `planner ran at ${lease.started}; next one after a ${cooldownMinutes}-minute cooldown` };
  return { run: true, why: `last planner ${Math.round(age)} min ago` };
}

/**
 * Spawn cursor-agent with prompts/planner.md. Default is detached, writing straight to planner.log,
 * so the cycle does not wait on the planner and the planner does not die with the cycle
 * (MARXY-200 AC3, MARXY-208). `--wait` keeps it in this process.
 */
export async function runPlanner({
  wait = false, m = models(), now = () => new Date(),
  bin, prompt = readFileSync(here('prompts/planner.md'), 'utf8'),
  leasePath = PLANNER_LEASE, logPath = PLANNER_LOG, needsHumanPath = here('needs-human.md'),
} = {}) {
  const lease = readLease(leasePath);
  const held = leaseHeld(lease);
  // A detached run's exit code is never seen, so its auth failure is read from its log afterwards.
  if (lease && held === false && !lease.authNoted && existsSync(logPath)
    && isAuthFailure({ code: 1, log: readFileSync(logPath), resultExists: false })) {
    noteAuthFailure('planner', needsHumanPath, now());
    writeFileSync(leasePath, JSON.stringify({ ...lease, authNoted: true }) + '\n');
    console.log(`planner: the last run failed to authenticate (${logPath}); noted in needs-human.md`);
    return { skipped: true, authFailure: true };
  }
  const gate = plannerGate({ lease, held, nowMs: now().getTime(), cooldownMinutes: m.plannerCooldownMinutes ?? 240 });
  if (!gate.run) {
    console.log(`planner: not started — ${gate.why}`);
    return { skipped: true };
  }
  const spawnArgs = plannerSpawnArgs({ m, prompt, ...(bin ? { bin } : {}) });
  mkdirSync(dirname(logPath), { recursive: true });
  const match = prompt.split('\n')[0];
  if (!wait) {
    const pid = spawnDetached(spawnArgs.bin, spawnArgs.args, { cwd: ROOT, log: logPath, flags: 'w' });
    if (!pid) {
      console.log(`planner: could not start ${spawnArgs.bin}`);
      return { skipped: true };
    }
    writeFileSync(leasePath, JSON.stringify(newLease(pid, match, now())) + '\n');
    console.log(`planner: started, pid ${pid}, log ${logPath}`);
    return { pid };
  }
  const { bin: waitBin, args } = spawnArgs;
  writeFileSync(leasePath, JSON.stringify(newLease(process.pid, 'plan-dispatch.mjs', now())) + '\n');
  const out = [];
  const child = spawn(waitBin, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => out.push(d));
  child.stderr.on('data', d => out.push(d));
  const code = await new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('exit', resolvePromise);
  });
  const logBuf = Buffer.concat(out);
  writeFileSync(logPath, logBuf);
  if (isAuthFailure({ code, log: logBuf, resultExists: false })) {
    noteAuthFailure('planner', needsHumanPath, now());
    console.log(`planner: auth failure (exit ${code}), log ${logPath}`);
    return { code, authFailure: true };
  }
  console.log(`planner: exit ${code}, log ${logPath}`);
  return { code, authFailure: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const wait = process.argv.includes('--wait');
  await runPlanner({ wait });
}
