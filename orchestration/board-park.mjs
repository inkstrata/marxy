// A dirty orchestrator checkout is dirty-board and holds every dispatch (MARXY-117). The bytes
// are real work, so the cycle does not revert them and does not edit them in place: it stashes
// the tracked edits under docs/plan and orchestration, copies a patch beside that stash, and
// restores the checkout to HEAD. Fast-forward can then reach origin/main and dispatch reads
// that board. A checkout off main is left alone — those edits belong to the branch.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here } from './lib.mjs';
import { trackedBoardEdits } from './board-check.mjs';

/** Porcelain XY pairs git uses for an unmerged path. Stashing one would drop the conflict. */
const UNMERGED_XY = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function defaultQuarantineDir() {
  return join(homedir(), '.config', 'marxy', 'orchestration', 'quarantine');
}

/** `marxy-board-park 2026-09-25T18-50-00Z` — a stash message and a patch filename. */
export function parkStamp(now = new Date()) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  return `marxy-board-park ${stamp}`;
}

/**
 * Whether this checkout's tracked board edits can be parked. `behind` is not a refusal:
 * the dirty tree is what stops the fast-forward that clears it. Off main is a refusal.
 */
export function planBoardPark({ branch, statusText = '' } = {}) {
  const lines = String(statusText).split('\n').filter(Boolean);
  const tracked = lines.filter(line => !line.startsWith('??'));
  const files = trackedBoardEdits(statusText);
  if (branch !== 'main') return { park: false, files, why: `checkout is on ${branch || 'no branch'}, not main` };
  const unmerged = tracked.filter(line => UNMERGED_XY.has(line.slice(0, 2)));
  if (unmerged.length) {
    const names = unmerged.map(line => line.slice(3).trim());
    return { park: false, files, why: `unmerged: ${names.join(', ')}` };
  }
  if (!files.length) return { park: false, files, why: 'clean' };
  return { park: true, files, why: '' };
}

export function parkBullet({ files, stashMessage, patchPath }) {
  const where = patchPath ? ` Patch: \`${patchPath}\`.` : '';
  return `- [ ] **Orchestrator checkout parked** — ${files.join(', ')} saved as \`${stashMessage}\`.${where} Apply it on a story worktree with \`git stash apply --index stash^{/${stashMessage}}\`.`;
}

/** One note per stash message, so a second cycle does not repeat it. */
export function appendParkNote(text, bullet, stashMessage) {
  if (stashMessage && text.includes(stashMessage)) return text;
  const sep = text.endsWith('\n') || text.length === 0 ? '' : '\n';
  return `${text}${sep}${bullet}\n`;
}

function git(root, args) {
  try {
    // A stash is a local commit. Signing it would prompt for a key in a headless cycle and
    // the prompt never arrives, so the dirty tree would stay dirty and dispatch would stay held.
    return execFileSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = `${e.stderr ?? ''}${e.stdout ?? ''}`.trim();
    throw new Error(stderr || e.message || `git ${args.join(' ')} failed`);
  }
}

/** `git status --porcelain` for the board paths. Not trimmed: a leading space is the unstaged column. */
export function readBoardStatus(root) {
  try {
    return execFileSync('git', ['-C', root, 'status', '--porcelain', '--', 'docs/plan', 'orchestration'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}

/**
 * Stash `files` (default: every tracked board edit), prove the checkout matches HEAD again,
 * and write the note. Returns `{ parked: false }` when there is nothing to do or the checkout
 * must not be touched. Throws only when git failed before the stash existed, or the stash
 * exists and the checkout is still dirty — the message names the stash either way.
 */
export function parkDirtyBoard({
  root,
  files = null,
  quarantineDir = defaultQuarantineDir(),
  needsHumanPath = null,
  now = new Date(),
} = {}) {
  let branch = '';
  try { branch = git(root, ['branch', '--show-current']).trim(); } catch { branch = ''; }
  const plan = planBoardPark({ branch, statusText: readBoardStatus(root) });
  if (!plan.park) return { parked: false, why: plan.why, files: plan.files, stashMessage: null, patchPath: null };
  const chosen = (files ?? plan.files).filter(f => plan.files.includes(f));
  if (!chosen.length) return { parked: false, why: 'clean', files: [], stashMessage: null, patchPath: null };

  const stashMessage = parkStamp(now);
  try {
    git(root, ['stash', 'push', '-m', stashMessage, '--', ...chosen]);
  } catch (e) {
    if (/No local changes to save/.test(e.message)) return { parked: false, why: 'clean', files: [], stashMessage: null, patchPath: null };
    throw e;
  }

  const line = git(root, ['stash', 'list']).split('\n').find(l => l.includes(stashMessage));
  const ref = line?.match(/^(stash@\{\d+\})/)?.[1];
  if (!ref) throw new Error(`stash ${stashMessage} was not created`);

  const left = trackedBoardEdits(readBoardStatus(root)).filter(f => chosen.includes(f));
  if (left.length) {
    try { git(root, ['stash', 'apply', ref]); } catch { /* the stash still holds the edits */ }
    throw new Error(`${left.join(', ')} still dirty after stash; ${stashMessage} has the edits`);
  }

  let patchPath = null;
  try {
    const patch = git(root, ['stash', 'show', '-p', '--binary', ref]);
    mkdirSync(quarantineDir, { recursive: true });
    patchPath = join(quarantineDir, `${stashMessage.replace(/\s+/g, '-')}.patch`);
    writeFileSync(patchPath, patch);
  } catch {
    patchPath = null;
  }

  if (needsHumanPath) {
    const bullet = parkBullet({ files: chosen, stashMessage, patchPath });
    const prior = existsSync(needsHumanPath) ? readFileSync(needsHumanPath, 'utf8') : '# Needs a human\n\n';
    writeFileSync(needsHumanPath, appendParkNote(prior, bullet, stashMessage));
  }
  return { parked: true, why: '', files: chosen, stashMessage, patchPath };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = parkDirtyBoard({ root: ROOT, needsHumanPath: here('needs-human.md') });
    if (result.parked) {
      console.log(`board-park: parked ${result.files.join(', ')} (${result.stashMessage})${result.patchPath ? `; patch ${result.patchPath}` : ''}`);
    } else if (result.why === 'clean') {
      console.log('board-park: clean');
    } else {
      console.error(`board-park: not parked — ${result.why}`);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`board-park: not parked — ${String(e.message ?? e).split('\n')[0]}`);
    process.exitCode = 1;
  }
}
