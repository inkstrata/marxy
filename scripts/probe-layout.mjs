#!/usr/bin/env node
// Layout probe (L-00, docs/plan/roadmap-2026-10/07-layout-and-reading.md). Measures the page the
// reader gets: for every corpus document and every cell of a width x size x variant x scrollbar
// matrix it records where the column, its gutters and every block sit, and writes numbers, not
// verdicts. L-01 reads probe.json and decides which of H1-H7 hold.
//
//   node scripts/probe-layout.mjs [--ref origin/main] [--out DIR] [--files a.md,b.md]
//        [--widths 320,960] [--sizes 20] [--variants dark] [--scrollbars overlay,classic]
//        [--workers N] [--no-png] [--overlays-dir DIR] [--readme-only]
//
// It renders through the same entry as scripts/gate-aesthetics.mjs: the real app, built from
// apps/desktop/gate.html and driven by window.marxyGate (B-02). The gate cannot be imported (it runs its
// own main on load and does not export the builder), so `buildRenderEntry` below is a read-only copy of
// it; the gate, the baselines, base.css and every src/ file are untouched. Not part of CI (that is L-02).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchWebkit } from './playwright-webkit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = join(root, 'apps/desktop');
// A fresh directory per run, as the gate does, so a probe and a gate in one worktree never share output.
// Made on first use, so the gate importing this module's rules leaves no empty directory behind.
let distDir = null;
const dist = () => (distDir ??= mkdtempSync(join(tmpdir(), 'marxy-probe-')));
const corpusDir = join(root, 'fixtures/corpus');

export const DEFAULTS = {
  widths: [320, 480, 659, 720, 960, 1280, 1600, 2560],
  sizes: [16, 20, 28],
  variants: ['dark', 'light'],
  scrollbars: ['overlay', 'classic'],
};
/** The cell the contact sheets and the full block lists are taken at (the rest keep aggregates). */
const REF = { size: 20, variant: 'dark', scrollbar: 'overlay' };
const BLOCK_LIST_WIDTHS = new Set([320, 960, 1600]);
/** Width of the classic scrollbar forced with ::-webkit-scrollbar, modelling WebKitGTK. */
export const CLASSIC_SCROLLBAR_PX = 15;
const ANY_DOC = '(any document)';
const HYPOTHESES = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

// ---------------------------------------------------------------------------------------------
// The in-page measurement. Serialised into the page: it may use nothing from this module.
// ---------------------------------------------------------------------------------------------

/**
 * Measure the article in the current page. Returns plain numbers rounded to 0.01 px, so two runs
 * give an identical result. Every `delta` is relative to the column (the article's content box):
 * dL = box.left - columnLeft, dR = box.right - columnRight; positive dR is past the right edge.
 */
