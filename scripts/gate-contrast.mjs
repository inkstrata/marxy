// Contrast gate (H-02, ADR-0059 item 10). Reads every bundled theme (packages/theme/*/theme.css and its
// theme.toml), resolves each variant and each [data-marxy-kind] scope to colours, composites translucent
// colours over the ground beneath them, and fails on any pair below its WCAG 2.2 floor. Ratios are never
// rounded: 4.499 fails. A role the theme does not declare is reported as "not yet declared", not passed
// and not failed; an unparseable colour is a failure naming the token. The model is Galley's
// docs/plan/direction-2026-10/galley/audit_contrast.py. usage: node scripts/gate-contrast.mjs [--md]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const THEMES_DIR = join(ROOT, 'packages/theme');

// ADR-0059 item 10, verbatim as data. Names drop the `--marxy-color-` prefix (`tok-*` keeps `tok-`).
// A ground is a role, `surface-glass` (as surface, composited over bg), `sel@code-bg` (a role composited
// over another) or `line@code-bg` (Source's active line: the selection mixed 40 % toward transparent over
// code-bg; derived, not a token). A translucent ground with no `@` is composited over `bg`.
const WASHES = ['status-ok-wash', 'status-warn-wash', 'status-err-wash'];
const DIFFS = ['diff-add', 'diff-del', 'diff-add-word', 'diff-del-word'];
const TEXT_GROUNDS = ['surface', 'code-bg', 'selection', 'find', 'find-current', 'accent-wash', ...WASHES, ...DIFFS];
export const FLOORS = [
  { fg: ['text'], floor: 7, grounds: ['bg'] },
  { fg: ['text', 'text-strong'], floor: 4.5, grounds: TEXT_GROUNDS },
  { fg: ['text-strong'], floor: 7, grounds: ['bg'] },
  { fg: ['text-secondary', 'text-faint'], floor: 4.5, grounds: ['bg', 'surface', 'code-bg', 'accent-wash', 'selection', 'find', 'find-current'] },
  { fg: ['accent', 'link', 'accent-strong'], floor: 4.5, grounds: ['bg', 'surface', 'accent-wash'] },
  { fg: ['accent-fg'], floor: 4.5, grounds: ['accent', 'accent-strong'] },
  { fg: ['status-ok'], floor: 4.5, grounds: ['bg', 'surface', 'status-ok-wash'] },
  { fg: ['status-warn'], floor: 4.5, grounds: ['bg', 'surface', 'status-warn-wash'] },
  { fg: ['status-err'], floor: 4.5, grounds: ['bg', 'surface', 'status-err-wash'] },
  { fg: ['status-info'], floor: 4.5, grounds: ['bg', 'surface'] },
  { fg: ['tok-*', 'code-text'], floor: 4.5, grounds: ['code-bg', 'bg', 'selection@code-bg', 'line@code-bg', ...DIFFS.map(d => `${d}@code-bg`)] },
  { fg: ['edge', 'find-edge', 'divider-focus'], floor: 3, grounds: ['bg', 'surface', 'code-bg'] },
];
// Roles contract v2 adds that a v1 theme lacks; reported when absent even though no row names them as a
// token wildcard match.
const V2_TOKENS = ['tok-marker', 'tok-heading', 'tok-link'];
const name = r => (r.startsWith('tok-') ? `--marxy-${r}` : `--marxy-color-${r}`);

// ---- colours -------------------------------------------------------------------------------------
const NAMED = { transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1] };
const clamp01 = x => Math.min(1, Math.max(0, x));
const num = (s, scale = 1) => { const t = s.trim(); return t.endsWith('%') ? parseFloat(t) / 100 * scale : parseFloat(t); };
const alphaOf = s => (s === undefined ? 1 : clamp01(num(s, 1)));

