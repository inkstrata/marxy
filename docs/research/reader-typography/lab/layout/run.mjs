#!/usr/bin/env node
// Layout and conformance lab (L-01, docs/research/reader-typography/12-conformance.md). Small headless
// WebKit probes for what the L-00 probe does not measure: the research's verification items (text
// spacing, 200 % text, hyphenation, fallback sizes, CJK leading, ragged right below 45 characters), the
// nested wide blocks H5 could not sample, and a before/after pair for each layout decision. It renders
// through the layout probe's harness (scripts/probe-layout.mjs, which renders through the aesthetics
// gate's entry) and three standalone pages beside this file. Writes ../data/layout.json; numbers only.
//
//   node docs/research/reader-typography/lab/layout/run.mjs
//
// Not a gate and not in CI. Every CSS "after" below is a proposal measured, not a change made.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRenderEntry, startHarness, measureInPage, CLASSIC_CSS, CLASSIC_SCROLLBAR_PX } from '../../../../../scripts/probe-layout.mjs';
import { launchWebkit } from '../../../../../scripts/playwright-webkit.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '../../../../..');
const corpus = (f) => readFileSync(join(root, 'fixtures/corpus', f), 'utf8');
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

// ---- in-page helpers (serialised; they use nothing from this module) -------------------------------

/** Clipping, set-line overflow, block overlap and sideways scroll in the article. */
function survey() {
  const a = document.getElementById('doc');
  const html = document.documentElement;
  const r = (n) => Math.round(n * 100) / 100;
  const hid = (v) => v === 'hidden' || v === 'clip';
  const clipped = [];
  for (const el of a.querySelectorAll('*')) {
    if (el.closest('.marxy-line-omitted, .marxy-invisible')) continue;
    const cs = getComputedStyle(el);
    if ((hid(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hid(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)) clipped.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
  }
  const range = document.createRange();
  let over = 0;
  let maxOver = 0;
  for (const p of a.querySelectorAll('.marxy-set')) {
    const cs = getComputedStyle(p);
    const right = p.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let m = -Infinity;
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim() || n.parentElement.closest('.marxy-hang')) continue;
      range.selectNodeContents(n);
      for (const rc of range.getClientRects()) if (rc.width) m = Math.max(m, rc.right);
    }
    if (m > right + 0.5) {
      over++;
      maxOver = Math.max(maxOver, m - right);
    }
  }
  let overlaps = 0;
  const kids = [...a.children].filter((e) => e.getBoundingClientRect().height > 0);
  for (let i = 1; i < kids.length; i++) if (kids[i].getBoundingClientRect().top < kids[i - 1].getBoundingClientRect().bottom - 1) overlaps++;
  return {
    hScroll: html.scrollWidth > html.clientWidth + 1,
    clipped: clipped.length,
    clippedKinds: [...new Set(clipped)].sort().slice(0, 8),
    setLinesPastBox: over,
    maxSetLinePastBoxPx: r(maxOver),
    blockOverlaps: overlaps,
    bodyFontPx: parseFloat(getComputedStyle(a).fontSize),
    setParagraphs: a.querySelectorAll('.marxy-set').length,
  };
}

/** Characters per set line (last line of each paragraph left out: it is short by nature). */
function charsPerLine() {
  const a = document.getElementById('doc');
  const rng = document.createRange();
  const counts = [];
  for (const p of [...a.querySelectorAll(':scope > p.marxy-set')].slice(0, 40)) {
    const lines = new Map();
    const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      for (let i = 0; i < n.length; i++) {
        if (n.nodeValue[i] === '­') continue;
        rng.setStart(n, i);
        rng.setEnd(n, i + 1);
        const rc = rng.getBoundingClientRect();
        if (!rc.height) continue;
        const k = Math.round(rc.top / 10);
        lines.set(k, (lines.get(k) ?? 0) + 1);
      }
    }
    const c = [...lines.entries()].sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    c.pop();
    counts.push(...c);
  }
  counts.sort((x, y) => x - y);
  const mean = counts.reduce((s, x) => s + x, 0) / (counts.length || 1);
  const p0 = a.querySelector(':scope > p.marxy-set');
  const cs = p0 ? getComputedStyle(p0) : null;
  return {
    lines: counts.length,
    mean: Math.round(mean * 10) / 10,
    min: counts[0] ?? null,
    p10: counts[Math.floor(counts.length * 0.1)] ?? null,
    max: counts[counts.length - 1] ?? null,
    textAlign: cs?.textAlign ?? null,
    wordSpacing: cs?.wordSpacing ?? null,
  };
}