export function measureInPage(args) {
  const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  const article = document.getElementById('doc');
  const html = document.documentElement;
  const cs = getComputedStyle(article);
  const vw = window.innerWidth;
  const cw = html.clientWidth;
  const padL = parseFloat(cs.paddingLeft);
  const padR = parseFloat(cs.paddingRight);
  const ar = article.getBoundingClientRect();
  const colL = ar.left + padL;
  const colR = ar.right - padR;
  const unit = parseFloat(cs.lineHeight) / 2;
  const gutter = parseFloat(cs.getPropertyValue('--marxy-gutter')) || padL;
  const lenProbe = document.createElement('span');
  lenProbe.style.cssText = 'position:absolute;visibility:hidden;height:0;width:var(--marxy-room)';
  article.append(lenProbe);
  const room = lenProbe.getBoundingClientRect().width;
  lenProbe.remove();

  const BLOCKS = new Set(['block', 'table', 'list-item', 'flow-root', 'grid', 'flex']);
  const blockEls = [];
  const blockSet = new Set();
  for (const el of article.querySelectorAll('[data-marxy-s], .marxy-footnotes')) {
    if (!BLOCKS.has(getComputedStyle(el).display)) continue;
    blockEls.push(el);
    blockSet.add(el);
  }
  const depthOf = (el) => {
    let d = 0;
    for (let p = el.parentElement; p && p !== article; p = p.parentElement) if (blockSet.has(p)) d++;
    return d;
  };
  const ownerOf = (node) => {
    for (let p = node.parentElement; p && p !== article; p = p.parentElement) if (blockSet.has(p)) return p;
    return null;
  };
  const kindOf = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === 'img') return 'img';
    if (t === 'p' && el.children.length === 1 && el.firstElementChild.tagName === 'IMG' && el.textContent.trim() === '') return 'p>img';
    if (el.parentElement === article && t === 'dl' && el === article.firstElementChild) return 'dl.front';
    if (el.classList.contains('marxy-footnotes')) return 'footnotes';
    return t;
  };

  // The box that clips an element's ink sideways: the nearest ancestor below the article that scrolls or
  // clips (a scrolling formula, a table, the omitted tail of a very long line). Ink outside it is not on the
  // page and is not cut off by the window.
  const clipCache = new Map();
  const clipOf = (el) => {
    if (!el || el === article) return null;
    if (!clipCache.has(el)) {
      const box = getComputedStyle(el).overflowX !== 'visible' ? el.getBoundingClientRect() : null;
      clipCache.set(el, box ? { l: box.left, r: box.right } : clipOf(el.parentElement));
    }
    return clipCache.get(el);
  };

  // Ink per block: the union of its own text nodes' client rects (hung punctuation kept apart).
  const ink = new Map();
  const hangs = [];
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const owner = ownerOf(n);
    if (!owner) continue;
    const isHang = n.parentElement?.closest('.marxy-hang') !== null;
    // A line of preserved spaces (`pre-wrap`) hangs past its box, and the client rects of a text node
    // include the spaces: whitespace is not ink. Such a node is read one run of non-space at a time.
    const kept = ['pre', 'pre-wrap', 'break-spaces'].includes(getComputedStyle(n.parentElement).whiteSpace);
    const rects = [];
    if (kept) {
      for (const m of n.nodeValue.matchAll(/\S+/g)) {
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        rects.push(...range.getClientRects());
      }
    } else {
      range.selectNodeContents(n);
      rects.push(...range.getClientRects());
    }
    // The typesetter's `.marxy-hang` wraps the first letter of a line (optical margin) or an opening
    // quote (hung punctuation). A hung letter is ink that is allowed to hang: it counts, from the
    // column's edge. Hung punctuation is kept apart.
    const isLetter = isHang && /[\p{L}\p{N}]/u.test(n.nodeValue);
    // The hang the typesetter declared is the span's own negative inline-start margin; a letter is read
    // from the column's edge only within it (plus half a pixel), so a paragraph drifting left is seen.
    const declared = isLetter ? Math.max(0, -parseFloat(getComputedStyle(n.parentElement.closest('.marxy-hang')).marginInlineStart) || 0) : 0;
    const clip = clipOf(n.parentElement);
    for (const rc of rects) {
      if (rc.width === 0 || rc.height === 0) continue;
      if (isHang) hangs.push({ owner, left: rc.left, right: rc.right });
      if (isHang && !isLetter) continue;
      const left = clip ? Math.max(rc.left, clip.l) : rc.left;
      const right = clip ? Math.min(rc.right, clip.r) : rc.right;
      if (right <= left) continue;
      const cur = ink.get(owner) ?? { l: Infinity, r: -Infinity };
      cur.l = Math.min(cur.l, isLetter && left >= colL - declared - 0.5 ? Math.max(left, colL) : left);
      cur.r = Math.max(cur.r, right);
      ink.set(owner, cur);
    }
  }
  for (const img of article.querySelectorAll('img')) {
    const owner = ownerOf(img);
    const rc = img.getBoundingClientRect();
    if (!owner || rc.width === 0) continue;
    const cur = ink.get(owner) ?? { l: Infinity, r: -Infinity };
    cur.l = Math.min(cur.l, rc.left);
    cur.r = Math.max(cur.r, rc.right);
    ink.set(owner, cur);
  }
  const imgOwner = (el) => (el.tagName === 'P' ? el.firstElementChild : null);

  const blocks = [];
  for (const el of blockEls) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    const kind = kindOf(el);
    const s = getComputedStyle(el);
    const depth = depthOf(el);
    const hasScroll =
      ['auto', 'scroll', 'hidden'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const hBar = hasScroll ? Math.max(0, el.offsetHeight - el.clientHeight - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth)) : 0;
    let i = ink.get(el) ?? null;
    if (kind === 'p>img') {
      const ir = imgOwner(el).getBoundingClientRect();
      i = { l: ir.left, r: ir.right };
    } else if (kind === 'hr') {
      i = null;
    }
    if (i && hasScroll) i = { l: Math.max(i.l, box.left), r: Math.min(i.r, box.right) };
    const b = {
      k: `${el.tagName.toLowerCase()}@${el.getAttribute('data-marxy-s') ?? '-'}-${el.getAttribute('data-marxy-e') ?? '-'}`,
      tag: kind,
      depth,
      s: Number(el.getAttribute('data-marxy-s') ?? -1),
      e: Number(el.getAttribute('data-marxy-e') ?? -1),
      top: box.top + window.scrollY,
      h: box.height,
      l: box.left,
      r: box.right,
      dL: box.left - colL,
      dR: box.right - colR,
      iL: i ? i.l : null,
      iR: i ? i.r : null,
      idL: i ? i.l - colL : null,
      idR: i ? i.r - colR : null,
      scroll: hasScroll,
      hBar,
      padT: parseFloat(s.paddingTop),
      padB: parseFloat(s.paddingBottom),
    };
    blocks.push(b);
  }

  // Hung marks: the typesetter's hanging punctuation, ordered-list markers, checkboxes.
  const marks = [];
  for (const h of hangs) {
    marks.push({ type: 'punct', owner: h.owner.getAttribute('data-marxy-s'), left: h.left, hang: colL - h.left });
  }
  for (const li of article.querySelectorAll('li')) {
    const ps = getComputedStyle(li, '::before');
    if (ps.content && ps.content !== 'none' && ps.content !== 'normal') {
      const lr = li.getBoundingClientRect();
      const left = lr.left + parseFloat(getComputedStyle(li).paddingLeft) + parseFloat(ps.marginInlineStart || ps.marginLeft || '0');
      marks.push({ type: 'ol-marker', owner: li.getAttribute('data-marxy-s'), left, hang: colL - left });
    }
  }
  for (const cb of article.querySelectorAll('input[type="checkbox"]')) {
    const rc = cb.getBoundingClientRect();
    marks.push({ type: 'checkbox', owner: cb.closest('li')?.getAttribute('data-marxy-s') ?? null, left: rc.left, hang: colL - rc.left });
  }

  // Set lines: per paragraph set by the typesetter, the right edge of each line against its content box.
  // The typesetter hangs a hyphen past the measure on purpose (.marxy-hyphen) and hangs opening punctuation
  // (.marxy-hang): those boxes are not line overflow. Their rects are left out of a line's right edge and the
  // worst one is kept apart as `maxHungPastPx`, the baseline a reader of the numbers can compare against.
  const lineStats = { paragraphs: 0, lines: 0, overflowing: 0, maxOverflow: 0, maxHungPastPx: 0 };
  const lineOffenders = [];
  for (const p of article.querySelectorAll('p.marxy-set')) {
    const ps = getComputedStyle(p);
    const pb = p.getBoundingClientRect();
    const contentR = pb.right - parseFloat(ps.paddingRight);
    const lh = parseFloat(ps.lineHeight);
    const top = pb.top + parseFloat(ps.paddingTop);
    const lines = new Map();
    const hung = [...p.querySelectorAll('.marxy-hang, .marxy-hyphen')].flatMap((e) => [...e.getClientRects()]);
    const isHung = (rc) => hung.some((h) => Math.abs(h.left - rc.left) < 0.5 && Math.abs(h.right - rc.right) < 0.5 && Math.abs(h.top - rc.top) < 0.5);
    range.selectNodeContents(p);
    for (const rc of range.getClientRects()) {
      if (rc.width === 0) continue;
      if (isHung(rc)) {
        lineStats.maxHungPastPx = Math.max(lineStats.maxHungPastPx, rc.right - contentR);
        continue;
      }
      const key = Math.floor((rc.top + rc.height / 2 - top) / lh);
      const cur = lines.get(key) ?? { r: -Infinity };
      cur.r = Math.max(cur.r, rc.right);
      lines.set(key, cur);
    }
    lineStats.paragraphs++;
    let worst = 0;
    for (const ln of lines.values()) {
      lineStats.lines++;
      const over = ln.r - contentR;
      if (over > 0.5) {
        lineStats.overflowing++;
        worst = Math.max(worst, over);
      }
    }
    if (worst > 0) {
      lineOffenders.push({
        k: `p@${p.getAttribute('data-marxy-s')}-${p.getAttribute('data-marxy-e')}`,
        s: Number(p.getAttribute('data-marxy-s')),
        e: Number(p.getAttribute('data-marxy-e')),
        top: pb.top + window.scrollY,
        l: pb.left,
        r: pb.right,
        h: pb.height,
        over: worst,
      });
      lineStats.maxOverflow = Math.max(lineStats.maxOverflow, worst);
    }
  }

  // Rules. Each offender carries the hypothesis it is evidence for and a metric in px.
  const offenders = [];
  const push = (h, b, metric, why) => offenders.push({ h, k: b.k, tag: b.tag, depth: b.depth, s: b.s, e: b.e, metric: r2(metric), why, top: b.top, l: b.l, r: b.r, bh: b.h });
  const floorL = gutter;
  const floorR = cw - gutter;
  const EDGE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table', 'blockquote', 'ul', 'ol', 'dl', 'dl.front', 'p>img', 'figure', 'footnotes']);
  for (const b of blocks) {
    const oL = Math.max(0, colL - b.l);
    const oR = Math.max(0, b.r - colR);
    if (Math.abs(oR - oL) > 1) push('H1', b, oR - oL, `box overhangs the column ${r2(oL)} left, ${r2(oR)} right`);
    if (b.depth === 0 && EDGE_TAGS.has(b.tag) && b.idL !== null && Math.abs(b.idL) > 1) {
      push('H2', b, b.idL, `text starts ${r2(b.idL)} from the column's left edge (box ${r2(b.dL)})`);
    }
    const pastL = Math.max(0, floorL - b.l - 0.5);
    const pastR = Math.max(0, b.r - floorR - 0.5);
    if (pastL > 0 || pastR > 0) push('H5', b, Math.max(pastL, pastR), `box passes the gutter floor by ${r2(pastL)} left, ${r2(pastR)} right at depth ${b.depth}`);
    else if (b.iL !== null && !b.scroll && (b.iL < -0.5 || b.iR > cw + 0.5)) push('H5', b, Math.max(-b.iL, b.iR - cw), 'ink is outside the window (clipped)');
  }
  for (const m of marks) {
    const past = floorL - m.left;
    if (past > 0.5) offenders.push({ h: 'H3', k: `${m.type}@${m.owner}`, tag: m.type, depth: 0, s: Number(m.owner ?? -1), e: -1, metric: r2(past), why: `${m.type} hangs ${r2(m.hang)} left of the column; its left edge is ${r2(m.left)} (gutter floor ${r2(floorL)}${m.left < 0 ? ', clipped' : ''})`, top: null, l: m.left, r: m.left, bh: 0 });
  }
  for (const lo of lineOffenders) offenders.push({ h: 'H4', k: lo.k, tag: 'p.set-line', depth: 0, s: lo.s, e: lo.e, metric: r2(lo.over), why: `a set line runs ${r2(lo.over)} past its paragraph's content box (hung hyphens and punctuation not counted)`, top: lo.top, l: lo.l, r: lo.r, bh: lo.h });

  // Aggregates per kind (the full block list is kept only at the reference cells).
  const kinds = {};
  for (const b of blocks) {
    const k = kinds[b.tag] ?? (kinds[b.tag] = { n: 0, nested: 0, dLmin: Infinity, dLmax: -Infinity, dRmin: Infinity, dRmax: -Infinity, idLmin: Infinity, idLmax: -Infinity, idRmin: Infinity, idRmax: -Infinity, scrolling: 0, hBarMax: 0, padBmax: 0 });
    k.n++;
    if (b.depth > 0) k.nested++;
    k.dLmin = Math.min(k.dLmin, b.dL);
    k.dLmax = Math.max(k.dLmax, b.dL);
    k.dRmin = Math.min(k.dRmin, b.dR);
    k.dRmax = Math.max(k.dRmax, b.dR);
    if (b.idL !== null) {
      k.idLmin = Math.min(k.idLmin, b.idL);
      k.idLmax = Math.max(k.idLmax, b.idL);
      k.idRmin = Math.min(k.idRmin, b.idR);
      k.idRmax = Math.max(k.idRmax, b.idR);
    }
    if (b.scroll) k.scrolling++;
    k.hBarMax = Math.max(k.hBarMax, b.hBar);
    k.padBmax = Math.max(k.padBmax, b.padB);
  }
  for (const k of Object.values(kinds)) for (const key of Object.keys(k)) if (typeof k[key] === 'number') k[key] = Number.isFinite(k[key]) ? r2(k[key]) : null;

  // Ink margins: body text (top-level paragraphs), all text, and all boxes, against the visible width.
  const inkOf = (pred) => {
    let l = Infinity;
    let r = -Infinity;
    for (const b of blocks) if (b.iL !== null && pred(b)) {
      l = Math.min(l, b.iL);
      r = Math.max(r, b.iR);
    }
    // `reaches` says whether the ink spans the column: a document of two short paragraphs has no
    // right-hand ink edge to compare, so its asymmetry says nothing about the page.
    return Number.isFinite(l)
      ? { left: r2(l), right: r2(cw - r), asymmetry: r2(l - (cw - r)), reaches: l <= colL + 2 && r >= colR - 2 * unit }
      : null;
  };
  const boxes = blocks.length
    ? (() => {
        const l = Math.min(...blocks.map((b) => b.l));
        const r = Math.max(...blocks.map((b) => b.r));
        return { left: r2(l), right: r2(cw - r), asymmetry: r2(l - (cw - r)), reaches: l <= colL + 2 && r >= colR - 2 * unit };
      })()
    : null;

  // Notice region: mirror apps/desktop/index.html (#marxy-notices above the article, in the main).
  let notice = null;
  if (args.notice) {
    const main = document.getElementById('marxy-main');
    const topBefore = article.getBoundingClientRect().top + window.scrollY;
    const host = document.createElement('div');
    host.id = 'marxy-notices';
    host.setAttribute('role', 'status');
    host.innerHTML =
      '<div class="marxy-notice"><span class="marxy-notice-text">The file changed on disk.</span><button class="marxy-notice-action">Reload</button><button class="marxy-notice-dismiss">Dismiss</button></div>';
    main.prepend(host);
    void host.offsetHeight;
    const nb = host.firstElementChild.getBoundingClientRect();
    const hb = host.getBoundingClientRect();
    const ns = getComputedStyle(host.firstElementChild);
    const topAfter = article.getBoundingClientRect().top + window.scrollY;
    const nLine = parseFloat(ns.lineHeight);
    notice = {
      boxLeft: r2(nb.left),
      boxRight: r2(nb.right),
      boxVsColumnL: r2(nb.left - colL),
      boxVsColumnR: r2(nb.right - colR),
      regionPadLeft: r2(parseFloat(getComputedStyle(host).paddingLeft)),
      articleGutter: r2(padL),
      height: r2(nb.height),
      heightInGridUnits: r2(nb.height / unit),
      regionHeightInGridUnits: r2(hb.height / unit),
      lineHeightPx: r2(Number.isFinite(nLine) ? nLine : parseFloat(ns.fontSize) * 1.4),
      lineHeightInGridUnits: r2((Number.isFinite(nLine) ? nLine : parseFloat(ns.fontSize) * 1.4) / unit),
      pushesTextDown: r2(topAfter - topBefore),
      position: getComputedStyle(host).position,
      regionFontPx: r2(parseFloat(getComputedStyle(host).fontSize)),
      articleFontPx: r2(parseFloat(cs.fontSize)),
      regionColumnPx: r2(hb.width - parseFloat(getComputedStyle(host).paddingLeft) - parseFloat(getComputedStyle(host).paddingRight)),
      articleColumnPx: r2(colR - colL),
    };
    // Counterfactuals, so the cause is measured and not asserted: the same region with the article's font
    // size, and with the article's gutter as its side padding. Each is undone before anything else is read.
    const edgeWith = (css) => {
      host.style.cssText = css;
      void host.offsetHeight;
      const left = host.firstElementChild.getBoundingClientRect().left - colL;
      host.style.cssText = '';
      void host.offsetHeight;
      return r2(left);
    };
    notice.edgeIfRegionFontMatchedArticle = edgeWith(`font-size:${cs.fontSize}`);
    notice.edgeIfRegionPaddingMatchedArticle = edgeWith(`padding-left:${padL}px;padding-right:${padR}px`);
    const maxScroll = html.scrollHeight - window.innerHeight;
    if (maxScroll > 0) {
      window.scrollTo(0, Math.min(maxScroll, Math.round(window.innerHeight * 3)));
      notice.scrolledTo = r2(window.scrollY);
      notice.topWhenScrolled = r2(host.getBoundingClientRect().top);
      notice.inViewWhenScrolled = host.getBoundingClientRect().bottom > 0;
      window.scrollTo(0, 0);
    } else {
      notice.scrolledTo = 0;
      notice.topWhenScrolled = r2(hb.top);
      notice.inViewWhenScrolled = true;
    }
    if (args.keepNotice) {
      // Leave it in the page for an overlay, and move what was measured above it down with the text.
      for (const o of offenders) if (o.top !== null) o.top += notice.pushesTextDown;
    } else host.remove();
    if (Math.abs(notice.boxLeft - colL) > 1 || Math.abs(notice.boxRight - colR) > 1) {
      offenders.push({ h: 'H6', k: 'notice', tag: 'notice', depth: 0, s: -1, e: -1, metric: r2(Math.max(Math.abs(notice.boxLeft - colL), Math.abs(notice.boxRight - colR))), why: `notice box edges ${r2(nb.left - colL)} / ${r2(nb.right - colR)} from the column: #marxy-notices sizes its column in em at its own ${notice.regionFontPx}px font (the article's is ${notice.articleFontPx}px), so its column is ${notice.regionColumnPx}px against ${notice.articleColumnPx}px; with the article's font size the edge would be ${notice.edgeIfRegionFontMatchedArticle} off, with the article's gutter as side padding ${notice.edgeIfRegionPaddingMatchedArticle} off (region padding ${notice.regionPadLeft}px, article gutter ${notice.articleGutter}px: padding matters only where the window clamps the box)`, top: args.keepNotice ? hb.top + window.scrollY : topBefore, l: nb.left, r: nb.right, bh: nb.height });
    }
    if (notice.lineHeightInGridUnits % 1 !== 0 && Math.abs((notice.lineHeightInGridUnits % 1) - 0) > 0.001) {
      offenders.push({ h: 'H6', k: 'notice.line', tag: 'notice', depth: 0, s: -1, e: -1, metric: r2(notice.lineHeightPx), why: `notice line height ${notice.lineHeightPx}px is ${notice.lineHeightInGridUnits} grid units`, top: null, l: colL, r: colR, bh: 0 });
    }
  }

  const axisColumn = (colL + colR) / 2;
  const cell = {
    viewport: { vw, cw, scrollbar: vw - cw, scrollWidth: html.scrollWidth, hScroll: html.scrollWidth > cw + 1, docHeight: r2(html.scrollHeight) },
    column: { left: r2(colL), right: r2(colR), width: r2(colR - colL), articleLeft: r2(ar.left), articleRight: r2(ar.right), gutter: r2(gutter), room: r2(room), unit: r2(unit), roomLimitRight: r2(colR + room), roomLimitLeft: r2(colL - room) },
    centre: {
      windowAxis: r2(vw / 2),
      clientAxis: r2(cw / 2),
      columnAxis: r2(axisColumn),
      offsetFromWindow: r2(axisColumn - vw / 2),
      offsetFromClient: r2(axisColumn - cw / 2),
    },
    margins: { bodyInk: inkOf((b) => b.tag === 'p' && b.depth === 0), pageInk: inkOf(() => true), pageBoxes: boxes },
    lines: { ...lineStats, maxOverflow: r2(lineStats.maxOverflow), maxHungPastPx: r2(lineStats.maxHungPastPx) },
    notice,
    blocksMeasured: blocks.length,
    marks: marks.length
      ? Object.fromEntries(
          [...new Set(marks.map((m) => m.type))].sort().map((t) => {
            const ms = marks.filter((m) => m.type === t);
            return [t, { n: ms.length, maxHang: r2(Math.max(...ms.map((m) => m.hang))), minLeft: r2(Math.min(...ms.map((m) => m.left))) }];
          }),
        )
      : {},
    kinds,
    offenders,
  };
  if (args.blocks) {
    cell.blocks = blocks.map((b) => [b.k, b.tag, b.depth, r2(b.l), r2(b.r), r2(b.dL), r2(b.dR), b.iL === null ? null : r2(b.iL), b.iR === null ? null : r2(b.iR), b.idL === null ? null : r2(b.idL), b.scroll ? 1 : 0, r2(b.hBar)]);
  }
  return cell;
}

