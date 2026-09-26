// Sign one story's approval: node approve.mjs KEY [--head SHA]
//
// The merge gate is `results/KEY.approved`, and on 2026-09-18 two subagents wrote one for their own
// work in an "acceptance pass" — sincerely, and with accurate contents, but an implementor that can
// write its own approval is not reviewed at all, and a reviewer that writes one has merged its own
// verdict. So an approval now has to be signed with a key that lives outside the repository, and it
// has to name the commit it approves: a body alone is a note, not a decision.
//
// This is not security against a determined agent on this machine. It is a boundary that cannot be
// crossed by accident or by helpfulness, which is the failure that actually happened.
//
// A signature may be taken whenever the PR is not in conflict (ADR-0034, amending ADR-0025 §5). "Sign
// last" existed because every merge rewrote every other head and voided every approval; since
// onlyMainArrived() lets an approval survive a head that is the reviewed commit merged with main,
// reviewers can work in parallel and the branch update still cannot launder an unreviewed change.
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';
import { approvalPath } from './store.mjs';
import { readPullRequest } from './review-order.mjs';

/** The one reason a signature is refused; printed verbatim so a test can name it. */
export const SIGN_HOLDS = {
  DIRTY: 'DIRTY',
};

/** Whether this story may be signed now: not while its PR conflicts, since the tree is not final. */
export function approvalHoldReason({ mergeStateStatus } = {}) {
  if (mergeStateStatus === 'DIRTY') return SIGN_HOLDS.DIRTY;
  return null;
}

const KEY_DIR = join(homedir(), '.config', 'marxy');
const KEY_PATH = join(KEY_DIR, 'approval.key');

