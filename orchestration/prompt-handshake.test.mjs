// The reviewer and implementor prompts must name the same approval handshake (MARXY-79).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const reviewer = readFileSync(join(here, 'prompts/reviewer.md'), 'utf8');
const implementor = readFileSync(join(here, 'prompts/implementor.md'), 'utf8');
const sdlc = readFileSync(join(root, 'docs/sdlc.md'), 'utf8');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

const FORBIDDEN_THREE_DOT = [
  'orchestration/cycle.mjs',
  'orchestration/approve.mjs',
  'orchestration/merge-bar.mjs',
  'package.json',
];

function resolveThreeDotBase(opts, git = execFileSync) {
  for (const ref of ['origin/main', 'main']) {
    try {
      git('git', ['rev-parse', '--verify', ref], {
        cwd: opts.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return ref;
    } catch {
      // shallow checkouts may have neither
    }
  }
  return null;
}

function threeDotNames(base, opts, git = execFileSync) {
  return git('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: opts.cwd,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

test('reviewer prompt requires the approved path and approve.mjs', () => {
  assert.match(reviewer, /results\/KEY\.approved/);
  assert.match(reviewer, /approve\.mjs/);
});

test('reviewer prompt forbids gh pr merge and does not tell the reviewer to run it', () => {
  const mentions = [...reviewer.matchAll(/gh pr merge/g)];
  assert.ok(mentions.length > 0, 'reviewer.md must forbid gh pr merge by name');
  for (const m of mentions) {
    const start = Math.max(0, m.index - 80);
    const window = reviewer.slice(start, m.index + m[0].length);
    assert.match(
      window,
      /\b(do not|don't|never|forbids?)\b/i,
      'gh pr merge must appear only as something the reviewer must not run',
    );
  }
});

test('implementor prompt forbids writing KEY.approved', () => {
  assert.match(implementor, /[Nn]ever write[^\n]*KEY\.approved/);
});

test('sdlc.md says a reviewer writes and signs KEY.approved and the implementor never writes it', () => {
  assert.match(sdlc, /reviewer writes and signs `KEY\.approved`/i);
  assert.match(sdlc, /implementor never writes\s+it/i);
});

test('CHANGELOG.md has a MARXY-79 line under Unreleased', () => {
  const unreleased = changelog.split(/^## /m)[1] ?? '';
  assert.match(unreleased, /^Unreleased\b/m);
  assert.match(unreleased, /MARXY-79/);
});

test('the three-dot diff does not contain cycle, approve, merge-bar, or package.json', t => {
  const base = resolveThreeDotBase({ cwd: root });
  if (!base) {
    t.skip('neither origin/main nor main is a resolvable git ref');
    return;
  }
  const names = threeDotNames(base, { cwd: root });
  for (const f of FORBIDDEN_THREE_DOT) {
    assert.ok(!names.includes(f), f);
  }
});
