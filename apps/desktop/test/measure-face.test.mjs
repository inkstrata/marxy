// H-06: the in-app measurement of a face's average character advance. Real WebKit, real font files from
// fonts/: the canvas path must agree with the build-time `hmtx` mean (packages/typeset/scripts/font-metrics.mjs)
// within 1 %, a ratio must not depend on size, and measuring must not run before first paint.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { readFont } from '../../../packages/typeset/scripts/font-metrics.mjs';
import { MEASURE_SAMPLE, averageAdvance } from '../../../packages/core/src/layout/average-advance.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const FACES = [
  { family: 'Literata', file: 'fonts/literata/Literata[opsz,wght].ttf' },
  { family: 'Source Serif 4', file: 'fonts/source-serif-4/SourceSerif4Variable-Roman.ttf' },
  { family: 'JetBrains Mono', file: 'fonts/jetbrains-mono/JetBrainsMono[wght].ttf' },
  { family: 'IBM Plex Mono', file: 'fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf' },
];

let server;
let base;
before(async () => {
  if (skip) return;
  const out = mkdtempSync(join(tmpdir(), 'marxy-measure-'));
  await build({
    root: repo,
    logLevel: 'silent',
    configFile: false,
    build: {
      outDir: out,
      lib: { entry: join(repo, 'apps/desktop/src/theme/measure-face.ts'), formats: ['iife'], name: 'MeasureFace', fileName: () => 'measure-face.js' },
    },
  });
  const bundle = readFileSync(join(out, 'measure-face.js'), 'utf8');
  const css = FACES.map((f, i) => `@font-face{font-family:"${f.family}";src:url("/font/${i}");font-weight:100 900}`).join('');
  const page = `<!doctype html><style>${css}</style><body><script>${bundle}</script>`;
  server = createServer((req, res) => {
    const m = /^\/font\/(\d+)$/.exec(req.url);
    if (m) { res.setHeader('Content-Type', 'font/ttf'); return res.end(readFileSync(join(repo, FACES[Number(m[1])].file))); }
    res.setHeader('Content-Type', 'text/html');
    res.end(page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    await fn(page);
  } finally {
    await browser.close();
  }
}

const measure = (page, family, sizePx) =>
  page.evaluate(([f, s]) => window.MeasureFace.measureAverageAdvance({ family: `"${f}", serif`, sizePx: s }), [family, sizePx]);
const hmtx = (file) => averageAdvance(MEASURE_SAMPLE, (c) => readFont(join(repo, file)).advanceOf(c.codePointAt(0)));

test('Literata at the 20 px body measures within 1 % of 0.463', async () => {
  await withPage(async (page) => {
    const value = await measure(page, 'Literata', 20);
    assert.ok(Math.abs(value - 0.463) / 0.463 < 0.01, String(value));
  });
});

for (const { family, file } of FACES) {
  test(`${family}: the canvas mean agrees with the hmtx mean (1 %; Literata 2 %, kerning)`, async () => {
    const reader = readFont(join(repo, file));
    const expected = averageAdvance(MEASURE_SAMPLE, (c) => reader.advanceOf(c.codePointAt(0)));
    // hmtx is the default instance; an optical-size face is measured at the size that is its default.
    const size = reader.axes.opsz ?? 20;
    await withPage(async (page) => {
      const value = await measure(page, family, size);
      // Literata's kerning (GPOS, which the canvas and the typesetter apply and hmtx does not) takes 1.35 %
      // off its mean; with kerning off a DOM span agrees with hmtx to 0.15 %. Its own bound is 2 %,
      // and its value is held to the 1 % of 0.463 above.
      const bound = family === 'Literata' ? 0.02 : 0.01;
      assert.ok(Math.abs(value - expected) / expected < bound, `${family}: canvas ${value}, hmtx ${expected}`);
    });
  });
}

test('two sizes of one face give the same em value within 0.5 %', async () => {
  await withPage(async (page) => {
    for (const { family } of FACES.filter((f) => f.family.includes('Mono') || f.family.includes('Plex'))) {
      const a = await measure(page, family, 16);
      const b = await measure(page, family, 28);
      assert.ok(Math.abs(a - b) / a < 0.005, `${family}: ${a} vs ${b}`);
    }
  });
});

test('an optical-size face is narrower as it grows, so its number is measured at the size it is set at', async () => {
  await withPage(async (page) => {
    const small = await measure(page, 'Source Serif 4', 16);
    const large = await measure(page, 'Source Serif 4', 28);
    assert.ok((small - large) / small > 0.01, `${small} vs ${large}`);
  });
});

test('a face that is not there is null, not a fallback face measured as if it were the one asked for', async () => {
  await withPage(async (page) => {
    const value = await page.evaluate(() => window.MeasureFace.measureAverageAdvance({ family: '"No Such Face"' }));
    assert.equal(value, null);
  });
});

test('a measurement is memoised: the second ask is answered from the cache, synchronously readable', async () => {
  await withPage(async (page) => {
    const r = await page.evaluate(async () => {
      const face = { family: '"Literata", serif', sizePx: 20 };
      const before = window.MeasureFace.cachedAverageAdvance(face);
      const [a, b] = await Promise.all([window.MeasureFace.measureAverageAdvance(face), window.MeasureFace.measureAverageAdvance(face)]);
      return { before, a, b, after: window.MeasureFace.cachedAverageAdvance(face) };
    });
    assert.equal(r.before, undefined);
    assert.equal(r.a, r.b);
    assert.equal(r.after, r.a);
  });
});

test('measureFaceWhenIdle does not measure before the first frame has painted', async () => {
  await withPage(async (page) => {
    const r = await page.evaluate(async () => {
      const order = [];
      const done = new Promise((resolve) =>
        window.MeasureFace.measureFaceWhenIdle({ family: '"Literata", serif', sizePx: 20 }, (v) => { order.push('measured'); resolve(v); }));
      order.push('scheduled');
      const first = await new Promise((resolve) => requestAnimationFrame(() => resolve(window.MeasureFace.cachedAverageAdvance({ family: '"Literata", serif', sizePx: 20 }))));
      const value = await done;
      return { order, cachedAtFirstFrame: first, value };
    });
    assert.equal(r.cachedAtFirstFrame, undefined);
    assert.deepEqual(r.order, ['scheduled', 'measured']);
    assert.ok(r.value > 0.4);
  });
});
