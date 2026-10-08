#!/usr/bin/env node
// Mechanical aesthetics gate (ADR-0014, docs/design/10-gates-and-testing.md §10). Token checks stay
// as the floor; the app harness (apps/desktop/gate.html) renders each corpus page through the real app
// and the ten page checks run over it in Playwright WebKit.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ragMetrics } from '../packages/typeset/scripts/rag-model.mjs';
import { defaultThemeCss } from '../packages/theme/scripts/inline.mjs';
import {
  geometryFailures,
  injectClassicScrollbar,
  measureInPage,
  measureNoticeInPage,
  noticeFailures,
  surveyFailures,
  surveyInPage,
  TEXT_SPACING_CSS,
  spacingAppliedFailures,
  text200AppliedFailures,
} from './probe-layout.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = join(root, 'apps/desktop');
// A fresh directory per run, so two gates in one worktree (or a gate and a desktop test) never share output.
const gateDist = mkdtempSync(join(tmpdir(), 'marxy-gate-'));
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
// --files a.md,b.md narrows the corpus (a quick look at one document); --emit-expected prints the geometry
// failures as expected-failure rows (L-02) and compares nothing. Neither is a way to pass: a run that
// narrows the corpus judges only the cases it ran.
const filesIdx = process.argv.indexOf('--files');
const FILES_FILTER = filesIdx === -1 ? null : process.argv[filesIdx + 1].split(',').filter(Boolean);
const EMIT_EXPECTED = process.argv.includes('--emit-expected');
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

/**
 * Where the gate's time goes (B-02): wall seconds per phase, and summed page-seconds per step inside the
 * corpus pass (render, the checks, the screenshot settle), printed with the notes. Measured, never judged.
 */
const spent = { render: 0, checks: 0, shots: 0 };
const phases = [];
let phaseStart = performance.now();
function phase(name) {
  const now = performance.now();
  phases.push(`${name} ${((now - phaseStart) / 1000).toFixed(1)}s`);
  phaseStart = now;
}

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
  const all = readdirSync(corpusDir).filter((f) => /^\d{2}-.+\.md$/.test(f)).sort();
  return FILES_FILTER ? all.filter((f) => FILES_FILTER.includes(f)) : all;
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

/**
 * Builds the app harness (B-01, B-02): `apps/desktop/gate.html` boots the real app over a memory shell,
 * so every page the gate measures is the one a reader sees, highlighting, KaTeX, notices and the user
 * theme loader included. The desktop Vite config supplies the bundled fonts and the inlined default
 * theme; only the input is replaced, so the window and index pages are not built here.
 */
async function buildRenderEntry() {
  const require = createRequire(join(desktop, 'package.json'));
  const { build } = require('vite');
  await build({
    root: desktop,
    configFile: join(desktop, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir: gateDist, emptyOutDir: true },
    plugins: [
      {
        name: 'marxy-gate-input',
        config(config) {
          config.build.rollupOptions.input = { gate: join(desktop, 'gate.html') };
        },
      },
    ],
  });
  if (!existsSync(join(gateDist, 'gate.html'))) throw new Error(`vite build did not write ${join(gateDist, 'gate.html')}`);
}

/** Serves the built harness, `/` as gate.html, and the corpus image beside it so `image.png` resolves. */
function startHarness() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.png': 'image/png',
    '.txt': 'text/plain; charset=utf-8',
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (code, type, body) => {
      res.statusCode = code;
      res.setHeader('Content-Type', type);
      res.end(body);
    };
    if (path === '/image.png') return send(200, 'image/png', readFileSync(join(corpusDir, 'image.png')));
    const file = path === '/' ? join(gateDist, 'gate.html') : join(gateDist, path.slice(1));
    if (!file.startsWith(gateDist) || !existsSync(file) || !statSync(file).isFile()) return send(404, 'text/plain', 'not found');
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

// ---- L-02: the geometry of the page (docs/aesthetics-acceptance.md, the six rules of the screen criterion) ----
//
// The rules live in scripts/probe-layout.mjs and are read from there: one implementation of "where the
// column, the blocks and the marks sit". Each check below takes a measured cell and names what fails; a
// failure is a *case* (check, sub-check, document, cell). Where today's page fails a rule, the case is
// listed in EXPECTED_FAILURES with the story that clears it; the gate fails on a case that is not listed
// and on a listed case that passes, so the list can neither hide a new fault nor go stale.