// ---------------------------------------------------------------------------------------------
// The rules, as the aesthetics gate holds them (L-02). Each reads what measureInPage returned (with
// `blocks: true`) and names what fails; the gate imports these and keeps no copy of them.
// ---------------------------------------------------------------------------------------------

/** Top-level blocks whose text is held to the column's left edge (the screen criterion's "Edges"). */
export const EDGE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'table', 'blockquote', 'ul', 'ol', 'dl', 'dl.front', 'p>img', 'figure', 'footnotes']);
const BLOCK_AT = { tag: 1, depth: 2, l: 3, r: 4, dL: 5, dR: 6, iL: 7, iR: 8, idL: 9, scroll: 10 };

/**
 * Judge one measured cell against rules 1 to 4 of the screen criterion. Returns `{ check, sub, detail }`
 * for every failure; `check` is the gate's check (centred, blockEdges, room, marks, noClip) and `sub` the
 * kind of block or mark at fault, so an expected failure can name exactly the case it defers.
 */
export function geometryFailures(cell, { classic: _classic = false } = {}) {
  const out = [];
  const add = (check, sub, detail) => out.push({ check, sub, detail });
  const r2 = (n) => Math.round(n * 100) / 100;
  const { column: col, viewport: vp } = cell;
  const at = (b, f) => b[BLOCK_AT[f]];

  // 1. Centre: the column's axis is the axis of what the reader sees (the window less a classic
  // scrollbar).
  const off = cell.centre.offsetFromClient;
  if (Math.abs(off) > 0.5) add('centred', 'axis', `the column's axis is ${off}px from the visible area's axis`);
  // The ink half of this rule is gone: it applied only when the longest ragged line ended within 1px of
  // the column's right edge, which depends on the font renderer (L-02 return). The axis above and the
  // blockEdges check (ink against the column's left edge) hold what it was meant to.

  for (const b of cell.blocks ?? []) {
    const tag = at(b, 'tag');
    const depth = at(b, 'depth');
    const label = `${b[0]} (${tag}, depth ${depth})`;
    // 2. Edges: top-level text starts on the column's left edge, but for the declared hangs.
    const idL = at(b, 'idL');
    if (depth === 0 && EDGE_TAGS.has(tag) && idL !== null && Math.abs(idL) > 1) {
      const grown = (tag === 'pre' || tag === 'table') && at(b, 'dL') < -1; // a wide block grown about the axis
      const indented = tag === 'blockquote' && idL > 0; // a blockquote's declared indent
      if (tag !== 'p>img' && !grown && !indented) {
        add('blockEdges', tag === 'pre' ? 'code' : tag, `${label}: text starts ${idL}px from the column's left edge`);
      }
    }
    // 3. Room: no box past the column plus the room, at any depth, and wide boxes grow evenly.
    const pastL = col.roomLimitLeft - at(b, 'l');
    const pastR = at(b, 'r') - col.roomLimitRight;
    if (pastL > 0.5 || pastR > 0.5) add('room', 'limit', `${label}: box passes the room by ${r2(Math.max(pastL, pastR))}px`);
    const overL = Math.max(0, col.left - at(b, 'l'));
    const overR = Math.max(0, at(b, 'r') - col.right);
    if (Math.abs(overR - overL) > 1) add('room', 'even', `${label}: box overhangs the column ${r2(overL)}px left and ${r2(overR)}px right`);
    // 3. No ink cut off by the window (a box that scrolls on its own is not cut off).
    const iL = at(b, 'iL');
    const iR = at(b, 'iR');
    if (iL !== null && !at(b, 'scroll') && (iL < -0.5 || iR > vp.cw + 0.5)) add('noClip', 'ink', `${label}: ink is cut off by the window`);
  }

  // 3. No mark left of the gutter floor but hung punctuation, and none outside the window.
  for (const [type, m] of Object.entries(cell.marks)) {
    if (type === 'punct') continue;
    if (m.minLeft < col.gutter - 0.5) add('marks', type, `a ${type} sits at ${m.minLeft}px, left of the gutter floor (${col.gutter}px)`);
  }

  // 4. The page never scrolls sideways.
  if (vp.hScroll) add('noClip', 'scroll', `the page scrolls sideways (${vp.scrollWidth}px of content in ${vp.cw}px)`);
  // 4. Once the relayout has settled, no set line runs past its paragraph's box.
  if (cell.lines.overflowing > 0) add('noClip', 'line', `${cell.lines.overflowing} set line(s) run up to ${cell.lines.maxOverflow}px past their paragraph's box`);
  return out;
}

/**
 * Rule 5, measured on the app's own `#marxy-notices` region: one line built the way notify() builds it,
 * its box against the column, whether it is in view three screens down, and its height in grid units.
 * Serialised into the page. The line is removed again, so the region is empty as before.
 */
export function measureNoticeInPage(args = {}) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const region = document.getElementById('marxy-notices');
  const article = document.getElementById('doc');
  const html = document.documentElement;
  if (!region) return { missing: true };
  const cs = getComputedStyle(article);
  const ar = article.getBoundingClientRect();
  const colL = ar.left + parseFloat(cs.paddingLeft);
  const colR = ar.right - parseFloat(cs.paddingRight);
  const unit = parseFloat(cs.lineHeight) / 2;
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  line.dataset.noticeKind = 'info';
  const text = document.createElement('span');
  text.className = 'marxy-notice-text';
  text.textContent = 'The file changed on disk.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'marxy-notice-dismiss';
  dismiss.textContent = 'Dismiss';
  line.append(text, dismiss);
  region.append(line);
  void region.offsetHeight;
  const box = line.getBoundingClientRect();
  if (args.source) {
    // Source mode: the notice must not sit on the editor's first line of text.
    const first = document.querySelector('#marxy-source .cm-content .cm-line');
    const text = first?.getBoundingClientRect();
    const covers = Boolean(text) && box.left < text.right && box.right > text.left && box.top < text.bottom && box.bottom > text.top;
    line.remove();
    return { missing: !text, source: true, covers, noticeTop: r2(box.top), noticeBottom: r2(box.bottom), textTop: text ? r2(text.top) : null };
  }
  const out = {
    missing: false,
    edgeL: r2(box.left - colL),
    edgeR: r2(box.right - colR),
    heightInUnits: r2(box.height / unit),
    position: getComputedStyle(region).position,
  };
  const maxScroll = html.scrollHeight - window.innerHeight;
  out.scrollable = maxScroll > 0;
  if (maxScroll > 0) {
    window.scrollTo(0, Math.min(maxScroll, Math.round(window.innerHeight * 3)));
    const b = line.getBoundingClientRect();
    out.inViewScrolled = b.bottom > 0 && b.top < window.innerHeight;
    out.topScrolled = r2(b.top);
    window.scrollTo(0, 0);
  } else out.inViewScrolled = true;
  line.remove();
  return out;
}

