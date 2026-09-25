// Unit tests for headless cursor-agent auth-failure detection and needs-human notes (MARXY-156).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTH_FAILURE_LOG,
  applyAuthFailureToStory,
  authFailureBulletPrefix,
  isAuthFailure,
  noteAuthFailure,
  resolveAgentBin,
} from './dispatch.mjs';

const authLog = () => Buffer.from(AUTH_FAILURE_LOG, 'utf8');

test('isAuthFailure on the exact known string, code 1, no result', () => {
  assert.equal(isAuthFailure({ code: 1, log: authLog(), resultExists: false }), true);
});

test('isAuthFailure on that string plus extra output, code 1, no result', () => {
  const log = Buffer.from(`${AUTH_FAILURE_LOG}\nMARXY-1: done\n`, 'utf8');
  assert.equal(isAuthFailure({ code: 1, log, resultExists: false }), false);
});

test('isAuthFailure on that string, code 0', () => {
  assert.equal(isAuthFailure({ code: 0, log: authLog(), resultExists: false }), false);
});

test('isAuthFailure on that string, code 1, result file exists', () => {
  assert.equal(isAuthFailure({ code: 1, log: authLog(), resultExists: true }), false);
});

test('applyAuthFailureToStory restores attempts and todo without charging the run', () => {
  const s2 = { stories: { 'MARXY-99': { status: 'in_progress', attempts: 4, branch: 'chore/MARXY-99-x' } } };
  const r2 = applyAuthFailureToStory(s2, 'MARXY-99', 3);
  assert.equal(r2.attempts, 3);
  assert.equal(r2.status, 'todo');
  assert.equal(r2.branch, 'chore/MARXY-99-x');
});

test('noteAuthFailure twice same day produces one bullet naming both keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-needs-human-'));
  const path = join(dir, 'needs-human.md');
  writeFileSync(path, '# Needs a human\n\n');
  const day = new Date('2026-09-20T12:00:00Z');
  noteAuthFailure('MARXY-1', path, day);
  noteAuthFailure('MARXY-2', path, day);
  const text = readFileSync(path, 'utf8');
  const prefix = authFailureBulletPrefix('2026-09-20');
  const bullets = text.split('\n').filter(l => l.startsWith(prefix));
  assert.equal(bullets.length, 1);
  assert.match(bullets[0], /MARXY-1/);
  assert.match(bullets[0], /MARXY-2/);
  assert.match(bullets[0], /in-app subagent/);
});

// Leased claims (MARXY-208).
import { claim, owns } from './dispatch.mjs';

const M = { maxAttempts: 2, implementor: { model: 'composer-2.5' }, implementorEscalation: { model: 'opus' } };
const ST = { Key: 'MARXY-9', Summary: 'Do the thing', Labels: 'phase-2' };

test('claim writes in_progress, the attempt, the role and a lease naming the worker', () => {
  const s = { stories: { 'MARXY-9': { status: 'todo', attempts: 0, parkedReason: 'old' } } };
  const lease = { pid: 4242, host: 'h', started: '2026-09-24T00:00:00.000Z', match: '--worker MARXY-9' };
  const rec = claim(s, 'MARXY-9', ST, { m: M, lease });
  assert.equal(rec.status, 'in_progress');
  assert.equal(rec.attempts, 1);
  assert.equal(rec.role, 'implementor');
  assert.equal(rec.model, 'composer-2.5');
  assert.equal(rec.worktree, '../marxy-wt/MARXY-9');
  assert.equal(rec.started, lease.started);
  assert.deepEqual(rec.lease, lease);
  assert.equal(rec.parkedReason, undefined);
});

test('claim escalates the model once attempts reach maxAttempts', () => {
  const s = { stories: { 'MARXY-9': { status: 'todo', attempts: 2 } } };
  const rec = claim(s, 'MARXY-9', ST, { m: M, lease: { pid: 1, started: 'T' } });
  assert.equal(rec.role, 'implementorEscalation');
  assert.equal(rec.model, 'opus');
});

test('a worker owns its row only while the row is in progress under its own lease', () => {
  assert.equal(owns({ status: 'in_progress', lease: { pid: 5 } }, 5), true);
  // Reaped (lease cleared), re-claimed by another worker, or already settled: not ours to write.
  assert.equal(owns({ status: 'todo' }, 5), false);
  assert.equal(owns({ status: 'in_progress', lease: { pid: 6 } }, 5), false);
  assert.equal(owns({ status: 'in_review', lease: { pid: 5 } }, 5), false);
});

