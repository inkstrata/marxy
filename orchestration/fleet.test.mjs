// The fleet's command line against a temporary store and a fake `gh` (ADR-0034). Each command's
// happy path, and every refusal: wrong status, unknown key, missing arguments.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The approval key lives under $HOME; never let a test create or read the real one.
const sandbox = mkdtempSync(join(tmpdir(), 'marxy-fleet-cli-'));
process.env.HOME = join(sandbox, 'home');
mkdirSync(process.env.HOME);
const { run } = await import('./fleet.mjs');
const { board } = await import('./machine.mjs');
const { append, approvalPath, notesPath, resultPath, fleetPath } = await import('./store.mjs');
const { verify } = await import('./approve.mjs');

const HEAD = 'a'.repeat(40);
let n = 0;

// A fake gh that prints whatever FAKE_GH_OUT names, for `gh pr list` and everything else.
const bin = join(sandbox, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'gh'), '#!/bin/sh\ncat "$FAKE_GH_OUT"\n');
chmodSync(join(bin, 'gh'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
const ghPrs = prs => {
  const f = join(sandbox, `gh-${n}.json`);
  writeFileSync(f, JSON.stringify(prs));
  process.env.FAKE_GH_OUT = f;
};
const openPr = (key, over = {}) => ({ number: 7, headRefOid: HEAD, headRefName: `feat/${key}-x`, mergeStateStatus: 'CLEAN', title: `feat: x (${key})`, ...over });

/** A fresh store holding these stories (an `imported` event, so nothing legacy is read). */
function seed(stories = {}) {
  process.env.MARXY_FLEET_DIR = join(sandbox, `fleet-${++n}`);
  append({ type: 'imported', board: { stories } });
  ghPrs([]);
}
const rec = key => board().stories[key];
const notesFile = text => { const f = join(sandbox, `notes-${n}.md`); writeFileSync(f, text); return f; };
const K = 'MARXY-501';

beforeEach(() => seed());

test('an unknown command prints the usage and exits 2', () => {
  const r = run('bogus');
  assert.equal(r.code, 2);
  assert.match(r.errors.join('\n'), /fleet\.mjs claim KEY/);
  assert.equal(run('constructor').code, 2, 'a name on Object.prototype is not a command');
});

test('status says so when no cycle has run, and prints the last one when there is', () => {
  assert.match(run('status').lines[0], /no status yet/);
  writeFileSync(fleetPath('status.md'), '# fleet\n');
  assert.deepEqual(run('status').lines, ['# fleet\n']);
});

test('path names the store file for a story, and refuses a bad kind or key', () => {
  assert.deepEqual(run('path', ['result', K]).lines, [resultPath(K)]);
  assert.deepEqual(run('path', ['approved', K]).lines, [approvalPath(K)]);
  assert.deepEqual(run('path', ['notes', K]).lines, [notesPath(K)]);
  assert.equal(run('path', ['nope', K]).code, 2);
  assert.equal(run('path', ['result', 'MARXY-x']).code, 2);
});

test('claim moves a todo story to in progress with a claim, and reserves it', () => {
  seed({ [K]: { status: 'todo' } });
  const r = run('claim', [K, '--hours', '2', '--note', 'by hand']);
  assert.equal(r.code, 0);
  assert.match(r.lines[0], new RegExp(`${K}: claimed until`));
  assert.equal(rec(K).status, 'in_progress');
  assert.equal(rec(K).claim.note, 'by hand');
  const hours = (Date.parse(rec(K).claim.until) - Date.now()) / 3_600_000;
  assert.ok(hours > 1.9 && hours <= 2, `${hours} hours`);
});

test('claim on a claimed story renews it; on any other status it is refused', () => {
  seed({ [K]: { status: 'in_progress', claim: { by: 'me', until: '2000-01-01T00:00:00.000Z' } } });
  const renewed = run('claim', [K]);
  assert.match(renewed.lines[0], /claim renewed/);
  assert.ok(Date.parse(rec(K).claim.until) > Date.now());
  seed({ [K]: { status: 'in_review' } });
  const refused = run('claim', [K]);
  assert.equal(refused.code, 1);
  assert.match(refused.errors[0], new RegExp(`✗ ${K}: refused`));
  assert.equal(rec(K).status, 'in_review');
});

test('claim refuses a missing or malformed key, and a key that is on neither the board nor main', () => {
  assert.equal(run('claim').code, 2);
  assert.equal(run('claim', ['501']).code, 2);
  const unknown = run('claim', ['MARXY-999999']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.errors[0], /not on the board and has no row on origin\/main/);
  assert.equal(rec('MARXY-999999'), undefined, 'nothing was written');
});

test('claim with its own --paths, or --force, takes a key that has no row yet', () => {
  assert.equal(run('claim', ['MARXY-998', '--paths', 'a/, b/']).code, 0);
  assert.deepEqual(rec('MARXY-998').claim.paths, ['a/', 'b/']);
  assert.equal(run('claim', ['MARXY-997', '--force']).code, 0);
});

test('release gives a claim back; a story with a run in flight, or not claimed, refuses', () => {
  seed({ [K]: { status: 'in_progress', claim: { by: 'me', until: '2099-01-01T00:00:00.000Z' } }, 'MARXY-502': { status: 'in_progress', run: 'r1' }, 'MARXY-503': { status: 'todo' } });
  assert.equal(run('release', [K]).code, 0);
  assert.deepEqual([rec(K).status, rec(K).claim], ['todo', undefined]);
  assert.equal(run('release', ['MARXY-502']).code, 1);
  assert.equal(run('release', ['MARXY-503']).code, 1);
  assert.equal(run('release').code, 2);
});

test('park blocks a story and unpark returns it to todo; each refuses the wrong status', () => {
  seed({ [K]: { status: 'in_review' }, 'MARXY-502': { status: 'done' }, 'MARXY-503': { status: 'todo', ghosts: 2 } });
  const parked = run('park', [K, 'waiting', 'on', 'a', 'decision']);
  assert.equal(parked.code, 0);
  assert.deepEqual([rec(K).status, rec(K).parkedReason], ['blocked', 'waiting on a decision']);
  assert.equal(run('park', ['MARXY-502', 'why']).code, 1, 'a finished story cannot be parked');
  assert.equal(run('park', [K]).code, 2, 'a reason is required');
  assert.equal(run('park', ['MARXY-999999', 'why']).code, 2, 'an unknown key');
  assert.equal(run('unpark', [K]).code, 0);
  assert.equal(rec(K).status, 'todo');
  assert.equal(rec(K).parkedReason, undefined);
  assert.equal(run('unpark', ['MARXY-503']).code, 1, 'only a blocked story can be unparked');
  assert.equal(run('unpark').code, 2);
});

test('retry sends an escalated story back for one more attempt, or a fresh start with --fresh', () => {
  seed({ [K]: { status: 'escalate', attempts: 9, lastFailure: 'x', repeats: 2 }, 'MARXY-502': { status: 'blocked', attempts: 4 }, 'MARXY-503': { status: 'in_review' } });
  const r = run('retry', [K]);
  assert.equal(r.code, 0);
  assert.equal(rec(K).status, 'todo');
  assert.ok(rec(K).attempts < 9, 'attempts are capped so exactly one escalation attempt is left');
  assert.equal(rec(K).lastFailure, undefined);
  assert.equal(run('retry', ['MARXY-502', '--fresh']).code, 0);
  assert.equal(rec('MARXY-502').attempts, 0);
  assert.equal(run('retry', ['MARXY-503']).code, 1, 'only escalate or blocked');
  assert.equal(run('retry').code, 2);
});

test('return sends a story back with the reason kept in its notes; a todo story refuses', () => {
  seed({ [K]: { status: 'in_review', attempts: 1 }, 'MARXY-502': { status: 'todo' } });
  const r = run('return', [K, '--why', 'cover the empty document']);
  assert.equal(r.code, 0);
  assert.equal(rec(K).status, 'todo');
  assert.equal(rec(K).returned.why, 'cover the empty document');
  assert.match(readFileSync(notesPath(K), 'utf8'), /cover the empty document/);
  assert.equal(run('return', ['MARXY-502', '--why', 'x']).code, 1);
  assert.equal(run('return', [K]).code, 2, '--why is required');
});

test('report records a blocked or failed result for the cycle, and refuses anything else', () => {
  seed({ [K]: { status: 'in_progress' } });
  const r = run('report', [K, 'blocked', 'needs', 'the', 'core', 'change']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(resultPath(K), 'utf8')), { key: K, status: 'blocked', notes: 'needs the core change' });
  assert.equal(run('report', [K, 'done', 'x']).code, 2);
  assert.equal(run('report', [K, 'failed']).code, 2);
  assert.equal(run('report', ['MARXY-999999', 'failed', 'x']).code, 2);
});

test('verdict refuses bad arguments, a missing notes file, a story not in review, and a story with no PR', () => {
  seed({ [K]: { status: 'in_review' }, 'MARXY-502': { status: 'todo' } });
  const notes = notesFile('1. fine\n');
  assert.equal(run('verdict', [K, 'maybe', '--notes', notes]).code, 2);
  assert.equal(run('verdict', [K, 'merge']).code, 2);
  assert.equal(run('verdict', [K, 'merge', '--notes', join(sandbox, 'nope.md')]).code, 2);
  const wrong = run('verdict', ['MARXY-502', 'merge', '--notes', notes, '--head', HEAD]);
  assert.equal(wrong.code, 2);
  assert.match(wrong.errors[0], /is todo, not in review/);
  const none = run('verdict', [K, 'merge', '--notes', notes]);
  assert.equal(none.code, 2);
  assert.match(none.errors[0], /could not find MARXY-501's open PR/);
  assert.equal(existsSync(approvalPath(K)), false, 'nothing was signed');
});

test('verdict merge signs the approval for the PR head, so the merge bar accepts it', () => {
  seed({ [K]: { status: 'in_review' } });
  ghPrs([openPr(K)]);
  const r = run('verdict', [K, 'merge', '--notes', notesFile('1. the tests cover it\n')]);
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /approved and signed for aaaaaaa/);
  assert.deepEqual(verify(approvalPath(K), HEAD, { fetch: false }), { ok: true, head: HEAD });
  assert.equal(rec(K).status, 'in_review', 'only the cycle merges');
});

test('verdict merge is not signed while the PR conflicts', () => {
  seed({ [K]: { status: 'in_review' } });
  ghPrs([openPr(K, { mergeStateStatus: 'DIRTY' })]);
  const r = run('verdict', [K, 'merge', '--notes', notesFile('ok\n')]);
  assert.equal(r.code, 2);
  assert.match(r.errors[0], /not signing — DIRTY/);
  assert.equal(existsSync(approvalPath(K)), false);
});

test('verdict return and escalate move the story and append the numbered notes', () => {
  seed({ [K]: { status: 'in_review', attempts: 1 }, 'MARXY-502': { status: 'in_review', attempts: 1 } });
  ghPrs([openPr(K)]);
  const back = run('verdict', [K, 'return', '--notes', notesFile('1. fix the off-by-one\n'), '--head', HEAD]);
  assert.equal(back.code, 0);
  assert.equal(rec(K).status, 'todo');
  assert.match(readFileSync(notesPath(K), 'utf8'), /\(return\)\n\n1\. fix the off-by-one/);
  const up = run('verdict', ['MARXY-502', 'escalate', '--notes', notesFile('needs a person\n'), '--head', HEAD]);
  assert.equal(up.code, 0);
  assert.equal(rec('MARXY-502').status, 'escalate');
  assert.equal(rec('MARXY-502').returned.why, 'escalated by review');
});

test('why and events show a story and its log', () => {
  seed({ [K]: { status: 'todo' } });
  run('park', [K, 'for now']);
  const why = run('why', [K]);
  assert.match(why.lines.join('\n'), /"status": "blocked"/);
  assert.match(why.lines.join('\n'), /parked by/);
  assert.match(run('why', ['MARXY-777']).lines[0], /not on the board/);
  assert.equal(run('why').code, 2);
  assert.ok(run('events', [K, '-n', '5']).lines.every(l => JSON.parse(l).key === K));
});