/** The check names a geometry failure can carry, and the in-page pass that measures each. */
const GEOMETRY_CHECKS = ['centred', 'blockEdges', 'room', 'marks', 'noClip'];
const geometryCheck = (name) => (cell, opts) => geometryFailures(cell, opts).filter((f) => f.check === name);
const checkCentred = geometryCheck('centred');
const checkBlockEdges = geometryCheck('blockEdges');
const checkRoom = geometryCheck('room');
const checkMarks = geometryCheck('marks');
const checkNoClip = geometryCheck('noClip');

/** Rule 5 on the app's own `#marxy-notices` region. */
async function checkNoticeColumn(page) {
  return noticeFailures(await page.evaluate(measureNoticeInPage, {}));
}
/** Rule 5 in Source: the reader's own shortcut switches the app to its editor, and the notice must not cover text. */
async function checkNoticeInSource(page) {
  await page.keyboard.press('ControlOrMeta+e');
  await page.waitForSelector('#marxy-source .cm-content .cm-line', { timeout: 20_000 });
  return noticeFailures(await page.evaluate(measureNoticeInPage, { source: true }));
}
/** Rule 6, with the four WCAG 1.4.12 overrides loaded as a reader theme (the render is given them). */
async function checkTextSpacing(page) {
  const s = await page.evaluate(surveyInPage);
  return [...spacingAppliedFailures(s), ...surveyFailures(s)];
}
/** Rule 6, at 200 % text: the reader's size at 40 px, through the config (the render is given it). */
async function checkText200(page) {
  const s = await page.evaluate(surveyInPage);
  return [...text200AppliedFailures(s, TEXT200_PX), ...surveyFailures(s)];
}

/** The long document the notice is measured on: it scrolls three screens at every width. */
const NOTICE_DOC = '15-prose-volume.md';
const NOTICE_SOURCE_WIDTHS = [320, 960];
/** Classic-scrollbar renders: the narrow end, and the width most readers have. */
const CLASSIC_WIDTHS = [480, 960];
const SPACING_WIDTHS = [320, 960];
const TEXT200_WIDTH = 960;
/** The reader's default body size is 20 px; 200 % of it. */
const TEXT200_PX = 40;
/**
 * Documents left out of the text-spacing pass, with the reason. Not a threshold: 32-long-reference.md is the
 * corpus's largest document, and the render entry gives the typesetter 10 s (gate-entry.ts), which the
 * universal line-height override takes more than on a loaded machine (plain 19 s in all, spacing over 50 s).
 * It still runs in the 200 % pass and in every geometry pass.
 */
const SPACING_SKIPS = new Set(['32-long-reference.md']);

const cellId = (o) => `${o.width}x${o.size}-${o.variant}${o.classic ? '-classic' : ''}`;
const familyOf = (check) => (check === 'noticeColumn' ? 'noticeColumn' : 'geometry');
/** The cases the run found, `check/sub|document|cell` to the details, and the (family, document, cell) it measured. */
const foundCases = new Map();
const measuredCells = new Set();

function recordCases(family, doc, cell, failures) {
  measuredCells.add(`${family}|${doc}|${cell}`);
  for (const f of failures) {
    const key = `${f.check}/${f.sub}|${doc}|${cell}`;
    foundCases.set(key, [...(foundCases.get(key) ?? []), f.detail]);
  }
}

/** All five geometry checks over the page as it stands; the cases are recorded, not returned as failures. */
async function checkGeometry(page, doc, o) {
  const cell = await page.evaluate(measureInPage, { blocks: true, notice: false });
  const opts = { classic: Boolean(o.classic) };
  recordCases('geometry', doc, cellId(o), [
    ...checkCentred(cell, opts),
    ...checkBlockEdges(cell, opts),
    ...checkRoom(cell, opts),
    ...checkMarks(cell, opts),
    ...checkNoClip(cell, opts),
  ]);
  return cell;
}

/**
 * The classic scrollbar appears after first text, so the app relays the page out: it re-sets the paragraphs
 * 100 ms after the article's width changes (rendered-view.ts), then runs its passes. The page is read once
 * it holds still: the same width, height and set lines on two reads a beat apart. A cap, not a wait: a page
 * that never holds still is a failure the caller reports.
 */
async function awaitRelayout(page) {
  const read = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            const a = document.getElementById('doc');
            const lines = [...a.querySelectorAll('p.marxy-set')].slice(0, 400).map((p) => Math.round(p.getBoundingClientRect().height)).join(',');
            resolve(`${a.clientWidth}:${document.documentElement.scrollHeight}:${lines}`);
          }, 150),
        ),
    );
  let before = await read();
  for (let i = 0; i < 40; i++) {
    const now = await read();
    if (now === before) return;
    before = now;
  }
  throw new Error('the page did not hold still 6 s after a classic scrollbar appeared');
}

