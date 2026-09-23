// Fails if a new session again reads 500 ms as a product cold-start ceiling (ADR-0029).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

function threeDotNames() {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    return null;
  }
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', 'origin/main...HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

test('ADR-0029 is accepted, not proposed', () => {
  const adr = read('docs/adr/0029-no-product-cold-start-ceiling.md');
  assert.match(adr, /\*\*Status:\*\*\s*accepted\b/);
  assert.doesNotMatch(adr, /\*\*Status:\*\*\s*proposed\b/);
});

test('the ADR index lists 0029 as accepted', () => {
  const index = read('docs/adr/README.md');
  assert.match(index, /\[0029\]\(0029-no-product-cold-start-ceiling\.md\).*\baccepted\b/);
});

test('the AGENTS.md budget table drops the 500 ms CI-failure claim and keeps the other budgets', () => {
  const agents = read('AGENTS.md');
  const start = agents.indexOf('## Budgets');
  const end = agents.indexOf('## Where things are');
  assert.ok(start >= 0 && end > start, 'the Budgets section is present');
  const budget = agents.slice(start, end);
  assert.ok(!budget.includes('< 500 ms'), 'the budget table must not contain < 500 ms');
  // The old heading treated every row, including cold start, as a CI failure.
  assert.doesNotMatch(agents, /## Budgets \(CI fails on regression\)/);
  assert.doesNotMatch(
    budget,
    /\|\s*Cold start[^|\n]*\|\s*<\s*\d+\s*ms/i,
    'the cold-start cell must not state a duration CI could fail on',
  );
  assert.equal([...budget.matchAll(/< 50 ms/g)].length, 2, 'open-indexed and find budgets remain');
  assert.equal([...budget.matchAll(/< 16 ms/g)].length, 1, 'palette budget remains');
  assert.equal([...budget.matchAll(/< 100 ms/g)].length, 2, 'typeset and live-reload budgets remain');
});

test('the roadmap tripwire is the resist-inflation rule, not a 500 ms Phase-2 ceiling', () => {
  const roadmap = read('docs/roadmap.md');
  assert.ok(
    !roadmap.includes('Cold start > 500 ms after Phase 2'),
    'the withdrawn Phase-2 500 ms signal must not remain',
  );
  assert.match(
    roadmap,
    /CI never writes a higher recorded cold-start number into the repo to make a red gate green/,
  );
});

test('the three-dot diff does not reopen ADR-0013', t => {
  const names = threeDotNames();
  if (names == null) {
    t.skip('origin/main is not resolvable');
    return;
  }
  assert.ok(
    !names.includes('docs/adr/0013-speed-budgets-are-gates.md'),
    'ADR-0013 is append-only and must not appear in the three-dot diff',
  );
  // The rest of this test policed the landing story's own paths (package.json, .github) for every
  // later branch that touched AGENTS.md; a path boundary is check-story.mjs's job (MARXY-191).
});
