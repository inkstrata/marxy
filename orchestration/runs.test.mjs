// What a finished run means for its story (ADR-0034). Every outcome lands somewhere with an exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishRun, fingerprint, implementRole, claimEvents, promptFor, storyText } from './runs.mjs';
import { fold, timing } from './machine.mjs';

const t = timing({});
const NOW = '2026-09-26T12:00:00.000Z';
const run = { id: 'r1', key: 'MARXY-1', role: 'implement', started: '2026-09-26T11:00:00.000Z', deadline: '2026-09-26T11:45:00.000Z' };
const inProgress = (over = {}) => ({ status: 'in_progress', attempts: 1, run: 'r1', ...over });

/** Apply finishRun's events to a board holding `rec`, and return the story after. */
function after(rec, args) {
  const out = finishRun({ id: 'r1', run, rec, t, now: NOW, ...args });
  const b = fold([
    { type: 'imported', at: '2026-09-26T10:00:00.000Z', board: { stories: { 'MARXY-1': { ...rec, status: 'todo' } } } },
    { type: 'story', key: 'MARXY-1', at: '2026-09-26T11:00:00.000Z', to: rec.status, set: { run: rec.run } },
    ...out.events.map(e => ({ at: NOW, ...e })),
  ], { renames: {} });
  return { rec: b.stories['MARXY-1'], out, b };
}

test('a result naming a PR, or an open PR found for the story, moves it to review', () => {
  const a = after(inProgress(), { obs: { exit: { outcome: 'exited', code: 0 } }, result: { status: 'done', pr: 42 } });
  assert.deepEqual([a.rec.status, a.rec.pr, a.rec.run], ['in_review', 42, undefined]);
  const b = after(inProgress(), { obs: { exit: { outcome: 'exited', code: 0 } }, prOpen: { number: 43 } });
  assert.deepEqual([b.rec.status, b.rec.pr], ['in_review', 43]);
  assert.match(b.out.lines[0], /no result file/);
});

test('an implementor that reports blocked parks the story with its reason', () => {
  const { rec } = after(inProgress(), { obs: { exit: { outcome: 'exited', code: 0 } }, result: { status: 'blocked', notes: 'needs a contract change\nmore' } });
  assert.deepEqual([rec.status, rec.parkedReason], ['blocked', 'needs a contract change']);
});

test('an auth failure refunds the attempt and asks a person to log in', () => {
  const { rec, out } = after(inProgress(), { obs: { exit: { outcome: 'auth', code: 1 } } });
  assert.deepEqual([rec.status, rec.attempts], ['todo', 0]);
  assert.match(out.attention[0].why, /cursor-agent login/);
});

test('an empty run is refunded; the second parks the story with the output that explains it', () => {
  const first = after(inProgress(), { obs: { exit: { outcome: 'exited', code: 1 }, logBytes: 90 }, logTail: 'error: model not found' });
  assert.deepEqual([first.rec.status, first.rec.attempts, first.rec.ghosts], ['todo', 0, 1]);
  const second = after(inProgress({ ghosts: 1 }), { obs: { exit: { outcome: 'exited', code: 1 }, logBytes: 90 }, logTail: 'error: model not found' });
  assert.equal(second.rec.status, 'blocked');
  assert.match(second.rec.parkedReason, /model not found/);
});

test('setup failures are refunded, and the second parks it', () => {
  const one = after(inProgress(), { obs: { exit: { outcome: 'setup', why: 'pnpm install timed out' } } });
  assert.deepEqual([one.rec.status, one.rec.attempts], ['todo', 0]);
  const two = after(inProgress({ setupFails: 1 }), { obs: { exit: { outcome: 'setup', why: 'pnpm install timed out' } } });
  assert.equal(two.rec.status, 'blocked');
});

test('a failed attempt with work returns to todo; the attempts cap escalates', () => {
  const evidence = { ahead: 2 };
  const one = after(inProgress({ attempts: 1 }), { obs: { exit: { outcome: 'timeout' } }, evidence, logTail: 'tests failing in a' });
  assert.equal(one.rec.status, 'todo');
  const cap = t.maxAttempts + t.escalationAttempts;
  const last = after(inProgress({ attempts: cap }), { obs: { exit: { outcome: 'exited', code: 1 } }, evidence, logTail: 'x' });
  assert.equal(last.rec.status, 'escalate');
  assert.ok(last.rec.blockedAt);
});

