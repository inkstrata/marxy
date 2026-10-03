#!/usr/bin/env node
// Mechanical aesthetics gate (ADR-0014, docs/design/10-gates-and-testing.md §10). Token checks stay
// as the floor; the headless render entry runs the ten page checks over the corpus in Playwright WebKit.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ragMetrics } from '../packages/typeset/scripts/rag-model.mjs';
import { defaultThemeCss } from '../packages/theme/scripts/inline.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = join(root, 'apps/desktop');
const dist = join(desktop, 'dist');
const corpusDir = join(root, 'fixtures/corpus');
const ragRoot = join(root, 'fixtures/baselines/rag');
const UPDATE = process.argv.includes('--update');
const SELFTEST_ONLY = process.argv.includes('--selftest');
// --mechanical is the pull-request gate (ADR-0047, A-10): every check that cannot be argued with (grid,
// measure, contrast, layout shift, heading colour, overflow, the room, the selftest) and no comparison
// with a stored baseline. It takes no screenshot and reads no rag baseline under fixtures/baselines/rag;
// the selftest still proves checkRag fails on a crafted page. The full gate, with the screenshot and
// rag comparisons, runs nightly (aesthetics-determinism in nightly.yml).
const MECHANICAL = process.argv.includes('--mechanical');
if (MECHANICAL && UPDATE) {
  console.error('aesthetics gate failed:\n - --mechanical compares no baseline, so it cannot --update one');
  process.exit(1);
}
const variantIdx = process.argv.indexOf('--variant');
const VARIANT_FILTER = variantIdx === -1 ? null : process.argv[variantIdx + 1];
if (VARIANT_FILTER && !['dark', 'light'].includes(VARIANT_FILTER)) {
  console.error(`aesthetics gate failed:\n - unknown --variant ${VARIANT_FILTER} (expected dark or light)`);
  process.exit(1);
}
const repeatIdx = process.argv.indexOf('--repeat');
// The CLS repeat pass re-renders the whole corpus to prove the font/image window is deterministic.
// It is a flake detector, not an assertion: the single pass below already measures fontWindow on
// every file × combo and fails on it. Three more full passes cost 266s of the browser job's 356s,
// which is the pull-request critical path, so nothing implies --repeat any more. The nightly
// workflow runs `--repeat 3` and keeps the signal off the path we iterate on (MARXY-153).
const REPEAT = repeatIdx === -1 ? 0 : Math.max(1, Number.parseInt(process.argv[repeatIdx + 1] ?? '', 10) || 0);
// Every corpus render is an independent page against a static harness, and nothing in the checks is
// wall-clock: snapshots are taken after document.fonts.ready and rAF pairs, rag and grid read
// geometry, screenshots rasterise deterministically. So contention delays a pass, it cannot change
// its verdict, and the matrix can run several pages at a time. The cap matches a standard runner.
const workersIdx = process.argv.indexOf('--workers');
const WORKERS = Math.max(
  1,
  Number.parseInt(workersIdx === -1 ? (process.env.MARXY_AESTHETICS_WORKERS ?? '') : (process.argv[workersIdx + 1] ?? ''), 10) ||
    Math.min(4, Math.max(1, cpus().length)),
);

/** Run `task` over `items`, at most WORKERS in flight, results in input order so failures are stable. */
async function pool(items, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(WORKERS, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await task(items[i]);
    }),
  );
  return out;
}
const REQUIRED = process.env.MARXY_AESTHETICS_REQUIRED === '1' || process.env.GITHUB_ACTIONS === 'true';
const RAG_OPTS = { shortLineFraction: 0.1, badnessStretchEm: 2 };
const WIDTHS = [720, 960, 1280];
const VARIANTS = ['dark', 'light'];
const SIZES = [16, 20, 24, 28];
const LINE_BOX = { 16: 24, 20: 30, 24: 36, 28: 42 };
const FONT_URLS = {
  '/fonts/Literata.ttf': join(root, 'fonts/literata/Literata[opsz,wght].ttf'),
  '/fonts/Literata-Italic.ttf': join(root, 'fonts/literata/Literata-Italic[opsz,wght].ttf'),
  '/fonts/JetBrainsMono.ttf': join(root, 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf'),
};

const tokens = readFileSync(join(root, 'packages/theme/src/tokens.css'), 'utf8');
const get = (k) => (tokens.match(new RegExp(`${k}:\\s*([^;]+);`)) || [])[1];
const lineBox = parseFloat(get('--marxy-line-box'));
const body = parseFloat(get('--marxy-size-body'));
const measureChars = parseFloat(get('--marxy-measure-chars'));
const fails = [];
const notes = [];

if (!(measureChars >= 45 && measureChars <= 80)) fails.push(`measure ${measureChars} characters outside 45–80 (constraint 1, ADR-0033)`);
if (!(lineBox / body >= 1.5 && lineBox / body <= 1.75)) fails.push(`line box ${lineBox}/${body} outside 1.5–1.75 (constraint 2)`);
const lum = (hex) => {
  const c = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const cr = contrast(get('--marxy-color-text').trim(), get('--marxy-color-bg').trim());
if (cr < 7) fails.push(`body contrast ${cr.toFixed(2)} < 7:1 (constraint 4)`);

function engineName() {
  if (process.platform === 'darwin') return 'webkit-macos';
  if (process.platform === 'linux') return 'webkit-linux';
  return `webkit-${process.platform}`;
}

function corpusFiles() {
  return readdirSync(corpusDir).filter((f) => /^\d{2}-.+\.md$/.test(f)).sort();
}

function matrix() {
  const variants = VARIANT_FILTER ? VARIANTS.filter((v) => v === VARIANT_FILTER) : VARIANTS;
  const out = [];
  for (const width of WIDTHS) {
    for (const variant of variants) {
      if (width === 960) {
        for (const size of SIZES) out.push({ width, variant, size });
      } else {
        out.push({ width, variant, size: 20 });
      }
    }
  }
  return out;
}

async function buildRenderEntry() {
  const require = createRequire(join(desktop, 'package.json'));
  const { build } = require('vite');
  await build({
    configFile: join(desktop, 'src/render/vite.config.ts'),
    root: desktop,
    logLevel: 'error',
  });
  mkdirSync(dist, { recursive: true });
  const fontsCss = readFileSync(join(desktop, 'src/fonts/fonts.css'), 'utf8').replaceAll('./fonts/', '/fonts/');
  writeFileSync(
    join(dist, 'render.html'),
    `<!doctype html>
<html lang="en" data-marxy-variant="dark">
<head>
<meta charset="utf-8">
<title>marxy render</title>
<style id="marxy-fonts">${fontsCss}</style>
<style id="marxy-default-theme">${defaultThemeCss()}</style>
</head>
<body>
<main id="marxy-main"><article id="doc" class="marxy-article"></article></main>
<script src="./render.js"></script>
</body>
</html>
`,
  );
  if (!existsSync(join(dist, 'render.js'))) throw new Error('vite build did not write apps/desktop/dist/render.js');
}

function startHarness() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.ttf': 'font/ttf',
  };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const send = (code, type, body) => {
      res.statusCode = code;
      res.setHeader('Content-Type', type);
      res.end(body);
    };
    if (FONT_URLS[path]) return send(200, 'font/ttf', readFileSync(FONT_URLS[path]));
    const file = path === '/' ? join(dist, 'render.html') : join(dist, path.slice(1));
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) return send(404, 'text/plain', 'not found');
    const ext = file.slice(file.lastIndexOf('.'));
    return send(200, types[ext] ?? 'application/octet-stream', readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}

