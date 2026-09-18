// Renders the long corpus document at the default type scale in both candidate typeface pairs
// (ADR-0015) and writes the PNG sets plus a manifest for taste review #0. Fonts are inlined as
// data: URLs and every http(s) request is recorded and aborted, so a specimen that reaches the
// network fails rather than quietly succeeding.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { DPRS, OUT, SOURCE, VIEWPORT, pages, pairs, pngSize, repo, repoPath, specimenPage, tokens, typeScale } from './specimen.mjs';

const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  source: SOURCE,
  viewport: VIEWPORT,
  dprs: DPRS,
  measure: tokens()('measure'),
  scale: typeScale(),
  pages,
  pairs: [],
  requests: [],
  blocked: [],
};

const browser = await chromium.launch();
try {
  for (const pair of pairs) {
    const dir = `${OUT}/${pair.slug}`;
    rmSync(repo(dir), { recursive: true, force: true });
    mkdirSync(repo(dir), { recursive: true });
    const html = specimenPage(pair);
    const entry = { ...pair, faces: pair.faces.map(f => ({ ...f, bytes: statSync(repo(f.file)).size })), images: [] };

    for (const dpr of DPRS) {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr, offline: true });
      await ctx.route('**/*', route => {
        const url = route.request().url();
        manifest.requests.push(url.slice(0, 80));
        if (/^(https?|ws|wss|ftp):/i.test(url)) { manifest.blocked.push(url.slice(0, 200)); return route.abort(); }
        return route.continue();
      });
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);

      if (dpr === DPRS[0]) entry.measured = await page.evaluate(measure);
      for (const p of pages) {
        const y = await page.evaluate(anchorOffset, p.id);
        await page.evaluate(top => window.scrollTo(0, top), y);
        const path = `${dir}/${p.id}-${dpr}x.png`;
        await page.screenshot({ path: repoPath(path) });
        const { width, height } = pngSize(repo(path));
        entry.images.push({ page: p.id, dpr, path, scrollY: y, width, height, bytes: statSync(repo(path)).size });
      }
      await ctx.close();
    }
    manifest.pairs.push(entry);
    console.log(`${pair.slug}: ${entry.images.length} PNGs, column ${entry.measured.columnPx}px = ${entry.measured.measureCh}ch`);
  }
} finally {
  await browser.close();
}

writeFileSync(repo(`${OUT}/manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
console.log(`specimen rendered: ${manifest.pairs.length} pairs × ${pages.length} pages × ${DPRS.length} densities, ${manifest.blocked.length} network requests`);

// --- functions evaluated in the page ---

function measure() {
  const article = document.querySelector('article');
  const probe = document.getElementById('ch-probe');
  const style = el => { const c = getComputedStyle(el); return { fontFamily: c.fontFamily.split(',')[0].replace(/"/g, ''), fontSize: parseFloat(c.fontSize), lineHeight: parseFloat(c.lineHeight), fontWeight: Number(c.fontWeight), letterSpacing: c.letterSpacing === 'normal' ? '0' : c.letterSpacing, marginTop: parseFloat(c.marginTop) }; };
  const chPx = probe.getBoundingClientRect().width / 68;
  const columnPx = article.getBoundingClientRect().width;
  const roleEl = { title: 'h1', section: 'h2', sub: 'h3', body: 'article > p', caption: 'article table', code: 'article pre code, article code' };
  const roles = {};
  for (const [k, sel] of Object.entries(roleEl)) roles[k] = style(document.querySelector(sel));
  return {
    codeBlocks: document.querySelectorAll('article pre').length,
    columnPx: Math.round(columnPx * 100) / 100,
    chPx: Math.round(chPx * 1000) / 1000,
    measureCh: Math.round((columnPx / chPx) * 100) / 100,
    documentHeightPx: document.documentElement.scrollHeight,
    roles,
    fontsLoaded: [...document.fonts].map(f => `${f.family} ${f.style} ${f.weight} ${f.status}`),
  };
}

function anchorOffset(id) {
  const pad = 56;
  const top = el => Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - pad));
  if (id === 'p1-opening') return 0;
  if (id === 'p2-inline-code') return top([...document.querySelectorAll('article p')].find(p => p.querySelector('code')));
  if (id === 'p3-table') return top(document.querySelector('article table'));
  if (id === 'p4-heading-stack') return top(document.querySelector('article h3'));
  if (id === 'p5-late-list') {
    const h = document.documentElement.scrollHeight;
    const list = [...document.querySelectorAll('article ul')].find(u => u.getBoundingClientRect().top + window.scrollY > h * 0.7);
    return top(list ?? document.querySelector('article ul'));
  }
  throw new Error(`unknown specimen page ${id}`);
}