// The token check must go red for a name added, removed, re-kinded or stripped of its
// comment, and stay green when only a value moves (ADR-0031).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { declarations, check, kindOf } from './check-tokens.mjs';

const css = readFileSync('packages/theme/src/tokens.css', 'utf8');
const contract = JSON.parse(readFileSync('packages/theme/tokens.contract.json', 'utf8'));

function reasons(mutated) {
  return check(mutated, contract).map(p => `${p.kind}:${p.token}`);
}

test('kind inference: length, number, colour, family, ratio, keyword; var() follows the target', () => {
  assert.equal(kindOf('28px'), 'length');
  assert.equal(kindOf('600'), 'number');
  assert.equal(kindOf('#151412'), 'colour');
  assert.equal(kindOf('"Literata", serif'), 'family');
  assert.equal(kindOf('1.25'), 'ratio');
  assert.equal(kindOf('none'), 'keyword');
  assert.equal(kindOf('var(--marxy-size-code)', () => 'length'), 'length');
  assert.equal(kindOf('var(--unknown)'), 'keyword');
  assert.equal(kindOf('calc(1px + 2px)'), 'length');
});

test('added token is red', () => {
  const mutated = css.replace(':root {', ':root {\n  --marxy-size-extra: 16px;');
  const found = check(mutated, contract);
  assert.ok(found.some(p => p.kind === 'added' && p.token === '--marxy-size-extra'), found);
  assert.equal(found.length, 1);
});

test('removed token is red', () => {
  const mutated = css.replace(/^\s*--marxy-size-code:.*\n/m, '');
  const found = check(mutated, contract);
  assert.ok(found.some(p => p.kind === 'removed' && p.token === '--marxy-size-code'), found);
  assert.equal(found.length, 1);
});

test('re-kinded token is red', () => {
  const mutated = css.replace('--marxy-size-code: 14px;', '--marxy-size-code: 14;');
  const found = check(mutated, contract);
  assert.ok(found.some(p => p.kind === 're-kinded' && p.token === '--marxy-size-code'), found);
  assert.match(found[0].message, /length → number/);
  assert.equal(found.length, 1);
});

test('comment lost is red', () => {
  const mutated = css.replace(
    '--marxy-measure: 68ch;              /* clamped by marxy to 45ch–90ch */',
    '--marxy-measure: 68ch;',
  );
  const found = check(mutated, contract);
  assert.ok(found.some(p => p.kind === 'comment-lost' && p.token === '--marxy-measure'), found);
  assert.equal(found.length, 1);
});

test('value-only change is green (--marxy-size-code 14px → 15px, --marxy-weight-heading 600 → 560)', () => {
  const mutated = css
    .replace('--marxy-size-code: 14px;', '--marxy-size-code: 15px;')
    .replace('--marxy-weight-heading: 600;', '--marxy-weight-heading: 560;');
  assert.deepEqual(reasons(mutated), []);
  assert.deepEqual(declarations(mutated), declarations(css));
});

test('the committed tree is green and the snapshot carries no values', () => {
  assert.deepEqual(check(css, contract), []);
  for (const row of contract) {
    assert.equal('value' in row, false, row.name);
    assert.deepEqual(Object.keys(row).sort(), ['comment', 'kind', 'name']);
  }
  const run = spawnSync(process.execPath, ['scripts/check-tokens.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /tokens-contract ok \(49 tokens\)/);
});