/**
 * Expected failures: where today's page fails a rule, the story that clears it. That story deletes the row.
 * A row is `{ check, document, cells, story }`: `check` is `check/sub-check`, and the row stands for the case in
 * each of its cells, so a row whose case passes in any measured cell fails the gate.
 */
const rowsFor = (check, story, cells, documents) => documents.map((document) => ({ check, document, cells, story }));
// Cell sets: the `<width>x<size>-<variant>` of a render, with `-classic` after a classic-scrollbar render and
// `-source` after one in Source mode. They are measured, not chosen: `--emit-expected` prints them.
// The code box sits 15 px inside the prose edge (H2, code): every cell, in every document that has a code block.
const CODE_BOX_CELLS = ["320x20-dark", "480x20-dark-classic", "720x20-dark", "720x20-light", "960x16-dark", "960x16-light", "960x20-dark", "960x20-dark-classic", "960x20-light", "960x24-dark", "960x24-light", "960x28-dark", "960x28-light", "1280x20-dark", "1280x20-light"];
// A checkbox hangs past the gutter floor (H3): at 320 px and under a classic scrollbar at 480 px.
const CHECKBOX_CELLS = ["320x20-dark", "480x20-dark-classic"];
// An ordered-list marker hangs past the gutter floor (H3): up to 720 px, and at 28 px type.
const OL_MARKER_CELLS = ["320x20-dark", "480x20-dark-classic", "720x20-dark", "720x20-light", "960x28-dark", "960x28-light"];
// A notice is off the column (H6): its region sizes the column in em at its own 16 px, so every cell but 960 px at 16 px, where that font is the article's.
const NOTICE_EDGE_CELLS = ["320x20-dark", "720x20-dark", "720x20-light", "960x20-dark", "960x20-light", "960x24-dark", "960x24-light", "960x28-dark", "960x28-light", "1280x20-dark", "1280x20-light"];
// A notice is not a whole number of grid units high (H6).
const NOTICE_GRID_CELLS = ["320x20-dark", "960x16-dark", "960x16-light", "960x24-dark", "960x24-light", "960x28-dark", "960x28-light"];
// A notice scrolls out of sight (H6): in every cell, the document being taller than three screens.
const NOTICE_SIGHT_CELLS = ["320x20-dark", "720x20-dark", "720x20-light", "960x16-dark", "960x16-light", "960x20-dark", "960x20-light", "960x24-dark", "960x24-light", "960x28-dark", "960x28-light", "1280x20-dark", "1280x20-light"];
// A notice covers the first line of text in Source (H6).
const NOTICE_SOURCE_CELLS = ["320x20-dark-source", "960x20-dark-source"];
// A wide block grows to the right only (H1): every cell with room to grow (720 px and up) in every document that has one.
const WIDE_BLOCK_CELLS = ["720x20-dark", "720x20-light", "960x16-dark", "960x16-light", "960x20-dark", "960x20-dark-classic", "960x20-light", "960x24-dark", "960x24-light", "960x28-dark", "960x28-light", "1280x20-dark", "1280x20-light"];

/** One row per document for each check, each naming the cells it fails in and the story that clears it. */
const EXPECTED_FAILURES = [
  ...rowsFor('blockEdges/code', 'L-04', CODE_BOX_CELLS, ["02-readme-real-world.md", "03-ai-plan.md", "06-math.md", "09-gfm-everything.md", "10-hostile.md", "16-api-reference.md", "18-agent-transcript.md", "19-source-file.md", "24-issue-thread.md", "27-alerts.md", "28-artifact-fences.md", "28-llm-answer.md", "29-hidden-characters.md", "30-notebook-export.md", "32-long-reference.md"]),
  ...rowsFor('marks/checkbox', 'L-03', CHECKBOX_CELLS, ["03-ai-plan.md", "09-gfm-everything.md", "23-task-openers.md", "24-issue-thread.md"]),
  ...rowsFor('marks/ol-marker', 'L-03', OL_MARKER_CELLS, ["01-long-technical.md", "02-readme-real-world.md", "03-ai-plan.md", "09-gfm-everything.md", "15-prose-volume.md", "24-issue-thread.md", "28-llm-answer.md", "31-essay.md", "32-long-reference.md"]),
  ...rowsFor('noticeColumn/edges', 'L-05', NOTICE_EDGE_CELLS, ["15-prose-volume.md"]),
  ...rowsFor('noticeColumn/grid', 'L-05', NOTICE_GRID_CELLS, ["15-prose-volume.md"]),
  ...rowsFor('noticeColumn/sight', 'L-05', NOTICE_SIGHT_CELLS, ["15-prose-volume.md"]),
  ...rowsFor('noticeColumn/source', 'L-05', NOTICE_SOURCE_CELLS, ["15-prose-volume.md"]),
  ...rowsFor('room/even', 'L-04', WIDE_BLOCK_CELLS, ["01-long-technical.md", "02-readme-real-world.md", "03-ai-plan.md", "05-pathological-table-and-nesting.md", "06-math.md", "10-hostile.md", "16-api-reference.md", "18-agent-transcript.md", "19-source-file.md", "24-issue-thread.md", "28-artifact-fences.md", "28-llm-answer.md", "30-notebook-export.md", "31-essay.md", "32-long-reference.md"]),
];

