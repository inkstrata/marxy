// The reviewer and implementor prompts must name the same approval handshake (MARXY-79).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const reviewer = readFileSync(join(here, 'prompts/reviewer.md'), 'utf8');
const implementor = readFileSync(join(here, 'prompts/implementor.md'), 'utf8');
const sdlc = readFileSync(join(root, 'docs/sdlc.md'), 'utf8');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

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

// A three-dot check that this branch avoided MARXY-79's files lived here and ran against every
// branch after MARXY-79 merged; it only stayed quiet because CI skipped orchestration tests. A path
// boundary belongs to check-story.mjs, not a test (MARXY-191; see readiness.test.mjs, MARXY-107).
