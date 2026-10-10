// The contrast gate (H-02, ADR-0059 item 10): floors compared unrounded, translucent colours composited
// first, an unparseable colour named, absent v2 roles reported and not failed, kind scopes walked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FLOORS, auditAll, auditTheme, findThemes, over, parseColour, ratio } from './gate-contrast.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const hex = ([r, g, b]) => `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
const css = (decls, ...more) => `:root { ${Object.entries(decls).map(([k, v]) => `--marxy-${k}: ${v};`).join(' ')} }\n${more.join('\n')}`;
const BASE = { 'color-bg': '#ffffff', 'color-text': '#000000', 'color-code-bg': '#ffffff', 'color-code-text': '#000000' };
const audit = (sheet, variants = ['dark']) => auditTheme('fx', sheet, variants);
const only = (r, fg, ground) => r.checks.filter(c => c.fg === fg && c.ground === ground);

// Grays on white, found rather than hard-coded so the two sit either side of 7:1 by a hair.
function straddle() {
  let below, above;
  for (let v = 0; v < 256; v++) {
    const r = ratio([v, v, v, 1], [255, 255, 255, 1]);
    if (r >= 7) above = { v, r };
    if (r < 7 && !below) below = { v, r };
  }
  return { below, above };
}
// A colour whose ratio on white lies in [6.995, 7): it rounds to 7.00 and must still fail.
function nearMiss() {
  for (let r = 0; r < 256; r++) for (let g = 0; g < 256; g++) for (const b of [0, 64, 128, 192, 255]) {
    const q = ratio([r, g, b, 1], [255, 255, 255, 1]);
    if (q >= 6.995 && q < 7) return { rgb: [r, g, b], q };
  }
}

test('H-02: body text at 6.99 fails the 7:1 floor and 7.00 passes, unrounded', () => {
  const miss = nearMiss();
  assert.ok(miss, 'fixture exists');
  assert.equal(miss.q.toFixed(2), '7.00', 'it would round to a pass');
  const failing = audit(css({ ...BASE, 'color-text': hex(miss.rgb) }));
  assert.ok(failing.failures.some(f => /text on bg = 6\.99 < 7$/.test(f)), failing.failures.join('\n'));
  const { above } = straddle();
  const passing = audit(css({ ...BASE, 'color-text': hex([above.v, above.v, above.v]) }));
  assert.equal(passing.failures.filter(f => /text on bg/.test(f)).length, 0);
  assert.ok(only(passing, 'text', 'bg')[0].ratio >= 7);
});

test('H-02: 4.499 fails a 4.5 floor (secondary text on the ground)', () => {
  let near;
  for (let r = 0; r < 256 && !near; r++) for (let g = 0; g < 256 && !near; g++) {
    const q = ratio([r, g, 128, 1], [255, 255, 255, 1]);
    if (q < 4.5 && q > 4.499) near = [r, g, 128];
  }
  assert.ok(near, 'fixture exists');
  const sheet = css({ ...BASE, 'color-text-secondary': hex(near) });
  assert.ok(audit(sheet).failures.some(f => /text-secondary on bg = 4\.49 < 4\.5$/.test(f)));
});

test('H-02: a translucent selection is composited over the code ground before it is measured', () => {
  const sheet = css({ ...BASE, 'color-code-bg': '#000000', 'color-bg': '#000000', 'color-text': '#ffffff', 'color-code-text': '#e0e0e0', 'color-selection': 'rgba(255, 255, 255, 0.1)' });
  const r = audit(sheet);
  const composited = over([255, 255, 255, 0.1], [0, 0, 0, 1]);
  const [sel] = only(r, 'code-text', 'selection@code-bg');
  assert.ok(Math.abs(sel.ratio - ratio([224, 224, 224, 1], composited)) < 1e-9);
  assert.ok(sel.ratio > 10, 'passes composited');
  assert.ok(ratio([224, 224, 224, 1], [255, 255, 255, 1]) < 1.4, 'and would fail were the alpha ignored');
  assert.deepEqual(r.failures, []);
  // and the other way: a heavy overlay that passes only if its alpha is ignored fails
  const heavy = audit(css({ ...BASE, 'color-code-bg': '#ffffff', 'color-selection': 'rgba(0, 0, 0, 0.8)', 'color-code-text': '#222222' }));
  assert.ok(heavy.failures.some(f => /code-text on selection@code-bg/.test(f)), heavy.failures.join('\n'));
});