/** Rule 5 against one `measureNoticeInPage` reading. */
export function noticeFailures(n) {
  if (n.missing) return [{ check: 'noticeColumn', sub: 'region', detail: 'the app has no #marxy-notices region, or Source has no first line' }];
  const out = [];
  const add = (sub, detail) => out.push({ check: 'noticeColumn', sub, detail });
  if (n.source) {
    if (n.covers) add('source', `in Source the notice (${n.noticeTop} to ${n.noticeBottom}px) covers the first line of text (from ${n.textTop}px)`);
    return out;
  }
  if (Math.abs(n.edgeL) > 1 || Math.abs(n.edgeR) > 1) add('edges', `the notice's edges are ${n.edgeL}px and ${n.edgeR}px from the column's`);
  if (!n.inViewScrolled) add('sight', `scrolled down, the notice is at ${n.topScrolled}px and out of view`);
  const off = Math.abs(n.heightInUnits - Math.round(n.heightInUnits));
  if (off > 0.05) add('grid', `the notice is ${n.heightInUnits} grid units high`);
  return out;
}

/**
 * Rule 6, read in the page: clipping, set lines past their box, blocks overlapping, sideways scroll. Used
 * with WCAG 1.4.12 text spacing and at 200 % text.
 */
export function surveyInPage() {
  const a = document.getElementById('doc');
  const html = document.documentElement;
  const r = (n) => Math.round(n * 100) / 100;
  const hid = (v) => v === 'hidden' || v === 'clip';
  const clipped = [];
  for (const el of a.querySelectorAll('*')) {
    if (el.closest('.marxy-line-omitted, .marxy-invisible')) continue;
    const cs = getComputedStyle(el);
    if ((hid(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hid(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)) {
      clipped.push(el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(' ')[0]}` : ''));
    }
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
      if (!n.nodeValue.trim() || n.parentElement.closest('.marxy-hang, .marxy-hyphen')) continue;
      range.selectNodeContents(n);
      for (const rc of range.getClientRects()) if (rc.width) m = Math.max(m, rc.right);
    }
    if (m > right + 0.5) {
      over++;
      maxOver = Math.max(maxOver, m - right);
    }
  }
  let overlaps = 0;
  // Block-level children only: an inline element of raw HTML (a badge, a link) sits on a line of its own.
  const BLOCKS = ['block', 'table', 'list-item', 'flow-root', 'grid', 'flex'];
  const kids = [...a.children].filter((e) => e.getBoundingClientRect().height > 0 && BLOCKS.includes(getComputedStyle(e).display));
  for (let i = 1; i < kids.length; i++) if (kids[i].getBoundingClientRect().top < kids[i - 1].getBoundingClientRect().bottom - 1) overlaps++;
  return {
    hScroll: html.scrollWidth > html.clientWidth + 1,
    clipped: [...new Set(clipped)].sort(),
    setLinesPastBox: over,
    maxSetLinePastBoxPx: r(maxOver),
    blockOverlaps: overlaps,
    bodyFontPx: parseFloat(getComputedStyle(a).fontSize),
    // What the page actually computes for a paragraph, so the checks can prove their condition was applied.
    spacing: (() => {
      const p = a.querySelector('p');
      const cs = getComputedStyle(p ?? a);
      return {
        fontPx: parseFloat(cs.fontSize),
        letterPx: parseFloat(cs.letterSpacing),
        wordPx: parseFloat(cs.wordSpacing),
        lineHeightPx: parseFloat(cs.lineHeight),
        marginBottomPx: p ? parseFloat(cs.marginBottom) : null,
      };
    })(),
  };
}

/** Rule 6 against one `surveyInPage` reading. */
export function surveyFailures(s) {
  const out = [];
  if (s.hScroll) out.push('the page scrolls sideways');
  if (s.clipped.length) out.push(`clipped: ${s.clipped.slice(0, 6).join(', ')}`);
  if (s.setLinesPastBox) out.push(`${s.setLinesPastBox} set line(s) run up to ${s.maxSetLinePastBoxPx}px past their box`);
  if (s.blockOverlaps) out.push(`${s.blockOverlaps} block(s) overlap the one above`);
  return out;
}

/**
 * The WCAG 1.4.12 text-spacing conditions, read from the computed style of a paragraph: line height 1.5,
 * paragraph spacing 2, letter spacing 0.12 and word spacing 0.16, all times the font size. A check that
 * passes with these not applied proves nothing, so the check asserts them first.
 */
export function spacingAppliedFailures(s) {
  const { fontPx: f, letterPx, wordPx, lineHeightPx, marginBottomPx } = s.spacing;
  const out = [];
  const near = (v, want) => Number.isFinite(v) && Math.abs(v - want) <= 0.5;
  if (!near(letterPx, 0.12 * f)) out.push(`letter-spacing is ${letterPx}px, not ${0.12 * f}px (0.12 x ${f}px): the text-spacing overrides were not applied`);
  if (!near(wordPx, 0.16 * f)) out.push(`word-spacing is ${wordPx}px, not ${0.16 * f}px (0.16 x ${f}px): the text-spacing overrides were not applied`);
  if (!(lineHeightPx >= 1.5 * f - 0.5)) out.push(`line-height is ${lineHeightPx}px, under 1.5 x ${f}px`);
  if (marginBottomPx !== null && !(marginBottomPx >= 2 * f - 0.5)) out.push(`paragraph spacing is ${marginBottomPx}px, under 2 x ${f}px`);
  return out;
}

/** The 200 % condition: body text is `want` px (twice the default size), not whatever the page happened to use. */
export function text200AppliedFailures(s, want) {
  return s.bodyFontPx === want ? [] : [`body text is ${s.bodyFontPx}px, not ${want}px (200 %): the size was not applied`];
}

/** The four WCAG 1.4.12 overrides, as a reader theme: the typesetter sets with them. */
export const TEXT_SPACING_CSS = `.marxy-article, .marxy-article * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
.marxy-article p { margin-bottom: 2em !important; }`;

/** Draw hairlines (window centre, column edges, gutter floors, room limits) and red boxes for offenders. */
export function drawOverlayInPage(args) {
  const { cell, only, onlyH } = args;
  const old = document.getElementById('probe-overlay');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'probe-overlay';
  wrap.style.cssText = `position:absolute;left:0;top:0;width:${cell.viewport.cw}px;height:${cell.viewport.docHeight}px;pointer-events:none;z-index:99999;font:11px/1 system-ui,sans-serif`;
  const line = (x, color, dash, label) => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;top:0;bottom:0;left:${x}px;width:0;border-left:1px ${dash ? 'dashed' : 'solid'} ${color}`;
    const t = document.createElement('div');
    t.textContent = label;
    t.style.cssText = `position:absolute;top:0;left:2px;color:${color};white-space:nowrap;background:rgba(0,0,0,.6);padding:1px 2px`;
    d.append(t);
    wrap.append(d);
  };
  const c = cell.column;
  line(cell.centre.windowAxis, '#00e5ff', false, 'window');
  line(c.left, '#3ddc84', false, 'col L');
  line(c.right, '#3ddc84', false, 'col R');
  line(c.gutter, '#ffd400', true, 'gutter');
  line(cell.viewport.cw - c.gutter, '#ffd400', true, 'gutter');
  if (c.room > 0) {
    line(c.roomLimitLeft, '#ff4fd8', true, 'room');
    line(c.roomLimitRight, '#ff4fd8', true, 'room');
  }
  for (const o of cell.offenders) {
    if (o.top === null || (only && o.k !== only.k) || (onlyH && o.h !== onlyH)) continue;
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;left:${o.l}px;top:${o.top}px;width:${Math.max(2, o.r - o.l)}px;height:${Math.max(2, o.bh)}px;outline:2px solid #ff2d2d;outline-offset:-1px`;
    const t = document.createElement('div');
    t.textContent = `${o.h} ${o.tag} ${o.metric}`;
    t.style.cssText = 'position:absolute;right:0;top:-12px;color:#fff;background:#d00;padding:1px 3px;white-space:nowrap';
    b.append(t);
    wrap.append(b);
  }
  document.body.append(wrap);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Harness: the render entry, a static server, one cell, the matrix.
// ---------------------------------------------------------------------------------------------

/** Read-only copy of scripts/gate-aesthetics.mjs buildRenderEntry (the gate does not export it). */
export async function buildRenderEntry() {
  const require = createRequire(join(desktop, 'package.json'));
  const { build } = require('vite');
  await build({
    root: desktop,
    configFile: join(desktop, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir: dist(), emptyOutDir: true },
    plugins: [
      {
        name: 'marxy-gate-input',
        config(config) {
          config.build.rollupOptions.input = { gate: join(desktop, 'gate.html') };
        },
      },
    ],
  });
  if (!existsSync(join(dist(), 'gate.html'))) throw new Error(`vite build did not write ${join(dist(), 'gate.html')}`);
}

/** Serves the built harness, `/` as gate.html, and the corpus image beside it so `image.png` resolves. */
export function startHarness() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.png': 'image/png',
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const send = (code, type, body) => {
      res.statusCode = code;
      res.setHeader('Content-Type', type);
      res.end(body);
    };
    if (path === '/image.png') return send(200, 'image/png', readFileSync(join(corpusDir, 'image.png')));
    const file = path === '/' ? join(dist(), 'gate.html') : join(dist(), path.slice(1));
    if (!file.startsWith(dist()) || !existsSync(file) || !statSync(file).isFile()) return send(404, 'text/plain', 'not found');
    return send(200, types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream', readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

export const CLASSIC_CSS = `html::-webkit-scrollbar{width:${CLASSIC_SCROLLBAR_PX}px;height:${CLASSIC_SCROLLBAR_PX}px}html::-webkit-scrollbar-thumb{background:#888}html::-webkit-scrollbar-track{background:#333}
#doc table::-webkit-scrollbar,#doc pre::-webkit-scrollbar{height:${CLASSIC_SCROLLBAR_PX}px;width:${CLASSIC_SCROLLBAR_PX}px}`;

/**
 * Render `source` at one matrix cell and measure it. `classic` models a scrollbar that appears after
 * first text: the page is typeset overlay-wide, then the scrollbar is injected and the main is left to
 * reflow (H4). Set lines are read once, as that reflow leaves them, two frames after the scrollbar shows.
 * The app re-sets paragraphs 100 ms after the article's clientWidth changes (apps/desktop/src/app.ts), so
 * the lines read are the ones before that relayout: how far the overflow reaches, not how long it shows.
 */
export async function probeCell(page, origin, source, cell, opts = {}) {
  await page.goto(`${origin}/gate.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.marxyGate?.render === 'function');
  await page.evaluate(async ({ source, o }) => window.marxyGate.render(source, o), {
    source,
    o: { variant: cell.variant, width: cell.width, size: cell.size },
  });
  // The app's main is a block that fills the window; the harness fixes its width. Release it.
  await page.evaluate(() => {
    document.getElementById('marxy-main').style.width = '';
  });
  await settle(page);
  const out = {};
  if (cell.scrollbar === 'classic') {
    await page.addStyleTag({ content: CLASSIC_CSS });
    // WebKit re-reads a viewport scrollbar style only when the root's overflow changes; toggling it is
    // what a scrollbar appearing on its own (content growing past the window) amounts to.
    await page.evaluate(() => {
      const el = document.documentElement;
      el.style.overflowY = 'hidden';
      void el.offsetHeight;
      el.style.overflowY = '';
      void el.offsetHeight;
    });
    await settle(page);
  }
  out.cell = await page.evaluate(measureInPage, { blocks: Boolean(opts.blocks), notice: true, keepNotice: Boolean(opts.keepNotice) });
  return out;
}

export async function settle(page) {
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))));
}

/**
 * A classic scrollbar that appears after first text, as probeCell injects it: the main is released to
 * the window, the scrollbar is forced, and the root's overflow is toggled so WebKit re-reads it.
 */
export async function injectClassicScrollbar(page) {
  await page.evaluate(() => {
    document.getElementById('marxy-main').style.width = '';
  });
  await settle(page);
  await page.addStyleTag({ content: CLASSIC_CSS });
  await page.evaluate(() => {
    const el = document.documentElement;
    el.style.overflowY = 'hidden';
    void el.offsetHeight;
    el.style.overflowY = '';
    void el.offsetHeight;
  });
  await settle(page);
}

/** Screenshot a clip of the page with the overlay drawn; returns { png, clip }. */
export async function overlayShot(page, cell, { focus = null, height = 900, onlyH = null } = {}) {
  await page.evaluate(drawOverlayInPage, { cell, only: null, onlyH });
  const docH = Math.ceil(cell.viewport.docHeight);
  const worst = focus ?? cell.offenders.filter((o) => o.top !== null && o.h !== 'H4').sort((a, b) => b.metric - a.metric || a.top - b.top)[0] ?? null;
  let y = worst ? Math.round(worst.top - height / 3) : 0;
  y = Math.max(0, Math.min(y, Math.max(0, docH - height)));
  const clip = { x: 0, y, width: cell.viewport.cw, height: Math.min(height, Math.max(1, docH - y)) };
  const png = await page.screenshot({ fullPage: true, clip, type: 'png' });
  return { png, clip };
}

// ---------------------------------------------------------------------------------------------
// Static facts: what the source says, with file:line, for the hypotheses a render cannot see.
// ---------------------------------------------------------------------------------------------

function grepLines(file, re) {
  const path = join(root, file);
  if (!existsSync(path)) return [];
  const out = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (re.test(line)) out.push({ at: `${file}:${i + 1}`, text: line.trim().slice(0, 160) });
    });
  return out;
}
function grepTree(dir, re, ext = /\.(ts|mjs|css|html)$/) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(join(root, d)).sort()) {
      const rel = `${d}/${n}`;
      const st = statSync(join(root, rel));
      if (st.isDirectory()) walk(rel);
      else if (ext.test(n)) out.push(...grepLines(rel, re));
    }
  };
  if (existsSync(join(root, dir))) walk(dir);
  return out;
}

const NOTICE = ['marxy', 'notice'].join('-');

export function staticFacts() {
  const notNotices = (hits) => hits.filter((h) => !h.at.startsWith('apps/desktop/src/notices/index.ts'));
  return {
    H1: {
      preMaxWidth: grepLines('packages/theme/src/base.css', /^\s*max-width: min\(calc\(100% \+ var\(--marxy-room\)\)/),
      tableMaxWidth: grepLines('packages/theme/src/base.css', /^\s*max-width: calc\(100% \+ var\(--marxy-room\)\)/),
      roomToken: grepLines('packages/theme/src/base.css', /--marxy-room:/),
    },
    H3: {
      gutterFloors: grepLines('packages/theme/src/base.css', /--marxy-gutter: \d+px/),
      olHang: grepLines('packages/theme/src/base.css', /margin-inline: -2\.25em/),
      checkboxHang: grepLines('packages/theme/src/base.css', /margin: 0 0\.5em 0 -1\.25em/),
    },
    H6: {
      noticeRegionPadding: grepLines('packages/theme/src/base.css', /padding: calc\(var\(--marxy-line-box\) \/ 2\) 3rem 0/),
      noticeLineHeight: grepLines('packages/theme/src/base.css', /^\s*line-height: 1\.4;/),
      sourceModeFixed: grepLines('apps/desktop/index.html', /marxy-mode="source"\] #marxy-notices \{ position: fixed/),
      adHocBuilders: notNotices(grepTree('apps/desktop/src', new RegExp(`classList\\.add\\(['"]${NOTICE}['"]|className = ['"]${NOTICE}|class="${NOTICE}|'${NOTICE}'`))).map((h) => h),
      notifyCallers: grepTree('apps/desktop/src', /\bnotify\(/).length,
    },
    H7: {
      syntaxHighlighting: grepTree('apps/desktop/src/source', /syntaxHighlighting|HighlightStyle/),
      contentPadding: grepLines('apps/desktop/src/source/theme-bridge.ts', /30px 60px|padding:/),
      activeLine: grepLines('apps/desktop/src/source/theme-bridge.ts', /cm-activeLine/),
      foldGutter: grepLines('apps/desktop/src/source/editor.ts', /foldGutter\(\)/),
      lineNumberStorage: grepLines('apps/desktop/src/source/line-numbers.ts', /sessionStorage\.(get|set)Item/),
      sourceMount: grepLines('apps/desktop/index.html', /#marxy-source:not\(\[hidden\]\)/),
      lineHeight: grepTree('apps/desktop/src/source', /lineHeight|line-height/),
      searchPanelStyle: grepTree('apps/desktop/src/source', /cm-panel|cm-search/),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------

export function corpusFiles() {
  return readdirSync(corpusDir).filter((f) => /^\d{2}-.+\.md$/.test(f)).sort();
}

export function cellsOf(opts) {
  const out = [];
  for (const width of opts.widths) {
    for (const size of opts.sizes) {
      for (const variant of opts.variants) {
        for (const scrollbar of opts.scrollbars) out.push({ width, size, variant, scrollbar });
      }
    }
  }
  return out;
}
export const cellId = (c) => `${c.width}x${c.size}-${c.variant}-${c.scrollbar}`;

async function pool(items, workers, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await task(items[i], i);
    }),
  );
  return out;
}

function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  const list = (name, dflt, num) => {
    const v = get(name);
    return v === null ? dflt : v.split(',').filter(Boolean).map((x) => (num ? Number(x) : x));
  };
  return {
    ref: get('--ref') ?? 'origin/main',
    out: get('--out') ?? join(root, 'docs/taste-review/2026-10-layout-audit'),
    files: list('--files', null, false),
    widths: list('--widths', DEFAULTS.widths, true),
    sizes: list('--sizes', DEFAULTS.sizes, true),
    variants: list('--variants', DEFAULTS.variants, false),
    scrollbars: list('--scrollbars', DEFAULTS.scrollbars, false),
    workers: Number(get('--workers')) || Math.min(4, Math.max(1, cpus().length)),
    png: !argv.includes('--no-png'),
    overlaysDir: get('--overlays-dir'),
  };
}

function refSha(ref) {
  const r = spawnSync('git', ['rev-parse', '--short=12', ref], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const prefer = (c) => (c.endsWith('-dark-overlay') ? 0 : 1) + (c.startsWith('960x') ? 0 : 0.5);
const rank = (a, b) => b.metric - a.metric || prefer(a.cell) - prefer(b.cell) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.cell.localeCompare(b.cell) || a.s - b.s || (a.k < b.k ? -1 : 1);

/** Global rankings: worst blocks per hypothesis across the whole matrix, deduplicated by block (worst cell kept). */
export function rankOffenders(results, topN = 25) {
  const byH = {};
  for (const h of HYPOTHESES) byH[h] = new Map();
  for (const { file, id, cell } of results) {
    for (const o of cell.offenders) {
      // A notice is the same in every document: rank it once per cell, not once per file.
      const f = o.tag === 'notice' ? ANY_DOC : file;
      const key = `${f}|${o.k}|${o.tag}|${o.tag === 'notice' ? id : ''}`;
      const rec = { file: f, cell: id, h: o.h, k: o.k, tag: o.tag, depth: o.depth, s: o.s, e: o.e, metric: Math.abs(o.metric ?? 0), signed: o.metric, why: o.why };
      const cur = byH[o.h].get(key);
      if (!cur || rank(rec, cur) < 0) byH[o.h].set(key, rec);
    }
  }
  const out = {};
  for (const h of HYPOTHESES) {
    // At most three per document and kind, so one document full of the same fault cannot fill the list.
    const seen = new Map();
    out[h] = [...byH[h].values()]
      .sort(rank)
      .filter((o) => {
        const key = `${o.file}|${o.tag}`;
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        return n <= 3;
      })
      .slice(0, topN);
  }
  return out;
}

/** The worst few per hypothesis and block kind, so a loud kind (a centred image in H2) cannot hide the rest. */
export function rankByKind(results, perKind = 3) {
  const out = {};
  for (const h of HYPOTHESES) {
    const byTag = new Map();
    for (const { file, id, cell } of results) {
      for (const o of cell.offenders) {
        if (o.h !== h) continue;
        const f = o.tag === 'notice' ? ANY_DOC : file;
        const rec = { file: f, cell: id, k: o.k, depth: o.depth, s: o.s, metric: Math.abs(o.metric ?? 0), signed: o.metric, why: o.why };
        const list = byTag.get(o.tag) ?? new Map();
        const key = `${f}|${o.k}`;
        const cur = list.get(key);
        if (!cur || rank({ ...rec, tag: o.tag }, { ...cur, tag: o.tag }) < 0) list.set(key, rec);
        byTag.set(o.tag, list);
      }
    }
    out[h] = Object.fromEntries([...byTag.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tag, m]) => [tag, { blocks: m.size, worst: [...m.values()].sort(rank).slice(0, perKind) }]));
  }
  return out;
}

/** Per-hypothesis headline numbers: the keys L-01 reads to confirm or kill each hypothesis. */
export function headlines(results, statics) {
  const refs = results.filter((r) => r.cell && r.size === 20 && r.variant === 'dark');
  const maxBy = (arr, f) => arr.reduce((m, x) => Math.max(m, f(x) ?? 0), 0);
  const withBlocks = (r, tags) => tags.some((t) => r.cell.kinds[t]);
  const out = { H1: {}, H2: {}, H3: {}, H4: {}, H5: {}, H6: {}, H7: {} };
  const o = refs.filter((r) => r.scrollbar === 'overlay');
  const c = refs.filter((r) => r.scrollbar === 'classic');
  const asym = (r) => (r.cell.margins.pageInk?.reaches ? Math.abs(r.cell.margins.pageInk.asymmetry) : 0);
  const wide = o.filter((r) => withBlocks(r, ['pre', 'table']) && r.cell.column.room > 0);
  out.H1 = {
    cellsMeasured: wide.length,
    cellsWithAsymmetricBlock: wide.filter((r) => r.cell.offenders.some((x) => x.h === 'H1')).length,
    maxBlockOverhangDifferencePx: r2(maxBy(o, (r) => Math.max(0, ...r.cell.offenders.filter((x) => x.h === 'H1').map((x) => Math.abs(x.metric))))),
    maxPageInkAsymmetryPx: r2(maxBy(o, asym)),
    maxBodyInkAsymmetryPx: r2(maxBy(o, (r) => (r.cell.margins.bodyInk?.reaches ? Math.abs(r.cell.margins.bodyInk.asymmetry) : 0))),
    bodyInkCellsThatReachTheColumn: o.filter((r) => r.cell.margins.bodyInk?.reaches).length,
    maxTableDRight: r2(maxBy(o, (r) => r.cell.kinds.table?.dRmax)),
    maxPreDRight: r2(maxBy(o, (r) => r.cell.kinds.pre?.dRmax)),
    minDLeftAnyWideBlock: r2(Math.min(0, ...o.map((r) => Math.min(r.cell.kinds.pre?.dLmin ?? 0, r.cell.kinds.table?.dLmin ?? 0)))),
  };
  out.H2 = {
    leftEdgePxByKind_960_20_dark: leftEdges(results.filter((r) => r.width === 960 && r.size === 20 && r.variant === 'dark' && r.scrollbar === 'overlay')),
    cellsWithEdgeOffender: o.filter((r) => r.cell.offenders.some((x) => x.h === 'H2')).length,
    cellsMeasured: o.length,
  };
  out.H3 = {
    maxMarkHangPx: r2(maxBy(o, (r) => Math.max(0, ...Object.values(r.cell.marks).map((m) => m.maxHang)))),
    maxOlMarkerHangPx: r2(maxBy(o, (r) => r.cell.marks['ol-marker']?.maxHang)),
    maxCheckboxHangPx: r2(maxBy(o, (r) => r.cell.marks.checkbox?.maxHang)),
    maxPunctuationHangPx: r2(maxBy(o, (r) => r.cell.marks.punct?.maxHang)),
    cellsWithMarkPastGutterFloor: o.filter((r) => r.cell.offenders.some((x) => x.h === 'H3')).length,
    cellsWithMarkClipped: o.filter((r) => Object.values(r.cell.marks).some((m) => m.minLeft < 0)).length,
    widestWindowWithOffender: Math.max(0, ...o.filter((r) => r.cell.offenders.some((x) => x.h === 'H3')).map((r) => r.width)),
  };
  const withSb = c.filter((r) => r.cell.viewport.scrollbar > 0);
  const shift = [];
  for (const cr of withSb) {
    const base = o.find((r) => r.file === cr.file && r.width === cr.width);
    if (base) shift.push(Math.abs(cr.cell.centre.columnAxis - base.cell.centre.columnAxis));
  }
  out.H4 = {
    note: 'Not errors: the column moving by half a classic scrollbar (maxColumnShiftPx, maxCentreOffsetFromWindowClassicPx) is what a classic scrollbar does, and maxCentreOffsetFromClientClassicPx 0 says the visible area stays centred. Set-line overflow is read as the 15 px scrollbar first reflows the page, before the app\'s own relayout (100 ms after clientWidth changes, apps/desktop/src/app.ts); the probe reads two frames after the scrollbar shows, so how long it shows is not measured. The typesetter\'s hung hyphens and punctuation are not counted (maxHungHyphenPastOverlayPx is their size, with no scrollbar).',
    classicCellsWithScrollbar: withSb.length,
    scrollbarPx: withSb[0]?.cell.viewport.scrollbar ?? null,
    maxColumnShiftPx: r2(Math.max(0, ...shift)),
    maxCentreOffsetFromWindowClassicPx: r2(maxBy(withSb, (r) => Math.abs(r.cell.centre.offsetFromWindow))),
    maxCentreOffsetFromWindowOverlayPx: r2(maxBy(o, (r) => Math.abs(r.cell.centre.offsetFromWindow))),
    maxCentreOffsetFromClientClassicPx: r2(maxBy(withSb, (r) => Math.abs(r.cell.centre.offsetFromClient))),
    cellsWithLinesOverflowingClassic: withSb.filter((r) => r.cell.lines.overflowing > 0).length,
    cellsWithLinesOverflowingOverlay: o.filter((r) => r.cell.lines.overflowing > 0).length,
    maxLineOverflowClassicPx: r2(maxBy(withSb, (r) => r.cell.lines.maxOverflow)),
    maxLineOverflowOverlayPx: r2(maxBy(o, (r) => r.cell.lines.maxOverflow)),
    maxHungHyphenPastOverlayPx: r2(maxBy(o, (r) => r.cell.lines.maxHungPastPx)),
    cellsWithHorizontalPageScroll: refs.filter((r) => r.cell.viewport.hScroll).length,
  };
  const nested = refs.flatMap((r) => r.cell.offenders.filter((x) => x.h === 'H5' && x.depth > 0));
  out.H5 = {
    note: 'Untested for nested tables: no table in the corpus sits inside a list or blockquote (nestedWideBlocksMeasured_960.table is 0), and the only nested pre are three in blockquotes of 24-issue-thread. nestedOffenders 0 means no sample, not that H5 is dead. Cell right padding and snapToGrid on scrolled tables are not measured. The two ranked H5 rows are classic-scrollbar clipping at 320 px, not the nested case.',
    cellsWithBlockPastGutterFloor: o.filter((r) => r.cell.offenders.some((x) => x.h === 'H5')).length,
    nestedOffenders: nested.length,
    maxPastFloorPx: r2(maxBy(o, (r) => Math.max(0, ...r.cell.offenders.filter((x) => x.h === 'H5').map((x) => x.metric)))),
    maxNestedPastFloorPx: r2(Math.max(0, ...nested.map((x) => x.metric))),
    nestedWideBlocksMeasured_960: { pre: nestedCount(o, 'pre'), table: nestedCount(o, 'table') },
    scrollingBlocks: o.reduce((n, r) => n + (r.cell.kinds.table?.scrolling ?? 0) + (r.cell.kinds.pre?.scrolling ?? 0), 0),
    classicHorizontalScrollbarMaxPx: r2(maxBy(c, (r) => r.cell.kinds.table?.hBarMax)),
  };
  const n960 = o.filter((r) => r.width === 960 && r.cell.notice).map((r) => r.cell.notice);
  const n320 = o.filter((r) => r.width === 320 && r.cell.notice).map((r) => r.cell.notice);
  const first = (arr) => arr[0] ?? null;
  out.H6 = {
    noticeEdgeVsColumnLeft_960: first(n960)?.boxVsColumnL ?? null,
    noticeEdgeVsColumnLeft_320: first(n320)?.boxVsColumnL ?? null,
    noticeRegionFontPxVsArticle_960: first(n960) ? [first(n960).regionFontPx, first(n960).articleFontPx] : null,
    noticeColumnPxVsArticle_960: first(n960) ? [first(n960).regionColumnPx, first(n960).articleColumnPx] : null,
    noticeEdgeIfRegionFontMatchedArticle_960: first(n960)?.edgeIfRegionFontMatchedArticle ?? null,
    noticeEdgeIfRegionPaddingMatchedArticle_960: first(n960)?.edgeIfRegionPaddingMatchedArticle ?? null,
    noticeRegionPadVsArticleGutter_320: first(n320) ? [first(n320).regionPadLeft, first(n320).articleGutter] : null,
    noticeEdgeIfRegionPaddingMatchedArticle_320: first(n320)?.edgeIfRegionPaddingMatchedArticle ?? null,
    noticeLineHeightInGridUnits: first(n960)?.lineHeightInGridUnits ?? null,
    noticeHeightInGridUnits: first(n960)?.heightInGridUnits ?? null,
    noticePushesTextDownPx: first(n960)?.pushesTextDown ?? null,
    cellsWhereNoticeIsOutOfViewWhenScrolled: o.filter((r) => r.cell.notice && r.cell.notice.inViewWhenScrolled === false).length,
    cellsMeasuredScrolled: o.filter((r) => r.cell.notice && r.cell.notice.scrolledTo > 0).length,
    sourceModeNoticeFixed: statics.H6.sourceModeFixed.length > 0,
    adHocNoticeBuilderFiles: new Set(statics.H6.adHocBuilders.map((h) => h.at.replace(/:\d+$/, ''))).size,
    adHocNoticeBuilderLines: statics.H6.adHocBuilders.length,
  };
  out.H7 = {
    note: 'Source mode is CodeMirror, not part of the render entry: these are static facts with file:line (see static.H7), measured by L-01 where it needs a render.',
    syntaxHighlightingReferences: statics.H7.syntaxHighlighting.length,
    contentPaddingRules: statics.H7.contentPadding.length,
    foldGutterAlwaysOn: statics.H7.foldGutter.length > 0,
    lineNumberChoiceInSessionStorage: statics.H7.lineNumberStorage.length > 0,
    searchPanelStyleRules: statics.H7.searchPanelStyle.length,
    sourceOverlayFixedFullWindow: statics.H7.sourceMount.length > 0,
  };
  return out;
}
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const nestedCount = (cells, tag) => cells.filter((r) => r.width === 960).reduce((n, r) => n + (r.cell.kinds[tag]?.nested ?? 0), 0);

function leftEdges(cells) {
  const acc = {};
  for (const r of cells) {
    for (const [tag, k] of Object.entries(r.cell.kinds)) {
      if (k.idLmin === null) continue;
      const a = (acc[tag] ??= { min: Infinity, max: -Infinity });
      a.min = Math.min(a.min, k.idLmin);
      a.max = Math.max(a.max, k.idLmax);
    }
  }
  return Object.fromEntries(Object.entries(acc).sort(([x], [y]) => (x < y ? -1 : 1)).map(([t, v]) => [t, { textLeftFromColumnMin: v.min, textLeftFromColumnMax: v.max }]));
}

export async function run(opts) {
  await buildRenderEntry();
  const browser = await launchWebkit();
  const harness = await startHarness();
  try {
    const files = (opts.files ?? corpusFiles()).slice().sort();
    const cells = cellsOf(opts);
    const tasks = files.flatMap((file) => cells.map((cell) => ({ file, cell })));
    const sources = new Map(files.map((f) => [f, readFileSync(join(corpusDir, f), 'utf8')]));
    const shots = new Map();
    const results = await pool(tasks, opts.workers, async ({ file, cell }) => {
      const page = await browser.newPage({ viewport: { width: cell.width, height: 900 } });
      try {
        const isRef = cell.size === REF.size && cell.variant === REF.variant && cell.scrollbar === REF.scrollbar;
        const out = await probeCell(page, harness.origin, sources.get(file), cell, { blocks: BLOCK_LIST_WIDTHS.has(cell.width) && cell.size === REF.size && cell.variant === REF.variant });
        if (opts.png && isRef) shots.set(`${file}|${cell.width}`, await overlayShot(page, out.cell));
        if (opts.overlaysDir && out.cell.offenders.some((o) => o.top !== null)) {
          mkdirSync(opts.overlaysDir, { recursive: true });
          writeFileSync(join(opts.overlaysDir, `${file.replace(/\.md$/, '')}-${cellId(cell)}.png`), (await overlayShot(page, out.cell)).png);
        }
        return { file, id: cellId(cell), ...cell, cell: out.cell };
      } catch (e) {
        return { file, id: cellId(cell), ...cell, error: String(e.message ?? e) };
      } finally {
        await page.close();
      }
    });
    return { files, cells, results, shots, browser, harness };
  } catch (e) {
    harness.close();
    await browser.close();
    throw e;
  }
}

/** Build probe.json's object (stable key order, no timestamps) from a run. */
/** The notice region does not depend on the document, only on the cell: one record per cell, from a long document. */
function noticesOf(ok, files) {
  const from = files.includes('01-long-technical.md') ? '01-long-technical.md' : files[0];
  return Object.fromEntries(ok.filter((r) => r.file === from && r.cell.notice).map((r) => [r.id, r.cell.notice]).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function assemble(opts, runResult) {
  const { files, cells, results } = runResult;
  const ok = results.filter((r) => !r.error);
  const statics = staticFacts();
  const docs = {};
  for (const r of ok) {
    (docs[r.file] ??= {})[r.id] = {
      viewport: r.cell.viewport,
      column: r.cell.column,
      centre: r.cell.centre,
      margins: r.cell.margins,
      lines: r.cell.lines,
      marks: r.cell.marks,
      kinds: r.cell.kinds,
      offenderCounts: Object.fromEntries(HYPOTHESES.map((h) => [h, r.cell.offenders.filter((o) => o.h === h).length]).filter(([, n]) => n > 0)),
      topOffenders: Object.fromEntries(
        HYPOTHESES.map((h) => [h, r.cell.offenders.filter((o) => o.h === h).sort((a, b) => Math.abs(b.metric) - Math.abs(a.metric) || a.s - b.s).slice(0, 1).map((o) => ({ k: o.k, tag: o.tag, depth: o.depth, metric: o.metric }))]).filter(([, a]) => a.length),
      ),
      ...(r.cell.blocks ? { blockFields: 'k,tag,depth,left,right,dL,dR,inkLeft,inkRight,inkDL,scrolls,hBarPx', blocks: r.cell.blocks } : {}),
    };
  }
  return {
    tool: 'scripts/probe-layout.mjs',
    ref: { name: opts.ref, sha: refSha(opts.ref), label: 'only a label: --ref does not select what is rendered' },
    tree: { rendered: 'the working tree this was run in', head: refSha('HEAD') },
    engine: process.platform === 'darwin' ? 'webkit-macos' : `webkit-${process.platform}`,
    matrix: { widths: opts.widths, sizes: opts.sizes, variants: opts.variants, scrollbars: opts.scrollbars, classicScrollbarPx: CLASSIC_SCROLLBAR_PX, cells: cells.length, documents: files.length, referenceCell: REF },
    definitions: {
      units: 'CSS px, rounded to 0.01. Every delta is from the column (the article content box); dR > 0 is past the right edge.',
      offsetFromWindow: 'column axis minus window axis (innerWidth / 2); offsetFromClient uses the width minus the scrollbar.',
      margins: 'left = leftmost ink edge from the window left; right = clientWidth minus rightmost ink edge; asymmetry = left - right. bodyInk = top-level paragraphs, pageInk = all text, pageBoxes = all block boxes.',
      classic: 'The page is set at the overlay width, then a 15px ::-webkit-scrollbar is injected (a scrollbar that appears after first text) and lines is read as that reflow leaves it, before the app\'s own relayout (100 ms after clientWidth changes; it is read two frames after the scrollbar shows, so nothing here says how long an overflow shows). Documents shorter than the window have scrollbar 0.',
      offenders: 'H1 box overhangs the column unequally; H2 top-level block text not on the column edge; H3 hung mark (ol marker, checkbox, hung punctuation) left of the gutter floor; H4 set line past its paragraph content box (the typesetter\'s hung hyphens and punctuation excluded, kept apart as lines.maxHungPastPx); H5 block box past the gutter floor at any depth (or ink outside the window); H6 notice edges / grid height. The probe states facts; L-01 judges them.',
    },
    errors: results.filter((r) => r.error).map((r) => ({ file: r.file, cell: r.id, error: r.error })),
    headlines: headlines(ok, statics),
    rankings: rankOffenders(ok),
    rankingsByKind: rankByKind(ok),
    rankingsAtReadingWidths: Object.fromEntries([960, 1280].map((w) => [`${w}x20-dark-overlay`, rankOffenders(ok.filter((r) => r.width === w && r.size === 20 && r.variant === 'dark' && r.scrollbar === 'overlay'), 10)])),
    static: statics,
    notices: noticesOf(ok, files),
    documents: Object.fromEntries(Object.entries(docs).sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, cellsOf]) => [f, Object.fromEntries(Object.entries(cellsOf).sort(([a], [b]) => (a < b ? -1 : 1)))])),
  };
}

// ---------------------------------------------------------------------------------------------
// Contact sheets and ranked overlays (PNG).
// ---------------------------------------------------------------------------------------------

async function writeContactSheets(browser, shots, files, widths, probe, outDir) {
  mkdirSync(join(outDir, 'contact-sheets'), { recursive: true });
  const written = [];
  for (const width of widths) {
    const tiles = files.filter((f) => shots.has(`${f}|${width}`));
    if (!tiles.length) continue;
    const cols = 6;
    const tileW = 300;
    const items = tiles
      .map((f) => {
        const { png } = shots.get(`${f}|${width}`);
        const counts = probe.documents[f]?.[`${width}x20-dark-overlay`]?.offenderCounts ?? {};
        const label = Object.entries(counts).map(([h, n]) => `${h}:${n}`).join(' ') || 'clean';
        return `<figure><div class="marxy-probe-im"><img src="data:image/png;base64,${png.toString('base64')}"></div><figcaption><b>${f.replace(/\.md$/, '')}</b><br>${label}</figcaption></figure>`;
      })
      .join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#111;color:#ddd;font:11px/1.3 system-ui,sans-serif;padding:10px}
      h1{font:600 14px system-ui;margin:0 0 8px}
      .marxy-probe-grid{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:8px}
      figure{margin:0}.marxy-probe-im{width:${tileW}px;height:360px;overflow:hidden;background:#000;border:1px solid #333}
      img{width:${tileW}px;display:block}figcaption{padding:2px 0}
    </style><h1>Width ${width}px, size 20, dark, overlay scrollbar. Lines: window centre cyan, column green, gutter floor yellow, room magenta; offenders red. Clip is centred on the worst offender (or the top).</h1><div class="marxy-probe-grid">${items}</div>`;
    const page = await browser.newPage({ viewport: { width: cols * (tileW + 8) + 12, height: 800 } });
    await page.setContent(html, { waitUntil: 'load' });
    const path = join(outDir, 'contact-sheets', `w${String(width).padStart(4, '0')}.jpg`);
    writeFileSync(path, await page.screenshot({ fullPage: true, type: 'jpeg', quality: 45 }));
    await page.close();
    written.push(path);
  }
  return written;
}

async function writeRankedOverlays(browser, harness, opts, probe, outDir, sources) {
  mkdirSync(join(outDir, 'overlays'), { recursive: true });
  const written = [];
  for (const h of HYPOTHESES) {
    const picked = [];
    for (const o of probe.rankings[h]) {
      if (picked.length >= 3) break;
      if (picked.some((p) => p.file === o.file)) continue;
      picked.push(o);
    }
    for (const o0 of picked) {
      const o = o0.file === ANY_DOC ? { ...o0, file: sources.has('01-long-technical.md') ? '01-long-technical.md' : [...sources.keys()][0] } : o0;
      const m = /^(\d+)x(\d+)-(dark|light)-(overlay|classic)$/.exec(o.cell);
      const cell = { width: Number(m[1]), size: Number(m[2]), variant: m[3], scrollbar: m[4] };
      const page = await browser.newPage({ viewport: { width: cell.width, height: 900 } });
      try {
        const out = await probeCell(page, harness.origin, sources.get(o.file), cell, { keepNotice: h === 'H6' });
        const focus = out.cell.offenders.find((x) => x.h === h && x.k === o.k) ?? null;
        const { png } = await overlayShot(page, out.cell, { focus, onlyH: h });
        const name = `${h}-${o.file.replace(/\.md$/, '')}-${o.cell}.png`;
        writeFileSync(join(outDir, 'overlays', name), png);
        written.push(name);
      } finally {
        await page.close();
      }
    }
  }
  return written;
}

const cellLabel = (id) => id.replace(/^(\d+)x(\d+)-(dark|light)-(overlay|classic)$/, '$1 px, $2 px type, $3, $4 scrollbar');

function table(rows, head) {
  const line = (r) => `| ${r.map((c) => String(c ?? '').replaceAll('|', '\\|')).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

/** README.md for the kit, written from probe.json alone so it can be regenerated without a run. */
export function readmeOf(probe, dir) {
  const H = probe.headlines;
  const list = (sub) => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort() : []);
  const hdr = {
    H1: 'H1. Wide blocks grow to one side only',
    H2: 'H2. Blocks use different left edges',
    H3: 'H3. Hanging marks are wider than the gutter floor',
    H4: 'H4. A classic scrollbar moves the centre and overflows set lines',
    H5: 'H5. Blocks pass the gutter floor (nested blocks, scrollbars)',
    H6: 'H6. Notices are off the column and out of sight',
  };
  const out = [];
  out.push(`# Layout audit, October 2026 (L-00)

A geometry probe over the corpus. It measures the page and states facts; it does not judge them. L-01
reads \`probe.json\`, confirms or kills H1 to H7 from it, and writes the findings. Hypotheses are in
\`docs/plan/roadmap-2026-10/07-layout-and-reading.md\`.

- Measured: the working tree at \`${probe.tree.head}\` (\`--ref\` is only a label and selects nothing; this run's label was \`${probe.ref.name}\`, which was \`${probe.ref.sha}\`), ${probe.engine}, ${probe.matrix.documents} documents x ${probe.matrix.cells} cells = ${probe.matrix.documents * probe.matrix.cells} renders.
- Matrix: widths ${probe.matrix.widths.join(', ')} px; sizes ${probe.matrix.sizes.join(', ')} px; ${probe.matrix.variants.join(' and ')}; scrollbars ${probe.matrix.scrollbars.join(' and ')} (classic is ${probe.matrix.classicScrollbarPx} px, forced with \`::-webkit-scrollbar\` to model WebKitGTK).
- Errors during the run: ${probe.errors.length}.

## Regenerate

\`\`\`bash
node scripts/probe-layout.mjs --ref origin/main                 # everything here; about 20 minutes
node scripts/probe-layout.mjs --out /tmp/probe --files 05-pathological-table-and-nesting.md --widths 320,960 --sizes 20 --variants dark
node scripts/probe-layout.mjs --readme-only                     # this file, from probe.json
node --test scripts/probe-layout.test.mjs                       # the negative controls and the determinism check
\`\`\`

The probe renders through the app harness the aesthetics gate uses (\`apps/desktop/gate.html\`). Two runs
over the same tree give an identical \`probe.json\` (no timestamps; numbers rounded to 0.01 px). The probe is not
in CI; L-02 promotes its rules into the gate.

## How to read it

Every number is CSS px. The column is the article's content box. \`dL\` and \`dR\` are a block's left and right box
edges from the column's, so a positive \`dR\` is past the right edge. \`offsetFromWindow\` is the column's axis minus the
window's; \`offsetFromClient\` uses the window minus the scrollbar. Margins are the leftmost ink edge from the window's
left, and the window's right edge (less the scrollbar) from the rightmost ink edge. An offender carries the hypothesis
it is evidence for and a metric in px; the rules are written out under \`definitions\` in \`probe.json\`.

## Headline numbers, per hypothesis

Taken over the size-20, dark cells (both scrollbar modes where the key says so). The keys are in \`probe.json\` under \`headlines\`.
`);
  for (const h of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']) {
    const rows = Object.entries(H[h])
      .filter(([k]) => k !== 'note')
      .map(([k, v]) => [`\`${k}\``, typeof v === 'object' && v !== null ? `\`${JSON.stringify(v)}\`` : v]);
    out.push(`### ${hdr[h] ?? 'H7. Source mode lacks the basics (static facts only)'}\n`);
    if (H[h].note) out.push(`${H[h].note}\n`);
    out.push(`${table(rows, ['key', 'value'])}\n`);
  }

  out.push('## Ranked offenders, by hypothesis\n');
  out.push('The worst blocks across the whole matrix, the worst block of each document and kind (the worst cell kept), by the size of the miss in px; `probe.json` keeps up to three per document and kind. `H4` here is set lines past their box in any cell, hung hyphens excluded.\n');
  for (const h of HYPOTHESES) {
    const seen = new Set();
    const rows = probe.rankings[h]
      .filter((o) => !seen.has(`${o.file}|${o.tag}`) && seen.add(`${o.file}|${o.tag}`))
      .slice(0, 10)
      .map((o, i) => [i + 1, o.file === ANY_DOC ? o.file : `\`${o.file}\``, cellLabel(o.cell), o.tag, o.depth, o.signed, o.e >= 0 ? `${o.s}-${o.e}` : '', o.why]);
    out.push(`### ${hdr[h]}\n`);
    out.push(rows.length ? `${table(rows, ['#', 'document', 'cell', 'kind', 'depth', 'px', 'bytes', 'what'])}\n` : 'No offenders in this matrix.\n');
  }

  out.push('## Ranked offenders at the cells a reader uses\n');
  out.push('The same ranking restricted to 960 px and 1280 px windows, 20 px type, dark, overlay scrollbar, so the order is not set by window width alone. Every row is at that cell.\n');
  for (const [cellId, byH] of Object.entries(probe.rankingsAtReadingWidths)) {
    out.push(`### ${cellLabel(cellId)}\n`);
    for (const h of HYPOTHESES) {
      const seen = new Set();
      const rows = (byH[h] ?? [])
        .filter((o) => !seen.has(`${o.file}|${o.tag}`) && seen.add(`${o.file}|${o.tag}`))
        .slice(0, 6)
        .map((o, i) => [i + 1, o.file === ANY_DOC ? o.file : `\`${o.file}\``, o.tag, o.depth, o.signed, o.e >= 0 ? `${o.s}-${o.e}` : '', o.why]);
      out.push(`#### ${h}\n`);
      out.push(rows.length ? `${table(rows, ['#', 'document', 'kind', 'depth', 'px', 'bytes', 'what'])}\n` : 'No offenders.\n');
    }
  }

  out.push('## Worst per block kind\n');
  out.push('So a loud kind (a centred image in H2) cannot hide the rest: the worst block of each kind, per hypothesis.\n');
  for (const h of HYPOTHESES) {
    const kinds = probe.rankingsByKind[h];
    const rows = Object.entries(kinds).map(([tag, v]) => {
      const w = v.worst[0];
      return [tag, v.blocks, w.file === ANY_DOC ? w.file : `\`${w.file}\``, cellLabel(w.cell), w.signed];
    });
    out.push(`### ${h}\n`);
    out.push(rows.length ? `${table(rows, ['kind', 'blocks affected', 'worst document', 'cell', 'px'])}\n` : 'None.\n');
  }

  out.push(`## The cases

The author has no list of observed errors (ruling of 2026-10-07). The ranked offenders above, per hypothesis, and
the worst-per-kind tables are the cases L-01 works from; each row names a document, a cell and a byte range, so it can be
reproduced with \`--files\`, \`--widths\` and \`--sizes\`.
`);

  out.push('## Static facts (H6, H7)\n');
  out.push('Read from the source tree with file and line; a render cannot show these. Source mode is CodeMirror and is not part of the render entry.\n');
  for (const [h, groups] of Object.entries(probe.static)) {
    out.push(`### ${h}\n`);
    for (const [name, hits] of Object.entries(groups)) {
      if (!Array.isArray(hits)) {
        out.push(`- \`${name}\`: ${hits}`);
        continue;
      }
      out.push(`- \`${name}\`: ${hits.length === 0 ? 'no match' : hits.slice(0, 6).map((x) => `\`${x.at}\``).join(', ') + (hits.length > 6 ? `, and ${hits.length - 6} more` : '')}`);
    }
    out.push('');
  }

  out.push(`## Files

- \`probe.json\`: every cell, per document: viewport, column, centre, margins, set lines, marks, per-kind aggregates, offender counts and the worst offender per hypothesis. The block lists (\`blocks\`, fields in \`blockFields\`) are kept at 320, 960 and 1600 px, size 20, dark only; the other cells keep aggregates. \`rankings\` and \`rankingsByKind\` are across the whole matrix; \`notices\` is the notice region per cell (it does not depend on the document).
- \`contact-sheets/\`: one per width, ${list('contact-sheets').length} files, every document at size 20, dark, overlay scrollbar, clipped around its worst offender (or the top). Hairlines: window centre cyan, column edges green, gutter floor yellow dashed, room limit magenta dashed; offenders in red.
- \`overlays/\`: ${list('overlays').length} full-size overlays, the top three documents for each hypothesis, in the worst cell.
- An overlay for every cell that has an offender is not committed (several hundred megabytes at this matrix); \`--overlays-dir DIR\` writes them, one \`<document>-<cell>.png\` each, for whatever \`--files\`, \`--widths\`, \`--sizes\`, \`--variants\` and \`--scrollbars\` select.

## What the probe does not do, and caveats

- It does not judge. A \`reaches: false\` margin means the document has no ink at the column's right edge, so that asymmetry says nothing.
- The harness fixes \`#marxy-main\` to the window width; the probe releases it after the render so the main fills the window as it does in the app. A classic scrollbar is injected after the page is set (a scrollbar that appears after first text), which is the H4 case; \`lines\` is read as that reflow leaves it, before the app's own relayout (100 ms after \`clientWidth\` changes, \`apps/desktop/src/app.ts\`). The probe reads two frames after the scrollbar shows, so it cannot say how long an overflow shows; L-01 must not read it as "relayout does not help". Hung hyphens and punctuation are not line overflow and are left out.
- H5 is untested for nested tables: the corpus has no table inside a list or blockquote, so \`nestedOffenders 0\` means no sample. L-01 should add one synthetic nested-table page.
- The classic-scrollbar column shift and centre offset from the window are what a classic scrollbar is; the visible area stays centred (\`offsetFromClient\` 0). They are not errors.
- \`--ref\` is a label only. The probe renders whatever tree it runs in; the Measured line says which.
- The notice is a synthetic region built the way \`apps/desktop/index.html\` builds it; the harness page has none.
- Light and dark can differ by sub-pixel type weight, so both are kept.
- Source mode, the palette and the outline are not rendered. H7 is static facts until L-01 probes it.
`);
  return out.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (argv.includes('--readme-only')) {
    const probe = JSON.parse(readFileSync(join(opts.out, 'probe.json'), 'utf8'));
    writeFileSync(join(opts.out, 'README.md'), readmeOf(probe, opts.out));
    console.log(`wrote ${join(opts.out, 'README.md')}`);
    return probe;
  }
  const t0 = Date.now();
  const rr = await run(opts);
  try {
    const probe = assemble(opts, rr);
    mkdirSync(opts.out, { recursive: true });
    writeFileSync(join(opts.out, 'probe.json'), `${JSON.stringify(probe)}\n`);
    const sources = new Map(rr.files.map((f) => [f, readFileSync(join(corpusDir, f), 'utf8')]));
    let sheets = [];
    let overlays = [];
    if (opts.png) {
      if (existsSync(join(opts.out, 'contact-sheets'))) rmSync(join(opts.out, 'contact-sheets'), { recursive: true });
      if (existsSync(join(opts.out, 'overlays'))) rmSync(join(opts.out, 'overlays'), { recursive: true });
      sheets = await writeContactSheets(rr.browser, rr.shots, rr.files, opts.widths, probe, opts.out);
      overlays = await writeRankedOverlays(rr.browser, rr.harness, opts, probe, opts.out, sources);
    }
    writeFileSync(join(opts.out, 'README.md'), readmeOf(probe, opts.out));
    console.log(`probe-layout: ${rr.results.length} cell renders (${rr.files.length} documents x ${rr.cells.length} cells), ${probe.errors.length} error(s), ${sheets.length} contact sheet(s), ${overlays.length} overlay(s), ${Math.round((Date.now() - t0) / 1000)}s`);
    console.log(`wrote ${join(opts.out, 'probe.json')}`);
    for (const e of probe.errors.slice(0, 5)) console.error(`  error: ${e.file} ${e.cell}: ${e.error}`);
    return probe;
  } finally {
    rr.harness.close();
    await rr.browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`probe-layout failed: ${e.stack || e.message}`);
    process.exit(1);
  });
}
