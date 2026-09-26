// Worker runs: what each role is asked to do, and what a finished run means for its story
// (ADR-0034). Pure except for reading prompt templates; the reconciler (cycle.mjs) does the writing.
import { readFileSync, existsSync } from 'node:fs';
import { CODE_ROOT, notesPath, worktreeFor, newRunId } from './store.mjs';
import { story, runEvent, boardEvent } from './machine.mjs';
import { typeOf, slug } from './lib.mjs';

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
    worktree: key && (role === 'implement' || role === 'resolve') ? (rec.worktree ?? worktreeFor(key)) : null,
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
        unset: ['claim', 'hold', 'parkedReason'], inc: { attempts: 1 },
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

const GHOST_BYTES = 2048;

/**
 * What a finished run means. Pure. `obs` is observeRuns' view of the run, `rec` the story now,
 * `result` the implementor's result file if it was written during this run, `prOpen` an open PR for
 * the story, `evidence` the worktree's commits ahead and dirtiness, `logTail` the end of its output.
 * Returns the events to append and the lines to print.
 */
export function finishRun({ id, run, obs, rec, result = null, prOpen = null, evidence = {}, logTail = '', t, now }) {
  const outcome = obs.exit?.outcome ?? (obs.alive ? 'timeout' : 'dead');
  const ended = runEvent(id, { ended: now, outcome, code: obs.exit?.code ?? null, ...(obs.exit?.why ? { why: obs.exit.why } : {}) });
  const events = [ended];
  const lines = [];
  const attention = [];
  const key = run.key;

  if (run.role === 'plan') {
    events.push(boardEvent({ planner: { run: null, lastEnded: now, lastOutcome: outcome } }));
    lines.push(`planner run ended: ${outcome}`);
    if (outcome === 'auth') attention.push({ key: 'fleet', why: 'cursor-agent could not authenticate for the planner; run `cursor-agent login`' });
    return { events, lines, attention };
  }
  if (!rec || rec.run !== id) {
    lines.push(`${id}: ended ${outcome}; ${key} had already moved on, nothing recorded`);
    return { events, lines, attention };
  }
  const base = { ifRun: id, unset: ['run'] };

  if (run.role === 'review') {
    events.push(story(key, { ...base, from: 'in_review', why: `reviewer ended (${outcome})` }));
    lines.push(`${key}: reviewer ended (${outcome})`);
    return { events, lines, attention };
  }
  if (run.role === 'resolve') {
    events.push(story(key, { ...base, from: 'in_review', why: `conflict resolution ended (${outcome})` }));
    lines.push(`${key}: conflict resolution ended (${outcome})`);
    return { events, lines, attention };
  }

  // implement
  const from = 'in_progress';
  if (outcome === 'auth') {
    events.push(story(key, { ...base, from, to: 'todo', inc: { attempts: -1 }, why: 'cursor-agent could not authenticate; attempt refunded' }));
    attention.push({ key: 'fleet', why: 'cursor-agent could not authenticate; run `cursor-agent login` (implementor runs are refunded until then)' });
    return { events, lines: [`${key}: auth failure, attempt refunded`], attention };
  }
  const pr = Number(result?.pr) > 0 ? Number(result.pr) : prOpen?.number;
  if ((result?.status === 'done' && pr) || prOpen) {
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
  if (outcome === 'setup') {
    const fails = (rec.setupFails ?? 0) + 1;
    const why = obs.exit?.why ?? 'the worker could not prepare the worktree';
    events.push(fails >= 2
      ? story(key, { ...base, from, to: 'blocked', inc: { attempts: -1, setupFails: 1 }, set: { parkedReason: `setup failed twice: ${why}`, blockedAt: now }, why: 'setup failed twice' })
      : story(key, { ...base, from, to: 'todo', inc: { attempts: -1, setupFails: 1 }, why: `setup failed, attempt refunded: ${why}` }));
    return { events, lines: [`${key}: setup failed (${why})`], attention };
  }
  const worked = (evidence.ahead ?? 0) > 0 || evidence.dirty || (obs.logBytes ?? 0) > GHOST_BYTES;
  if (!worked) {
    const ghosts = (rec.ghosts ?? 0) + 1;
    const tail = lastText(logTail).slice(0, 200);
    events.push(ghosts >= t.ghostLimit
      ? story(key, { ...base, from, to: 'blocked', inc: { attempts: -1, ghosts: 1 }, set: { parkedReason: `the agent produced nothing ${ghosts} times (${outcome})${tail ? `: ${tail}` : ''}`, blockedAt: now }, why: 'repeated empty runs' })
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
