// Unit tests for headless cursor-agent auth-failure detection and needs-human notes (MARXY-156).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AUTH_FAILURE_LOG,
  applyAuthFailureToStory,
  authFailureBulletPrefix,
  isAuthFailure,
  noteAuthFailure,
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
