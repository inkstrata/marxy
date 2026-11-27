// The kind icon set: every kind has exactly one glyph, drawn inside the 16-unit grid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FILE_TYPES, KINDS, langOf } from '@marxy/core';
import { GLYPH_SOURCE, ICON_GRID, ICON_STROKE, KIND_GLYPHS, glyphSvg, iconLang, kindIconSvg, langOfPath } from './icons.ts';
import { VIEWER_GLYPHS } from './viewer-glyphs.ts';

test('every kind has exactly one glyph, and no glyph names a kind that does not exist', () => {
  assert.deepEqual(Object.keys(KIND_GLYPHS).sort(), [...KINDS].sort());
  assert.deepEqual(Object.keys(GLYPH_SOURCE).sort(), [...KINDS].sort());
  for (const k of KINDS) assert.ok(KIND_GLYPHS[k].length > 0, k);
});

test('no two kinds share a glyph except by an explicit decision (none today)', () => {
  const seen = new Map<string, string>();
  for (const k of KINDS) {
    assert.equal(seen.get(KIND_GLYPHS[k]), undefined, `${k} duplicates ${seen.get(KIND_GLYPHS[k])}`);
    seen.set(KIND_GLYPHS[k], k);
  }
});

/** Every number a path's commands reach, tracking the current point for relative commands. */
function extents(d: string): number[] {
  const out: number[] = [];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let cmd = '';
  let args: number[] = [];
  let x = 0;
  let y = 0;
  const arity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  const flush = (): void => {
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toLowerCase();
    if (c === 'h') { x = rel ? x + args[0]! : args[0]!; out.push(x); }
    else if (c === 'v') { y = rel ? y + args[0]! : args[0]!; out.push(y); }
    else if (c === 'a') { x = rel ? x + args[5]! : args[5]!; y = rel ? y + args[6]! : args[6]!; out.push(x, y); }
    else if (c !== 'z') {
      for (let i = 0; i < args.length; i += 2) {
        const px = rel ? x + args[i]! : args[i]!;
        const py = rel ? y + args[i + 1]! : args[i + 1]!;
        out.push(px, py);
        if (i + 2 >= args.length) { x = px; y = py; }
      }
    }
    args = [];
  };
  for (const t of tokens) {
    if (/[a-zA-Z]/.test(t)) { cmd = t; if (arity[t.toLowerCase()] === 0) flush(); continue; }
    args.push(Number(t));
    if (args.length === arity[cmd.toLowerCase()]) {
      flush();
      if (cmd === 'm') cmd = 'l';
      if (cmd === 'M') cmd = 'L';
    }
  }
  return out;
}

test('each glyph stays inside the 16-unit box with room for its stroke', () => {
  for (const k of KINDS) {
    const markup = KIND_GLYPHS[k];
    const ds = [...markup.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);
    assert.ok(ds.length > 0, `${k} has a path`);
    for (const d of ds) {
      for (const n of extents(d)) assert.ok(n >= 0.5 && n <= ICON_GRID - 0.5, `${k}: ${n} outside the grid`);
    }
    for (const m of markup.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
      assert.ok(x >= 0.5 && y >= 0.5 && x + w <= 15.5 && y + h <= 15.5, `${k} rect outside the grid`);
    }
  }
});

test('glyphs are stroked with currentColor on a 16 grid; no fixed colour, no fill, no page outline', () => {
  for (const k of KINDS) {
    const svg = kindIconSvg(k);
    assert.match(svg, /viewBox="0 0 16 16"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, new RegExp(`stroke-width="${ICON_STROKE}"`));
    assert.match(svg, /fill="none"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(|style=|<script|\bon\w+=/i, k);
    assert.doesNotMatch(KIND_GLYPHS[k], /fill=(?!"none")/, `${k} fills`);
    // No page outline: nothing spans the whole box.
    assert.doesNotMatch(KIND_GLYPHS[k], /<rect x="[0-2]" y="[0-2]" width="1[3-6]" height="1[3-6]"/);
  }
});

test('only code carries a language', () => {
  assert.equal(iconLang('code', 'rust'), 'rust');
  assert.equal(iconLang('code', undefined), undefined);
  assert.equal(iconLang('log', 'rust'), undefined);
});

test('langOfPath is the language id the registry gives, and nothing for a file it gives none', () => {
  assert.equal(langOfPath('/a/b/main.rs'), 'rust');
  assert.equal(langOfPath('/a/b/X.TS'), 'typescript');
  assert.equal(langOfPath('/a.b/Makefile'), 'make');
  assert.equal(langOfPath('/a/b/Program.cs'), 'csharp');
  assert.equal(langOfPath('/a/b/data.csv'), undefined);
  assert.equal(langOfPath('/a/b/a.zzz'), undefined);
  for (const row of FILE_TYPES) {
    for (const ext of row.match.ext ?? []) {
      assert.equal(langOfPath(`/r/f.${ext}`), row.lang, ext);
      assert.equal(langOfPath(`/r/f.${ext}`), langOf(`/r/f.${ext}`), ext);
    }
  }
});

test('the glyph colour is a theme token the contrast gate already checks (no hard-coded colour)', () => {
  const src = readFileSync(new URL('../palette/view.ts', import.meta.url), 'utf8');
  const rule = /\.marxy-kind-glyph \{[^}]*\}/.exec(src)?.[0] ?? '';
  assert.match(rule, /color: var\(--marxy-lang, var\(--marxy-color-text-secondary/);
  assert.doesNotMatch(rule, /(?:^|[^\w-])#[0-9a-f]{3,8}\s*;/);
});

test('the viewer glyphs: inside the grid, stroked as the kinds are, path and rect only, none the same as another', () => {
  const seen = new Map<string, string>();
  for (const [viewer, g] of Object.entries(VIEWER_GLYPHS)) {
    assert.ok(g !== undefined && g.inner.length > 0, viewer);
    assert.doesNotMatch(g.inner, /<(?!path |rect )[a-z]/, `${viewer}: path and rect only`);
    assert.equal(seen.get(g.inner), undefined, `${viewer} duplicates ${seen.get(g.inner)}`);
    seen.set(g.inner, viewer);
    for (const m of g.inner.matchAll(/ d="([^"]+)"/g)) {
      for (const n of extents(m[1]!)) assert.ok(n >= 0.5 && n <= ICON_GRID - 0.5, `${viewer}: ${n} outside the grid`);
    }
    for (const m of g.inner.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
      assert.ok(x >= 0.5 && y >= 0.5 && x + w <= 15.5 && y + h <= 15.5, `${viewer} rect outside the grid`);
    }
    const svg = glyphSvg(g.inner);
    assert.match(svg, /viewBox="0 0 16 16"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, new RegExp(`stroke-width="${ICON_STROKE}"`));
    assert.match(svg, /fill="none"/);
  }
});
