// Worker runs: what each role is asked to do, and what a finished run means for its story
// (ADR-0034). Pure except for reading prompt templates; the reconciler (cycle.mjs) does the writing.
import { readFileSync, existsSync } from 'node:fs';
import { CODE_ROOT, notesPath, storyWorktree, newRunId } from './store.mjs';
import { story, runEvent, boardEvent } from './machine.mjs';
import { typeOf, slug } from './lib.mjs';
import { OUTCOME, inferOutcome, isAuthOutcome, isMachineFault, neverRan, producedWork } from './outcomes.mjs';
import { recordVerdict as fleetRecordVerdict, openPrFor } from './fleet.mjs';

const template = name => readFileSync(`${CODE_ROOT}orchestration/prompts/${name}.md`, 'utf8');

/** Which model an implement attempt uses: the implementor, then the escalation model once it has had its tries. */
export const implementRole = (attemptsSoFar, t) => (attemptsSoFar >= t.maxAttempts ? 'implementorEscalation' : 'implementor');

/** The story text an implementor gets. */
export function storyText(row, { notes = '', escalated = false } = {}) {
  const fields = ['Key', 'Summary', 'Labels', 'Paths', 'Description', 'Acceptance'].map(k => `- **${k}:** ${row[k] || '—'}`).join('\n');
  const esc = escalated
    ? '\n\n## This is an escalation attempt\n\nEarlier attempts by the implementor model did not finish this story. Read the notes below before anything else, and change approach rather than repeating it.'
    : '';
  return `${fields}${esc}${notes ? `\n\n## Why the previous attempt was returned\n\n${notes}` : ''}`;
}

/** The full prompt for a role. Everything a run was asked is in its run.json, for the record. */
export function promptFor(role, { key, row, rec = {}, pr, branch, escalated, read = template, notes, minutes = 45 } = {}) {
  switch (role) {
    case 'implement':
      return read('implementor').replaceAll('{{STORY}}', storyText(row, { notes, escalated })).replaceAll('{{KEY}}', key).replaceAll('{{ATTEMPT_MINUTES}}', String(minutes));
    case 'review':
      return `${read('reviewer').trimEnd()}\n\nReview ${key} (PR #${pr}) only. Start with \`node orchestration/review.mjs ${key}\`. Record your verdict with \`node orchestration/fleet.mjs verdict ${key} merge|return|escalate --notes <file>\`; it signs a merge verdict for you. Do not run \`gh pr merge\`.\n`;
    case 'resolve':
      return `${read('conflict').trimEnd()}\n\nThe story is ${key}; the branch is ${branch}; the pull request is #${pr}.\n`;
    case 'plan':
      return read('planner');
    default:
      throw new Error(`unknown role ${role}`);
  }
}

/** A run spec: what worker.mjs reads from runs/<id>/run.json. */
export function buildSpec({ role, key = null, row, rec = {}, pr, m, t, now = new Date(), bin = 'cursor-agent', notes }) {
  const attemptsSoFar = rec.attempts ?? 0;
  const modelRole = role === 'implement' || role === 'resolve'
    ? implementRole(attemptsSoFar, t)
    : role === 'review' ? 'reviewer' : 'planner';
  const model = m[modelRole] ?? m.implementor;
  const branch = rec.branch ?? (row ? `${typeOf(row)}/${key}-${slug(row.Summary ?? key)}` : null);
  const id = newRunId(key, role, now);
  const minutes = t.attemptMinutes;
  return {
    id, key, role, modelRole, model: model.model, effort: model.effort, cliEffortFlag: m.cliEffortFlag || '',
    bin, branch, pr: pr ?? rec.pr ?? null,
    worktree: key && (role === 'implement' || role === 'resolve') ? storyWorktree(key, rec.worktree) : null,
    cwd: CODE_ROOT,
    install: role === 'implement',
    started: now.toISOString(),
    deadline: new Date(now.getTime() + minutes * 60_000).toISOString(),
    stallMinutes: t.stallMinutes,
    prompt: promptFor(role, {
      key, row, rec, pr: pr ?? rec.pr, branch,
      escalated: modelRole === 'implementorEscalation', minutes,
      notes: notes ?? (key && existsSync(notesPath(key)) ? readFileSync(notesPath(key), 'utf8') : ''),
    }),
  };
}

