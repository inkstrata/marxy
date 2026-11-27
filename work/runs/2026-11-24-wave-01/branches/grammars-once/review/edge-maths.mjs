// Maths in headless Edge under the release CSP, from a production build of the tree in argv[2].
// argv[3] = inline limit override ("default" keeps vite.config.ts; a number forces Vite's assetsInlineLimit).
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tree = process.argv[2];
const limit = process.argv[3] ?? 'default';
const shot = process.argv[4];
const desk = join(tree, 'apps/desktop');
const imp = (p) => import(pathToFileURL(p).href);
const { build } = await imp(join(desk, 'node_modules/vite/dist/node/index.js'));
const { chromium } = await imp(join(desk, 'node_modules/playwright/index.mjs'));
const { injectStyleNonces, loadConfiguredCsp, releaseStyleCsp } = await imp(join(tree, 'scripts/check-csp.mjs'));

const outDir = mkdtempSync(join(tmpdir(), 'marxy-edge-maths-'));
await build({ root: desk, logLevel: 'silent', build: { outDir, emptyOutDir: true, ...(limit === 'default' ? {} : { assetsInlineLimit: Number(limit) }) } });
const fontFiles = readdirSync(join(outDir, 'assets')).filter((f) => /\.(woff2?|ttf)$/.test(f));
const NONCE = 'edgemaths';
const csp = releaseStyleCsp(loadConfiguredCsp(), NONCE);
const requested = [];
const types = { '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  requested.push(pathname);
  const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
  const ext = extname(path);
  res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
  if (ext === '.html') { res.setHeader('Content-Security-Policy', csp); return res.end(injectStyleNonces(readFileSync(path, 'utf8'), NONCE)); }
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const TEXT = 'Inline $\\alpha + \\frac{a}{b}$, $\\mathbb{R}$, $\\mathcal{L}$, $\\mathfrak{g}$, $\\mathscr{H}$, $\\mathsf{S}$, $\\mathtt{m}$.\n\n$$\n\\sum_{i=0}^{n} i = \\frac{n(n+1)}{2} \\bigl( \\Bigl( \\biggl( \\Biggl( x \\Biggr) \\biggr) \\Bigr) \\bigr) \\int_0^1 \\sqrt[3]{x}\\,dx\n$$\n';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const csperr = [];
  page.on('console', (m) => { if (/Content Security Policy|font/i.test(m.text())) csperr.push(m.text().slice(0, 160)); });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => { const h = await window.marxyApp.start(files, argv); await h.ready; }, { files: { '/m.md': Buffer.from(TEXT).toString('base64') }, argv: ['/m.md'] });
  await page.waitForSelector('.katex');
  const st = await page.evaluate(async () => {
    await document.fonts.ready;
    const k = [...document.fonts].filter((f) => f.family.replace(/["']/g, '').startsWith('KaTeX_'));
    const usedLoaded = k.filter((f) => f.status === 'loaded').length;
    await Promise.allSettled(k.map((f) => f.load()));
    const rules = [...document.adoptedStyleSheets, ...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).filter((r) => r instanceof CSSFontFaceRule && /KaTeX_/.test(r.cssText));
    const srcs = rules.flatMap((r) => [...r.cssText.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]));
    return { ua: navigator.userAgent.match(/Edg\/[\d.]+/)?.[0], faces: k.length, usedLoaded, failed: k.filter((f) => f.status !== 'loaded').map((f) => `${f.family} ${f.weight} ${f.style}`), dataSrcs: srcs.filter((s) => s.startsWith('data:')).length, nonWoff2: srcs.filter((s) => !/\.woff2/.test(s)).map((s) => s.slice(0, 50)) };
  });
  if (shot) await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1000, height: 400 } });
  console.log(JSON.stringify({ limit, fontFiles: fontFiles.length, fontKinds: [...new Set(fontFiles.map((f) => extname(f)))], ...st, fontRequests: requested.filter((p) => /\.(woff2?|ttf)$/.test(p)).length, csperr: csperr.slice(0, 3) }, null, 1));
} finally { await browser.close(); server.close(); }