test("H-02: the active-line ground is the selection mixed 40 % toward transparent over the code ground", () => {
  const r = audit(css({ ...BASE, 'color-code-bg': '#ffffff', 'color-selection': 'rgba(0, 0, 255, 0.5)', 'color-code-text': '#303030' }));
  const [line] = only(r, 'code-text', 'line@code-bg');
  const ground = over([0, 0, 255, 0.5 * 0.6], [255, 255, 255, 1]);
  assert.ok(Math.abs(line.ratio - ratio([48, 48, 48, 1], ground)) < 1e-9);
});

test('H-02: an unparseable colour fails and names its token; so does a var() to nothing', () => {
  const r = audit(css({ ...BASE, 'tok-string': 'chartreuse-ish', 'tok-number': 'var(--marxy-nope)' }));
  assert.ok(r.failures.some(f => /--marxy-tok-string: unparseable/.test(f)), r.failures.join('\n'));
  assert.ok(r.failures.some(f => /--marxy-tok-number: unparseable/.test(f)));
  const cyc = audit(css({ ...BASE, 'color-accent': 'var(--marxy-color-link)', 'color-link': 'var(--marxy-color-accent)' }));
  assert.ok(cyc.failures.some(f => /--marxy-color-(accent|link): unparseable/.test(f)));
});

test('H-02: a v2 role a theme leaves out is reported as not declared and does not fail; declared, it is checked', () => {
  const r = audit(css(BASE));
  assert.deepEqual(r.failures, []);
  const roles = r.undeclared[0].roles;
  for (const want of ['surface', 'text-strong', 'accent-wash', 'status-ok', 'status-err-wash', 'tok-marker', 'edge']) assert.ok(roles.includes(want), want);
  assert.equal(only(r, 'text-strong', 'bg').length, 0, 'not counted as a pass');
  const weak = audit(css({ ...BASE, 'color-text-strong': '#cccccc', 'color-surface': '#ffffff' }));
  assert.ok(weak.failures.some(f => /text-strong on bg = 1\.\d+ < 7$/.test(f)));
  assert.ok(weak.failures.some(f => /text-strong on surface/.test(f)));
  assert.ok(!weak.undeclared[0].roles.includes('surface'));
});

test('H-02: a ground whose own role is missing is skipped and counted, not passed', () => {
  const r = audit(css({ ...BASE, 'color-accent': '#000000' }));
  assert.equal(only(r, 'accent', 'accent-wash').length, 0);
  assert.ok(r.undeclared[0].roles.includes('accent-wash'));
  assert.equal(only(r, 'accent', 'bg').length, 1);
});

test('H-02: surface-glass is held to the surface floors once composited over the ground', () => {
  const sheet = css({ ...BASE, 'color-surface': '#ffffff', 'color-surface-glass': 'rgba(0, 0, 0, 0.55)', 'color-text': '#000000' });
  const r = audit(sheet);
  assert.ok(r.failures.some(f => /text on surface-glass/.test(f)), r.failures.join('\n'));
  assert.equal(only(r, 'text', 'surface-glass')[0].ratio, ratio([0, 0, 0, 1], over([0, 0, 0, 0.55], [255, 255, 255, 1])));
});

test('H-02: variants and kind scopes are each walked, and a kind inherits the root', () => {
  const sheet = css({ ...BASE, 'color-text-secondary': '#555555' },
    ':root[data-marxy-variant="light"] { --marxy-color-text-secondary: #bbbbbb; }',
    '[data-marxy-kind="report"] { --marxy-color-text-secondary: #aaaaaa; }',
    ':root[data-marxy-variant="light"] [data-marxy-kind="log"] { --marxy-color-text-secondary: #999999; }');
  const r = audit(sheet, ['dark', 'light']);
  const f = r.failures.join('\n');
  assert.match(f, /^fx · light · root: text-secondary on bg/m);
  assert.match(f, /^fx · dark · kind=report: text-secondary on bg/m);
  assert.match(f, /^fx · light · kind=log: text-secondary on bg/m);
  assert.doesNotMatch(f, /fx · dark · root/);
  assert.doesNotMatch(f, /fx · dark · kind=log/, 'a variant-qualified kind scope is inert in the other variant');
  assert.equal(only(r, 'text', 'bg').filter(c => c.scope === 'kind=report').length, 2, 'kind scopes check inherited roles too, in each variant');
});

