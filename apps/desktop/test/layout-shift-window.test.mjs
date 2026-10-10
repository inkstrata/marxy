// MARXY-143: the gate render's font/image window waits (apps/desktop/src/harness, B-02), the gate repeat
// flag, and frozen CLS thresholds.

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const entryPath = new URL('apps/desktop/src/harness/gate-entry.ts', root);
const shiftPath = new URL('apps/desktop/src/harness/layout-shift.ts', root);
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
  SIZES: 'const SIZES = [16, 20, 24, 28];',
  LINE_BOX: 'const LINE_BOX = { 16: 24, 20: 30, 24: 36, 28: 42 };',
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

function entrySource() {
  return readFileSync(entryPath, 'utf8');
}

function shiftSource() {
  return readFileSync(shiftPath, 'utf8');
}

function gateSource() {
  return readFileSync(gatePath, 'utf8');
}

test('MARXY-143: the gate render awaits document.fonts.load per used face and decode on reserved images before the first scored snapshot', () => {
  const helpers = shiftSource();
  assert.match(helpers, /export async function awaitArticleFonts/, 'awaitArticleFonts is exported');
  assert.match(helpers, /document\.fonts\.load/, 'loads each face the article uses');
  assert.match(helpers, /export async function awaitReservedImages/, 'awaitReservedImages is exported');
  assert.match(helpers, /img\.decode/, 'decodes reserved images');
  const src = entrySource();
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
  const src = entrySource();
  const stub = src.replace(/await awaitArticleFonts\(article\);\s*\n\s*await awaitReservedImages\(article\);\s*\n/, '  await document.fonts.ready;\n');
  assert.doesNotMatch(stub, /await awaitArticleFonts\(article\)/);
  assert.doesNotMatch(stub, /await awaitReservedImages\(article\)/);
  assert.match(stub, /await document\.fonts\.ready;\s*\n\s*takeSnapshot\(article, snaps\)/);
});

test('MARXY-143: an unreserved image after the first snapshot still yields fontWindow > 0', async () => {
  const { build } = await import('vite');
  const desktop = join(fileURLToPath(new URL('..', import.meta.url)));
  const outDir = mkdtempSync(join(tmpdir(), 'marxy-layout-shift-'));
  await build({
    root: desktop,
    configFile: join(desktop, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true },
    plugins: [{ name: 'marxy-gate-input', config(c) { c.build.rollupOptions.input = { gate: join(desktop, 'gate.html') }; } }],
  });
  const { createServer } = await import('node:http');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.ttf': 'font/ttf' };
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = join(outDir, path === '/' ? 'gate.html' : path.slice(1));
    if (!file.startsWith(outDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${origin}/gate.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.marxyGate?.layoutShift?.finishShift === 'function');
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
      const shift = window.marxyGate.layoutShift;
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
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('MARXY-143: gate-aesthetics CLS thresholds and matrix literals match main', () => {
  const src = gateSource();
  for (const [name, text] of Object.entries(MAIN_GATE_SNIPPETS)) {
    assert.ok(src.includes(text), `${name} must stay byte-identical to main`);
  }
});

// MARXY-153 moved the repeat pass off the pull-request path: re-rendering the corpus to see whether
// the answer changes is a flake detector, it cannot fail for anything in the diff under review, and
// it was 266s of the browser job's 356s. MARXY-143's signal is kept, not dropped — so this test now
// pins both halves of that bargain: nothing implies --repeat, and the nightly workflow passes it.
test('MARXY-153: gate-aesthetics runs no CLS repeat pass unless --repeat asks for one', () => {
  const src = gateSource();
  const repeatBlock = src.slice(src.indexOf("const repeatIdx = process.argv.indexOf('--repeat')"));
  assert.match(repeatBlock, /const REPEAT = repeatIdx === -1 \? 0 :/, 'an omitted --repeat must mean no repeat pass, on CI as locally');
  assert.doesNotMatch(repeatBlock, /process\.env\.CI/, 'CI must not imply a repeat pass: it is the path every pull request waits on');
  assert.match(repeatBlock, /Math\.max\(1, Number\.parseInt\(process\.argv\[repeatIdx \+ 1\]/, '--repeat N must stay explicit for local and nightly runs');
});

test('MARXY-153: the nightly workflow still runs the CLS repeat passes MARXY-143 added', () => {
  const nightly = readFileSync(new URL('.github/workflows/nightly.yml', root), 'utf8');
  assert.match(nightly, /gate-aesthetics\.mjs --repeat 3/, 'nightly must run the repeat passes, or MARXY-143 loses its signal entirely');
  assert.match(nightly, /schedule:/, 'nightly must be scheduled, not only dispatchable');
});
