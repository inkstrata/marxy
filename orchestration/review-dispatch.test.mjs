// Headless reviewer: one lease, the first signable pull request, MARXY-214's binary (MARXY-215).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leaseHeld, readLease } from './lease.mjs';
import {
  chooseReviewer,
  launchReviewer,
  planHeadlessReview,
  reviewerSpawnArgs,
} from './review-dispatch.mjs';

const unsigned = ['MARXY-1 (PR #9): not reviewed (no results/KEY.approved)'];
const order = [{ key: 'MARXY-1', behind: false, dirty: false }];

function plan(extra = {}) {
  return planHeadlessReview({
    order,
    needsReview: unsigned,
    holds: [],
    hasCli: true,
    dry: false,
    leaseHeld: () => false,
    ...extra,
  });
}

test('a cycle with an unsigned reviewable pull request starts one reviewer and not a second while the lease is held', () => {
  const first = plan();
  assert.equal(first.spawn, true);
  assert.equal(first.key, 'MARXY-1');

  const dir = mkdtempSync(join(tmpdir(), 'marxy-reviewer-'));
  const sleeper = join(dir, 'sleep.sh');
  writeFileSync(sleeper, '#!/bin/sh\nsleep 30\n');
  chmodSync(sleeper, 0o755);
  const child = spawn(sleeper, ['--worker', 'MARXY-1'], { detached: true, stdio: 'ignore' });
  child.unref();
  const leasePath = join(dir, 'MARXY-1.review.lease');
  const logPath = join(dir, 'MARXY-1.review.log');
  try {
    const launched = launchReviewer('MARXY-1', {
      m: { compute: 'default' },
      leasePath,
      logPath,
      spawn: () => child.pid,
    });
    assert.equal(launched.pid, child.pid);
    assert.equal(leaseHeld(readLease(leasePath)), true);

    const again = plan({
      leaseHeld: key => key === 'MARXY-1' && leaseHeld(readLease(leasePath)) === true,
    });
    assert.equal(again.spawn, false);
    assert.match(again.why, /already running/);

    let spawned = false;
    const second = launchReviewer('MARXY-1', {
      leasePath,
      logPath,
      spawn: () => { spawned = true; return 1; },
    });
    assert.equal(second.skipped, true);
    assert.equal(spawned, false);
  } finally {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
});

test('a pull request the cycle cannot boundary-check is not given a reviewer', () => {
  const noRow = plan({
    order: [{ key: 'MARXY-212', behind: false }],
    needsReview: ['MARXY-212 (PR #195): not reviewed (no results/KEY.approved)'],
    holds: ['MARXY-212: PR #195 held — no board row on main or on its branch, so no boundary check can run'],
  });
  assert.equal(noRow.key, null);
  assert.equal(noRow.spawn, false);
  assert.match(noRow.why, /cannot be boundary-checked/);

  const noDiff = plan({
    holds: ['MARXY-1: PR #9 held — could not compute the branch diff, so no boundary check ran'],
  });
  assert.equal(noDiff.spawn, false);

  const codeowners = plan({
    holds: ['MARXY-1: PR #9 held — human review required (CODEOWNERS): orchestration/cycle.mjs'],
  });
  assert.equal(codeowners.spawn, true, 'a CODEOWNERS pull request still needs a reviewer signature');
});

test('CURSOR_AGENT=1 and an empty value resolve to cursor-agent, and a real command name is kept', () => {
  const prev = process.env.CURSOR_AGENT;
  const m = { reviewer: { model: 'claude-sonnet-5', effort: 'high' }, cliEffortFlag: '' };
  const prompt = readFileSync(new URL('./prompts/reviewer.md', import.meta.url), 'utf8');
  const restore = () => {
    if (prev === undefined) delete process.env.CURSOR_AGENT;
    else process.env.CURSOR_AGENT = prev;
  };
  try {
    process.env.CURSOR_AGENT = '1';
    assert.equal(reviewerSpawnArgs({ m, prompt, key: 'MARXY-1' }).bin, 'cursor-agent');
    process.env.CURSOR_AGENT = '';
    assert.equal(reviewerSpawnArgs({ m, prompt, key: 'MARXY-1' }).bin, 'cursor-agent');
    const bin = join(mkdtempSync(join(tmpdir(), 'marxy-review-bin-')), 'fake-agent');
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    process.env.CURSOR_AGENT = bin;
    const spawned = reviewerSpawnArgs({ m, prompt, key: 'MARXY-1' });
    assert.equal(spawned.bin, bin);
    assert.ok(spawned.args.includes('--model'));
    assert.ok(spawned.args.includes('claude-sonnet-5'));
    assert.match(spawned.args.at(-1), /Review MARXY-1 only/);
    assert.match(spawned.args.at(-1), /approve\.mjs MARXY-1/);
    assert.match(spawned.args.at(-1), /Do not run `gh pr merge`/);
  } finally {
    restore();
  }
});

test('only the first review-order entry approve.mjs can sign is started', () => {
  const behind = chooseReviewer({
    order: [{ key: 'MARXY-A', behind: true }, { key: 'MARXY-B', behind: false }],
    unsigned: ['MARXY-A', 'MARXY-B'],
  });
  assert.equal(behind.key, null);
  assert.match(behind.why, /BEHIND/);

  const later = chooseReviewer({
    order: [{ key: 'MARXY-A', behind: false }, { key: 'MARXY-B', behind: false }],
    unsigned: ['MARXY-B'],
  });
  assert.equal(later.key, null);
  assert.match(later.why, /not waiting on a reviewer signature/);

  const dirty = chooseReviewer({
    order: [{ key: 'MARXY-A', dirty: true }],
    unsigned: ['MARXY-A'],
  });
  assert.equal(dirty.key, null);
  assert.match(dirty.why, /DIRTY/);
});

test('a dry cycle names the reviewer and does not spawn one', () => {
  const dry = plan({ dry: true });
  assert.equal(dry.key, 'MARXY-1');
  assert.equal(dry.spawn, false);
  assert.equal(plan({ hasCli: false }).spawn, false);
});