function splitTop(s, sep = ',') {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parse a CSS colour to [r, g, b, a] (0-255, 0-1). `lookup(name)` resolves a var() reference. Throws on anything unsupported. */
export function parseColour(value, lookup = () => undefined) {
  const v = String(value).trim();
  const lower = v.toLowerCase();
  if (NAMED[lower]) return [...NAMED[lower]];
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (![3, 4, 6, 8].includes(h.length)) throw new Error(`bad hex ${v}`);
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    const p = i => parseInt(h.slice(i, i + 2), 16);
    return [p(0), p(2), p(4), h.length === 8 ? p(6) / 255 : 1];
  }
  m = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/i.exec(v);
  if (m) {
    const got = lookup(m[1]);
    if (got !== undefined) return got;
    if (m[2] !== undefined && m[2].trim()) return parseColour(m[2], lookup);
    throw new Error(`${m[1]} is not declared`);
  }
  m = /^(rgba?|hsla?)\(([\s\S]*)\)$/i.exec(v);
  if (m) {
    const parts = m[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) throw new Error(`bad ${m[1]}()`);
    let rgb;
    if (/^rgb/i.test(m[1])) rgb = parts.slice(0, 3).map(p => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)));
    else rgb = hslToRgb(((parseFloat(parts[0]) % 360) + 360) % 360, num(parts[1]), num(parts[2]));
    if (rgb.some(Number.isNaN)) throw new Error(`bad ${m[1]}()`);
    return [...rgb.map(c => Math.min(255, Math.max(0, c))), alphaOf(parts[3])];
  }
  m = /^color-mix\(([\s\S]*)\)$/i.exec(v);
  if (m) {
    const [space, ...ops] = splitTop(m[1]);
    if (!/^in\s+srgb$/i.test(space) || ops.length !== 2) throw new Error('only color-mix(in srgb, a, b) is supported');
    const arms = ops.map(o => {
      const pm = /^([\s\S]*?)\s+(\d*\.?\d+)%$/.exec(o) ?? /^(\d*\.?\d+)%\s+([\s\S]*)$/.exec(o);
      if (!pm) return { c: parseColour(o, lookup), p: undefined };
      const lead = /^(\d*\.?\d+)%\s/.test(o);
      return lead ? { c: parseColour(pm[2], lookup), p: parseFloat(pm[1]) } : { c: parseColour(pm[1], lookup), p: parseFloat(pm[2]) };
    });
    let [p1, p2] = [arms[0].p, arms[1].p];
    if (p1 === undefined && p2 === undefined) [p1, p2] = [50, 50];
    else if (p1 === undefined) p1 = 100 - p2;
    else if (p2 === undefined) p2 = 100 - p1;
    const sum = p1 + p2;
    if (sum <= 0) throw new Error('color-mix percentages sum to 0');
    const w1 = p1 / sum, w2 = p2 / sum, mult = Math.min(1, sum / 100);
    const [a, b] = [arms[0].c, arms[1].c];
    const alpha = a[3] * w1 + b[3] * w2;
    if (alpha === 0) return [0, 0, 0, 0];
    const ch = i => (a[i] * a[3] * w1 + b[i] * b[3] * w2) / alpha;
    return [ch(0), ch(1), ch(2), alpha * mult];
  }
  throw new Error(`cannot parse "${v}"`);
}

/** Source-over: `top` composited over opaque `bottom`. */
export function over(top, bottom) {
  const a = top[3];
  return [0, 1, 2].map(i => top[i] * a + bottom[i] * (1 - a)).concat(1);
}
const lin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
/** WCAG 2.2 contrast ratio of two opaque colours, unrounded. */
export function ratio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---- CSS -----------------------------------------------------------------------------------------
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
const ATTR = (n) => new RegExp(`\\[data-marxy-${n}\\s*=\\s*["']?([\\w-]+)["']?\\s*\\]`);

/** Inline `@import url("x.css")` relative to `file`, depth-first, so a theme sees the tokens it builds on. */
export function flatten(file, read = f => readFileSync(f, 'utf8'), seen = new Set()) {
  if (seen.has(file)) return '';
  seen.add(file);
  return stripComments(read(file)).replace(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/g,
    (_, p) => (/^[a-z]+:/i.test(p) ? '' : flatten(resolve(dirname(file), p), read, seen)));
}

