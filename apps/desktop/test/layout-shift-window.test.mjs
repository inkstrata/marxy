// MARXY-143: the headless font/image window waits, the gate repeat flag, and frozen CLS thresholds.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';

const root = new URL('../../../', import.meta.url);
const headlessPath = new URL('apps/desktop/src/render/headless.ts', root);
const gatePath = new URL('scripts/gate-aesthetics.mjs', root);

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

/** Main-branch gate literals; criterion 4 forbids moving them. */
const MAIN_GATE_SNIPPETS = {
  RAG_OPTS: 'const RAG_OPTS = { shortLineFraction: 0.1, badnessStretchEm: 2 };',
  WIDTHS: 'const WIDTHS = [720, 960, 1280];',
  VARIANTS: "const VARIANTS = ['dark', 'light'];",
  SIZES: 'const SIZES = [14, 17, 21, 24];',
  LINE_BOX: 'const LINE_BOX = { 14: 24, 17: 28, 21: 34, 24: 40 };',
  checkCls: `function checkCls(reported) {
  if (reported == null || reported.observed !== true) {
    return [\`layout shift unobserved: \${reported?.reason ?? 'no measurement'}\`];
  }
  if ((reported.snapshots ?? 0) < 2) {
    return [\`layout shift unobserved: \${reported.snapshots ?? 0} snapshot(s)\`];
  }
  if (reported.cls > 0) {
    const bits = [];
    if ((reported.fontWindow ?? 0) > 0) bits.push(\`font/image \${reported.fontWindow}\`);
    if ((reported.settleWindow ?? 0) > 0) bits.push(\`settle \${reported.settleWindow}\`);
    return [\`layout shift \${reported.cls}\${bits.length ? \` (\${bits.join(', ')})\` : ''}\`];
  }
  return [];
}`,
};

function headlessSource() {
  return readFileSync(headlessPath, 'utf8');
}

function gateSource() {
  return readFileSync(gatePath, 'utf8');
}

test('MARXY-143: headless awaits document.fonts.load per used face and decode on reserved images before the first scored snapshot', () => {
  const src = headlessSource();
  assert.match(src, /export async function awaitArticleFonts/, 'awaitArticleFonts is exported');
  assert.match(src, /document\.fonts\.load/, 'loads each face the article uses');
  assert.match(src, /export async function awaitReservedImages/, 'awaitReservedImages is exported');
  assert.match(src, /img\.decode/, 'decodes reserved images');
  const beforeFirstSnap = src.slice(src.indexOf('const snaps'), src.indexOf('takeSnapshot(article, snaps);'));
  assert.match(beforeFirstSnap, /await awaitArticleFonts\(article\)/);
  assert.match(beforeFirstSnap, /await awaitReservedImages\(article\)/);
  const fontsReadyOnly = beforeFirstSnap.replace(/await awaitArticleFonts\(article\);\s*/, '').replace(/await awaitReservedImages\(article\);\s*/, '');
  assert.doesNotMatch(
    fontsReadyOnly.replace(/await document\.fonts\.ready;\s*/g, ''),
    /await document\.fonts\.ready/,
    'fonts.ready alone is not the only wait before the first snapshot',
  );
});

test('MARXY-143: fonts.ready alone before the first snapshot would fail the wait case', () => {
  const src = headlessSource();
  const stub = src.replace(/await awaitArticleFonts\(article\);\s*\n\s*await awaitReservedImages\(article\);\s*\n/, '  await document.fonts.ready;\n');
  assert.doesNotMatch(stub, /await awaitArticleFonts\(article\)/);
  assert.doesNotMatch(stub, /await awaitReservedImages\(article\)/);
  assert.match(stub, /await document\.fonts\.ready;\s*\n\s*settleGrid\(article, lineBox\)/);
});

test('MARXY-143: an unreserved image after the first snapshot still yields fontWindow > 0', async () => {
  const { build } = await import('vite');
  const { writeFileSync } = await import('node:fs');
  const desktop = join(new URL('..', import.meta.url).pathname);
  await build({
    configFile: join(desktop, 'src/render/vite.config.ts'),
    root: desktop,
    logLevel: 'error',
  });
  const dist = join(desktop, 'dist');
  writeFileSync(
    join(dist, 'render.html'),
    `<!doctype html><html><body><main id="marxy-main"><article id="doc" class="marxy-article"></article></main><script src="./render.js"></script></body></html>`,
  );
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = path === '/render.html' ? join(dist, 'render.html') : join(dist, path.slice(1));
    if (!existsSync(file)) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${origin}/render.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyLayoutShift?.finishShift === 'function');
    const fontWindow = await page.evaluate(async () => {
      const article = document.getElementById('doc');
      const mk = (s, e, text) => {
        const p = document.createElement('p');
        p.setAttribute('data-marxy-s', s);
        p.setAttribute('data-marxy-e', e);
        p.style.display = 'block';
        p.style.margin = '0';
        p.textContent = text;
        return p;
      };
      article.replaceChildren(mk('0', '1', 'Above'), mk('2', '3', 'Below'));
      const shift = window.marxyLayoutShift;
      shift.assertCanObserve();
      const snaps = [];
      const snap = () => snaps.push(shift.snapshot(article));
      snap();
      const img = document.createElement('img');
      img.id = 'late';
      img.alt = '';
      img.style.display = 'block';
      article.insertBefore(img, article.lastElementChild);
      const canvas = document.createElement('canvas');
      canvas.width = 40;
      canvas.height = 200;
      img.src = canvas.toDataURL();
      await img.decode();
      void article.offsetHeight;
      snap();
      snap();
      const report = shift.finishShift(snaps);
      return report.fontWindow ?? 0;
    });
    assert.ok(fontWindow > 0, `expected fontWindow > 0, got ${fontWindow}`);
  } finally {
    await browser.close();
    server.close();
  }
});

test('MARXY-143: gate-aesthetics CLS thresholds and matrix literals match main', () => {
  const src = gateSource();
  for (const [name, text] of Object.entries(MAIN_GATE_SNIPPETS)) {
    assert.ok(src.includes(text), `${name} must stay byte-identical to main`);
  }
});

test('MARXY-143: gate-aesthetics defaults CLS corpus to 3 passes in CI when --repeat is omitted', () => {
  const src = gateSource();
  const repeatBlock = src.slice(src.indexOf("const repeatIdx = process.argv.indexOf('--repeat')"));
  assert.match(
    repeatBlock,
    /repeatIdx === -1[\s\S]*process\.env\.CI[\s\S]*\?\s*3\s*:\s*0/,
    'CI must default REPEAT to 3 when --repeat is not passed',
  );
  assert.match(repeatBlock, /Math\.max\(1, Number\.parseInt\(process\.argv\[repeatIdx \+ 1\]/, '--repeat N must stay explicit for local runs');
});