test('H-02: colour syntaxes resolve: rgb, hsl, 8-digit hex, var() fallback, color-mix with transparent', () => {
  const eq = (a, b) => assert.deepEqual(a.map(Math.round), b.map(Math.round));
  eq(parseColour('rgb(255 0 0 / 50%)').slice(0, 3), [255, 0, 0]);
  assert.equal(parseColour('rgb(255 0 0 / 50%)')[3], 0.5);
  eq(parseColour('hsl(120 100% 25%)').slice(0, 3), [0, 128, 0]);
  assert.equal(parseColour('#ff000080')[3], 128 / 255);
  eq(parseColour('var(--x, #123456)').slice(0, 3), [0x12, 0x34, 0x56]);
  const m = parseColour('color-mix(in srgb, #000000 60%, transparent)');
  assert.deepEqual([m[0], m[3]], [0, 0.6]);
  eq(parseColour('color-mix(in srgb, #ffffff, #000000)').slice(0, 3), [128, 128, 128]);
  assert.throws(() => parseColour('color-mix(in oklab, red, blue)'));
});

test('H-02: ADR-0059 item 10 is the data: every floor and role list in the table is in FLOORS', () => {
  const adr = readFileSync(`${ROOT}docs/adr/0059-token-contract-v2.md`, 'utf8');
  const table = adr.slice(adr.indexOf('| Role | Floor | Against |'), adr.indexOf('The large-text allowance'));
  const rows = table.split('\n').filter(l => /\|\s*\d(\.\d)?:1\s*\|/.test(l));
  assert.equal(rows.length, 9, 'the ADR table has nine floored rows');
  for (const line of rows) {
    const [, roles, floor] = line.split('|').map(s => s.trim());
    const want = Number.parseFloat(floor);
    const named = [...roles.matchAll(/`--marxy-(?:color-)?([a-z*-]+)`/g)].map(m => m[1]);
    const fg = named.flatMap(n => (n === 'status-*' ? ['status-ok', 'status-warn', 'status-err', 'status-info'] : [n]));
    assert.ok(fg.length, roles);
    for (const role of fg) assert.ok(FLOORS.some(f => f.floor === want && f.fg.includes(role)), `${role} @ ${want}`);
  }
  assert.ok(!/large/i.test(readFileSync(`${ROOT}scripts/gate-contrast.mjs`, 'utf8').replace(/\/\/.*$/gm, '')), 'no large-text allowance');
});

test('H-02: the bundled themes are found, every variant is audited, and today none fails', () => {
  const themes = findThemes();
  assert.ok(themes.some(t => t.name === 'default' && t.variants.join() === 'dark,light'));
  const all = auditAll();
  assert.ok(all.checks.some(c => c.variant === 'light') && all.checks.some(c => c.variant === 'dark'));
  assert.deepEqual(all.failures, []);
  // H-03 declares every contract-2 role in tokens.css (as its v1 fallback), so the default theme has none undeclared.
  assert.ok(all.undeclared.length > 0 && all.undeclared.every(u => u.roles.length === 0), JSON.stringify(all.undeclared));
  assert.ok(all.checks.some(c => c.fg === 'text-strong') && all.checks.some(c => c.fg === 'accent-fg'), 'the v2 roles are now checked');
  // the "not yet declared" path stays live for a theme that does not import tokens.css
  assert.ok(audit(css(BASE)).undeclared[0].roles.includes('surface'));
});

test('H-02: the CLI exits 0 and prints the not-declared count; --md prints a table', () => {
  const run = a => spawnSync(process.execPath, [`${ROOT}scripts/gate-contrast.mjs`, ...a], { cwd: ROOT, encoding: 'utf8' });
  const cli = run([]);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /gate-contrast: \d+ pairs checked, 0 failing, 0 roles not yet declared/);
  assert.match(run(['--md']).stdout, /\| Role \| Against \| Floor \| dark \| light \|/);
});