/** Every rule that sets `--marxy-*` on the root or a kind scope: [{ variant, kind, decls }] in source order. */
export function parseRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(css));) {
    const decls = {};
    for (const d of m[2].matchAll(/(--marxy-[\w-]+)\s*:\s*([^;]+)/g)) decls[d[1]] = d[2].trim();
    if (!Object.keys(decls).length) continue;
    for (const sel of m[1].split(',')) {
      const variant = ATTR('variant').exec(sel)?.[1] ?? null;
      const kind = ATTR('kind').exec(sel)?.[1] ?? null;
      const residue = sel.replace(ATTR('variant'), '').replace(ATTR('kind'), '').replace(/:root|\bhtml\b|\*/g, '').trim();
      if (residue) continue;
      rules.push({ variant, kind, decls });
    }
  }
  return rules;
}

/** The token map a (variant, kind) scope sees: base, then the variant, then the kind, then both. */
export function scopeTokens(rules, variant, kind) {
  const layers = [r => !r.variant && !r.kind, r => r.variant === variant && !r.kind, r => !r.variant && r.kind === kind, r => r.variant === variant && r.kind === kind && kind];
  const out = {};
  for (const [i, pick] of layers.entries()) {
    if (i >= 2 && !kind) break;
    for (const r of rules) if (pick(r)) Object.assign(out, r.decls);
  }
  return out;
}

// ---- audit ---------------------------------------------------------------------------------------
/**
 * Audit one theme. `css` is the flattened stylesheet; `variants` the theme.toml list.
 * Returns { checks: [{variant, scope, fg, ground, floor, ratio}], failures: [...strings],
 * undeclared: [{variant, roles}] }.
 */
export function auditTheme(themeName, css, variants) {
  const rules = parseRules(css);
  const kinds = [...new Set(rules.map(r => r.kind).filter(Boolean))].sort();
  const checks = [], failures = [], undeclared = [];
  for (const variant of variants) {
    for (const kind of [null, ...kinds]) {
      const scope = kind ? `kind=${kind}` : 'root';
      const where = `${themeName} · ${variant} · ${scope}`;
      const tokens = scopeTokens(rules, variant, kind);
      const cache = new Map(), busy = new Set(), bad = new Set();
      const colour = token => {
        if (cache.has(token)) return cache.get(token);
        if (!(token in tokens)) return undefined;
        if (busy.has(token)) throw new Error(`${token} refers to itself`);
        busy.add(token);
        try { const c = parseColour(tokens[token], colour); cache.set(token, c); return c; }
        finally { busy.delete(token); }
      };
      // Every declared colour token must parse, used by a pair or not.
      for (const t of Object.keys(tokens).filter(t => /^--marxy-(color|tok)-/.test(t))) {
        try { colour(t); } catch (e) { bad.add(t); failures.push(`${where}: ${t}: unparseable (${e.message}); value: ${tokens[t]}`); }
      }
      const opaque = new Map();
      const ground = spec => {
        const [top, base] = spec.split('@');
        if (spec === 'surface-glass') return over(colour(name('surface-glass')), ground('bg'));
        if (top === 'line') { const s = colour(name('selection')); return over([s[0], s[1], s[2], s[3] * 0.6], ground(base)); }
        const c = colour(name(top));
        if (c === undefined) return undefined;
        if (base) return over(c, ground(base));
        if (c[3] < 1) return over(c, ground('bg'));
        return c;
      };
      const groundOk = spec => {
        if (!opaque.has(spec)) {
          let g;
          try { g = ground(spec); } catch { g = undefined; }
          opaque.set(spec, g);
        }
        return opaque.get(spec);
      };
      const missing = new Set();
      const declared = r => name(r) in tokens;
      const roleMissing = r => { if (!declared(r) || (r === 'surface-glass' && !declared('surface'))) missing.add(r); };
      for (const row of FLOORS) {
        const fgs = row.fg.flatMap(f => (f === 'tok-*' ? [...new Set([...Object.keys(tokens).filter(t => t.startsWith('--marxy-tok-')).map(t => t.slice(8)), ...V2_TOKENS])] : [f]));
        const grounds = row.grounds.flatMap(g => (g === 'surface' ? ['surface', 'surface-glass'] : [g]));
        for (const fg of fgs) {
          if (!declared(fg)) { missing.add(fg); continue; }
          for (const g of grounds) {
            const parts = g.split('@')[0];
            const needed = parts === 'line' ? ['selection', g.split('@')[1]] : [parts, ...(g.includes('@') ? [g.split('@')[1]] : [])];
            if (needed.some(n => !declared(n))) { needed.filter(n => !declared(n)).forEach(roleMissing); continue; }
            if (g === 'surface-glass' && !declared('surface')) continue;
            if (bad.has(name(fg)) || needed.some(n => bad.has(name(n))) || !declared('bg') || bad.has(name('bg'))) continue;
            let fgc, gc;
            try { fgc = colour(name(fg)); gc = groundOk(g); } catch { continue; }
            if (!gc) continue;
            const r = ratio(over(fgc, gc), gc);
            checks.push({ variant, scope, fg, ground: g, floor: row.floor, ratio: r });
            if (r < row.floor) failures.push(`${where}: ${fg} on ${g} = ${(Math.floor(r * 100) / 100).toFixed(2)} < ${row.floor}`);
          }
        }
      }
      if (!kind) undeclared.push({ variant, roles: [...missing].sort() });
    }
  }
  return { checks, failures, undeclared };
}