/** §10 check 1. Same remainder test as offGrid in packages/theme/test/grid.test.mjs. */
async function checkGrid(page) {
  return page.evaluate(() => {
    const article = document.getElementById('doc');
    const unit = parseFloat(getComputedStyle(article).lineHeight) / 2;
    const origin = article.getBoundingClientRect().top;
    const off = [];
    for (const el of article.querySelectorAll('[data-marxy-s]')) {
      const display = getComputedStyle(el).display;
      if (!['block', 'table', 'list-item', 'flow-root'].includes(display)) continue;
      const top = el.getBoundingClientRect().top - origin;
      const r = ((top % unit) + unit) % unit;
      if (r > 0.5 && r < unit - 0.5) off.push(`<${el.tagName.toLowerCase()}> top ${top.toFixed(2)} (unit ${unit})`);
    }
    return off;
  });
}

/**
 * §10 check 2, in average characters rather than ch (ADR-0033): the column divided by the mean advance
 * of English prose in the article's own face, within 10 % of `--marxy-measure-chars` (66 by default).
 * Skipped when the window is narrower than the column: then the window, not the measure, sets it.
 */
const MEASURE_SAMPLE =
  'A reader app makes one promise: that the text will get out of the way. Keeping it is harder than it looks, because typographic choices interact. A larger face wants a longer line; a longer line wants more space between lines; and a dark theme changes how heavy the same letters appear.';
async function checkMeasure(page) {
  const r = await page.evaluate((sample) => {
    const article = document.getElementById('doc');
    const probe = document.createElement('span');
    probe.style.whiteSpace = 'pre';
    probe.textContent = sample;
    article.prepend(probe);
    const avg = probe.getBoundingClientRect().width / sample.length;
    probe.remove();
    const style = getComputedStyle(article);
    const target = parseFloat(style.getPropertyValue('--marxy-measure-chars')) || 66;
    const column = article.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const windowBound = parseFloat(style.maxWidth) > column + 1;
    return { chars: column / avg, target, windowBound };
  }, MEASURE_SAMPLE);
  if (r.windowBound) return [];
  return Math.abs(r.chars - r.target) <= r.target * 0.1 ? [] : [`measure ${r.chars.toFixed(1)} characters, target ${r.target} ± 10 %`];
}