/**
 * Judge the cases a run found against a table of expected failures. A row is `{ check, document, cells,
 * story }`: `check` is `check/sub`, and it stands for the case in each of its cells. Returns the messages
 * of failures: a case with no row, and a row whose case did not occur in a cell that was measured.
 * `measured` is what the run measured, so a narrowed run judges only its own cells.
 */
function judgeExpected(found, measured, table) {
  const out = [];
  const listed = new Set();
  for (const row of table) {
    for (const cell of row.cells) {
      const key = `${row.check}|${row.document}|${cell}`;
      listed.add(key);
      if (!measured.has(`${familyOf(row.check.split('/')[0])}|${row.document}|${cell}`)) continue;
      if (!found.has(key)) out.push(`${row.document} ${cell}: ${row.check} now passes, so its row (${row.story}) is stale: delete it`);
    }
  }
  for (const [key, details] of found) {
    if (listed.has(key)) continue;
    const [check, doc, cell] = key.split('|');
    out.push(`${doc} ${cell}: ${check}: ${details.slice(0, 3).join('; ')}${details.length > 3 ? ` (and ${details.length - 3} more)` : ''}`);
  }
  return out;
}

/** The found cases as rows of the table: one per check and document, with the cells it fails in. */
function rowsOf(found) {
  const rows = new Map();
  for (const key of found.keys()) {
    const [check, doc, cell] = key.split('|');
    const k = `${check}|${doc}`;
    rows.set(k, { check, document: doc, cells: [...(rows.get(k)?.cells ?? []), cell] });
  }
  return [...rows.values()].sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : a.document < b.document ? -1 : 1));
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

/**
 * Scrolls to the top (`first`) or brings the last heading into view (`last`) and waits for the page
 * to hold still. The app highlights a code block when it comes near the viewport (render/highlight.ts):
 * plain line spans at once, colour when the worker answers, and a grid pass after each, so blocks can
 * change height and colour after the scroll. Each round lets the app's coalesced grid snap (250 ms) and
 * two frames pass; the page is settled when no block the highlighter will colour is still waiting for
 * the worker, and three rounds in a row after that see the same scroll height, position, target top and
 * number of coloured blocks. The wait for colour is a condition, not a time: on a loaded machine the
 * worker can answer after three quiet rounds, and the screenshot then caught the block uncoloured
 * (18-agent-transcript, 0.28 %). A block is waiting when it is in the highlighter's reach (its
 * IntersectionObserver margin, 200 % of the viewport above and below), its language is one the
 * highlighter colours (`marxyGate.colourable`), and it is not yet `data-marxy-done="highlight"`.
 * Returns false when there is no heading to scroll to.
 */
async function scrollAndSettle(where) {
  let target = null;
  if (where === 'last') {
    const headings = [...document.querySelectorAll('#doc h1, #doc h2, #doc h3, #doc h4, #doc h5, #doc h6')];
    target = headings[headings.length - 1] ?? null;
    if (!target) return false;
  }
  const place = () => (target ? target.scrollIntoView() : window.scrollTo(0, 0));
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };
  const state = () =>
    [
      document.documentElement.scrollHeight,
      window.scrollY,
      target ? target.getBoundingClientRect().top : 0,
      document.querySelectorAll('#doc code[data-marxy-done="highlight"]').length,
    ].join(':');
  const reach = 2 * window.innerHeight;
  const waiting = () =>
    [...document.querySelectorAll('#doc pre:not(.marxy-math-block) > code')].filter((code) => {
      if (code.dataset.marxyDone === 'highlight') return false;
      const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice('language-'.length);
      if (!lang || !window.marxyGate.colourable(lang)) return false;
      const box = code.getBoundingClientRect();
      return box.bottom > -reach && box.top < window.innerHeight + reach;
    }).length;
  let before = null;
  let still = 0;
  let pending = 0;
  // A cap on a page that never holds still, not a wait: a settled page returns after four rounds, and
  // a loaded machine's worker gets ~30 s to answer before this throws.
  for (let i = 0; i < 100; i++) {
    place();
    await settle();
    const now = state();
    pending = waiting();
    still = pending === 0 && now === before ? still + 1 : 0;
    if (still === 3) return true;
    before = now;
  }
  throw new Error(
    `the page did not hold still at the ${where} screenshot after 100 rounds${pending ? ` (${pending} code block(s) still waiting for colour)` : ''}`,
  );
}

