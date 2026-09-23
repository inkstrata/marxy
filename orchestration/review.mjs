// Review packet for one story. Exits non-zero when the branch or the diff cannot be determined,
// so a missing branch cannot pass the boundary checks as "none" (MARXY-9).
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, stories, state, pathsOf, pathMatches } from './lib.mjs';
import { BOARD_FILES, reviewBoundary } from '../scripts/lib/own-row.mjs';

/** Boundary checks that need a branch; named when state.json has none (MARXY-81). */
export const BRANCHLESS_CHECKS = [
  'files outside paths',
  'contract files touched',
  'fixtures/fonts touched',
  'files this branch deletes',
];

/** Extra paths every story may touch, alongside CHANGELOG.md. */
export const EXTRA_BOUNDARIES = [
  'CHANGELOG.md',
  'docs/taste-review/queue.md',
  'pnpm-lock.yaml',
  'results',
  'orchestration/results',
];

const ATTRIBUTION_RE = /co-authored-by:.*(claude|cursor|gpt|grok|copilot)|generated with/i;

/** Paths the boundary check treats as inside the story. */
/** reviewBoundary for a live branch ref against origin/main. */
function liveBoundary(key, ref) {
  const show = spec => { const r = run('git', ['show', spec]); return r.ok ? r.out : null; };
  return reviewBoundary(key, {
    baseCsv: show(`origin/main:${BOARD_FILES[0]}`) ?? '', headCsv: show(`${ref}:${BOARD_FILES[0]}`) ?? '',
    baseDeps: show(`origin/main:${BOARD_FILES[1]}`) ?? '{}', headDeps: show(`${ref}:${BOARD_FILES[1]}`) ?? '{}',
  });
}

export function allowedFor(st, key) {
  return [...pathsOf(st), ...EXTRA_BOUNDARIES, `orchestration/results/${key}.json`];
}

/** Whether a changed file is inside the story's paths or an allowed extra. */
export function fileAllowed(file, allowed) {
  return allowed.some(a => file === a || pathMatches(file, a) || file.startsWith(a.replace(/\/$/, '') + '/'));
}

/** Story Acceptance split the same way `pnpm done` splits it. */
export function criteriaOf(st) {
  return String(st?.Acceptance || '').split(/;\s+|\n/).map(s => s.trim()).filter(Boolean);
}

/**
 * Every story criterion must be claimed by a result.acceptance row with a real check.
 * Matching is exact or substring so a slightly shorter result line still counts.
 */