function luminanceRgb([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrastRgb(a, b) {
  const [x, y] = [luminanceRgb(a), luminanceRgb(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Background tokens whose foreground pairs are checked against declared theme values (MARXY-241). */
const TINT_BACKGROUNDS = [
  '--marxy-color-bg',
  '--marxy-color-code-bg',
  '--marxy-color-selection',
  '--marxy-color-find',
  '--marxy-color-find-current',
  '--marxy-color-notice',
];
const TINT_FOREGROUNDS = [
  '--marxy-color-text',
  '--marxy-color-text-secondary',
  '--marxy-color-code-text',
  '--marxy-tok-keyword',
  '--marxy-tok-string',
  '--marxy-tok-comment',
  '--marxy-tok-number',
  '--marxy-tok-function',
  '--marxy-tok-type',
  '--marxy-tok-variable',
  '--marxy-tok-operator',
  '--marxy-tok-punctuation',
  '--marxy-tok-constant',
  '--marxy-tok-tag',
  '--marxy-tok-attribute',
];

function declaredTintBackgrounds() {
  const css = [
    join(root, 'packages/theme/src/tokens.css'),
    join(root, 'packages/theme/default/theme.css'),
    join(root, 'packages/theme/src/base.css'),
  ]
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
  const names = new Set(TINT_BACKGROUNDS);
  for (const m of css.matchAll(/(--marxy-color-diff-[\w-]+)/g)) names.add(m[1]);
  return [...names];
}

function minContrastForTintPair(fgToken, bgToken) {
  if (fgToken === '--marxy-color-text' && bgToken === '--marxy-color-bg') return 7;
  if (fgToken === '--marxy-color-code-text' && bgToken === '--marxy-color-code-bg') return 7;
  return 4.5;
}

function tintPairRules() {
  const rules = [];
  for (const bg of declaredTintBackgrounds()) {
    for (const fg of TINT_FOREGROUNDS) {
      rules.push({ fg, bg, min: minContrastForTintPair(fg, bg) });
    }
  }
  return rules;
}

const TINT_PAIR_RULES = tintPairRules();

/** §10 check 3 — every text-bearing computed pair and every declared text-on-tint (MARXY-241). */
async function checkContrast(page) {
  return page.evaluate(({ tintRules }) => {
    const article = document.getElementById('doc');
    if (!article) return ['contrast: missing #doc'];
    const rgb = (value) => {
      const probe = document.createElement('i');
      probe.style.color = value;
      document.body.append(probe);
      const raw = getComputedStyle(probe).color;
      probe.remove();
      const parts = raw.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return null;
      return parts.slice(0, 3).map(Number);
    };
    const lum = (c) => {
      const v = c.map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const contrast = (a, b) => {
      if (!a || !b) return 0;
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const close = (a, b) =>
      a &&
      b &&
      Math.abs(a[0] - b[0]) < 2 &&
      Math.abs(a[1] - b[1]) < 2 &&
      Math.abs(a[2] - b[2]) < 2;
    const bgOf = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return rgb(bg);
        node = node.parentElement;
      }
      return rgb(getComputedStyle(article).backgroundColor);
    };
    const root = getComputedStyle(document.documentElement);
    const bodyRgb = rgb(getComputedStyle(article).color);
    const codeRgb = rgb(root.getPropertyValue('--marxy-color-code-text'));
    const out = [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const compact = node.textContent?.replace(/\s+/g, '') ?? '';
      if (!compact.length) continue;
      const el = node.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const fg = rgb(cs.color);
      const bg = bgOf(el);
      if (!fg || !bg) continue;
      const key = `${fg.join(',')}|${bg.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ratio = contrast(fg, bg);
      const inCode = el.closest('pre, code') !== null;
      const min = inCode && close(fg, codeRgb) ? 7 : close(fg, bodyRgb) ? 7 : 4.5;
      if (ratio < min) {
        out.push(`<${el.tagName.toLowerCase()}> contrast ${ratio} < ${min}:1`);
      }
      if (out.length >= 40) break;
    }
    for (const { fg, bg, min } of tintRules) {
      const fgRgb = rgb(root.getPropertyValue(fg));
      const bgRgb = rgb(root.getPropertyValue(bg));
      if (!fgRgb || !bgRgb) continue;
      const ratio = contrast(fgRgb, bgRgb);
      if (ratio < min) out.push(`${fg} on ${bg} contrast ${ratio} < ${min}:1`);
    }
    return out;
  }, { tintRules: TINT_PAIR_RULES });
}

/** WCAG 1.4.10 reflow: no page-level horizontal scroll (MARXY-241). */
async function checkNoHorizontalPageScroll(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const sw = Math.max(doc.scrollWidth, document.body.scrollWidth);
    const cw = doc.clientWidth;
    return sw > cw + 1 ? [`horizontal scroll ${sw}px > ${cw}px viewport`] : [];
  });
}

function themeFixtureNames() {
  const dir = join(root, 'fixtures/themes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'theme.css')))
    .sort();
}

/**
 * §10 check 4. WebKit does not implement PerformanceObserver `layout-shift`, so a missing
 * measurement is a failure, not cls: 0. The number itself comes from in-page block rects.
 * `snapshots >= 2` is the floor the crafted --selftest report uses (two rects around a late
 * image). finishShift never returns fewer than 3; tightening this to 3 would make that
 * selftest throw instead of scoring the late-image miss.
 */
function checkCls(reported) {
  if (reported == null || reported.observed !== true) {
    return [`layout shift unobserved: ${reported?.reason ?? 'no measurement'}`];
  }
  if ((reported.snapshots ?? 0) < 2) {
    return [`layout shift unobserved: ${reported.snapshots ?? 0} snapshot(s)`];
  }
  if (reported.cls > 0) {
    const bits = [];
    if ((reported.fontWindow ?? 0) > 0) bits.push(`font/image ${reported.fontWindow}`);
    if ((reported.settleWindow ?? 0) > 0) bits.push(`settle ${reported.settleWindow}`);
    return [`layout shift ${reported.cls}${bits.length ? ` (${bits.join(', ')})` : ''}`];
  }
  return [];
}

/** Line widths per p.marxy-set, via Range per break, matching measure-rendered.mjs grouping. */
async function readSetLines(page) {
  return page.evaluate(() => {
    const article = document.getElementById('doc');
    const out = [];
    for (const p of article.querySelectorAll('p.marxy-set')) {
      const cs = getComputedStyle(p);
      const box = p.getBoundingClientRect();
      const left = box.left + parseFloat(cs.paddingLeft);
      const measure = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const range = document.createRange();
      range.selectNodeContents(p);
      const lines = new Map();
      for (const r of range.getClientRects()) {
        if (r.width === 0) continue;
        const key = Math.floor((r.top + r.height / 2 - box.top - parseFloat(cs.paddingTop)) / parseFloat(cs.lineHeight));
        const line = lines.get(key) ?? { left: Infinity, right: -Infinity };
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
        lines.set(key, line);
      }
      const widths = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l.right - left);
      out.push({ measure, widths });
    }
    return out;
  });
}

function ragOf(lines) {
  if (lines.length === 0) return { cv: 0, shortLineRate: 0 };
  const measure = lines[0].measure;
  const m = ragMetrics(lines.map((l) => l.widths), measure, RAG_OPTS);
  return { cv: m.cv ?? 0, shortLineRate: m.shortLineRate ?? 0 };
}

/** §10 check 5. */
function checkRag(metrics, baseline, file) {
  if (!baseline) return [`rag baseline missing for ${file}`];
  const out = [];
  if (metrics.cv > baseline.cv * 1.05 + 1e-12) out.push(`${file} rag cv ${metrics.cv.toFixed(4)} > baseline ${baseline.cv.toFixed(4)} + 5%`);
  if (metrics.shortLineRate > baseline.shortLineRate * 1.05 + 1e-12) {
    out.push(`${file} short-line rate ${metrics.shortLineRate.toFixed(2)}% > baseline ${baseline.shortLineRate.toFixed(2)}% + 5%`);
  }
  return out;
}

/** Literal origin/main checkHanging — selftest only (40 % floor for every `.marxy-hang`). */
async function checkHangingPreFix(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.marxy-hang')) {
      const p = el.closest('p, li, blockquote') ?? el.parentElement;
      if (!p) continue;
      const cs = getComputedStyle(p);
      const contentLeft = p.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
      const rect = el.getBoundingClientRect();
      if (!(rect.left < contentLeft - 0.4 * rect.width)) {
        out.push(`hang ${el.textContent.slice(0, 12)} does not sit outside the edge`);
      }
    }
    return out;
  });
}

/** §10 check 6 — full quote hangs (hangFraction 1) use the 40 % floor; optical protrusion matches margin. */
async function checkHanging(page) {
  return page.evaluate(() => {
    const out = [];
    const tol = 0.75;
    for (const el of document.querySelectorAll('.marxy-hang')) {
      const p = el.closest('p, li, blockquote') ?? el.parentElement;
      if (!p) continue;
      const cs = getComputedStyle(p);
      const contentLeft = p.getBoundingClientRect().left + parseFloat(cs.paddingLeft);
      const rect = el.getBoundingClientRect();
      const marginPx = -parseFloat(getComputedStyle(el).marginInlineStart) || 0;
      if (marginPx <= 0) continue;
      const outside = contentLeft - rect.left;
      if (marginPx >= 0.4 * rect.width) {
        if (!(rect.left < contentLeft - 0.4 * rect.width)) {
          out.push(`hang ${el.textContent.slice(0, 12)} does not sit outside the edge`);
        }
      } else if (Math.abs(outside - marginPx) > tol) {
        out.push(`hang ${el.textContent.slice(0, 12)} does not sit outside the edge (outside ${outside.toFixed(2)} px, margin ${marginPx.toFixed(2)} px)`);
      }
    }
    return out;
  });
}

/** §10 check 7. */
async function checkHierarchy(page) {
  return page.evaluate(() => {
    const article = document.getElementById('doc');
    const articleColor = getComputedStyle(article).color;
    const out = [];
    for (const h of article.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const s = getComputedStyle(h);
      if (s.color !== articleColor) out.push(`${h.tagName} color ${s.color} ≠ article ${articleColor}`);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none') out.push(`${h.tagName} has a border`);
      }
      if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' && s.backgroundImage !== 'none') {
        const articleBg = getComputedStyle(article).backgroundColor;
        if (s.backgroundColor !== articleBg) out.push(`${h.tagName} background ${s.backgroundColor}`);
      }
    }
    return out;
  });
}

/** §10 check 8. */
async function checkCodeVoice(page, { xHeight = false } = {}) {
  return page.evaluate((strict) => {
    const article = document.getElementById('doc');
    const p = article.querySelector('p');
    const code = article.querySelector('code');
    if (!p || !code) return [];
    const pf = getComputedStyle(p).fontFamily;
    const cf = getComputedStyle(code).fontFamily;
    const out = [];
    if (pf === cf) out.push(`code font-family equals body (${cf})`);
    // The 5 % x-height probe is the selftest (same size, a crafted miss). The shipped
    // pair at a shared size is ~108 %, and at 18/20 (the tokens, ADR-0033) ~97 %.
    const xHeightAt = (el, size) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const s = getComputedStyle(el);
      ctx.font = `${s.fontStyle} ${s.fontWeight} ${size} ${s.fontFamily}`;
      const m = ctx.measureText('x');
      return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    };
    const size = getComputedStyle(p).fontSize;
    const px = xHeightAt(p, size);
    const cx = xHeightAt(code, size);
    if (strict && px > 0 && Math.abs(cx - px) / px > 0.05) {
      out.push(`x-height ratio ${((cx / px) * 100).toFixed(1)}% outside 5%`);
    }
    return out;
  }, xHeight);
}

/** §10 check 9. html/body and the main landmark itself are the page, not chrome. */
async function checkChrome(page) {
  return page.evaluate(() => {
    const main = document.getElementById('marxy-main');
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      if (el === document.documentElement || el === document.body || el === main) continue;
      if (main && main.contains(el)) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push(`visible <${el.tagName.toLowerCase()}> outside #marxy-main`);
    }
    return out;
  });
}

function shotDir() {
  return join(root, 'fixtures/baselines', engineName());
}

function shotName(file, width, variant, where) {
  const stem = file.replace(/\.md$/, '');
  return `${stem}-${width}-${variant}${where === 'last' ? '-last' : ''}.png`;
}

/** §10 check 10: 960 px dark/light only; same threshold and 0.1 % budget as `pixelmatch` (MIT). */
function screenshotCombo(opts) {
  return opts.width === 960 && opts.size === 20 && (opts.variant === 'dark' || opts.variant === 'light');
}

function diffDir() {
  return join(root, 'results/diffs', engineName());
}

const SHOT_THRESHOLD = 0.1;
const SHOT_MAX_PCT = 0.1;
let screenshotsTaken = 0;

/** Every page.screenshot of the gate goes through here, so the --mechanical run can prove it took none. */
function screenshot(page) {
  screenshotsTaken++;
  return page.screenshot({ fullPage: false, type: 'png' });
}

/** RGBA compare in-page (Playwright WebKit has createImageBitmap); matches pixelmatch threshold semantics. */
async function compareScreenshotPng(page, expected, actual, { writeDiffPath } = {}) {
  const payload = await page.evaluate(
    async ({ a, b, threshold, diffPath }) => {
      const decode = async (bytes) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const left = await decode(a);
      const right = await decode(b);
      if (left.width !== right.width || left.height !== right.height) {
        return { pct: 100, reason: `size ${left.width}×${left.height} vs ${right.width}×${right.height}`, diffPng: null };
      }
      let differ = 0;
      const n = left.data.length / 4;
      const out = new Uint8ClampedArray(left.data.length);
      for (let i = 0; i < left.data.length; i += 4) {
        const dr = left.data[i] - right.data[i];
        const dg = left.data[i + 1] - right.data[i + 1];
        const db = left.data[i + 2] - right.data[i + 2];
        const da = left.data[i + 3] - right.data[i + 3];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db + da * da) / 510;
        if (dist > threshold) {
          differ++;
          out[i] = 255;
          out[i + 1] = out[i + 2] = 0;
          out[i + 3] = 255;
        } else {
          out[i] = left.data[i];
          out[i + 1] = left.data[i + 1];
          out[i + 2] = left.data[i + 2];
          out[i + 3] = left.data[i + 3];
        }
      }
      let diffPng = null;
      if (diffPath && differ > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = left.width;
        canvas.height = left.height;
        canvas.getContext('2d').putImageData(new ImageData(out, left.width, left.height), 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        diffPng = [...atob(dataUrl.slice(dataUrl.indexOf(',') + 1))].map((c) => c.charCodeAt(0));
      }
      return { pct: (differ / n) * 100, diffPng };
    },
    {
      a: [...expected],
      b: [...actual],
      threshold: SHOT_THRESHOLD,
      diffPath: writeDiffPath ?? null,
    },
  );
  if (writeDiffPath && payload.diffPng?.length) {
    mkdirSync(dirname(writeDiffPath), { recursive: true });
    writeFileSync(writeDiffPath, Buffer.from(payload.diffPng));
  }
  return payload;
}

async function checkScreenshot(page, { file, width, variant, update }) {
  const dir = shotDir();
  const out = [];
  for (const where of ['first', 'last']) {
    if (where === 'last') {
      const moved = await page.evaluate(() => {
        const headings = [...document.querySelectorAll('#doc h1, #doc h2, #doc h3, #doc h4, #doc h5, #doc h6')];
        const last = headings[headings.length - 1];
        if (!last) return false;
        last.scrollIntoView();
        return true;
      });
      if (!moved) continue;
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const png = await screenshot(page);
    const name = shotName(file, width, variant, where);
    const dest = join(dir, name);
    if (update || !existsSync(dest)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(dest, png);
      out.push(`baseline created; add a queue entry (${engineName()}/${name})`);
      continue;
    }
    const expected = readFileSync(dest);
    if (expected.equals(png)) continue;
    const diffPath = join(diffDir(), name.replace(/\.png$/, '.diff.png'));
    const diff = await compareScreenshotPng(page, expected, png, { writeDiffPath: diffPath });
    if (diff.pct > SHOT_MAX_PCT) {
      out.push(`${file} ${width} ${variant} ${where}: ${diff.pct.toFixed(3)}% pixels differ${diff.reason ? ` (${diff.reason})` : ''} (diff ${diffPath.slice(root.length + 1)})`);
    }
  }
  return out;
}

async function runPageChecks(page, result, ctx) {
  const problems = [];
  const prefix = `${ctx.file} ${ctx.width}×${ctx.size} ${ctx.variant}`;
  const add = (list) => { for (const p of list) problems.push(`${prefix}: ${p}`); };
  add(await checkGrid(page));
  add(await checkMeasure(page));
  add(await checkContrast(page));
  add(checkCls(result?.stats));
  add(await checkHanging(page));
  add(await checkHierarchy(page));
  add(await checkCodeVoice(page));
  add(await checkChrome(page));
  if (ctx.rag) add(checkRag(ctx.rag.metrics, ctx.rag.baseline, ctx.file));
  if (ctx.shot) add(await checkScreenshot(page, ctx.shot));
  return problems;
}

function crafted(body, extraCss = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff;color:#111}
#marxy-main{width:960px}
.marxy-article{font:17px/28px serif;max-width:68ch;padding:0;color:#111;background:#fff}
${extraCss}
</style></head><body><main id="marxy-main"><article id="doc" class="marxy-article">${body}</article></main></body></html>`;
}

/** Image swap that moves a following block, using the same in-page geometry as marxyRender. */
async function craftedClsShift(page, origin) {
  await page.goto(`${origin}/render.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyLayoutShift?.snapshot === 'function');
  return page.evaluate(async () => {
    const article = document.getElementById('doc');
    article.innerHTML =
      '<p data-marxy-s="0" data-marxy-e="1" style="display:block;margin:0">Above</p>' +
      '<img id="late" alt="" style="display:block">' +
      '<p data-marxy-s="2" data-marxy-e="3" style="display:block;margin:0">Moves when the image arrives</p>';
    const shift = window.marxyLayoutShift;
    shift.assertCanObserve();
    const first = shift.snapshot(article);
    const img = document.getElementById('late');
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 200;
    img.src = canvas.toDataURL();
    await img.decode();
    void article.offsetHeight;
    const second = shift.snapshot(article);
    return { cls: shift.movedFraction(first, second), observed: true, snapshots: 2 };
  });
}

/**
 * B-03: wide code runs into the margin of the box the article sits in, not the window. A 735 px
 * `#marxy-main` in a 1,470 px viewport (a half-width pane) holds a 140-character code line; the
 * `pre` must not end past the container. `css` is injectable so the selftest can prove the check
 * fails against the pre-fix `100vw` rule.
 */
async function checkRoomInNarrowContainer(browser, css = defaultThemeCss()) {
  const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
  try {
    await page.setContent(
      `<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0"><main id="marxy-main" style="width:735px"><article id="doc" class="marxy-article"><pre><code>${'x'.repeat(140)}</code></pre></article></main></body></html>`,
      { waitUntil: 'domcontentloaded' },
    );
    const m = await page.evaluate(() => ({
      pre: document.querySelector('#doc pre').getBoundingClientRect().right,
      main: document.getElementById('marxy-main').getBoundingClientRect().right,
    }));
    const spill = m.pre - m.main;
    return { spill, problems: spill > 0.5 ? [`code block spills ${spill.toFixed(1)}px past its 735px container (pre right ${m.pre.toFixed(1)}, container right ${m.main.toFixed(1)})`] : [] };
  } finally {
    await page.close();
  }
}

async function selftest(browser, origin) {
  const cases = [
    {
      name: 'grid',
      html: crafted('<h2 data-marxy-s="0" data-marxy-e="1" style="display:block;margin:0;position:relative;top:3px">Off</h2>'),
      run: checkGrid,
    },
    {
      name: 'measure',
      html: crafted('<p>Measure</p>', '.marxy-article{width:90ch;max-width:90ch;padding:0}'),
      run: checkMeasure,
    },
    {
      name: 'contrast-link',
      html: crafted('<p><a href="#">Low</a></p>', '.marxy-article{background:#fff;color:#111}a{color:#9a9a9a}'),
      run: checkContrast,
    },
    {
      name: 'contrast-kbd',
      html: crafted('<p><kbd>K</kbd></p>', '.marxy-article{background:#fff;color:#111}kbd{color:#aaa;border-color:#aaa;background:#fff}'),
      run: checkContrast,
    },
    {
      name: 'contrast-th',
      html: crafted('<table><tr><th>Head</th><td>x</td></tr></table>', '.marxy-article{background:#fff;color:#111}th{color:#aaa}'),
      run: checkContrast,
    },
    {
      name: 'cls',
      html: null,
      run: async (page) => {
        const reported = await craftedClsShift(page, origin);
        const problems = checkCls(reported);
        // Silence is a failure: an unobserved 0 must not pass the way WebKit's no-op observer did.
        const silence = checkCls({ cls: 0, observed: false, reason: 'engine cannot observe' });
        if (silence.length === 0) return [];
        return problems;
      },
    },
    {
      name: 'rag',
      html: crafted('<p class="marxy-set" data-marxy-s="0" style="width:400px;max-width:400px;line-height:20px">Hi<span class="marxy-lb" style="display:block"></span>this second line is long enough to fill the measure of the paragraph</p>'),
      run: async (page) => {
        const metrics = ragOf(await readSetLines(page));
        return checkRag(metrics, { cv: 0, shortLineRate: 0 }, 'crafted.md');
      },
    },
    {
      name: 'chrome',
      html: crafted('<p>In</p>') + '<mark>out</mark>',
      run: checkChrome,
    },
    {
      name: 'hierarchy',
      html: crafted('<h2 style="color:red">Red</h2><p>Body</p>'),
      run: checkHierarchy,
    },
    {
      name: 'code-voice',
      html: crafted('<p>Body <code>x</code></p>', 'p,code{font-family:serif}'),
      run: (page) => checkCodeVoice(page, { xHeight: true }),
    },
    {
      name: 'hanging-quote',
      html: crafted(
        '<p style="margin:0;padding-left:20px"><span class="marxy-hang" style="display:inline-block;margin-inline-start:-14px;position:relative;left:13px">\u201c</span>Short</p>',
      ),
      run: checkHanging,
    },
  ];
  const missed = [];
  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    if (c.html) await page.setContent(c.html, { waitUntil: 'domcontentloaded' });
    const problems = await c.run(page);
    await page.close();
    if (problems.length === 0) missed.push(c.name);
  }
  if (missed.length) throw new Error(`selftest: these checks did not fail on a crafted page: ${missed.join(', ')}`);

  const optical = await browser.newPage({ viewport: { width: 960, height: 800 } });
  await optical.setContent(
    crafted(
      '<p style="margin:0;padding-left:20px"><span class="marxy-hang" style="display:inline-block">T</span>ext</p>',
    ),
    { waitUntil: 'domcontentloaded' },
  );
  const opticalSizing = await optical.evaluate(() => {
    const el = document.querySelector('.marxy-hang');
    const rect = el.getBoundingClientRect();
    const w = rect.width;
    el.style.marginInlineStart = `${-0.05 * w}px`;
    return { width: w, marginPx: 0.05 * w };
  });
  const preFixProblems = await checkHangingPreFix(optical);
  if (preFixProblems.length === 0) {
    throw new Error(
      `selftest: ~5% optical protrusion must fail pre-fix checkHanging (margin/width=${(opticalSizing.marginPx / opticalSizing.width).toFixed(3)})`,
    );
  }
  const opticalProblems = await checkHanging(optical);
  await optical.close();
  if (opticalProblems.length) {
    throw new Error(`selftest: valid ~5% optical protrusion must pass checkHanging (${opticalProblems.join('; ')})`);
  }

  // The screenshot comparator's own selftest needs two screenshots; --mechanical compares none.
  if (!MECHANICAL) {
    const shotPage = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await shotPage.setContent(
      crafted('<h2 data-marxy-s="0" data-marxy-e="1" style="display:block;margin:0">Title</h2><p>Body text for the viewport shot.</p>'),
      { waitUntil: 'domcontentloaded' },
    );
    const shotBase = await screenshot(shotPage);
    const same = await compareScreenshotPng(shotPage, shotBase, shotBase);
    if (same.pct > SHOT_MAX_PCT) {
      throw new Error(`selftest: identical screenshot reruns must match (got ${same.pct.toFixed(3)}% differ)`);
    }
    await shotPage.evaluate(() => {
      document.querySelector('h2').style.marginTop = '1px';
    });
    const shotShift = await screenshot(shotPage);
    const shifted = await compareScreenshotPng(shotPage, shotBase, shotShift);
    await shotPage.close();
    if (shifted.pct <= SHOT_MAX_PCT) {
      throw new Error(`selftest: 1px h2 margin must fail screenshot diff (got ${shifted.pct.toFixed(3)}% differ)`);
    }
  }

  return {
    rectWidth: opticalSizing.width,
    marginPx: opticalSizing.marginPx,
    marginOverWidth: opticalSizing.marginPx / opticalSizing.width,
    preFixProblems,
    headProblems: opticalProblems,
  };
}

async function renderCorpus(page, origin, source, opts) {
  await page.goto(`${origin}/render.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyRender === 'function');
  return page.evaluate(async ({ source, opts }) => window.marxyRender(source, opts), { source, opts });
}

/** Documents whose font/image window (snaps[0]→[1]) scored movement; used by --repeat. */
function fontWindowOffenders(result, ctx) {
  if ((result?.stats?.fontWindow ?? 0) <= 0) return [];
  return [`${ctx.file} ${ctx.width}×${ctx.size} ${ctx.variant}: layout shift ${result.stats.cls} (font/image ${result.stats.fontWindow})`];
}

async function clsCorpusPass(browser, harness, files, combos) {
  const tasks = files.flatMap((file) => {
    const source = readFileSync(join(corpusDir, file), 'utf8');
    return combos.map((opts) => ({ file, source, opts }));
  });
  const found = await pool(tasks, async ({ file, source, opts }) => {
    const page = await browser.newPage({ viewport: { width: opts.width, height: 900 } });
    try {
      const result = await renderCorpus(page, harness.origin, source, opts);
      return fontWindowOffenders(result, { file, ...opts });
    } catch (e) {
      return [`${file} ${opts.width}×${opts.size} ${opts.variant}: marxyRender threw: ${e.message}`];
    } finally {
      await page.close();
    }
  });
  return new Set(found.flat());
}

function sameOffenderSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Same split as shotDir(): FreeType (webkit-linux) and CoreText (webkit-macos) do not share rag numbers. */
function ragDir() {
  return join(ragRoot, engineName());
}

function loadRagBaseline(file) {
  const path = join(ragDir(), file.replace(/\.md$/, '') + '.json');
  if (!existsSync(path)) return { path, data: null };
  return { path, data: JSON.parse(readFileSync(path, 'utf8')) };
}

function writeRagBaseline(file, metrics) {
  mkdirSync(ragDir(), { recursive: true });
  const path = join(ragDir(), file.replace(/\.md$/, '') + '.json');
  writeFileSync(path, `${JSON.stringify({ file, cv: metrics.cv, shortLineRate: metrics.shortLineRate }, null, 2)}\n`);
  return path;
}

async function main() {
  if (fails.length) {
    console.error('aesthetics gate failed:\n - ' + fails.join('\n - '));
    process.exit(1);
  }

  await buildRenderEntry();
  notes.push('apps/desktop/dist/render.js built');

  let webkit;
  try {
    ({ webkit } = await import('playwright'));
  } catch (e) {
    if (REQUIRED) {
      console.error(`aesthetics gate failed:\n - playwright is not installed (${e.message})`);
      process.exit(1);
    }
    console.log(`aesthetics gate ok: measure ${measureChars} characters, line box ${lineBox}px, contrast ${cr.toFixed(2)}:1 (browser checks pending: playwright missing)`);
    return;
  }
  if (!existsSync(webkit.executablePath()) && REQUIRED) {
    console.error('aesthetics gate failed:\n - Playwright WebKit is not installed; MARXY_AESTHETICS_REQUIRED=1 makes this a failure');
    process.exit(1);
  }
  if (!existsSync(webkit.executablePath())) {
    console.log(`aesthetics gate ok: measure ${measureChars} characters, line box ${lineBox}px, contrast ${cr.toFixed(2)}:1 (browser checks pending: WebKit not installed)`);
    return;
  }

  const { launchWebkit } = await import('./playwright-webkit.mjs');
  const browser = await launchWebkit();
  const harness = await startHarness();
  try {
    const opticalSelftest = await selftest(browser, harness.origin);
    notes.push(
      `selftest: optical ~5% protrusion (margin/width=${opticalSelftest.marginOverWidth.toFixed(3)}, rect.width=${opticalSelftest.rectWidth.toFixed(2)}px) fails pre-fix (${opticalSelftest.preFixProblems.join('; ')}) and passes head (${opticalSelftest.headProblems.length ? opticalSelftest.headProblems.join('; ') : '[]'})`,
    );
    notes.push(
      'selftest: grid, measure, contrast-link/kbd/th, cls, rag, chrome, hierarchy, code-voice, hanging-quote each fail on a crafted page; optical protrusion passes',
    );
    const roomHead = await checkRoomInNarrowContainer(browser);
    if (roomHead.problems.length) throw new Error(`aesthetics gate: ${roomHead.problems.join('; ')}`);
    const roomPreFix = await checkRoomInNarrowContainer(browser, defaultThemeCss().replaceAll('100cqi', '100vw'));
    if (roomPreFix.problems.length === 0) {
      throw new Error('selftest: checkRoomInNarrowContainer did not fail against the pre-fix 100vw room');
    }
    notes.push(
      `room: a 140-character code line stays inside a 735px container in a 1470px window (spill ${roomHead.spill.toFixed(1)}px); the pre-fix 100vw rule spills ${roomPreFix.spill.toFixed(1)}px`,
    );
    if (!loadRagBaseline('01-long-technical.md').path.includes(`${join('rag', engineName())}`)) {
      throw new Error(`rag baselines must be engine-keyed under rag/${engineName()}/`);
    }
    if (SELFTEST_ONLY) {
      if (MECHANICAL && screenshotsTaken !== 0) throw new Error(`--mechanical took ${screenshotsTaken} screenshot(s); it must take none`);
      console.log(`aesthetics gate ok: selftest passed; ${notes.join('; ')}; screenshots taken: ${screenshotsTaken}`);
      return;
    }

    const files = corpusFiles();
    const combos = matrix();
    let created = 0;
    const smoke = await browser.newPage({ viewport: { width: 960, height: 800 } });
      const result = await renderCorpus(smoke, harness.origin, '# Hello\n\nA short paragraph.', { variant: 'dark', width: 960, size: 20 });
      const painted = await smoke.evaluate(() => ({
        heading: document.querySelector('#doc h1')?.textContent,
        paragraph: document.querySelector('#doc p')?.textContent,
        css: getComputedStyle(document.getElementById('doc')).fontFamily,
      }));
      await smoke.close();
      if (painted.heading !== 'Hello' || !painted.paragraph || !/Literata/.test(painted.css) || !result) {
        throw new Error(`selftest: marxyRender did not typeset without the shell (${JSON.stringify(painted)})`);
      }
      notes.push('selftest: dist/render.js painted a document through marxyRender');
      const tasks = files.flatMap((file) => {
        const source = readFileSync(join(corpusDir, file), 'utf8');
        const ragBase = loadRagBaseline(file);
        return combos.map((opts) => ({ file, source, ragBase, opts }));
      });
      const batched = await pool(tasks, async ({ file, source, ragBase, opts }) => {
        const page = await browser.newPage({ viewport: { width: opts.width, height: 900 } });
        try {
          let result;
          try {
            result = await renderCorpus(page, harness.origin, source, opts);
          } catch (e) {
            return [`${file} ${opts.width}×${opts.size} ${opts.variant}: marxyRender threw: ${e.message}`];
          }
          // --mechanical skips both baseline comparisons: the rag reference read and the screenshots.
          const atRef = !MECHANICAL && opts.width === 960 && opts.variant === 'dark' && opts.size === 20;
          const lines = atRef ? await readSetLines(page) : [];
          const metrics = atRef ? ragOf(lines) : null;
          if (UPDATE && atRef && metrics) {
            writeRagBaseline(file, metrics);
            created++;
          }
          const shot = !MECHANICAL && screenshotCombo(opts);
          return await runPageChecks(page, result, {
            file,
            ...opts,
            rag: atRef && metrics ? { metrics, baseline: UPDATE ? metrics : ragBase.data } : null,
            shot: shot ? { file, width: opts.width, variant: opts.variant, update: UPDATE } : null,
          });
        } finally {
          await page.close();
        }
      });
      for (const problems of batched) fails.push(...problems);
      notes.push(`corpus: ${tasks.length} render(s) = ${files.length} file(s) × ${combos.length} combo(s), ${WORKERS} page(s) at a time`);

      const themeTasks = themeFixtureNames().flatMap((themeName) => {
        const themeCss = readFileSync(join(root, 'fixtures/themes', themeName, 'theme.css'), 'utf8');
        const variants = VARIANT_FILTER ? VARIANTS.filter((v) => v === VARIANT_FILTER) : VARIANTS;
        return variants.flatMap((variant) =>
          files.map((file) => ({
            file,
            variant,
            themeName,
            themeCss,
            source: readFileSync(join(corpusDir, file), 'utf8'),
          })),
        );
      });
      const themeFails = await pool(themeTasks, async ({ file, variant, themeName, themeCss, source }) => {
        const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
        try {
          await renderCorpus(page, harness.origin, source, { variant, width: 960, size: 20, theme: themeCss });
          const problems = await checkContrast(page);
          return problems.map((p) => `${file} theme/${themeName} ${variant}: ${p}`);
        } catch (e) {
          return [`${file} theme/${themeName} ${variant}: marxyRender threw: ${e.message}`];
        } finally {
          await page.close();
        }
      });
      fails.push(...themeFails.flat());
      if (themeTasks.length) notes.push(`contrast: ${themeTasks.length} theme fixture render(s)`);

      const reflowModes = [
        { tag: '320px', width: 320, height: 900, emulate: {} },
        // WCAG 1.4.10: 400 % zoom on a 1280 px window is 320 CSS px of reflow width.
        { tag: '400% zoom', width: 320, height: 900, emulate: {} },
        { tag: 'forced-colors', width: 960, height: 900, emulate: { forcedColors: 'active' }, zoom: null },
        { tag: 'prefers-contrast: more', width: 960, height: 900, emulate: { contrast: 'more' }, zoom: null },
        { tag: 'prefers-reduced-motion: reduce', width: 960, height: 900, emulate: { reducedMotion: 'reduce' }, zoom: null },
      ];
      const reflowVariants = VARIANT_FILTER ? VARIANTS.filter((v) => v === VARIANT_FILTER) : ['dark'];
      const reflowTasks = files.flatMap((file) => {
        const source = readFileSync(join(corpusDir, file), 'utf8');
        return reflowModes.flatMap((mode) => reflowVariants.map((variant) => ({ file, source, mode, variant })));
      });
      const reflowFails = await pool(reflowTasks, async ({ file, source, mode, variant }) => {
        const page = await browser.newPage({ viewport: { width: mode.width, height: mode.height } });
        try {
          if (Object.keys(mode.emulate).length) await page.emulateMedia(mode.emulate);
          await renderCorpus(page, harness.origin, source, { variant, width: mode.width, size: 20 });
          const problems = await checkNoHorizontalPageScroll(page);
          return problems.map((p) => `${file} ${mode.tag} ${variant}: ${p}`);
        } catch (e) {
          return [`${file} ${mode.tag} ${variant}: marxyRender threw: ${e.message}`];
        } finally {
          await page.close();
        }
      });
      fails.push(...reflowFails.flat());
      notes.push(`reflow: ${reflowTasks.length} render(s) at 320 px, 400 % zoom and three media preferences`);

    if (UPDATE || created) {
      fails.push('baseline created; add a queue entry');
    }

    if (REPEAT > 0) {
      const passSets = [];
      for (let pass = 1; pass <= REPEAT; pass++) {
        const offenders = await clsCorpusPass(browser, harness, files, combos);
        const list = [...offenders].sort();
        console.log(
          `CLS repeat pass ${pass}/${REPEAT}: ${list.length === 0 ? 'ok (no font/image window)' : list.join('; ')}`,
        );
        passSets.push(offenders);
        if (offenders.size > 0) {
          for (const p of list) fails.push(`CLS repeat pass ${pass}: ${p}`);
        }
      }
      for (let i = 1; i < passSets.length; i++) {
        if (!sameOffenderSet(passSets[0], passSets[i])) {
          fails.push(
            `CLS repeat: pass 1 offenders (${[...passSets[0]].join('; ') || 'none'}) ≠ pass ${i + 1} (${[...passSets[i]].join('; ') || 'none'})`,
          );
        }
      }
      notes.push(`CLS repeat: ${REPEAT} identical pass(es), no font/image window`);
    }
  } finally {
    harness.close();
    await browser.close();
  }

  notes.push(`${MECHANICAL ? 'mechanical: no baseline comparison, ' : ''}screenshots taken: ${screenshotsTaken}`);
  if (MECHANICAL && screenshotsTaken !== 0) fails.push(`--mechanical took ${screenshotsTaken} screenshot(s); it must take none`);
  if (fails.length) {
    console.error('aesthetics gate failed:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log(`aesthetics gate ok: measure ${measureChars} characters, line box ${lineBox}px, contrast ${cr.toFixed(2)}:1; ${engineName()}; ${notes.join('; ')}`);
}

main().catch((e) => {
  console.error(`aesthetics gate failed:\n - ${e.stack || e.message}`);
  process.exit(1);
});
