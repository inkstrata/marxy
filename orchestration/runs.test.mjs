// What a finished run means for its story (ADR-0034). Every outcome lands somewhere with an exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishRun, fingerprint, lastText, implementRole, claimEvents, promptFor, storyText, buildSpec, parseReviewNotes, recoverVerdict } from './runs.mjs';
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

// MARXY-316: a review run that never called `fleet.mjs verdict` recovers the verdict from the notes
// file the reviewer prompt now writes first — but only when it names the PR's current head.
const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

test('parseReviewNotes reads the verdict, head and body, and rejects anything short of the full shape', () => {
  assert.deepEqual(parseReviewNotes(`verdict: return\nhead: ${HEAD_A}\n\n1. fix it\n2. and this\n`), {
    verdict: 'return', head: HEAD_A, body: '1. fix it\n2. and this',
  });
  assert.deepEqual(parseReviewNotes(`VERDICT: MERGE\nHEAD: ${HEAD_A.toUpperCase()}\n\nlgtm\n`), { verdict: 'merge', head: HEAD_A, body: 'lgtm' });
  assert.equal(parseReviewNotes(null), null, 'no file');
  assert.equal(parseReviewNotes(''), null, 'empty file');
  assert.equal(parseReviewNotes('just some prose\n'), null, 'no verdict line');
  assert.equal(parseReviewNotes(`verdict: maybe\nhead: ${HEAD_A}\n\nnotes\n`), null, 'not one of the three verdicts');
  assert.equal(parseReviewNotes(`verdict: return\nhead: not-a-sha\n\nnotes\n`), null, 'head is not 40 hex characters');
  assert.equal(parseReviewNotes(`verdict: return\nhead: ${HEAD_A}\n\n   \n`), null, 'no notes body');
});

test('recoverVerdict records a verdict through the same function fleet.mjs verdict uses, only when the notes name the PR\'s current head', () => {
  const calls = [];
  const apply = (key, verdict, notes, pr) => { calls.push({ key, verdict, notes, pr }); return { ok: true, message: `${key}: ${verdict} recorded` }; };
  const fresh = recoverVerdict('MARXY-1', {
    readNotes: () => `verdict: return\nhead: ${HEAD_A}\n\n1. fix the off-by-one\n`,
    findPr: () => ({ headRefOid: HEAD_A, mergeStateStatus: 'CLEAN' }),
    apply,
  });
  assert.deepEqual(fresh, { verdict: 'return', message: 'MARXY-1: return recorded' });
  assert.deepEqual(calls, [{ key: 'MARXY-1', verdict: 'return', notes: '1. fix the off-by-one', pr: { headRefOid: HEAD_A, mergeStateStatus: 'CLEAN' } }]);

  const noApply = () => { throw new Error('must not record anything'); };
  assert.equal(recoverVerdict('MARXY-1', { readNotes: () => null, apply: noApply }), null, 'no notes file: today\'s behaviour');
  assert.equal(recoverVerdict('MARXY-1', { readNotes: () => 'not well-formed\n', apply: noApply }), null, 'malformed: today\'s behaviour');
  assert.equal(recoverVerdict('MARXY-1', {
    readNotes: () => `verdict: merge\nhead: ${HEAD_A}\n\nlgtm\n`,
    findPr: () => ({ headRefOid: HEAD_B, mergeStateStatus: 'CLEAN' }),
    apply: noApply,
  }), null, 'the PR moved past the head the reviewer read: today\'s behaviour, never sign a newer head');
  assert.equal(recoverVerdict('MARXY-1', {
    readNotes: () => `verdict: merge\nhead: ${HEAD_A}\n\nlgtm\n`,
    findPr: () => null,
    apply: noApply,
  }), null, 'no PR found: today\'s behaviour');
});

test('a review run ending without a verdict command recovers a return/escalate verdict and stops there', () => {
  const calls = [];
  const recover = {
    readNotes: () => `verdict: return\nhead: ${HEAD_A}\n\n1. fix it\n`,
    findPr: () => ({ headRefOid: HEAD_A, mergeStateStatus: 'CLEAN' }),
    apply: (...a) => { calls.push(a); return { ok: true, message: 'MARXY-1: return recorded → todo' }; },
  };
  const out = finishRun({ id: 'r1', run: { ...run, role: 'review' }, rec: { status: 'in_review', run: 'r1' }, obs: { exit: { outcome: 'exited' } }, t, now: NOW, recover });
  assert.equal(calls.length, 1, 'recorded through recover.apply exactly once');
  // Only the run's own "ended" event: recording the verdict already moved the story and unset run
  // through fleet.mjs's own code, so the default review-ended event (from: 'in_review') would be a
  // no-op the fold refuses — recoverVerdict's caller must not push it.
  assert.equal(out.events.length, 1);
  assert.match(out.lines[0], /recovered its return verdict from its notes file/);
});

test('a reviewer that died after writing valid notes still has its verdict recovered; setup/auth never-ran runs do not', () => {
  for (const [outcome, obs, expected] of [['dead', { alive: false }, 1], ['setup', { exit: { outcome: 'setup' } }, 0], ['auth', { exit: { outcome: 'auth' } }, 0]]) {
    let applied = 0;
    const recover = {
      readNotes: () => `verdict: return\nhead: ${HEAD_A}\n\n1. fix it\n`,
      findPr: () => ({ headRefOid: HEAD_A, mergeStateStatus: 'CLEAN' }),
      apply: () => { applied++; return { ok: true, message: 'recorded' }; },
    };
    finishRun({ id: 'r1', run: { ...run, role: 'review' }, rec: { status: 'in_review', run: 'r1' }, obs, t, now: NOW, recover });
    assert.equal(applied, expected, outcome);
  }
});

