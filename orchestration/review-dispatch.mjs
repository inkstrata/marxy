// Start one reviewer headlessly through the Cursor CLI (MARXY-215).
// usage: node review-dispatch.mjs KEY
// The cycle calls this for the single pull request approve.mjs will sign: the first review-order
// entry that is not BEHIND or DIRTY. A later key is not started — signing it would be refused.
// A second cycle does not start another reviewer for a key whose lease is still held.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, models } from './lib.mjs';
import { resolveAgentBin } from './dispatch.mjs';
import { leaseHeld, newLease, readLease, spawnDetached } from './lease.mjs';

const KEY_RE = /^(MARXY-\d+)/;

/** Holds that mean the cycle cannot boundary-check this pull request, so a reviewer must not start. */
const UNREVIEWABLE_HOLD = [
  /could not compute the branch diff/,
  /no board row on main or on its branch/,
];

export function reviewLeasePath(key) {
  return here(`results/${key}.review.lease`);
}

export function reviewLogPath(key) {
  return here(`results/${key}.review.log`);
}

/** Keys named by the cycle's "review needed" lines. */
export function keysNeedingReview(lines = []) {
  return lines.map(line => String(line).match(KEY_RE)?.[1]).filter(Boolean);
}

/** True when this key is held because no boundary check can run. A CODEOWNERS hold is not one of these. */
export function heldUnreviewable(holds, key) {
  return (holds ?? []).some(line => String(line).startsWith(`${key}:`) && UNREVIEWABLE_HOLD.some(re => re.test(line)));
}

/**
 * The one key a headless cycle may review. `approve.mjs` signs only `order[0]`, and only when that
 * entry is not BEHIND or DIRTY, so a later unsigned pull request is left for a later cycle.
 * A missing diff or a missing board row is skipped. A CODEOWNERS hold is not: the signature is
 * still required, and the human approve stays a separate hold once the signature exists.
 */
export function chooseReviewer({ order = [], unsigned = [], holds = [], leaseHeld: held = () => false } = {}) {
  const first = order[0];
  if (!first?.key) return { key: null, why: 'nothing in the review order' };
  if (first.behind) return { key: null, why: `${first.key} is BEHIND; approve.mjs will not sign it` };
  if (first.dirty) return { key: null, why: `${first.key} is DIRTY; approve.mjs will not sign it` };
  if (!unsigned.includes(first.key)) return { key: null, why: `${first.key} is not waiting on a reviewer signature` };
  if (heldUnreviewable(holds, first.key)) return { key: null, why: `${first.key} cannot be boundary-checked` };
  if (held(first.key)) return { key: null, why: `reviewer already running for ${first.key}` };
  return { key: first.key, why: 'first signable entry of the review order' };
}

/** Whether this cycle should spawn. Dry-run and a missing CLI only name the key. */
export function planHeadlessReview({ order, needsReview = [], holds = [], hasCli = false, dry = false, leaseHeld: held } = {}) {
  const choice = chooseReviewer({ order, unsigned: keysNeedingReview(needsReview), holds, leaseHeld: held });
  return { ...choice, spawn: Boolean(choice.key && hasCli && !dry) };
}

/** Prompt plus the one key. The role text stays prompts/reviewer.md. */
export function reviewerPrompt(prompt, key) {
  return `${String(prompt).trimEnd()}

Review ${key} only. Run \`node orchestration/review.mjs ${key}\` first. Where this prompt says KEY, use ${key}. Write orchestration/results/${key}.approved only on merge, then sign it with \`node orchestration/approve.mjs ${key}\`. Do not run \`gh pr merge\`.
`;
}

/** argv for the reviewer CLI. The binary is resolveAgentBin (MARXY-214): `1` and empty are not commands. */
export function reviewerSpawnArgs({ m = models(), bin = resolveAgentBin(), prompt = '', key }) {
  const role = m.reviewer;
  const args = ['-p', '--force', '--model', role.model, '--output-format', 'text'];
  if (m.cliEffortFlag && role.effort) args.push(m.cliEffortFlag, role.effort);
  args.push(reviewerPrompt(prompt, key));
  return { bin, args };
}

/**
 * Spawn a detached worker for `key` unless its lease is held. The worker's command line carries
 * `--worker KEY`, which is what the lease matches, so a recycled pid does not count as this reviewer.
 */
export function launchReviewer(key, {
  m = models(),
  leasePath = reviewLeasePath(key),
  logPath = reviewLogPath(key),
  spawn = spawnDetached,
  held = leaseHeld,
  now = () => new Date(),
} = {}) {
  const lease = readLease(leasePath);
  if (held(lease) === true) {
    console.log(`${key}: reviewer already running (pid ${lease.pid} since ${lease.started}); not started again`);
    return { skipped: true, key };
  }
  const match = `--worker ${key}`;
  const pid = spawn(process.execPath, [here('review-dispatch.mjs'), '--worker', key], {
    cwd: ROOT,
    log: logPath,
    env: { ...process.env, MARXY_COMPUTE: m.compute },
  });
  if (!pid) {
    console.log(`${key}: reviewer could not start`);
    return { skipped: true, key };
  }
  mkdirSync(dirname(leasePath), { recursive: true });
  writeFileSync(leasePath, JSON.stringify(newLease(pid, match, now())) + '\n');
  console.log(`${key}: reviewer started, pid ${pid}, log ${logPath}`);
  return { pid, key };
}

/** The worker: cursor-agent with prompts/reviewer.md, output in the review log, capped by attemptMinutes. */
export async function workReviewer(key, {
  m = models(),
  bin,
  prompt = readFileSync(here('prompts/reviewer.md'), 'utf8'),
} = {}) {
  const { bin: cmd, args } = reviewerSpawnArgs({ m, prompt, key, ...(bin ? { bin } : {}) });
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = d => { process.stdout.write(d); };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const timer = setTimeout(() => child.kill('SIGTERM'), (m.attemptMinutes ?? 45) * 60_000);
  let code;
  try {
    code = await new Promise((resolvePromise, reject) => {
      child.on('error', reject);
      child.on('exit', resolvePromise);
    });
  } finally {
    clearTimeout(timer);
  }
  console.log(`${key}: reviewer exit ${code}`);
  return { code };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const workerAt = process.argv.indexOf('--worker');
  if (workerAt >= 0) {
    await workReviewer(process.argv[workerAt + 1]);
  } else {
    const key = process.argv[2];
    if (!/^MARXY-\d+$/.test(key ?? '')) {
      console.error('usage: review-dispatch.mjs KEY');
      process.exit(2);
    }
    launchReviewer(key);
  }
}