async function checkScreenshot(page, { file, width, variant, update }) {
  const dir = shotDir();
  const out = [];
  for (const where of ['first', 'last']) {
    const t0 = performance.now();
    const placed = await page.evaluate(scrollAndSettle, where);
    spent.shots += performance.now() - t0;
    if (!placed) continue;
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
      out.push(`${file} ${width} ${variant} ${where}: ${diff.pct.toFixed(3)}% pixels differ${diff.reason ? ` (${diff.reason})` : ''} (diff ${diffPath.slice(root.length)})`);
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
  await checkGeometry(page, ctx.file, ctx);
  if (ctx.file === NOTICE_DOC) recordCases('noticeColumn', ctx.file, cellId(ctx), await checkNoticeColumn(page));
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

/** Image swap that moves a following block, using the app harness's own layout-shift geometry. */
async function craftedClsShift(page, origin) {
  await page.goto(`${origin}/gate.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyGate?.layoutShift?.snapshot === 'function');
  return page.evaluate(async () => {
    const article = document.getElementById('doc');
    article.innerHTML =
      '<p data-marxy-s="0" data-marxy-e="1" style="display:block;margin:0">Above</p>' +
      '<img id="late" alt="" style="display:block">' +
      '<p data-marxy-s="2" data-marxy-e="3" style="display:block;margin:0">Moves when the image arrives</p>';
    const shift = window.marxyGate.layoutShift;
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

/**
 * Crafted pages for the L-02 checks, each with one fault the rule must catch and a twin without it that must
 * pass. The faults are written in inline style, so they hold whatever the theme does: a story that clears an
 * expected failure cannot make a control pass.
 */
function geometrySelftestCases() {
  const themed = (body, extraCss = '', before = '') =>
    `<!doctype html><html lang="en" data-marxy-variant="dark"><head><meta charset="utf-8"><style>${defaultThemeCss()}${extraCss}</style></head><body><main id="marxy-main">${before}<article id="doc" class="marxy-article">${body}</article></main></body></html>`;
  const blk = (tag, i, inner, style = '') => `<${tag} data-marxy-s="${i * 100}" data-marxy-e="${i * 100 + 99}"${style ? ` style="${style}"` : ''}>${inner}</${tag}>`;
  const PROSE = blk('p', 0, 'A short paragraph of body text that sits on the column and nowhere else.');
  const TALL = blk('div', 9, '', 'height:3000px');
  const REGION = '<div id="marxy-notices" role="status"></div>';
  const SOURCE = '<div id="marxy-source"><div class="cm-content"><div class="cm-line" style="height:30px">first line of source</div></div></div>';
  const FIXED_NOTICES = '#marxy-notices{position:fixed;top:0;left:0;right:0}';
  const measured = async (page) => page.evaluate(measureInPage, { blocks: true, notice: false });
  const details = (list) => list.map((f) => f.detail);
  const sub = (name) => async (page) => (await checkNoticeColumn(page)).filter((f) => f.sub === name).map((f) => f.detail);
  return [
    {
      name: 'centred (axis)',
      html: themed(PROSE, '.marxy-article{margin-inline:0}'),
      ok: themed(PROSE),
      run: async (page) => details(checkCentred(await measured(page))),
    },
    {
      name: 'blockEdges',
      html: themed(blk('p', 0, 'A paragraph that starts forty pixels in.', 'margin-left:40px')),
      ok: themed(PROSE),
      run: async (page) => details(checkBlockEdges(await measured(page))),
    },
    {
      name: 'room (past the room)',
      // Even on both sides, but 400px each way is far past the room.
      html: themed(PROSE + blk('div', 1, 'a box that runs 400px past the column on both sides', 'margin-inline:-400px')),
      ok: themed(PROSE + blk('div', 1, 'a box inside the column')),
      run: async (page) => details(checkRoom(await measured(page)).filter((f) => f.sub === 'limit')),
    },
    {
      name: 'room (uneven)',
      // Inside the room, but only on the right.
      html: themed(PROSE + blk('div', 1, 'a box that runs 100px past the right edge only', 'margin-right:-100px')),
      ok: themed(PROSE + blk('div', 1, 'a box that runs 100px past each edge', 'margin-inline:-100px')),
      run: async (page) => details(checkRoom(await measured(page)).filter((f) => f.sub === 'even')),
    },
    {
      name: 'marks',
      viewport: { width: 480, height: 800 },
      html: themed(blk('ul', 0, blk('li', 1, '<input type="checkbox" style="margin-left:-60px">an item whose checkbox hangs out of the page'))),
      ok: themed(blk('ul', 0, blk('li', 1, '<input type="checkbox" style="margin:0 !important">an item')), 'ul{padding-left:0 !important}'),
      run: async (page) => details(checkMarks(await measured(page))),
    },
    {
      name: 'noClip',
      html: themed(blk('p', 0, 'text pushed off the left of the window', 'margin-left:-300px')),
      ok: themed(PROSE),
      run: async (page) => details(checkNoClip(await measured(page))),
    },
    {
      name: 'noticeColumn (edges)',
      html: themed(PROSE, '#marxy-notices{margin-inline-start:140px}', REGION),
      // The region inside the article's own column, with nothing of its own to move it, sits on the column.
      ok: themed(`<div id="marxy-notices" role="status" style="padding:0 !important;margin:0 !important;max-width:none !important"></div>` + PROSE),
      run: sub('edges'),
    },
    {
      name: 'noticeColumn (in sight)',
      html: themed(PROSE + TALL, '#marxy-notices{position:static !important}', REGION),
      ok: themed(PROSE + TALL, '#marxy-notices{position:sticky;top:0}', REGION),
      run: sub('sight'),
    },
    {
      name: 'noticeColumn (grid units)',
      html: themed(PROSE, '.marxy-notice{padding-block:7px !important;line-height:1 !important}', REGION),
      ok: themed(PROSE, '.marxy-notice{display:block !important;height:30px !important;padding:0 !important;border:0 !important}', REGION),
      run: sub('grid'),
    },
    {
      name: 'noticeColumn (not over Source text)',
      html: themed(PROSE, FIXED_NOTICES + '#marxy-source{position:fixed;inset:0}', REGION + SOURCE),
      ok: themed(PROSE, FIXED_NOTICES + '#marxy-source{position:fixed;inset:200px 0 0 0}', REGION + SOURCE),
      run: async (page) => (noticeFailures(await page.evaluate(measureNoticeInPage, { source: true }))).map((f) => f.detail),
    },
    {
      name: 'textSpacing (clipped text)',
      html: themed(blk('div', 0, 'a line of text that the spacing pushes out of a box of fixed height '.repeat(4), 'height:20px;overflow:hidden'), TEXT_SPACING_CSS),
      ok: themed(PROSE, TEXT_SPACING_CSS),
      run: checkTextSpacing,
    },
    {
      // The overrides never loaded: the check must say so, not pass on a page it did not stress.
      name: 'textSpacing (overrides applied)',
      html: themed(PROSE),
      ok: themed(PROSE, TEXT_SPACING_CSS),
      run: checkTextSpacing,
    },
    {
      name: 'text200 (wide box)',
      html: themed(blk('div', 0, 'a box wider than the window', 'width:3000px'), `.marxy-article{font-size:${TEXT200_PX}px}`),
      ok: themed(PROSE, `.marxy-article{font-size:${TEXT200_PX}px}`),
      run: checkText200,
    },
    {
      // The size was not doubled: the check must say so.
      name: 'text200 (size applied)',
      html: themed(PROSE, '.marxy-article{font-size:20px}'),
      ok: themed(PROSE, `.marxy-article{font-size:${TEXT200_PX}px}`),
      run: checkText200,
    },
  ];
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
    ...geometrySelftestCases(),
    {
      name: 'hanging-quote',
      html: crafted(
        '<p style="margin:0;padding-left:20px"><span class="marxy-hang" style="display:inline-block;margin-inline-start:-14px;position:relative;left:13px">\u201c</span>Short</p>',
      ),
      run: checkHanging,
    },
  ];
  const missed = [];
  const falseAlarms = [];
  for (const c of cases) {
    const page = await browser.newPage({ viewport: c.viewport ?? { width: 960, height: 800 } });
    if (c.html) await page.setContent(c.html, { waitUntil: 'domcontentloaded' });
    const problems = await c.run(page);
    // The twin without the fault: a check that fails there too would fail every page.
    let twin = [];
    if (c.ok) {
      await page.setContent(c.ok, { waitUntil: 'domcontentloaded' });
      twin = await c.run(page);
    }
    await page.close();
    if (problems.length === 0) missed.push(c.name);
    if (twin.length) falseAlarms.push(`${c.name}: ${twin.join('; ')}`);
  }
  if (missed.length) throw new Error(`selftest: these checks did not fail on a crafted page: ${missed.join(', ')}`);
  if (falseAlarms.length) throw new Error(`selftest: these checks failed on a crafted page without the fault: ${falseAlarms.join(' | ')}`);

  // The expected-failure table is held both ways: a case with no row fails, and a row whose case passes fails.
  const row = { check: 'room/even', document: 'x.md', cells: ['960x20-dark'], story: 'L-04' };
  const ran = new Set(['geometry|x.md|960x20-dark']);
  const occurs = new Map([['room/even|x.md|960x20-dark', ['a box overhangs']]]);
  const tableCases = [
    ['an unlisted failure fails', judgeExpected(occurs, ran, []).length === 1],
    ['a listed row whose case passes fails', judgeExpected(new Map(), ran, [row]).length === 1],
    ['a listed failure that occurs passes', judgeExpected(occurs, ran, [row]).length === 0],
    ['a row for a cell this run did not measure is not judged', judgeExpected(new Map(), new Set(), [row]).length === 0],
  ];
  const wrongTable = tableCases.filter(([, ok]) => !ok).map(([name]) => name);
  if (wrongTable.length) throw new Error(`selftest: the expected-failure table is not held both ways: ${wrongTable.join('; ')}`);

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

/** One fresh harness page per render: the app keeps module state, so gate.html renders once per load. */
async function renderCorpus(page, origin, source, opts) {
  await page.goto(`${origin}/gate.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
  return page.evaluate(async ({ source, opts }) => window.marxyGate.render(source, opts), { source, opts });
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
      return [`${file} ${opts.width}×${opts.size} ${opts.variant}: marxyGate.render threw: ${e.message}`];
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
  phase('build');
  notes.push('apps/desktop/gate.html built');

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
      'selftest: grid, measure, contrast-link/kbd/th, cls, rag, chrome, hierarchy, code-voice, hanging-quote, and the geometry checks (centred, blockEdges, room, marks, noClip, noticeColumn, textSpacing, text200) each fail on a crafted page and pass on its twin; optical protrusion passes; the expected-failure table is held both ways',
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
    phase('selftest');
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
        throw new Error(`selftest: marxyGate.render did not paint a document through the app (${JSON.stringify(painted)})`);
      }
      notes.push('selftest: the app harness painted a document through marxyGate.render');
      const tasks = files.flatMap((file) => {
        const source = readFileSync(join(corpusDir, file), 'utf8');
        const ragBase = loadRagBaseline(file);
        return combos.map((opts) => ({ file, source, ragBase, opts }));
      });
      const batched = await pool(tasks, async ({ file, source, ragBase, opts }) => {
        const page = await browser.newPage({ viewport: { width: opts.width, height: 900 } });
        try {
          let result;
          const t0 = performance.now();
          try {
            result = await renderCorpus(page, harness.origin, source, opts);
          } catch (e) {
            return [`${file} ${opts.width}×${opts.size} ${opts.variant}: marxyGate.render threw: ${e.message}`];
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
          const t1 = performance.now();
          spent.render += t1 - t0;
          const problems = await runPageChecks(page, result, {
            file,
            ...opts,
            rag: atRef && metrics ? { metrics, baseline: UPDATE ? metrics : ragBase.data } : null,
            shot: shot ? { file, width: opts.width, variant: opts.variant, update: UPDATE } : null,
          });
          spent.checks += performance.now() - t1;
          return problems;
        } finally {
          await page.close();
        }
      });
      for (const problems of batched) fails.push(...problems);
      phase('corpus');
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
          return [`${file} theme/${themeName} ${variant}: marxyGate.render threw: ${e.message}`];
        } finally {
          await page.close();
        }
      });
      fails.push(...themeFails.flat());
      phase('themes');
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
          // The narrowest page the gate renders is also where the geometry is tightest.
          if (mode.tag === '320px') {
            const o = { width: mode.width, size: 20, variant };
            await checkGeometry(page, file, o);
            if (file === NOTICE_DOC) recordCases('noticeColumn', file, cellId(o), await checkNoticeColumn(page));
          }
          const problems = await checkNoHorizontalPageScroll(page);
          return problems.map((p) => `${file} ${mode.tag} ${variant}: ${p}`);
        } catch (e) {
          return [`${file} ${mode.tag} ${variant}: marxyGate.render threw: ${e.message}`];
        } finally {
          await page.close();
        }
      });
      fails.push(...reflowFails.flat());
      phase('reflow');
      notes.push(`reflow: ${reflowTasks.length} render(s) at 320 px, 400 % zoom and three media preferences`);

    // Classic scrollbars (WebKitGTK, or macOS set to always show them): one render per document at the
    // narrow width and the usual one, the scrollbar injected after first text and the app's relayout awaited.
    const classicTasks = files.flatMap((file) => {
      const source = readFileSync(join(corpusDir, file), 'utf8');
      return CLASSIC_WIDTHS.map((width) => ({ file, source, o: { width, size: 20, variant: 'dark', classic: true } }));
    });
    const classicFails = await pool(classicTasks, async ({ file, source, o }) => {
      const page = await browser.newPage({ viewport: { width: o.width, height: 900 } });
      try {
        await renderCorpus(page, harness.origin, source, { variant: o.variant, width: o.width, size: o.size });
        await injectClassicScrollbar(page);
        await awaitRelayout(page);
        const cell = await checkGeometry(page, file, o);
        // A page too short to scroll has no scrollbar to model; only a page that took one is a classic page.
        if (cell.viewport.scrollbar === 0 && cell.viewport.docHeight > 900) {
          return [`${file} ${cellId(o)}: the classic scrollbar took no space on a page ${cell.viewport.docHeight}px tall`];
        }
        return [];
      } catch (e) {
        return [`${file} ${cellId(o)}: ${e.message}`];
      } finally {
        await page.close();
      }
    });
    fails.push(...classicFails.flat());
    phase('classic');
    notes.push(`classic scrollbar: ${classicTasks.length} render(s) at ${CLASSIC_WIDTHS.join(' and ')} px, after the app's relayout`);

    // Rule 5 in Source mode, on the long document: the app is put into its editor the way a reader does it.
    if (files.includes(NOTICE_DOC)) {
      const source = readFileSync(join(corpusDir, NOTICE_DOC), 'utf8');
      const inSource = await pool(NOTICE_SOURCE_WIDTHS, async (width) => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await renderCorpus(page, harness.origin, source, { variant: 'dark', width, size: 20 });
          recordCases('noticeColumn', NOTICE_DOC, `${cellId({ width, size: 20, variant: 'dark' })}-source`, await checkNoticeInSource(page));
          return [];
        } catch (e) {
          return [`${NOTICE_DOC} ${width}px in Source: ${e.message}`];
        } finally {
          await page.close();
        }
      });
      fails.push(...inSource.flat());
    }

    // Rule 6: WCAG 1.4.12 text spacing as a reader theme, and 200 % text (the reader's size at 40 px).
    const accessTasks = files.flatMap((file) => {
      const source = readFileSync(join(corpusDir, file), 'utf8');
      return [
        ...SPACING_WIDTHS.filter(() => !SPACING_SKIPS.has(file)).map((width) => ({ file, source, kind: 'text spacing', width, opts: { variant: 'dark', width, size: 20, theme: TEXT_SPACING_CSS }, check: checkTextSpacing })),
        { file, source, kind: '200 % text', width: TEXT200_WIDTH, opts: { variant: 'dark', width: TEXT200_WIDTH, size: TEXT200_PX }, check: checkText200 },
      ];
    });
    const accessFails = await pool(accessTasks, async ({ file, source, kind, width, opts, check }) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await renderCorpus(page, harness.origin, source, opts);
        return (await check(page)).map((p) => `${file} ${kind} ${width}px: ${p}`);
      } catch (e) {
        return [`${file} ${kind} ${width}px: marxyGate.render threw: ${e.message}`];
      } finally {
        await page.close();
      }
    });
    fails.push(...accessFails.flat());
    phase('access');
    notes.push(`access: ${accessTasks.length} render(s), text spacing at ${SPACING_WIDTHS.join(' and ')} px and 200 % text at ${TEXT200_WIDTH} px`);

    if (EMIT_EXPECTED) {
      console.log(`expected-failure rows (${foundCases.size} case(s)):\n${rowsOf(foundCases).map((r) => `  ${JSON.stringify(r)},`).join('\n')}`);
    } else {
      fails.push(...judgeExpected(foundCases, measuredCells, EXPECTED_FAILURES));
      notes.push(`geometry: ${foundCases.size} listed failure case(s) across ${measuredCells.size} measured cell(s); ${EXPECTED_FAILURES.length} expected-failure row(s)`);
    }

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
    rmSync(gateDist, { recursive: true, force: true });
  }

  notes.push(`${MECHANICAL ? 'mechanical: no baseline comparison, ' : ''}screenshots taken: ${screenshotsTaken}`);
  // Printed on success and failure alike: the breakdown matters most on a slow red run.
  console.log(
    `aesthetics gate time: ${phases.join(', ')}; corpus page-seconds: render ${(spent.render / 1000).toFixed(0)}, checks ${((spent.checks - spent.shots) / 1000).toFixed(0)}, screenshot settle ${(spent.shots / 1000).toFixed(0)}`,
  );
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