test('a recovered merge verdict still runs the normal review-ended bookkeeping, since signing does not move the story', () => {
  const recover = {
    readNotes: () => `verdict: merge\nhead: ${HEAD_A}\n\nlooks good\n`,
    findPr: () => ({ headRefOid: HEAD_A, mergeStateStatus: 'CLEAN' }),
    apply: () => ({ ok: true, message: `MARXY-1: approved and signed for ${HEAD_A.slice(0, 7)}` }),
  };
  const out = finishRun({ id: 'r1', run: { ...run, role: 'review' }, rec: { status: 'in_review', run: 'r1' }, obs: { exit: { outcome: 'exited' } }, t, now: NOW, recover });
  assert.equal(out.events.length, 2);
  assert.deepEqual(out.events[1].unset, ['run']);
  assert.match(out.lines[0], /recovered its merge verdict/);
  assert.match(out.lines[1], /reviewer ended \(exited\)/);
});

test('a review run that never reached its agent does not attempt verdict recovery (nothing to recover)', () => {
  const noApply = () => { throw new Error('must not be called: the reviewer never ran'); };
  const out = finishRun({
    id: 'r1', run: { ...run, role: 'review' }, rec: { status: 'in_review', run: 'r1', reviewTries: 2 },
    obs: { exit: { outcome: 'setup', why: 'worktree busy' } }, t, now: NOW,
    recover: { readNotes: noApply, findPr: noApply, apply: noApply },
  });
  assert.match(out.lines[0], /try refunded/);
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

test('stream-json tails that differ only in ids, timings and counts fingerprint the same', async () => {
  const { readFileSync } = await import('node:fs');
  const tail = n => readFileSync(new URL(`./fixtures/stream-json-failed-${n}.ndjson`, import.meta.url), 'utf8');
  assert.equal(lastText(tail('a')), 'pnpm precheck failed: 3 tests failing in packages/core');
  assert.equal(fingerprint('exited', tail('a')), fingerprint('exited', tail('b')));
  assert.equal(fingerprint('exited', tail('a')), 'exited:pnpm precheck failed: # tests failing in packages/core');
});

test('lastText prefers the result, falls back to the last assistant text, then to a plain line', () => {
  const ev = o => JSON.stringify(o);
  const say = text => ev({ type: 'assistant', message: { content: [{ text }] } });
  assert.equal(lastText([say('first'), say('second'), ev({ type: 'tool_call', call_id: 'x' })].join('\n')), 'second');
  assert.equal(lastText(['error: model not found'].join('\n')), 'error: model not found');
  assert.equal(lastText('{"type":"assistant","message":{"conte\n' + say('cut tail')), 'cut tail');
  assert.equal(lastText(''), '');
});

test('a failed implement run does not carry the PR it was returned at back into review', () => {
  const rec = inProgress({ returned: { at: NOW, head: 'abc', why: 'conflicts' } });
  const same = after(rec, { obs: { exit: { outcome: 'setup', why: 'git worktree add: already used' } }, prOpen: { number: 212, headRefOid: 'abc' } });
  assert.notEqual(same.rec.status, 'in_review');
  const pushed = after(rec, { obs: { exit: { outcome: 'exited', code: 0 } }, prOpen: { number: 212, headRefOid: 'def' } });
  assert.deepEqual([pushed.rec.status, pushed.rec.pr], ['in_review', 212]);
});

test('a review or resolution that never reached its agent refunds its try; one that ran does not', () => {
  for (const [role, tries] of [['resolve', 'resolveTries'], ['review', 'reviewTries']]) {
    for (const outcome of ['setup', 'auth', 'dead']) {
      const out = finishRun({ id: 'r1', run: { ...run, role }, rec: { status: 'in_review', run: 'r1', [tries]: 2 }, obs: { exit: { outcome } }, t, now: NOW });
      assert.deepEqual(out.events[1].inc, { [tries]: -1 }, `${role} ${outcome}`);
    }
    const ran = finishRun({ id: 'r1', run: { ...run, role }, rec: { status: 'in_review', run: 'r1', [tries]: 2 }, obs: { exit: { outcome: 'exited', code: 1 } }, t, now: NOW });
    assert.equal(ran.events[1].inc, undefined);
  }
});

test('a worktree recorded as a relative path is resolved beside the home checkout, not the runner', () => {
  const was = process.env.MARXY_REPO_HOME;
  process.env.MARXY_REPO_HOME = '/home/dev/marxy';
  try {
    const row = { Key: 'MARXY-1', Summary: 's', Labels: '', Paths: 'a' };
    const m = { implementor: { model: 'x' } };
    const rel = buildSpec({ role: 'implement', key: 'MARXY-1', row, rec: { worktree: '../marxy-wt/MARXY-1' }, m, t });
    assert.equal(rel.worktree, '/home/dev/marxy-wt/MARXY-1');
    const abs = buildSpec({ role: 'resolve', key: 'MARXY-1', row, rec: { worktree: '/elsewhere/MARXY-1' }, m, t });
    assert.equal(abs.worktree, '/elsewhere/MARXY-1');
  } finally { if (was === undefined) delete process.env.MARXY_REPO_HOME; else process.env.MARXY_REPO_HOME = was; }
});
