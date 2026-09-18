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
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { here } from './lib.mjs';

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
export function verify(path, prHead) {
  if (!existsSync(path)) return { ok: false, why: 'not reviewed (no results/KEY.approved)' };
  const text = readFileSync(path, 'utf8');
  const m = text.match(FOOTER);
  if (!m) return { ok: false, why: 'the approval is unsigned; run node orchestration/approve.mjs KEY' };
  const [, head, signature] = m;
  if (sign(text.replace(FOOTER, ''), head) !== signature) {
    return { ok: false, why: 'the approval signature does not match its text' };
  }
  if (prHead && head !== prHead) {
    return { ok: false, why: `the approval is for ${head.slice(0, 7)}, and the PR head is ${prHead.slice(0, 7)}` };
  }
  return { ok: true, head };
}

if (process.argv[1]?.endsWith('approve.mjs')) {
  const key = process.argv[2];
  if (!key) { console.error('usage: approve.mjs KEY [--head SHA]'); process.exit(2); }
  const path = here(`results/${key}.approved`);
  if (!existsSync(path)) { console.error(`${path} does not exist — write the approval first, then sign it`); process.exit(2); }
  const flag = process.argv.indexOf('--head');
  let head = flag > 0 ? process.argv[flag + 1] : '';
  if (!head) {
    const pr = JSON.parse(execFileSync('gh', ['pr', 'list', '--search', key, '--json', 'number,headRefOid'], { encoding: 'utf8' }));
    if (pr.length !== 1) { console.error(`found ${pr.length} PRs for ${key}; pass --head SHA`); process.exit(2); }
    head = pr[0].headRefOid;
  }
  const body = readFileSync(path, 'utf8').replace(FOOTER, '').trimEnd();
  writeFileSync(path, `${body}\n\nPR-HEAD: ${head}\nSIGNATURE: ${sign(body, head)}\n`);
  console.log(`${key}: approval signed for ${head.slice(0, 7)}`);
}