/** The bundled themes: every packages/theme/<dir> with a theme.css. */
export function findThemes(dir = THEMES_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(dir, e.name, 'theme.css')))
    .map(e => {
      const toml = existsSync(join(dir, e.name, 'theme.toml')) ? readFileSync(join(dir, e.name, 'theme.toml'), 'utf8') : '';
      const list = /^\s*variants\s*=\s*\[([^\]]*)\]/m.exec(toml)?.[1];
      const variants = list ? [...list.matchAll(/["']([\w-]+)["']/g)].map(m => m[1]) : ['dark'];
      return { name: e.name, css: flatten(join(dir, e.name, 'theme.css')), variants };
    });
}

export function auditAll(themes = findThemes()) {
  const all = { checks: [], failures: [], undeclared: [], byTheme: {} };
  for (const t of themes) {
    const r = auditTheme(t.name, t.css, t.variants);
    all.checks.push(...r.checks.map(c => ({ theme: t.name, ...c })));
    all.failures.push(...r.failures);
    all.undeclared.push(...r.undeclared.map(u => ({ theme: t.name, ...u })));
    all.byTheme[t.name] = r;
  }
  return all;
}

export function markdown(all) {
  const out = [];
  for (const [theme, r] of Object.entries(all.byTheme)) {
    const variants = [...new Set(r.checks.map(c => c.variant))];
    out.push(`### ${theme}`, '', `| Role | Against | Floor | ${variants.join(' | ')} |`, `|---|---|---|${variants.map(() => '---').join('|')}|`);
    const keys = [...new Map(r.checks.filter(c => c.scope === 'root').map(c => [`${c.fg}|${c.ground}`, c])).values()];
    for (const k of keys) {
      const cells = variants.map(v => {
        const c = r.checks.find(x => x.scope === 'root' && x.variant === v && x.fg === k.fg && x.ground === k.ground);
        return c ? `${(Math.floor(c.ratio * 100) / 100).toFixed(2)}${c.ratio < c.floor ? ' FAIL' : ''}` : 'not declared';
      });
      out.push(`| ${k.fg} | ${k.ground} | ${k.floor} | ${cells.join(' | ')} |`);
    }
    for (const u of r.undeclared) out.push('', `${theme} · ${u.variant}: not yet declared (${u.roles.length}): ${u.roles.join(', ') || 'none'}`);
    out.push('');
  }
  return out.join('\n');
}

if (import.meta.main) {
  const all = auditAll();
  if (process.argv.includes('--md')) { console.log(markdown(all)); process.exit(all.failures.length ? 1 : 0); }
  const undeclaredCount = all.undeclared.reduce((n, u) => n + u.roles.length, 0);
  for (const u of all.undeclared) if (u.roles.length) console.log(`${u.theme} · ${u.variant} · root: not yet declared (${u.roles.length}): ${u.roles.join(', ')}`);
  console.log(`gate-contrast: ${all.checks.length} pairs checked, ${all.failures.length} failing, ${undeclaredCount} roles not yet declared (${Object.keys(all.byTheme).length} themes)`);
  if (all.failures.length) {
    for (const f of all.failures) console.error(f);
    console.error('    fix: change the colour (a taste story) or the theme, never the floor; node scripts/gate-contrast.mjs --md prints every ratio');
    process.exit(1);
  }
}