export function acceptanceClaimed(st, result) {
  const criteria = criteriaOf(st);
  if (!criteria.length) return { ok: false, missing: ['(story Acceptance is empty)'] };
  if (!result?.acceptance?.length) return { ok: false, missing: criteria };
  const missing = [];
  for (const c of criteria) {
    const hit = (result.acceptance || []).find(a =>
      a.criterion === c || (a.criterion && (a.criterion.includes(c) || c.includes(a.criterion))),
    );
    if (!hit || !hit.checkedBy || hit.checkedBy.length < 3 || /TODO/i.test(hit.checkedBy)) {
      missing.push(c);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Golden or screenshot-baseline files, the same set check-pr.mjs watches. */
export function baselinesChanged(files) {
  return (files || []).some(f => /goldens\/|fixtures\/baselines\//.test(f));
}

/** pass / fail / n/a — n/a when fixtures/baselines did not change. */
export function tasteQueueVerdict(files) {
  if (!baselinesChanged(files)) return 'n/a';
  return (files || []).includes('docs/taste-review/queue.md') ? 'pass' : 'fail';
}

function line(label, verdict, detail = '') {
  return `- ${label}: ${verdict}${detail ? ` (${detail})` : ''}`;
}

function run(cmd, args, cwd = ROOT) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim() };
  } catch (e) {
    const err = (e.stderr || e.stdout || e.message || '').toString().trim();
    return { ok: false, out: err };
  }
}

/**
 * Build a review packet. When `ctx` supplies files / result / rev, no git or gh is consulted
 * — that is how the fixture-board tests drive the script.
 */
export function buildReview(key, ctx = {}) {
  const all = ctx.stories ?? stories();
  const rec = (ctx.state ?? state()).stories[key] ?? {};
  const injectedBoard = ctx.stories !== undefined || ctx.state !== undefined;
  // The row the merge bar will judge by (MARXY-190): the branch's own row when it edits no other
  // story's, so an out-of-plan PR's row and a story's widened Paths are what the reviewer sees too.
  const boundary = ctx.boundary !== undefined ? ctx.boundary
    : !injectedBoard && rec.branch ? liveBoundary(key, `origin/${rec.branch}`) : null;
  const st = boundary?.story ?? all.find(x => x.Key === key);
  if (!st) return { ok: false, exit: 2, text: `unknown key: ${key} has no row on main${rec.branch ? ' or on its branch' : ''}` };
  const result = ctx.result !== undefined
    ? ctx.result
    : existsSync(here(`results/${key}.json`))
      ? JSON.parse(readFileSync(here(`results/${key}.json`), 'utf8'))
      : null;

  const injected = ctx.stories !== undefined || ctx.state !== undefined || ctx.files !== undefined
    || ctx.rev !== undefined || ctx.determined === false || ctx.diffError !== undefined;

  let rev = ctx.rev ?? rec.branch ?? null;
  let files = ctx.files;
  let deleted = ctx.deleted ?? [];
  let attribution = ctx.attribution;
  let drift = ctx.drift ?? '';
  let prJson = ctx.pr ?? '(no PR)';

  if (ctx.diffError) {
    return {
      ok: false,
      exit: 1,
      text: `cannot compute the diff for ${key}: ${ctx.diffError}`,
    };
  }

  if (injected) {
    if (ctx.determined === false || !rev) {
      return noBranch(key);
    }
  } else {
    const localBranch = rec.branch;
    const prNumber = (result?.pr ?? rec.pr) || null;
    let headSha = '';
    if (prNumber) {
      const viewed = run('gh', ['pr', 'view', String(prNumber), '--json', 'headRefOid', '--jq', '.headRefOid']);
      if (viewed.ok && /^[0-9a-f]{40}$/.test(viewed.out)) headSha = viewed.out;
    }
    rev = headSha || localBranch;
    if (!rev) return noBranch(key);
    run('git', ['fetch', '-q', 'origin']);
    const resolved = run('git', ['rev-parse', '--verify', `${rev}^{commit}`]);
    if (!resolved.ok) {
      return {
        ok: false,
        exit: 1,
        text: `cannot determine the branch for ${key}: ${rev} is not a commit; `
          + 'refusing to report boundary checks as clean',
      };
    }
    const diff = run('git', ['diff', '--name-only', `origin/main...${rev}`]);
    if (!diff.ok) {
      return {
        ok: false,
        exit: 1,
        text: `cannot compute the diff for ${key}: ${diff.out || 'git diff failed'}`,
      };
    }
    files = diff.out.split('\n').filter(Boolean);
    const del = run('git', ['diff', '--diff-filter=D', '--name-only', `origin/main...${rev}`]);
    deleted = del.ok ? del.out.split('\n').filter(Boolean) : [];
    const log = run('git', ['log', `origin/main..${rev}`, '--format=%B']);
    attribution = log.ok && ATTRIBUTION_RE.test(log.out) ? log.out : '';
    if (headSha && localBranch) {
      const local = run('git', ['rev-parse', localBranch]);
      if (local.ok && local.out !== rev) {
        const short = run('git', ['rev-parse', '--short', localBranch]);
        drift = `the PR head ${rev.slice(0, 7)} is not ${localBranch} (${short.ok ? short.out : '?'}); `
          + 'this packet describes the PR';
      }
    }
    if (result?.pr) {
      const pr = run('gh', [
        'pr', 'view', String(result.pr),
        '--json', 'state,mergeable,statusCheckRollup,reviewDecision,additions,deletions',
        '--jq', '{state,mergeable,reviewDecision,additions,deletions,checks:[.statusCheckRollup[]?|{name,conclusion}]}',
      ]);
      prJson = pr.ok ? pr.out : '(no PR)';
    }
  }

  files = files ?? [];
  const allowed = allowedFor(st, key);
  const outside = files
    .filter(f => !(fileAllowed(f, allowed) || (boundary?.ownOnly && BOARD_FILES.includes(f))))
    .map(f => (boundary && !boundary.ownOnly && BOARD_FILES.includes(f) ? `${f} (edits ${boundary.others.join(', ')})` : f));
  const boardLine = !boundary ? null
    : boundary.added ? `- board row: brought by this branch (out-of-plan; ${boundary.story?.Labels ?? ''})`
      : boundary.widened.length ? `- WARNING: this branch widens its own Paths: ${boundary.widened.join(', ')} — accept only if an acceptance criterion needs it`
        : null;
  const contracts = files.filter(f => /packages\/[^/]+\/src\/contracts\//.test(f) || f === 'packages/theme/src/tokens.css');
  const fixtures = files.filter(f => f.startsWith('fixtures/corpus/') || f.startsWith('fonts/'));
  const schemaProblems = validateResult(result);
  const claimed = acceptanceClaimed(st, result);
  const changelog = files.includes('CHANGELOG.md') ? 'pass' : 'fail';
  const acceptance = claimed.ok ? 'pass' : 'fail';
  const tasteQueue = tasteQueueVerdict(files);
  const attrib = attribution ? 'FOUND' : 'none';
  const stat = ctx.stat ?? (rev && !injected ? run('git', ['diff', '--stat', `origin/main...${rev}`]).out : '');

  const doneLines = [
    line('CHANGELOG.md entry', changelog),
    line('every acceptance criterion claimed by a check', acceptance,
      claimed.ok ? '' : `unclaimed: ${claimed.missing.map(m => JSON.stringify(m)).join(', ')}`),
    line('taste-queue entry (fixtures/baselines changed)', tasteQueue),
  ];

  const text = [
    `# Review packet — ${key}`,
    '',
    '## Story',
    `- ${st.Summary}`,
    `- Paths: ${st.Paths}`,
    `- Labels: ${st.Labels}`,
    '',
    '## Acceptance criteria',
    st.Acceptance,
    '',
    '## Diff',
    stat || (rev ? `(${files.length} file(s))` : '(no branch)'),
    '',
    '## Boundary check',
    `- files outside paths: ${outside.length ? outside.join(', ') : 'none'}`,
    ...(boardLine ? [boardLine] : []),
    `- contract files touched: ${contracts.length ? contracts.join(', ') : 'none'}`,
    `- fixtures/fonts touched: ${fixtures.length ? fixtures.join(', ') : 'none'}`,
    `- files this branch deletes: ${deleted.length ? deleted.join(', ') : 'none'}`,
    `- attribution trailers: ${attrib}${drift ? `\n- WARNING: ${drift}` : ''}`,
    '',
    '## Definition of done',
    ...doneLines,
    '',
    '## Implementor result',
    schemaProblems.length ? `⚠ result file problems: ${schemaProblems.join('; ')} → return` : '',
    result ? JSON.stringify(result, null, 2) : '(missing — treat as failed)',
    '',
    '## PR',
    prJson,
    '',
    '## Decide',
    `merge (write and sign results/${key}.approved; do not merge) | return (write results/${key}.notes.md) | escalate`,
  ].join('\n');

  return {
    ok: true,
    exit: 0,
    text,
    files,
    outside,
    done: { changelog, acceptance, tasteQueue },
  };
}

function noBranch(key) {
  return {
    ok: false,
    exit: 1,
    text: `cannot determine the branch for ${key}: state.json has no branch; `
      + 'these boundary checks cannot run without it and will not be reported as none: '
      + BRANCHLESS_CHECKS.join(', '),
  };
}

function validateResult(result) {
  const schemaProblems = [];
  if (!result) return schemaProblems;
  const schema = JSON.parse(readFileSync(here('schema/result.schema.json'), 'utf8'));
  for (const k of schema.required) if (!(k in result)) schemaProblems.push(`missing "${k}"`);
  if (result.status && !schema.properties.status.enum.includes(result.status)) {
    schemaProblems.push(`status "${result.status}" not in ${schema.properties.status.enum.join('|')}`);
  }
  for (const a of result.acceptance || []) {
    if (!a.checkedBy || a.checkedBy.length < 3 || /TODO/i.test(a.checkedBy)) {
      schemaProblems.push(`criterion without a named check: "${String(a.criterion).slice(0, 60)}"`);
    }
  }
  return schemaProblems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const key = process.argv[2];
  if (!key) { console.error('usage: node review.mjs KEY'); process.exit(2); }
  const packet = buildReview(key);
  console[packet.ok ? 'log' : 'error'](packet.text);
  process.exit(packet.exit);
}
