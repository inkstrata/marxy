// Start the planner headlessly through the Cursor CLI when the cycle says it is due (MARXY-200).
// usage: node plan-dispatch.mjs [--wait]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, models } from './lib.mjs';
import { isAuthFailure, noteAuthFailure } from './dispatch.mjs';

/** argv for `spawn(bin, tail)` — exported so tests need not run the CLI. */
export function plannerSpawnArgs({ m = models(), bin = process.env.CURSOR_AGENT || 'cursor-agent', prompt = '' } = {}) {
  const role = m.planner;
  const args = ['-p', '--force', '--model', role.model, '--output-format', 'text'];
  if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
  args.push(prompt);
  return { bin, args };
}

/**
 * Spawn cursor-agent with prompts/planner.md. Default is detached so a cadence-only due pass
 * does not block implementor dispatch in the same cycle (MARXY-200 AC3).
 */
export async function runPlanner({ wait = false, m = models(), now = () => new Date() } = {}) {
  const { bin, args } = plannerSpawnArgs({
    m,
    prompt: readFileSync(here('prompts/planner.md'), 'utf8'),
  });
  mkdirSync(here('results'), { recursive: true });
  const logPath = here('results/planner.log');
  const out = [];
  const child = spawn(bin, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !wait,
  });
  child.stdout.on('data', d => out.push(d));
  child.stderr.on('data', d => out.push(d));
  if (!wait) child.unref();
  const code = await new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('exit', resolvePromise);
  });
  const logBuf = Buffer.concat(out);
  writeFileSync(logPath, logBuf);
  if (isAuthFailure({ code, log: logBuf, resultExists: false })) {
    noteAuthFailure('planner', here('needs-human.md'), now());
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