// The worker's write is guarded by ownership (review return 2, MARXY-208).
import { recordOutcome } from './dispatch.mjs';

test('recordOutcome writes the outcome while the worker owns the row, and clears lease and reaps', () => {
  const s = { stories: { 'MARXY-9': { status: 'in_progress', attempts: 1, reaps: 1, lease: { pid: 5 } } } };
  const o = recordOutcome(s, 'MARXY-9', { result: { status: 'done', pr: 12 }, code: 0, attemptsBefore: 0 }, 5);
  assert.deepEqual(o, { recorded: true, status: 'in_review', jira: ['pr', 'MARXY-9', '12'] });
  assert.equal(s.stories['MARXY-9'].lease, undefined);
  assert.equal(s.stories['MARXY-9'].reaps, undefined);
});

test('recordOutcome leaves a reaped or re-claimed row exactly as it is', () => {
  const reaped = { status: 'todo', attempts: 0, reapedAt: 'T' };
  const reclaimed = { status: 'in_progress', attempts: 2, lease: { pid: 6 } };
  const s = { stories: { 'MARXY-9': structuredClone(reaped), 'MARXY-10': structuredClone(reclaimed) } };
  assert.deepEqual(recordOutcome(s, 'MARXY-9', { result: { status: 'done', pr: 1 }, code: 0 }, 5), { recorded: false });
  assert.deepEqual(recordOutcome(s, 'MARXY-10', { result: { status: 'blocked' }, code: 0 }, 5), { recorded: false });
  assert.deepEqual(s.stories['MARXY-9'], reaped);
  assert.deepEqual(s.stories['MARXY-10'], reclaimed);
});

test('recordOutcome: blocked stays blocked, a missing or unnamed-PR result is todo, auth failure refunds', () => {
  const mk = () => ({ stories: { K: { status: 'in_progress', attempts: 2, lease: { pid: 5 } } } });
  assert.equal(recordOutcome(mk(), 'K', { result: { status: 'blocked' }, code: 0 }, 5).status, 'blocked');
  assert.equal(recordOutcome(mk(), 'K', { result: { status: 'done' }, code: 0 }, 5).status, 'todo');
  assert.equal(recordOutcome(mk(), 'K', { result: null, code: 1 }, 5).status, 'todo');
  const s = mk();
  const o = recordOutcome(s, 'K', { result: null, code: 1, logBuf: Buffer.from(AUTH_FAILURE_LOG), attemptsBefore: 1 }, 5);
  assert.equal(o.authFailure, true);
  assert.equal(s.stories.K.attempts, 1);
});

test('CURSOR_AGENT=1, empty, and a non-command resolve to cursor-agent; an executable path wins', () => {
  const miss = () => false;
  assert.equal(resolveAgentBin({ CURSOR_AGENT: '1' }, { lookup: miss }), 'cursor-agent');
  assert.equal(resolveAgentBin({ CURSOR_AGENT: '' }, { lookup: miss }), 'cursor-agent');
  assert.equal(resolveAgentBin({ CURSOR_AGENT: '   ' }, { lookup: miss }), 'cursor-agent');
  assert.equal(resolveAgentBin({}, { lookup: miss }), 'cursor-agent');
  assert.equal(resolveAgentBin({ CURSOR_AGENT: 'no-such-bin' }, { lookup: miss }), 'cursor-agent');
  const dir = mkdtempSync(join(tmpdir(), 'marxy-agent-bin-'));
  const bin = join(dir, 'fake-agent');
  writeFileSync(bin, '#!/bin/sh\n');
  chmodSync(bin, 0o755);
  assert.equal(resolveAgentBin({ CURSOR_AGENT: bin }), bin);
  assert.equal(resolveAgentBin({ CURSOR_AGENT: '1' }), 'cursor-agent');
});

test('work() records through recordOutcome and releases only a row it owns', async () => {
  const { readFileSync: read } = await import('node:fs');
  const src = read(new URL('./dispatch.mjs', import.meta.url), 'utf8');
  const work = src.slice(src.indexOf('export async function work('), src.indexOf('export function recordOutcome('));
  assert.match(work, /resolveAgentBin\(/);
  assert.match(work, /updateState\(s2 => recordOutcome\(s2, key,/);
  assert.match(work, /const release = why => \{[\s\S]*?updateState\(s2 => \{[\s\S]*?if \(!owns\(r2\)\) return false;/);
  const outsideRelease = work.replace(/const release = why => \{[\s\S]*?\n  \};/, '');
  assert.doesNotMatch(outsideRelease, /\.status = /, 'every other board write goes through recordOutcome');
});
