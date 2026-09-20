// Renders the long corpus document at the default type scale in both candidate typeface pairs
// (ADR-0015) and writes the PNG sets plus a manifest for taste review #0. Fonts are inlined as
// data: URLs and every http(s) request is recorded and aborted; a control page that deliberately
// references six remote resources runs through the same interception, so "the specimen requested
// nothing" is a measurement rather than the absence of one.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { CONTROL_RESOURCES, DPRS, OUT, SOURCE, VARIANTS, VIEWPORT, pages, pairs, pngSize, repo, repoPath, specimenPage, tokens, typeScale } from './specimen.mjs';

const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  source: SOURCE,
  viewport: VIEWPORT,
  dprs: DPRS,
  variants: [...VARIANTS],
  measure: tokens('dark')('measure'),
  scale: typeScale(),
  pages,
  pairs: [],
  requests: [],
  blocked: [],
  networkControl: null,
};

// One interception for the specimen and for the control, so the control proves the specimen's
// counters were actually watching.
const intercept = (ctx, sink) => ctx.route('**/*', route => {
  const url = route.request().url();
  sink.requests.push(url.slice(0, 80));
  if (/^(https?|ws|wss|ftp):/i.test(url)) { sink.blocked.push(url.slice(0, 200)); return route.abort(); }
  return route.continue();
});

const browser = await chromium.launch();
try {
  for (const pair of pairs) {
    const dir = `${OUT}/${pair.slug}`;
    rmSync(repo(dir), { recursive: true, force: true });
    mkdirSync(repo(dir), { recursive: true });
    const entry = { ...pair, faces: pair.faces.map(f => ({ ...f, bytes: statSync(repo(f.file)).size })), images: [] };

    for (const variant of VARIANTS) {
      const html = specimenPage(pair, variant);
      for (const dpr of DPRS) {
        const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: dpr, offline: true });
        await intercept(ctx, manifest);
        const page = await ctx.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);

        if (variant === VARIANTS[0] && dpr === DPRS[0]) entry.measured = await page.evaluate(measure);
        for (const p of pages) {
          const { y, anchor } = await page.evaluate(anchorOffset, p.id);
          await page.evaluate(top => window.scrollTo(0, top), y);
          const path = `${dir}/${p.id}-${variant}-${dpr}x.png`;
          await page.screenshot({ path: repoPath(path) });
          const { width, height } = pngSize(repo(path));
          entry.images.push({ page: p.id, variant, dpr, path, anchor, scrollY: y, width, height, bytes: statSync(repo(path)).size });
        }
        await ctx.close();
      }
    }
    manifest.pairs.push(entry);
    console.log(`${pair.slug}: ${entry.images.length} PNGs, column ${entry.measured.columnPx}px = ${entry.measured.measureCh}ch`);
  }

  manifest.networkControl = await runNetworkControl(browser);
  console.log(`network control: ${manifest.networkControl.blocked.length} of ${CONTROL_RESOURCES.length} deliberate remote references intercepted`);
} finally {
  await browser.close();
}

writeFileSync(repo(`${OUT}/manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
console.log(`specimen rendered: ${manifest.pairs.length} pairs × ${VARIANTS.length} variants × ${pages.length} pages × ${DPRS.length} densities, ${manifest.blocked.length} network requests`);

async function runNetworkControl(browser) {
  const sink = { requests: [], blocked: [] };
  const ctx = await browser.newContext({ viewport: VIEWPORT, offline: true });
  await intercept(ctx, sink);
  const page = await ctx.newPage();
  const url = kind => `https://specimen-control.invalid/${kind}`;
  await page.setContent(`<!doctype html><meta charset=utf-8>
<style>@import url(${url('import')});</style>
<link rel=stylesheet href="${url('stylesheet')}">
<img src="${url('img')}" alt>
<video src="${url('video')}" preload=auto></video>
<iframe src="${url('iframe')}"></iframe>
<script>fetch("${url('fetch')}").catch(() => {})</script>`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await ctx.close();
  const kinds = CONTROL_RESOURCES.filter(k => sink.blocked.some(u => u.endsWith(`/${k}`)));
  return { requests: sink.requests.length, blocked: sink.blocked, kinds, expected: CONTROL_RESOURCES };
}

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
  const blocks = [...document.querySelectorAll('article > *')];
  const describe = el => ({ tag: el.tagName.toLowerCase(), block: blocks.indexOf(el), text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) });
  const at = el => ({ y: Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - pad)), anchor: describe(el) });
  if (id === 'p1-opening') return { y: 0, anchor: describe(blocks[0]) };
  if (id === 'p2-inline-code') return at(blocks.find(el => el.matches('p') && el.querySelector('code')));
  if (id === 'p3-table') return at(blocks.find(el => el.matches('table')));
  if (id === 'p4-heading-stack') return at(blocks.find(el => el.matches('h3')));
  // Counted in blocks, not in pixels: the two pairs set the document to different heights, so a
  // pixel threshold could put the two sets on different lists, which is the one thing the
  // comparison cannot survive.
  if (id === 'p5-late-list') return at(blocks.slice(Math.floor(blocks.length * 0.7)).find(el => el.matches('ul')) ?? blocks.find(el => el.matches('ul')));
  throw new Error(`unknown specimen page ${id}`);
}