export function approvalKey() {
  if (!existsSync(KEY_PATH)) {
    mkdirSync(KEY_DIR, { recursive: true });
    writeFileSync(KEY_PATH, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
    chmodSync(KEY_PATH, 0o600);
  }
  return readFileSync(KEY_PATH, 'utf8').trim();
}

const FOOTER = /\n?PR-HEAD: ([0-9a-f]{40})\nSIGNATURE: ([0-9a-f]{64})\n?$/;

export function sign(body, head) {
  return createHmac('sha256', approvalKey()).update(`${head}\n${body.trimEnd()}\n`).digest('hex');
}

/** `{ ok, why, head }` — why is the reason a merge must be held, so it can be printed verbatim. */
export function verify(path, prHead, { fetch = true } = {}) {
  if (!existsSync(path)) return { ok: false, why: 'not reviewed (no results/KEY.approved)' };
  const text = readFileSync(path, 'utf8');
  const m = text.match(FOOTER);
  if (!m) return { ok: false, why: 'the approval is unsigned; run node orchestration/approve.mjs KEY' };
  const [, head, signature] = m;
  if (sign(text.replace(FOOTER, ''), head) !== signature) {
    return { ok: false, why: 'the approval signature does not match its text' };
  }
  if (prHead && head !== prHead) {
    const drift = onlyMainArrived(head, prHead, { fetch });
    if (!drift.ok) return { ok: false, why: `the approval is for ${head.slice(0, 7)}, the PR head is ${prHead.slice(0, 7)}, and ${drift.why}` };
    return { ok: true, head, note: `approved at ${head.slice(0, 7)}; ${drift.why}` };
  }
  return { ok: true, head };
}

const rootGit = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/**
 * Whether everything that changed since the approved commit arrived from main.
 *
 * Signing against a commit and updating branches that fall behind are a livelock together: each
 * merge rewrites the head of every other branch, so every signed approval is void before it can be
 * used. What a review is of is the story's own work, so an approval survives a head change when the
 * new head is exactly what merging the reviewed commit with main produces.
 *
 * That is computed, not guessed: `git merge-tree` merges the reviewed commit with the main commit the
 * head took in, and the head must match it file for file. A file both sides touched (CHANGELOG.md,
 * nearly every time) comes out of merge-tree in conflict and was resolved by hand, so for those the
 * resolution is checked line by line: every line in it came from one side, and no line either side
 * kept has gone unless the other side removed it. The earlier check only asked the first half, which
 * let a resolution delete a line of the reviewed work, or of main, and keep the approval.
 */
export function onlyMainArrived(approved, head, { git = rootGit, mainRef = 'origin/main', fetch = true } = {}) {
  const short = sha => sha.slice(0, 7);
  try {
    if (fetch) git(['fetch', '-q', 'origin']);
    git(['merge-base', '--is-ancestor', approved, head]);
  } catch { return { ok: false, why: `${short(approved)} is not an ancestor of it, so the reviewed work is not what the pull request contains` }; }
  let main;
  try { main = git(['merge-base', head, mainRef]); } catch { return { ok: false, why: `the head shares no history with ${mainRef}` }; }
  let out;
  try { out = git(['merge-tree', '--write-tree', '--name-only', '--no-messages', approved, main]); } catch (e) {
    if (e.status !== 1 || !e.stdout) return { ok: false, why: `merge-tree could not merge ${short(approved)} with ${short(main)}` };
    out = String(e.stdout).trim();
  }
  const [tree, ...conflicted] = out.split('\n').filter(Boolean);
  const differ = git(['diff', '--name-only', tree, head]).split('\n').filter(Boolean);
  if (!differ.length) return { ok: true, why: `the head is exactly ${short(approved)} merged with main at ${short(main)}` };
  const unexplained = differ.filter(f => !conflicted.includes(f));
  if (unexplained.length) {
    return { ok: false, why: `${unexplained.length} file(s) differ from merging the reviewed commit with main: ${unexplained.slice(0, 5).join(', ')}` };
  }
  const base = git(['merge-base', approved, main]);
  const lines = (r, f) => { try { return git(['show', `${r}:${f}`]).split('\n'); } catch { return []; } };
  const bad = differ.filter(f => !resolutionFromSides({
    base: lines(base, f), ours: lines(approved, f), theirs: lines(main, f), result: lines(head, f),
  }));
  return bad.length
    ? { ok: false, why: `${bad.length} hand-resolved file(s) carry a line neither side had, or drop one a side kept: ${bad.slice(0, 5).join(', ')}` }
    : { ok: true, why: `the head is ${short(approved)} merged with main at ${short(main)}; ${differ.length} conflicted file(s) resolved from both sides' lines` };
}

/**
 * A hand resolution of one file is taken from the two sides when every line in it came from one of
 * them, and every line a side kept is still there unless the other side deleted it.
 */
export function resolutionFromSides({ base, ours, theirs, result }) {
  const [B, O, T, R] = [base, ours, theirs, result].map(a => new Set(a));
  if (![...R].every(l => O.has(l) || T.has(l))) return false;
  const deletedBy = (side, l) => B.has(l) && !side.has(l);
  if (![...O].every(l => R.has(l) || deletedBy(T, l))) return false;
  return [...T].every(l => R.has(l) || deletedBy(O, l));
}

/** Read the live PR. `readPr` is injectable so --selftest never hits GitHub. */
export function liveApprovalHold(key, { readPr = readPullRequest, pr } = {}) {
  if (pr == null || pr === '') return null;
  try {
    return approvalHoldReason({ mergeStateStatus: readPr(pr).mergeStateStatus ?? '' });
  } catch (e) {
    return `could not read pull request: ${e.message}`;
  }
}

/** Sign the approval at approvalPath(key) for `head`. The body is the reviewer's notes. */
export function signApproval(key, head, { path = approvalPath(key) } = {}) {
  if (!/^[0-9a-f]{40}$/.test(head ?? '')) throw new Error(`refusing to sign ${key} without a 40-character head`);
  const body = readFileSync(path, 'utf8').replace(FOOTER, '').trimEnd();
  writeFileSync(path, `${body}\n\nPR-HEAD: ${head}\nSIGNATURE: ${sign(body, head)}\n`);
  return head;
}

/** Named cases for `node orchestration/approve.mjs --selftest`. Returns the process exit code. */
export function selftest() {
  const cases = [
    { name: 'BEHIND signs: the approval survives the update (onlyMainArrived)', mergeStateStatus: 'BEHIND', hold: null },
    { name: 'CLEAN signs whatever its place in the review order', mergeStateStatus: 'CLEAN', hold: null },
    { name: 'DIRTY holds without writing a signature', mergeStateStatus: 'DIRTY', hold: SIGN_HOLDS.DIRTY },
  ];
  let bad = 0;
  for (const c of cases) {
    const hold = approvalHoldReason(c);
    const ok = hold === c.hold;
    if (ok) console.log(`selftest ok: ${c.name}`);
    else {
      bad += 1;
      console.error(`selftest FAIL: ${c.name} — got ${JSON.stringify(hold)}, want ${JSON.stringify(c.hold)}`);
    }
  }
  if (bad) {
    console.error(`approve selftest failed: ${bad} case(s)`);
    return 1;
  }
  console.log(`approve selftest ok: ${cases.length} named cases`);
  return 0;
}

if (process.argv[1]?.endsWith('approve.mjs')) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const key = process.argv[2];
  if (!key) { console.error('usage: approve.mjs KEY [--head SHA]'); process.exit(2); }
  const path = approvalPath(key);
  if (!existsSync(path)) { console.error(`${path} does not exist — write the approval first (node orchestration/fleet.mjs verdict ${key} merge --notes FILE does both)`); process.exit(2); }
  const flag = process.argv.indexOf('--head');
  let head = flag > 0 ? process.argv[flag + 1] : '';
  let number = null;
  if (!head) {
    const pr = JSON.parse(execFileSync('gh', ['pr', 'list', '--search', key, '--json', 'number,headRefOid'], { encoding: 'utf8', timeout: 90_000 }));
    if (pr.length !== 1) { console.error(`found ${pr.length} PRs for ${key}; pass --head SHA`); process.exit(2); }
    head = pr[0].headRefOid;
    number = pr[0].number;
  }
  const hold = liveApprovalHold(key, { pr: number });
  if (hold) {
    console.error(`${key}: not signing — ${hold}`);
    process.exit(1);
  }
  signApproval(key, head, { path });
  console.log(`${key}: approval signed for ${head.slice(0, 7)}`);
}