/** The events that claim a story (or the planner slot) for a run. Guarded, so a moved story refuses it. */
export function claimEvents(spec) {
  const run = runEvent(spec.id, {
    key: spec.key, role: spec.role, model: spec.model, started: spec.started, deadline: spec.deadline,
  });
  switch (spec.role) {
    case 'implement':
      return [run, story(spec.key, {
        from: 'todo', to: 'in_progress', why: `${spec.modelRole} attempt started (${spec.model})`,
        set: { run: spec.id, branch: spec.branch, worktree: spec.worktree, role: spec.modelRole, model: spec.model, started: spec.started },
        unset: ['claim', 'hold', 'parkedReason', 'parkedBy'], inc: { attempts: 1 },
      })];
    case 'review':
      return [run, story(spec.key, { from: 'in_review', ifRun: null, why: 'reviewer started', set: { run: spec.id }, inc: { reviewTries: 1 } })];
    case 'resolve':
      return [run, story(spec.key, { from: 'in_review', ifRun: null, why: 'conflict resolution started', set: { run: spec.id }, inc: { resolveTries: 1 } })];
    case 'plan':
      return [run, boardEvent({ planner: { run: spec.id, started: spec.started, mergesAtStart: spec.mergesAtStart ?? null } })];
    default:
      return [run];
  }
}

/**
 * The last thing a run said, in words. Workers run `cursor-agent --output-format stream-json`, so
 * out.log is one JSON event per line; the final `result` (or, failing that, the last assistant text
 * or error) is the message, and ids, timings and tool payloads are noise. Lines that are not JSON
 * (a crash before the stream starts, a shell error) are the message as they stand. The tail may
 * begin mid-line, so a line that does not parse is treated as text rather than dropped.
 */
export function lastText(log = '') {
  let assistant = '';
  let other = '';
  for (const line of String(log).split('\n').map(l => l.trim()).filter(Boolean)) {
    let ev;
    try { ev = JSON.parse(line); } catch { other = line; continue; }
    if (!ev || typeof ev !== 'object') { other = line; continue; }
    if (ev.type === 'result' || ev.type === 'error') {
      const said = ev.result ?? ev.error?.message ?? ev.error ?? ev.message;
      if (typeof said === 'string' && said.trim()) return said.trim().split('\n').filter(Boolean).slice(-1)[0];
      continue;
    }
    if (ev.type === 'assistant') {
      const text = [].concat(ev.message?.content ?? []).map(c => c?.text).filter(Boolean).join(' ').trim();
      if (text) assistant = text.split('\n').filter(Boolean).slice(-1)[0];
    }
  }
  return assistant || other;
}

/** A short, stable signature of why an attempt failed, so the same failure twice is recognised. */
export function fingerprint(outcome, text = '') {
  const tail = lastText(text);
  const norm = tail.toLowerCase().replace(/[0-9a-f]{7,40}/g, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 120);
  return `${outcome}:${norm}`;
}

const VERDICT_LINE = /^verdict:\s*(merge|return|escalate)\s*$/i;
const HEAD_LINE = /^head:\s*([0-9a-f]{40})\s*$/i;

/**
 * Parse a reviewer's notes file: `verdict: merge|return|escalate`, then `head: <sha>`, then the
 * numbered notes (the shape `orchestration/prompts/reviewer.md` asks for). `null` for anything that
 * does not match — a file from before this format, one with no notes body, or plain garbage.
 */
export function parseReviewNotes(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const v = VERDICT_LINE.exec((lines[0] ?? '').trim());
  const h = HEAD_LINE.exec((lines[1] ?? '').trim());
  if (!v || !h) return null;
  const body = lines.slice(2).join('\n').trim();
  if (!body) return null;
  return { verdict: v[1].toLowerCase(), head: h[1].toLowerCase(), body };
}

