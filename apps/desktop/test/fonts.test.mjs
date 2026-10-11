// The bundled faces in the built page (MARXY-21): both families load from the app bundle, text is
// never painted in a fallback face, and each face ships with its licence. Builds the web half into a
// temporary directory and serves it, with the app script blocked (there is no shell here).

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips these tests and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);


const outDir = mkdtempSync(join(tmpdir(), 'marxy-fonts-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.js': 'text/javascript', '.txt': 'text/plain' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

test('each face ships with its OFL licence beside it', () => {
  for (const file of ['Literata.ttf', 'Literata-Italic.ttf', 'JetBrainsMono.ttf', 'SourceSerif4.ttf', 'AtkinsonHyperlegibleNext.woff2', 'AtkinsonHyperlegibleNext-Italic.woff2', 'InterVariable.woff2', 'Literata-OFL.txt', 'JetBrainsMono-OFL.txt', 'SourceSerif4-OFL.txt', 'AtkinsonHyperlegibleNext-OFL.txt', 'Inter-OFL.txt']) {
    assert.ok(existsSync(join(outDir, 'fonts', file)), `dist/fonts/${file}`);
  }
  for (const licence of ['Literata', 'AtkinsonHyperlegibleNext', 'Inter']) {
    assert.match(readFileSync(join(outDir, 'fonts', `${licence}-OFL.txt`), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/i, licence);
  }
});

test('the sans faces of the Classic set load from the bundle and are not the platform face (H-04.1)', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const text = 'Hamburgefonstiv';
      const width = (family) => { const s = document.createElement('span'); s.style.cssText = `font: 17px ${family}; position: absolute; white-space: nowrap`; s.textContent = text; document.body.append(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
      const faces = ['"Atkinson Hyperlegible Next"', '"Inter"'];
      for (const f of faces) await document.fonts.load(`17px ${f}`, text);
      await document.fonts.load('italic 17px "Atkinson Hyperlegible Next"', text);
      const root = getComputedStyle(document.documentElement);
      return {
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')}/${f.style}`).sort(),
        differs: faces.map((f) => Math.abs(width(`${f}, monospace`) - width('monospace')) > 1),
        sans: root.getPropertyValue('--marxy-face-sans'),
        readme: root.getPropertyValue('--marxy-face-readme'),
      };
    });
    for (const want of ['Atkinson Hyperlegible Next/italic', 'Atkinson Hyperlegible Next/normal', 'Inter/normal']) assert.ok(result.loaded.includes(want), `${want} loaded`);
    assert.deepEqual(result.differs, [true, true], 'each face is the bundled one, not a fallback');
    assert.match(result.sans, /^"Atkinson Hyperlegible Next"/);
    assert.match(result.readme, /^"Inter"/);
  } finally {
    await browser.close();
  }
});

test('text is set in Literata and code in JetBrains Mono, and no frame shows a fallback face', async () => {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto(base);
    const result = await page.evaluate(async () => {
      const doc = document.getElementById('doc');
      const p = document.createElement('p');
      const em = document.createElement('em');
      const code = document.createElement('code');
      em.textContent = 'italic';
      code.textContent = 'mono()';
      p.append('Hamburgefonstiv ', em, ' ', code);
      doc.append(p);
      p.getBoundingClientRect(); // layout asks for the faces; `fonts.ready` only waits for loads already asked for
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')}/${f.style}`).sort();
      const probe = (family) => { const s = document.createElement('span'); s.style.font = `17px ${family}`; s.textContent = 'Hamburgefonstiv'; document.body.append(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
      return {
        loaded,
        display: [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((r) => r instanceof CSSFontFaceRule).map((r) => r.style.getPropertyValue('font-display')),
        literataIsNotSerif: Math.abs(probe('Literata') - probe('serif')) > 1,
        body: getComputedStyle(p).fontFamily,
        code: getComputedStyle(p.querySelector('code')).fontFamily,
      };
    });
    assert.deepEqual(result.loaded, ['JetBrains Mono/normal', 'Literata/italic', 'Literata/normal']);
    assert.deepEqual([...new Set(result.display)], ['block'], 'every face blocks rather than swapping in a fallback');
    assert.ok(result.literataIsNotSerif, 'the loaded face is not the system serif');
    assert.match(result.body, /^"?Literata"?/);
    assert.match(result.code, /^"?JetBrains Mono"?/);
  } finally {
    await browser.close();
  }
});