/** CJK paragraphs: line pitch and whether the typesetter set them. */
function cjkLines() {
  const a = document.getElementById('doc');
  const rng = document.createRange();
  const out = [];
  for (const p of a.querySelectorAll('p')) {
    const t = p.textContent ?? '';
    if ((t.match(/[　-鿿가-힯]/g)?.length ?? 0) < t.length * 0.2) continue;
    rng.selectNodeContents(p);
    const tops = [...new Set([...rng.getClientRects()].filter((x) => x.width).map((x) => Math.round(x.top)))].sort((x, y) => x - y);
    const d = tops.slice(1).map((x, i) => x - tops[i]);
    out.push({ lines: tops.length, minPitchPx: d.length ? Math.min(...d) : null, maxPitchPx: d.length ? Math.max(...d) : null, lineHeight: getComputedStyle(p).lineHeight, lang: p.closest('[lang]')?.getAttribute('lang') ?? null, set: p.classList.contains('marxy-set') });
  }
  return out;
}

/** Nested wide blocks against the page column's room, and scrolled tables against the grid. */
function nestedAndGrid() {
  const a = document.getElementById('doc');
  const cs = getComputedStyle(a);
  const ar = a.getBoundingClientRect();
  const colL = ar.left + parseFloat(cs.paddingLeft);
  const colR = ar.right - parseFloat(cs.paddingRight);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--marxy-room)';
  a.append(probe);
  const room = probe.getBoundingClientRect().width;
  probe.remove();
  const unit = parseFloat(cs.lineHeight) / 2;
  const depth = (el) => {
    let d = 0;
    for (let p = el.parentElement; p && p !== a; p = p.parentElement) if (/^(LI|BLOCKQUOTE|DD)$/.test(p.tagName)) d++;
    return d;
  };
  const r = (n) => Math.round(n * 100) / 100;
  return [...a.querySelectorAll('table, pre')].map((el) => {
    const b = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      depth: depth(el),
      pastRoomRightPx: r(b.right - (colR + room)),
      pastRoomLeftPx: r(colL - room - b.left),
      scrolls: el.scrollWidth > el.clientWidth + 1,
      heightInUnits: r(b.height / unit),
    };
  });
}

// ---- driver ------------------------------------------------------------------------------------------

async function render(page, origin, source, { width, renderWidth = width, size = 20, variant = 'dark', cssBefore = '', cssAfter = '', typeset = true }) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/render.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyRender === 'function');
  if (cssBefore) await page.addStyleTag({ content: cssBefore });
  await page.evaluate(async ({ source, o }) => window.marxyRender(source, o), { source, o: { variant, width: renderWidth, size, typeset } });
  await page.evaluate(() => {
    document.getElementById('marxy-main').style.width = '';
  });
  if (cssAfter) await page.addStyleTag({ content: cssAfter });
  await frames(page);
}
const frames = (page) => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))));
const measure = (page, opts = {}) => page.evaluate(measureInPage, { blocks: Boolean(opts.blocks), notice: Boolean(opts.notice), keepNotice: false });

const TEXT_SPACING = `.marxy-article, .marxy-article * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
.marxy-article p { margin-bottom: 2em !important; }`;

// The decisions' "after" CSS, as proposals.
const SYMMETRIC_AND_HUNG = `.marxy-article :is(pre, table) { position: relative; left: 50%; translate: -50% 0; }
.marxy-article pre { min-width: calc(100% + 2 * min(var(--marxy-half), var(--marxy-room))); max-width: min(calc(100% + 2 * var(--marxy-room)), calc(100ch + 2 * var(--marxy-half))); }
.marxy-article table { max-width: calc(100% + 2 * var(--marxy-room)); }`;
const FLUSH_IMAGES = `.marxy-article p > img:only-child { margin-inline: 0; }`;
const STABLE_GUTTER = `html { scrollbar-gutter: stable both-edges; }`;
const STICKY_NOTICES = `#marxy-notices { position: sticky; top: 0; z-index: 1; font-size: var(--marxy-size-body); padding-inline: 16px; background: var(--marxy-color-bg); }
@media (min-width: 30em) { #marxy-notices { padding-inline: 24px; } }`;