const defaultReadNotes = key => {
  const p = notesPath(key);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

/**
 * When a review run ends without ever calling `fleet.mjs verdict`, the reviewer's own notes file is
 * its verdict: the prompt now has it write that file first — `verdict: …` then `head: …` then its
 * numbered notes — before it runs the command (MARXY-316, fixing the 18-hour stall MARXY-268 left
 * when three reviewer runs finished reviewing but never reached that last step).
 *
 * A file counts only when it names the PR's *current* head — the guard against a stale file, chosen
 * over comparing the file's mtime to the run's start because it also answers the separate question of
 * which head a recovered `merge` may be signed against: never a newer one than the reviewer actually
 * read. A file from an earlier run, or one naming a head the PR has since moved past, is left alone —
 * the story falls through to today's behaviour (its reviewTries accounting, nothing recorded). So is a
 * missing or malformed file.
 *
 * `findPr` and `apply` default to the exact functions `fleet.mjs verdict` itself uses (`openPrFor`,
 * `recordVerdict`), so a recovered verdict is recorded through that one code path — never a second
 * implementation of what a merge or a return means for the board.
 */
export function recoverVerdict(key, { readNotes = defaultReadNotes, findPr = openPrFor, apply = fleetRecordVerdict } = {}) {
  const parsed = parseReviewNotes(readNotes(key));
  if (!parsed) return null;
  const pr = findPr(key);
  if (!pr?.headRefOid || pr.headRefOid.toLowerCase() !== parsed.head) return null;
  const res = apply(key, parsed.verdict, parsed.body, pr);
  return res?.ok ? { verdict: parsed.verdict, message: res.message } : null;
}

/**
 * What a finished run means. `obs` is observeRuns' view of the run, `rec` the story now, `result` the
 * implementor's result file if it was written during this run, `prOpen` an open PR for the story,
 * `evidence` the worktree's commits ahead and dirtiness, `logTail` the end of its output. Pure except
 * for a review run's notes-file recovery above, which is itself fully injectable (`recover`) so a test
 * never has to touch the real store or shell out to `gh`. Returns the events to append and the lines
 * to print.
 */
export function finishRun({ id, run, obs, rec, result = null, prOpen = null, evidence = {}, logTail = '', t, now, recover = {} }) {
  const outcome = inferOutcome(obs);
  const ended = runEvent(id, { ended: now, outcome, code: obs.exit?.code ?? null, ...(obs.exit?.why ? { why: obs.exit.why } : {}) });
  const events = [ended];
  const lines = [];
  const attention = [];
  const key = run.key;

  if (run.role === 'plan') {
    events.push(boardEvent({ planner: { run: null, lastEnded: now, lastOutcome: outcome } }));
    lines.push(`planner run ended: ${outcome}`);
    if (isAuthOutcome(outcome)) attention.push({ key: 'fleet', why: 'cursor-agent could not authenticate for the planner; run `cursor-agent login`' });
    return { events, lines, attention };
  }
  if (!rec || rec.run !== id) {
    lines.push(`${id}: ended ${outcome}; ${key} had already moved on, nothing recorded`);
    return { events, lines, attention };
  }
  const base = { ifRun: id, unset: ['run'] };

  // A review or resolution that never reached its agent (the worktree could not be prepared, the CLI
  // could not log in, the worker died) has not tried anything, so it does not spend a try: three setup
  // failures used to park a story as "still conflicts after 3 resolution runs".
  let refundedTry = neverRan(outcome);
  if (run.role === 'review' || run.role === 'resolve') {
    const what = run.role === 'review' ? 'reviewer' : 'conflict resolution';
    const tries = run.role === 'review' ? 'reviewTries' : 'resolveTries';
    // A worker that died after writing valid notes still has a verdict to recover; only a run that
    // never reached its agent (setup/auth/not-started) has no notes worth reading.
    if (run.role === 'review' && !isMachineFault(outcome)) {
      const recovered = recoverVerdict(key, recover);
      if (recovered) {
        lines.push(`${key}: recovered its ${recovered.verdict} verdict from its notes file (the run ended without calling fleet.mjs verdict) — ${recovered.message}`);
        // return/escalate already moved the story out of in_review and unset run through the same
        // fleet.mjs code a live verdict command uses; the default ending below would only be refused.
        if (recovered.verdict !== 'merge') return { events, lines, attention };
        // A reviewer that reached a verdict spent its try, even if its worker then died.
        refundedTry = false;
      }
    }
    events.push(story(key, {
      ...base, from: 'in_review', why: `${what} ended (${outcome})${refundedTry ? ', try refunded' : ''}`,
      ...(refundedTry ? { inc: { [tries]: -1 } } : {}),
    }));
    lines.push(`${key}: ${what} ended (${outcome})${refundedTry ? ', try refunded' : ''}`);
    if (isAuthOutcome(outcome)) attention.push({ key: 'fleet', why: 'cursor-agent could not authenticate; run `cursor-agent login`' });
    return { events, lines, attention };
  }

  // implement
  const from = 'in_progress';
  if (isAuthOutcome(outcome)) {
    events.push(story(key, { ...base, from, to: 'todo', inc: { attempts: -1 }, why: 'cursor-agent could not authenticate; attempt refunded' }));
    attention.push({ key: 'fleet', why: 'cursor-agent could not authenticate; run `cursor-agent login` (implementor runs are refunded until then)' });
    return { events, lines: [`${key}: auth failure, attempt refunded`], attention };
  }
  // An open PR still at the head it was returned at is the PR that was sent back, not new work: a run
  // that failed before pushing must not carry it straight back into review (MARXY-217's invariant,
  // which adopt.mjs keeps and this path used to skip).
  const stale = prOpen && rec.returned?.head && rec.returned.head === prOpen.headRefOid;
  const fresh = stale ? null : prOpen;
  const pr = Number(result?.pr) > 0 ? Number(result.pr) : fresh?.number;
  if ((result?.status === 'done' && pr) || fresh) {
    events.push(story(key, {
      ...base, from, to: 'in_review', set: { pr, prOpened: now },
      unset: ['run', 'hold', 'returned', 'lastFailure', 'repeats'], why: `PR #${pr} opened`,
    }));
    const missing = !result ? '; no result file — the merge bar will ask for `pnpm done` in its worktree' : '';
    return { events, lines: [`${key}: PR #${pr} → in review${missing}`], attention };
  }
  if (result?.status === 'blocked') {
    const reason = String(result.notes ?? 'the implementor reported blocked').split('\n')[0];
    events.push(story(key, { ...base, from, to: 'blocked', set: { parkedReason: reason, blockedAt: now }, why: 'implementor reported blocked' }));
    return { events, lines: [`${key}: blocked — ${reason}`], attention };
  }
  if (outcome === OUTCOME.SETUP) {
    const fails = (rec.setupFails ?? 0) + 1;
    const why = obs.exit?.why ?? 'the worker could not prepare the worktree';
    events.push(fails >= 2
      ? story(key, { ...base, from, to: 'blocked', inc: { attempts: -1, setupFails: 1 }, set: { parkedReason: `setup failed twice: ${why}`, parkedBy: 'fleet', blockedAt: now }, why: 'setup failed twice' })
      : story(key, { ...base, from, to: 'todo', inc: { attempts: -1, setupFails: 1 }, why: `setup failed, attempt refunded: ${why}` }));
    return { events, lines: [`${key}: setup failed (${why})`], attention };
  }
  const worked = producedWork(evidence, obs.logBytes);
  if (!worked) {
    const ghosts = (rec.ghosts ?? 0) + 1;
    const tail = lastText(logTail).slice(0, 200);
    events.push(ghosts >= t.ghostLimit
      ? story(key, { ...base, from, to: 'blocked', inc: { attempts: -1, ghosts: 1 }, set: { parkedReason: `the agent produced nothing ${ghosts} times (${outcome})${tail ? `: ${tail}` : ''}`, parkedBy: 'fleet', blockedAt: now }, why: 'repeated empty runs' })
      : story(key, { ...base, from, to: 'todo', inc: { attempts: -1, ghosts: 1 }, why: `the agent produced nothing (${outcome}); attempt refunded` }));
    return { events, lines: [`${key}: empty run (${outcome}), refunded`], attention };
  }
  const fp = fingerprint(outcome, result?.notes ?? logTail);
  const repeats = rec.lastFailure === fp ? (rec.repeats ?? 1) + 1 : 1;
  const attempts = rec.attempts ?? 1;
  const cap = t.maxAttempts + t.escalationAttempts;
  const set = { lastFailure: fp, repeats };
  // The same failure twice is a model that is guessing, not converging: skip to the escalation model,
  // and if that is the model repeating itself, stop (MAST; failure #15 of the redesign brief).
  if (repeats >= 2 && attempts < t.maxAttempts) set.attempts = t.maxAttempts;
  const exhausted = attempts >= cap || (repeats >= 2 && attempts >= t.maxAttempts);
  events.push(story(key, {
    ...base, from, to: exhausted ? 'escalate' : 'todo', set: { ...set, ...(exhausted ? { blockedAt: now } : {}) },
    why: `attempt ${attempts} ${outcome}${repeats >= 2 ? ' (same failure again)' : ''}`,
  }));
  return { events, lines: [`${key}: attempt ${attempts} ${outcome} → ${exhausted ? 'escalate' : 'todo'}`], attention };
}

export { newRunId };