test('the same failure twice skips to the escalation model; the escalation model repeating it escalates', () => {
  const evidence = { dirty: true };
  const fp = fingerprint('stalled', 'running pnpm test 42');
  const skip = after(inProgress({ attempts: 1, lastFailure: fp, repeats: 1 }), { obs: { exit: { outcome: 'stalled' } }, evidence, logTail: 'running pnpm test 97' });
  assert.equal(skip.rec.status, 'todo');
  assert.equal(skip.rec.attempts, t.maxAttempts, 'the next claim uses implementorEscalation');
  assert.equal(implementRole(skip.rec.attempts, t), 'implementorEscalation');
  const stop = after(inProgress({ attempts: t.maxAttempts + 0, lastFailure: fp, repeats: 1 }), { obs: { exit: { outcome: 'stalled' } }, evidence, logTail: 'running pnpm test 3' });
  assert.equal(stop.rec.status, 'escalate');
});

test('a worker that died without an exit record is finished as dead, and one alive past its deadline as timeout', () => {
  assert.equal(finishRun({ id: 'r1', run, rec: inProgress(), obs: { alive: false }, t, now: NOW }).events[0].set.outcome, 'dead');
  assert.equal(finishRun({ id: 'r1', run, rec: inProgress(), obs: { alive: true }, t, now: NOW }).events[0].set.outcome, 'timeout');
});

test('a run whose story moved on records only its own end', () => {
  const out = finishRun({ id: 'r1', run, rec: inProgress({ run: 'r2' }), obs: { exit: { outcome: 'exited' } }, t, now: NOW });
  assert.equal(out.events.length, 1);
  assert.match(out.lines[0], /moved on/);
});

test('review and resolve runs release the story without moving it; the planner run frees the slot', () => {
  const review = finishRun({ id: 'r1', run: { ...run, role: 'review' }, rec: { status: 'in_review', run: 'r1' }, obs: { exit: { outcome: 'exited' } }, t, now: NOW });
  assert.deepEqual(review.events[1].unset, ['run']);
  assert.equal(review.events[1].to, undefined);
  const plan = finishRun({ id: 'p', run: { ...run, key: null, role: 'plan' }, obs: { exit: { outcome: 'exited' } }, t, now: NOW });
  assert.deepEqual(plan.events[1].set.planner, { run: null, lastEnded: NOW, lastOutcome: 'exited' });
});

test('fingerprints ignore numbers and hashes, so a retry of the same failure matches', () => {
  assert.equal(fingerprint('exited', 'FAIL test 12 at abc1234def'), fingerprint('exited', 'FAIL test 99 at 9876543abc'));
  assert.notEqual(fingerprint('exited', 'FAIL a'), fingerprint('timeout', 'FAIL a'));
});

test('claim events are guarded: implement from todo, review and resolve only with no run in flight', () => {
  const [, impl] = claimEvents({ id: 'x', key: 'MARXY-1', role: 'implement', modelRole: 'implementor', model: 'm', started: NOW, deadline: NOW, branch: 'b', worktree: 'w' });
  assert.equal(impl.from, 'todo');
  assert.deepEqual(impl.inc, { attempts: 1 });
  const [, review] = claimEvents({ id: 'y', key: 'MARXY-1', role: 'review', model: 'm', started: NOW, deadline: NOW });
  assert.deepEqual([review.from, review.ifRun], ['in_review', null]);
});

test('prompts carry the story, the reviewer verdict command, and the returned notes', () => {
  const read = name => `TEMPLATE ${name} {{KEY}} {{STORY}}`;
  const row = { Key: 'MARXY-9', Summary: 's', Paths: 'a', Acceptance: 'c' };
  const impl = promptFor('implement', { key: 'MARXY-9', row, read, notes: 'fix the red check', escalated: true });
  assert.match(impl, /TEMPLATE implementor MARXY-9/);
  assert.match(impl, /fix the red check/);
  assert.match(impl, /escalation attempt/);
  assert.match(promptFor('review', { key: 'MARXY-9', pr: 5, read }), /fleet\.mjs verdict MARXY-9 merge\|return\|escalate/);
  assert.doesNotMatch(storyText(row), /escalation/);
});
