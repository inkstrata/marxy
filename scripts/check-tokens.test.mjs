// The token check must go red for a name added, removed, re-kinded or stripped of its
// comment, and stay green when only a value moves (ADR-0031).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { declarations, check, kindOf } from './check-tokens.mjs';

const css = readFileSync('packages/theme/src/tokens.css', 'utf8');
const contract = JSON.parse(readFileSync('packages/theme/tokens.contract.json', 'utf8'));

const DECL_VALUE = /^(\s*(--marxy-[a-z0-9-]+)\s*:\s*)([^;]+)(;.*)$/;

/** Current value string for a `--marxy-*` token in committed tokens.css (MARXY-145). */
function valueOf(cssText, name) {
  for (const line of String(cssText).split(/\r?\n/)) {
    const m = DECL_VALUE.exec(line);
    if (m && m[2] === name) return m[3].trim();
  }
  assert.fail(`missing declaration ${name}`);
}

/** Replace one token's value without hard-coding the committed literal (MARXY-145). */
function withValue(cssText, name, newValue) {
  let replaced = false;
  const out = String(cssText)
    .split(/\r?\n/)
    .map(line => {
      const m = DECL_VALUE.exec(line);
      if (!m || m[2] !== name) return line;
      replaced = true;
      return `${m[1]}${newValue}${m[4]}`;
    })
    .join('\n');
  assert.ok(replaced, `did not replace ${name}`);
  return out;
}

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
  // its system-owned root copy (--marxy-root-size-code, ADR-0059) reads it, so it is re-kinded with it
  const found = check(mutated, contract).filter(p => p.token !== '--marxy-root-size-code');
  assert.ok(found.some(p => p.kind === 'removed' && p.token === '--marxy-size-code'), found);
  assert.equal(found.length, 1);
});

test('re-kinded token is red', () => {
  const live = valueOf(css, '--marxy-size-code');
  const bare = String(parseFloat(live));
  const mutated = withValue(css, '--marxy-size-code', bare);
  const found = check(mutated, contract).filter(p => p.token !== '--marxy-root-size-code');
  assert.ok(found.some(p => p.kind === 're-kinded' && p.token === '--marxy-size-code'), found);
  assert.match(found[0].message, /length → number/);
  assert.equal(found.length, 1);
});

test('comment lost is red', () => {
  // Strip the explaining comment from the live --marxy-measure line, whatever its value.
  const mutated = css.replace(/^(\s*--marxy-measure:[^;]+;).*$/m, '$1');
  assert.notEqual(mutated, css, 'the --marxy-measure line was not found');
  const found = check(mutated, contract);
  assert.ok(found.some(p => p.kind === 'comment-lost' && p.token === '--marxy-measure'), found);
  assert.equal(found.length, 1);
});

test('value-only change is green (size-code and weight-heading nudged from live values)', () => {
  const sizeLive = valueOf(css, '--marxy-size-code');
  const weightLive = valueOf(css, '--marxy-weight-heading');
  const sizeNum = parseFloat(sizeLive);
  const sizeUnit = sizeLive.slice(String(sizeNum).length);
  const weightNum = parseInt(weightLive, 10);
  const mutated = withValue(
    withValue(css, '--marxy-size-code', `${sizeNum + 1}${sizeUnit}`),
    '--marxy-weight-heading',
    String(weightNum - 40),
  );
  assert.deepEqual(reasons(mutated), []);
  assert.deepEqual(declarations(mutated), declarations(css));
});

test('no hard-coded token literal survives a tune', () => {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  assert.doesNotMatch(src, /--marxy-size-code:\s*1[45]px;/);
  assert.doesNotMatch(src, /--marxy-weight-heading:\s*(600|560);/);
});

test('the committed tree is green and the snapshot carries no values', () => {
  assert.deepEqual(check(css, contract), []);
  for (const row of contract) {
    assert.equal('value' in row, false, row.name);
    assert.deepEqual(Object.keys(row).sort(), ['comment', 'kind', 'name']);
  }
  const run = spawnSync(process.execPath, ['scripts/check-tokens.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, new RegExp(`tokens-contract ok \\(${contract.length} tokens\\)`));
});

test('contract 2 (ADR-0059): the 27 names are in the snapshot with the kinds the ADR gives, each explained', () => {
  const want = {
    colour: [
      'color-surface', 'color-surface-glass', 'color-text-strong', 'color-text-faint', 'color-rule-strong', 'color-edge',
      'color-accent-strong', 'color-accent-fg', 'color-accent-wash', 'color-status-ok', 'color-status-warn', 'color-status-err',
      'color-status-info', 'color-status-ok-wash', 'color-status-warn-wash', 'color-status-err-wash', 'tok-marker', 'tok-heading', 'tok-link',
    ],
    keyword: ['shadow-surface'],
    family: ['face-book', 'face-article', 'face-sans', 'face-readme', 'face-mono', 'face-chrome'],
    length: ['size-chrome'],
  };
  const byName = new Map(declarations(css).map(d => [d.name, d]));
  let n = 0;
  for (const [kind, names] of Object.entries(want)) {
    for (const name of names) {
      const d = byName.get(`--marxy-${name}`);
      assert.ok(d, `${name} is not declared`);
      assert.equal(d.kind, kind, name);
      assert.ok(d.comment, `${name} has no comment (ADR-0031)`);
      n++;
    }
  }
  assert.equal(n, 27);
  for (const name of ['size-body', 'size-code', 'size-caption', 'line-box', 'line-box-code', 'lh-h1', 'lh-h2']) {
    const d = byName.get(`--marxy-root-${name}`);
    assert.equal(d?.kind, 'length', `--marxy-root-${name}`);
    assert.ok(d.comment);
  }
});

test('a contract-2 name removed from tokens.css is refused', () => {
  const mutated = css.replace(/^\s*--marxy-color-edge:[^;]+;.*$/m, '');
  assert.deepEqual(reasons(mutated), ['removed:--marxy-color-edge']);
});

test('Source reads the three contract-2 token roles (markers, headings, links)', () => {
  const src = readFileSync('apps/desktop/src/source/highlight-style.ts', 'utf8');
  assert.match(src, /t\.processingInstruction, color: tok\('marker'\)/);
  assert.match(src, /t\.heading, color: tok\('heading'\)/);
  assert.match(src, /t\.link, t\.url\], color: tok\('link'\)/);
});
