// Merge-readiness table for every open PR. Decisions come from merge-bar evaluate and
// approve verify so the print and the cycle cannot disagree; order is the one 80/81 already
// compute. GitHub never sets REVIEW_REQUIRED on Ian's own CODEOWNERS PRs, so those wait
// for Ian even when CI is green (MARXY-92).
// usage: node orchestration/readiness.mjs [--json] [--results DIR]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, readJson, stories, state, deps, pathsOf, pathMatches } from './lib.mjs';
import { classifyChecks, evaluate } from './merge-bar.mjs';
import { verify } from './approve.mjs';
import { computeOrder, readPullRequest } from './review-order.mjs';

export { evaluate, verify, computeOrder };

/** GitHub login on CODEOWNERS and the repo; the account the overlay names. */
export const IAN = 'inkstrata';

const EXTRAS = ['CHANGELOG.md', 'docs/taste-review/queue.md', 'pnpm-lock.yaml'];

/** CODEOWNERS lines as `{ pattern, owners }` with the leading slash stripped. */
export function codeOwnerPatterns(text) {
  return String(text ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [pattern, ...owners] = l.split(/\s+/);
      return { pattern: pattern.replace(/^\//, ''), owners: owners.map(o => o.replace(/^@/, '')) };
    })
    .filter(p => p.pattern);
}

export function ownedBy(patterns, file) {
  return patterns.some(p => (p.pattern.endsWith('/') ? file.startsWith(p.pattern) : file === p.pattern));
}

export function ciConclusion(pr) {
  const { checks, red, pending } = classifyChecks(pr.statusCheckRollup);
  if (!checks.length) return 'none';
  if (red.length) return 'red';
  if (pending.length) return 'pending';
  return 'green';
}

export function approvalState(approval) {
  if (approval?.ok) return approval.head ? `signed ${String(approval.head).slice(0, 7)}` : 'signed';
  const why = approval?.why ?? 'not reviewed (no results/KEY.approved)';
  if (/^not reviewed/.test(why)) return 'none';
  if (/unsigned/.test(why)) return 'unsigned';
  return 'stale';
}

function filesOf(pr) {
  return (pr.files ?? []).map(f => (typeof f === 'string' ? f : f.path)).filter(Boolean);
}

function storyKeyOf(pr) {
  return (String(pr.title ?? '').match(/MARXY-\d+/) ?? String(pr.headRefName ?? '').match(/MARXY-\d+/))?.[0] ?? null;
}

function isIan(pr) {
  const login = pr.author?.login ?? pr.author;
  return login === IAN;
}

function resultPath(resultsDir, name) {
  return resultsDir ? `${String(resultsDir).replace(/\/$/, '')}/${name}` : here(`results/${name}`);
}

/**
 * Who still has to act. Evaluate already names CODEOWNERS when GitHub sets REVIEW_REQUIRED;
 * Ian's own PRs never get that signal, so a CODEOWNERS path on his account is Ian regardless
 * of a green evaluate.
 */
export function waitingOn({ pr, files, decision, patterns }) {
  if (isIan(pr) && files.some(f => ownedBy(patterns, f))) return 'Ian';
  if (decision.reasons.some(r => /human review required/.test(r))) return 'Ian';
  if (decision.action === 'merge') return '—';
  if (decision.action === 'auto-merge') return 'CI';
  if (decision.reasons.some(r => /not reviewed|approval|changes requested/.test(r))) return 'reviewer';
  if (decision.reasons.some(r => /files outside/.test(r))) return 'planner';
  return 'implementor';
}

export function nextAction({ waiting, decision }) {
  if (waiting === 'Ian') return 'wait for Ian to approve on GitHub';
  if (decision.action === 'merge') return 'cycle.mjs merges it';
  if (decision.action === 'auto-merge') return 'waiting on CI; cycle enables auto-merge';
  return decision.reasons.find(r => !r.startsWith('pending:')) ?? decision.reasons[0] ?? 'hold';
}

/** Same six fields the text table and --json both print. */
export function tableRows(rows) {
  return rows.map(r => ({
    url: r.url,
    ci: r.ci,
    mergeable: r.mergeable,
    approval: r.approval,
    waitingOn: r.waitingOn,
    next: r.next,
  }));
}

export function formatText(rows) {
  const cells = tableRows(rows);
  const esc = s => String(s ?? '').replace(/\|/g, '\\|');
  const lines = [
    '| URL | CI | Mergeable | Approval | Waiting on | Next |',
    '| --- | --- | --- | --- | --- | --- |',
    ...cells.map(c => `| ${esc(c.url)} | ${esc(c.ci)} | ${esc(c.mergeable)} | ${esc(c.approval)} | ${esc(c.waitingOn)} | ${esc(c.next)} |`),
  ];
  return lines.join('\n');
}

export function formatJson(rows) {
  return JSON.stringify(tableRows(rows), null, 2);
}

export function sortByReviewOrder(rows, orderKeys) {
  const rank = new Map((orderKeys ?? []).map((k, i) => [k, i]));
  return [...rows].sort((a, b) => {
    const ia = rank.has(a.key) ? rank.get(a.key) : Number.POSITIVE_INFINITY;
    const ib = rank.has(b.key) ? rank.get(b.key) : Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    return (a.number ?? 0) - (b.number ?? 0);
  });
}

/**
 * Build one row per open PR. `evaluate` / `verify` / `computeOrder` default to the live
 * bindings so a fixture can swap them and prove the table did not grow a second bar.
 */
export function collect({
  prs,
  evaluate: ev = evaluate,
  verify: vf = verify,
  computeOrder: orderOf = computeOrder,
  stories: all,
  state: board,
  deps: d,
  readPr,
  now = Date.now(),
  resultsDir,
  codeownersText,
  readResult,
  mergeUnreviewed = false,
} = {}) {
  if (!Array.isArray(prs)) throw new Error('collect requires prs');
  const patterns = codeOwnerPatterns(
    codeownersText !== undefined
      ? codeownersText
      : existsSync(`${ROOT}.github/CODEOWNERS`)
        ? readFileSync(`${ROOT}.github/CODEOWNERS`, 'utf8')
        : '',
  );
  const storyList = all ?? stories();
  const rows = prs.map(pr => {
    const key = storyKeyOf(pr);
    const story = key && storyList.find(s => s.Key === key);
    const files = filesOf(pr);
    const allowed = story
      ? [...pathsOf(story), ...EXTRAS, `orchestration/results/${key}.json`]
      : null;
    const outside = allowed ? files.filter(f => !allowed.some(a => pathMatches(f, a))) : [];
    const result = readResult
      ? readResult(key)
      : key && existsSync(resultPath(resultsDir, `${key}.json`))
        ? readJson(resultPath(resultsDir, `${key}.json`))
        : null;
    const approval = key
      ? vf(resultPath(resultsDir, `${key}.approved`), pr.headRefOid)
      : { ok: false, why: 'not reviewed (no results/KEY.approved)' };
    const decision = ev({
      pr,
      files,
      outside,
      result,
      attribution: false,
      approval,
      mergeUnreviewed,
    });
    const waiting = waitingOn({ pr, files, decision, patterns });
    return {
      key,
      number: pr.number,
      url: pr.url,
      ci: ciConclusion(pr),
      mergeable: pr.mergeable,
      approval: approvalState(approval),
      waitingOn: waiting,
      next: nextAction({ waiting, decision }),
      action: decision.action,
      reasons: decision.reasons,
    };
  });
  const ordered = orderOf({
    ...(board ? { s: board } : {}),
    ...(d ? { d } : {}),
    ...(readPr ? { readPr } : {}),
    now,
  });
  return sortByReviewOrder(rows, (ordered.order ?? []).map(r => r.key));
}

function livePrs() {
  return JSON.parse(
    execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '200',
        '--json',
        'number,title,url,headRefName,headRefOid,state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,createdAt,files,author',
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 },
    ).trim(),
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const flag = process.argv.indexOf('--results');
  const rows = collect({
    prs: livePrs(),
    resultsDir: flag > 0 ? process.argv[flag + 1] : undefined,
    readPr: readPullRequest,
    state: state(),
    deps: deps(),
  });
  console.log(process.argv.includes('--json') ? formatJson(rows) : formatText(rows));
}
