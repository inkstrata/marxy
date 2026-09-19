// Every way the orchestrator checkout can disagree with origin/main's board, named so a stale
// checkout never seeds dispatch (MARXY-117). `boardDrift` is pure; the CLI at the bottom is the
// only IO and exits 1 on any finding so `cycle.mjs` and a bare `node` run agree.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, parseCsv, state } from './lib.mjs';

/** The five kinds `boardDrift` can report. */
export const KIND = {
  BEHIND: 'behind',
  OFF_MAIN: 'off-main',
  DIRTY_BOARD: 'dirty-board',
  UNBOARDED_PR: 'unboarded-pr',
  STALE_REVIEW: 'stale-review',
};

/** The findings that must hold dispatch (`cycle.mjs` step 6). `unboarded-pr` and `stale-review`
 * are named every cycle but never hold — they are someone else's next action, not this
 * checkout's staleness. */
export const BLOCKS_DISPATCH = [KIND.BEHIND, KIND.OFF_MAIN, KIND.DIRTY_BOARD];

/** The Jira key a PR's title or branch names, or null. Title wins: a branch can be renamed
 * without the title following, but the commit-msg hook keeps the title's key honest. */
function prKey(pr) {
  const fromTitle = String(pr?.title ?? '').match(/MARXY-\d+/);
  if (fromTitle) return fromTitle[0];
  return String(pr?.headRefName ?? '').match(/MARXY-\d+/)?.[0] ?? null;
}

/**
 * `Finding = { kind, detail }`. Every input is already gathered, so a fixture never touches
 * git, `gh` or Jira — see `gatherBoardCheckInput` for the one function that does.
 */
export function boardDrift({
  branch,
  behind = 0,
  dirtyTracked = [],
  openPrs = [],
  csvKeys = [],
  outOfPlanKeys = [],
  inReview = [],
} = {}) {
  const findings = [];
  if (Number(behind) > 0) {
    findings.push({ kind: KIND.BEHIND, detail: `checkout is ${behind} commit(s) behind origin/main` });
  }
  if (branch && branch !== 'main') {
    findings.push({ kind: KIND.OFF_MAIN, detail: `checkout is on ${branch}, not main` });
  }
  for (const file of dirtyTracked) {
    findings.push({ kind: KIND.DIRTY_BOARD, detail: `${file} has uncommitted changes` });
  }

  const csv = new Set(csvKeys);
  const outOfPlan = new Set(outOfPlanKeys);
  for (const pr of openPrs) {
    const key = prKey(pr);
    if (!key || csv.has(key) || outOfPlan.has(key)) continue;
    findings.push({
      kind: KIND.UNBOARDED_PR,
      detail: `PR #${pr.number} "${pr.title ?? ''}" (${key}) has no row in docs/plan/jira-issues.csv and is not an out-of-plan task`,
    });
  }

  for (const rec of inReview) {
    if (rec.prState === 'MERGED' || rec.prState === 'CLOSED') {
      findings.push({
        kind: KIND.STALE_REVIEW,
        detail: `${rec.key}: PR #${rec.pr} is ${rec.prState} but the board still says in_review`,
      });
    }
  }
  return findings;
}

// No .trim() here: `git status --porcelain` lines can start with a leading space (" M path")
// that a whole-string trim would eat, shifting every slice(3) below by one and truncating the
// first path's first letter. Callers trim the single-line outputs they actually want trimmed.
function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return null;
  }
}

/**
 * Gather `boardDrift`'s input from git, `gh` and the local board mirror. `outOfPlanKeys` stays
 * empty here: querying Jira for the `out-of-plan` label needs `jira.mjs`'s credential handling,
 * which this story's Paths do not include (jira.mjs is not one of them), so a real out-of-plan
 * PR still prints an `unboarded-pr` finding today — a false positive that only asks a human to
 * look, never one that hides real drift. TODO(MARXY-117): wire the Jira query once a story
 * gives `jira.mjs` an importable out-of-plan search.
 */
export function gatherBoardCheckInput() {
  const branch = sh('git', ['branch', '--show-current'])?.trim() ?? '';
  const behindRaw = sh('git', ['rev-list', '--count', 'HEAD..origin/main'])?.trim();
  const behind = behindRaw ? Number(behindRaw) : 0;
  const status = sh('git', ['status', '--porcelain', '--', 'docs/plan', 'orchestration']) ?? '';
  const dirtyTracked = status
    .split('\n')
    .filter(Boolean)
    // `??` is an untracked file; only a tracked edit is board drift (MARXY-117 acceptance 1).
    .filter(line => !line.startsWith('??'))
    .map(line => line.slice(3).trim());

  const prJson = sh('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,headRefName'])?.trim();
  let openPrs = [];
  if (prJson) {
    try {
      openPrs = JSON.parse(prJson);
    } catch {
      /* gh unavailable or gave unparsable output: no open-PR findings this cycle */
    }
  }

  const csvKeys = parseCsv(readFileSync(`${ROOT}docs/plan/jira-issues.csv`, 'utf8')).map(r => r.Key);

  const inReview = Object.entries(state().stories ?? {})
    .filter(([, rec]) => rec.status === 'in_review' && rec.pr)
    .map(([key, rec]) => {
      const view = sh('gh', ['pr', 'view', String(rec.pr), '--json', 'state'])?.trim();
      let prState = null;
      if (view) {
        try {
          prState = JSON.parse(view).state;
        } catch {
          /* leave prState null: an unreadable PR is not provably stale */
        }
      }
      return { key, pr: rec.pr, prState };
    });

  return { branch, behind, dirtyTracked, openPrs, csvKeys, outOfPlanKeys: [], inReview };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const findings = boardDrift(gatherBoardCheckInput());
  if (findings.length) {
    for (const f of findings) console.log(`${f.kind}: ${f.detail}`);
    process.exit(1);
  }
  console.log('board-check: clean');
}