const NESTED = `# Nested wide blocks

1. A list item holding a wide table:

   | Option | Type | Default | Description that runs long enough to need the room |
   | --- | --- | --- | --- |
   | \`ephemeral_quorum.retain\` | integer | \`1h\` | The setting controls how a node is flushed when the disk is more than ninety per cent full and the operator has not said otherwise. |

   - A nested item with another:

     | Option | Type | Default | Description that runs long enough to need the room |
     | --- | --- | --- | --- |
     | \`compact_shard.jitter\` | integer | \`1h\` | Raising the jitter increases connection use but shortens tail latency across every shard in the region. |

> A quotation holding a wide table:
>
> | Option | Type | Default | Description that runs long enough to need the room |
> | --- | --- | --- | --- |
> | \`regional_profile.level\` | ratio | \`"/var/lib/brindle"\` | Operators who run thirty-three or more nodes should set this explicitly rather than rely on the default value. |
>
> \`\`\`text
> a long code line inside a quotation that runs on well past the column so that it needs every pixel of the room there is
> \`\`\`

| A | top-level | table | that | scrolls | at | narrow | widths | with | many | columns | of | text |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| one | two | three | four | five | six | seven | eight | nine | ten | eleven | twelve | thirteen |
`;

async function main() {
  await buildRenderEntry();
  const harness = await startHarness();
  const browser = await launchWebkit();
  const page = await browser.newPage();
  // The standalone pages are served from this folder under the harness's origin, so they share its fonts.
  await page.route(`${harness.origin}/lab/**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice('/lab/'.length);
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(join(here, name)) });
  });
  const out = { tool: 'docs/research/reader-typography/lab/layout/run.mjs', engine: 'webkit-macos (Playwright)' };

  // 1. Text spacing (WCAG 1.4.12): as a theme (before the typesetter runs) and as a late user sheet.
  out.textSpacing = {};
  for (const f of ['09-gfm-everything.md', '05-pathological-table-and-nesting.md', '27-alerts.md', '31-essay.md']) {
    for (const width of [320, 960]) {
      await render(page, harness.origin, corpus(f), { width, cssBefore: TEXT_SPACING });
      const before = await page.evaluate(survey);
      await render(page, harness.origin, corpus(f), { width, cssAfter: TEXT_SPACING });
      const late = await page.evaluate(survey);
      out.textSpacing[`${f}@${width}`] = { asTheme: before, asLateSheet: late };
    }
  }

  // 2. 200 % text: the reader's size at 40 px (view.text-larger reaches 50). The headless entry sets only
  // 16-28 px, so the page renders untypeset at 20 and the tokens are doubled; lines then reflow by the engine.
  const DOUBLE = `:root { --marxy-size-body: 40px; --marxy-line-box: 60px; --marxy-size-code: 36px; --marxy-line-box-code: 60px; --marxy-size-caption: 30px; }`;
  out.text200 = {};
  for (const f of ['09-gfm-everything.md', '01-long-technical.md', '05-pathological-table-and-nesting.md']) {
    for (const width of [960, 1280]) {
      await render(page, harness.origin, corpus(f), { width, typeset: false, cssAfter: DOUBLE });
      out.text200[`${f}@${width}`] = await page.evaluate(survey);
    }
  }

  // 3. Ragged right below 45 characters (coupling rule 2).
  out.ragged = {};
  for (const width of [320, 480, 960]) {
    await render(page, harness.origin, corpus('31-essay.md'), { width });
    out.ragged[`31-essay.md@${width}`] = await page.evaluate(charsPerLine);
  }

  // 4. CJK leading (coupling rule 4) in the app's page, and the standalone face page.
  await render(page, harness.origin, corpus('07-cjk.md'), { width: 960 });
  out.cjkInPage = await page.evaluate(cjkLines);
  await page.goto(`${harness.origin}/lab/faces.html`);
  out.faces = await page.evaluate(() => window.run());

  // 5. Hyphenation in the engine, and the typesetter's patterns on untagged text.
  await page.goto(`${harness.origin}/lab/hyphenation.html`);
  out.hyphenation = { engine: await page.evaluate(() => window.run()) };
  const hy = await import(join(root, 'packages/typeset/src/hyphenate.ts'));
  const patterns = await hy.loadHyphenators();
  out.hyphenation.typesetter = {
    patternForDocumentLang: hy.resolvePattern(await page.evaluate(() => document.documentElement.lang)),
    patternForDe: hy.resolvePattern('de'),
    enUsOnOtherLanguages: Object.fromEntries(['Donaudampfschifffahrtsgesellschaft', 'anticonstitutionnellement', 'electroencefalografista'].map((w) => [w, patterns['en-us'](w).join('-')])),
  };

  // 6. H5: nested wide blocks against the page column's room; scrolled tables against the grid.
  out.nested = {};
  for (const width of [320, 960, 1280]) {
    await render(page, harness.origin, NESTED, { width });
    out.nested[`${width}`] = await page.evaluate(nestedAndGrid);
  }
  for (const size of [16, 20]) {
    await render(page, harness.origin, NESTED, { width: 480, size, cssBefore: CLASSIC_CSS });
    out.nested[`480-classic-${size}`] = await page.evaluate(nestedAndGrid);
  }

  // 7. Decision pairs: today against the default the rulings recorded.
  const pick = (c) => ({
    pageBoxesAsymmetry: c.margins.pageBoxes.asymmetry,
    preTextFromColumn: [c.kinds.pre?.idLmin ?? null, c.kinds.pre?.idLmax ?? null],
    preBoxLeftRight: [c.kinds.pre?.dLmin ?? null, c.kinds.pre?.dRmax ?? null],
    tableBoxLeftRight: [c.kinds.table?.dLmin ?? null, c.kinds.table?.dRmax ?? null],
    imageTextFromColumn: c.kinds['p>img']?.idLmin ?? null,
    room: c.column.room,
  });
  out.decisions = { d1d2: {}, d3: {}, d4: {}, d5: {} };
  for (const f of ['01-long-technical.md', '03-ai-plan.md', '06-math.md']) {
    for (const width of [480, 960, 1280]) {
      await render(page, harness.origin, corpus(f), { width });
      const before = pick(await measure(page));
      await render(page, harness.origin, corpus(f), { width, cssAfter: SYMMETRIC_AND_HUNG });
      const after = pick(await measure(page));
      out.decisions.d1d2[`${f}@${width}`] = { before, after };
    }
  }
  for (const f of ['24-issue-thread.md']) {
    await render(page, harness.origin, corpus(f), { width: 960 });
    const before = pick(await measure(page)).imageTextFromColumn;
    await render(page, harness.origin, corpus(f), { width: 960, cssAfter: FLUSH_IMAGES });
    out.decisions.d3[`${f}@960`] = { centred: before, flush: pick(await measure(page)).imageTextFromColumn };
  }
  // A classic scrollbar that appears after first text: the page sets while short (no scrollbar), then grows.
  // The scrollbar is the forced 15 px ::-webkit-scrollbar of the L-00 probe, a model of WebKitGTK's.
  for (const f of ['31-essay.md', '15-prose-volume.md']) {
    for (const width of [480, 960]) {
      const pair = {};
      for (const [k, extra] of [['today', ''], ['stable', 'html { scrollbar-gutter: stable; }'], ['stableBothEdges', STABLE_GUTTER], ['overflowScroll', 'html { overflow-y: scroll; }']]) {
        // The harness sets its main to the render width; with the track always shown, that is the window less it.
        const renderWidth = k === 'overflowScroll' ? width - CLASSIC_SCROLLBAR_PX : width;
        await render(page, harness.origin, corpus(f), { width, renderWidth, cssBefore: `${CLASSIC_CSS}\n#marxy-main:not(.grown) { height: 100px; overflow: hidden; }\n${extra}` });
        const m0 = await measure(page);
        await page.evaluate(() => document.getElementById('marxy-main').classList.add('grown'));
        await frames(page);
        const m1 = await measure(page);
        pair[k] = {
          scrollbarBeforePx: m0.viewport.scrollbar,
          columnMovedPx: r2(m1.centre.columnAxis - m0.centre.columnAxis),
          offsetFromWindowPx: m1.centre.offsetFromWindow,
          linesPastBox: m1.lines.overflowing,
          maxLinePastBoxPx: m1.lines.maxOverflow,
          columnWidthPx: [m0.column.width, m1.column.width],
        };
      }
      pair.supported = await page.evaluate(() => CSS.supports('scrollbar-gutter', 'stable both-edges'));
      out.decisions.d4[`${f}@${width}`] = pair;
    }
  }
  // Control: does the engine reserve a gutter at all, on a box that is not the viewport, with the forced
  // scrollbar and with its own? If not, the d4 pairs cannot tell the harness from the engine.
  await page.goto(`${harness.origin}/lab/gutter.html`);
  out.decisions.d4control = await page.evaluate(() => window.run());
  for (const width of [320, 960]) {
    const pair = {};
    for (const [k, css] of [['before', ''], ['after', STICKY_NOTICES]]) {
      await render(page, harness.origin, corpus('15-prose-volume.md'), { width, cssAfter: css });
      const n = (await measure(page, { notice: true })).notice;
      pair[k] = { edgeFromColumnPx: n.boxVsColumnL, inViewWhenScrolled: n.inViewWhenScrolled, topWhenScrolledPx: n.topWhenScrolled, position: n.position };
    }
    out.decisions.d5[`15-prose-volume.md@${width}`] = pair;
  }

  await browser.close();
  harness.close();
  const file = join(here, '../data/layout.json');
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${file}`);
}

await main();
