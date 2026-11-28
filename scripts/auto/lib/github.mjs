// Thin gh wrapper. Only the inkstrata account contributes to the repo, so every call carries its token.
import { execFileSync } from 'node:child_process';

export const REPO = 'inkstrata/marxy';
let cached;

// The token is fetched once per process; if that fails the ambient gh login is used.
export function ghToken() {
  if (cached === undefined) {
    try {
      cached = execFileSync('gh', ['auth', 'token', '-u', 'inkstrata'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch { cached = null; }
  }
  return cached;
}

export function gh(args, { json = false, input } = {}) {
  const env = { ...process.env };
  const token = ghToken();
  if (token) env.GH_TOKEN = token;
  const out = execFileSync('gh', args, { env, input, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['pipe', 'pipe', 'pipe'] });
  return json ? JSON.parse(out || 'null') : out;
}

// Every changed path, a rename's old path included: `gh pr list` stops at 100 files and drops where a file came
// from, and either gap could hide an owner path from the gate.
export function prFiles(n) {
  const out = gh(['api', '--paginate', `repos/${REPO}/pulls/${n}/files?per_page=100`, '--jq', '.[] | .filename, (.previous_filename // empty)']);
  return out.split(/\r?\n/).filter(Boolean);
}

const PR_FIELDS = 'number,title,isDraft,state,headRefName,headRefOid,labels,body,comments,statusCheckRollup,mergeStateStatus';
export function listOpenPRs() {
  const rows = gh(['pr', 'list', '-R', REPO, '--state', 'open', '--limit', '100', '--json', PR_FIELDS], { json: true }) || [];
  return rows.map((p) => ({
    number: p.number, title: p.title, isDraft: p.isDraft, state: p.state, headRefName: p.headRefName, headRefOid: p.headRefOid,
    labels: (p.labels || []).map((l) => l.name),
    body: p.body || '', files: prFiles(p.number),
    comments: (p.comments || []).map((c) => ({ body: c.body, createdAt: c.createdAt })),
    checks: (p.statusCheckRollup || []).map((c) => ({ name: c.name || c.context, conclusion: c.conclusion || c.state, status: c.status })),
    mergeStateStatus: p.mergeStateStatus,
  }));
}

// The merge names the commit the gate judged: a push after the judgement makes GitHub refuse it.
export function mergePR(n, head) {
  if (!/^[0-9a-f]{40}$/i.test(String(head))) throw new Error(`no head commit to pin for #${n}`);
  return gh(['pr', 'merge', String(n), '--squash', '--delete-branch', '--match-head-commit', head, '-R', REPO]);
}

export function mergedSince(isoDate) {
  return gh(['pr', 'list', '-R', REPO, '--state', 'merged', '--search', `merged:>=${isoDate}`, '--json', 'number,title,mergedAt,headRefName', '--limit', '100'], { json: true }) || [];
}

export function mainCi() {
  const runs = gh(['run', 'list', '-R', REPO, '--workflow', 'ci', '--branch', 'main', '--limit', '1', '--json', 'conclusion,status,url,createdAt'], { json: true }) || [];
  return runs[0] || null;
}

const TITLE = 'Marxy dashboard';

export function upsertDashboardIssue(body) {
  const found = gh(['issue', 'list', '-R', REPO, '--state', 'open', '--label', 'dashboard', '--json', 'number,title'], { json: true }) || [];
  const hit = found.find((i) => i.title === TITLE);
  if (hit) {
    gh(['issue', 'edit', String(hit.number), '-R', REPO, '--body-file', '-'], { input: body });
    return hit.number;
  }
  try { gh(['label', 'create', 'dashboard', '-R', REPO, '--color', '0e8a16', '--description', 'Standing dashboard']); } catch { /* already there */ }
  const url = gh(['issue', 'create', '-R', REPO, '--title', TITLE, '--label', 'dashboard', '--body-file', '-'], { input: body }).trim();
  try { gh(['issue', 'pin', url, '-R', REPO]); } catch { /* pin limit or permissions: the issue still exists */ }
  return url;
}
