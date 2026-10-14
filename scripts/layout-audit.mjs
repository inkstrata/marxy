// X-32: the layout audit. Drives the full-app harness (Vite dev server over the memory shell, WebKit, headless) through
// every surface the card lists, at four widths and two heights in both variants, and flags every text node whose box
//   clipped      is cut mid-glyph by an overflow:hidden/clip ancestor,
//   spills       passes the border box of the block that owns it (visible overflow: text floating outside its box),
//   truncated    is ellipsised or line-clamped with no title or tooltip (a tab's path reveal counts) to reveal it,
//   overlap      lies over another text box (two different text nodes, both visible, neither covering the other),
//   covered      is drawn under an element that is not its own (the tooltip over the document),
//   outside      sits outside the window with no scroller to bring it back.
// Text a scroller has scrolled away is by design and is skipped. The allowlist below prunes what is intended, each entry
// with its reason; the entries tagged `known` are reported but belong to a card already boarded.
//   node scripts/layout-audit.mjs [--quick] [--only <surface|group,...>] [--theme night,paper] [--widths 800,1000,...]
//     [--heights 600,900] [--workers 6] [--shots <dir> [--shots-every]] [--json <file>] [--md <file>] [--pieces] [--fail] [--list]
// Each scene boots at the width under test (the sidebar and the inspector dock by the width at which the workspace first
// unfolds); `--fail` exits 1 on any defect not tagged `known`. Local tooling: a candidate gate (the report in
// docs/taste-review/2026-10-14-layout-audit/ says what it found and what it cannot see), not on the PR path yet.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = join(ROOT, 'docs/plan/direction-2026-10/mock-v2');

export const WIDTHS = [800, 1000, 1400, 1920];
export const HEIGHTS = [600, 900];
export const THEMES = [
  { id: 'night', scheme: 'dark' },
  { id: 'paper', scheme: 'light' },
];

/**
 * What is intended, pruned with its reason (and counted in the report, so a rule that starts hiding too much shows).
 * `kind` is a finding kind (or `*`), `within` matches the finding's element or an ancestor, `cover` matches the element
 * that covers it (for `covered`). An entry with `known: 'F-nn'` is not hidden: it is reported under that card and left out
 * of the count of new defects (none is needed now: the boarded cases F-97 to F-100 are not text-box defects at default
 * settings, or are drawn at states this sweep does not set).
 */
export const ALLOW = [
  { kind: 'covered', cover: 'dialog[open], dialog[open] *', why: 'A modal dialog (palette, transform sheet, settings sheet) covers the page under it by design.' },
  { kind: 'covered', cover: '[role="status"] *, [data-notice-kind], [data-notice-kind] *', why: 'A notice pill floats over the page by design (U-02).' },
  { kind: 'covered', cover: '.marxy-verb-menu, .marxy-verb-menu *, [role="menu"], [role="menu"] *', why: 'An open menu covers what is under it by design.' },
  { kind: 'covered', within: '[data-marxy-tab-tip]', cover: '[data-marxy-workspace-region="toolbar"], [data-marxy-workspace-region="toolbar"] *', why: 'The tab path reveal opens over the toolbar, never the document, when the tool strip is not there to hold it (F-99).' },
  { kind: 'covered', within: '#doc, .cm-content', cover: '[data-marxy-workspace-region], [data-marxy-workspace-region] *', why: 'The document scrolls under the fixed toolbar, strip and status row.' },
];

// ------------------------------------------------------------------ the in-page auditor

/** Runs in the page. Returns { findings, texts, suppressed }. Self-contained: no closures over the module. */
export function auditInPage({ allow }) {
  const VW = document.documentElement.clientWidth;
  const VH = window.innerHeight;
  const rootScrollsY = document.documentElement.scrollHeight > VH + 1 || document.body.scrollHeight > VH + 1;
  const csCache = new Map();
  const cs = (el) => {
    let c = csCache.get(el);
    if (!c) csCache.set(el, (c = getComputedStyle(el)));
    return c;
  };
  const sel = (el) => {
    const parts = [];
    for (let e = el, n = 0; e && e.nodeType === 1 && e !== document.body && n < 4; e = e.parentElement, n++) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += `#${e.id}`;
      const cls = [...e.classList].filter((c) => !/^\d|^_|^cm-line-\d/.test(c)).slice(0, 2);
      if (cls.length) s += `.${cls.join('.')}`;
      const data = [...e.attributes].find((a) => /^data-marxy-(tab|status-item|toolbar-item|inspector-tab|category|sidebar-section|pane|notice)/.test(a.name));
      if (data) s += `[${data.name}${data.value && data.value.length < 24 ? `="${data.value}"` : ''}]`;
      parts.unshift(s);
      if (e.id || data) break;
    }
    return parts.join(' > ');
  };
  const matches = (el, q) => {
    if (!q || !el) return false;
    try {
      return el.closest(q) !== null;
    } catch {
      return false;
    }
  };
  const suppressed = {};
  const findings = [];
  const seen = new Set();
  const add = (kind, el, text, rect, extra = {}) => {
    const entry = allow.find((a) => (a.kind === '*' || a.kind === kind) && (a.within ? matches(el, a.within) : true) && (a.cover ? matches(extra.coverEl, a.cover) : true));
    const key = `${kind}|${sel(el)}|${text.slice(0, 24)}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (entry && !entry.known) {
      suppressed[entry.why] = (suppressed[entry.why] ?? 0) + 1;
      return;
    }
    const f = { kind, sel: sel(el), text: text.replace(/\s+/g, ' ').trim().slice(0, 48), rect: [rect.left, rect.top, rect.width, rect.height].map(Math.round) };
    if (extra.box) f.box = extra.box.map(Math.round);
    if (extra.cover) f.cover = extra.cover;
    if (extra.note) f.note = extra.note;
    if (entry?.known) f.known = entry.known;
    findings.push(f);
  };

  /** The clipping and scrolling ancestors of an element, as the text inside it meets them. */
  const chainOf = (el) => {
    const out = [];
    let absolute = false;
    let fixed = false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const c = cs(e);
      const clipsX = c.overflowX !== 'visible';
      const clipsY = c.overflowY !== 'visible';
      const positioned = c.position !== 'static' || c.transform !== 'none';
      // A fixed child escapes every ancestor's clip; an absolute child escapes the ones that are not positioned.
      const escapes = fixed || (absolute && !positioned);
      if (!escapes && (clipsX || clipsY)) {
        const r = e.getBoundingClientRect();
        out.push({
          el: e,
          x: clipsX,
          y: clipsY,
          hardX: c.overflowX === 'hidden' || c.overflowX === 'clip',
          hardY: c.overflowY === 'hidden' || c.overflowY === 'clip',
          box: [r.left + e.clientLeft, r.top + e.clientTop, e.clientWidth, e.clientHeight],
        });
      }
      if (c.position === 'fixed') {
        fixed = true;
        out.fixed = true;
      } else if (c.position === 'absolute') absolute = true;
      else if (positioned) absolute = false;
    }
    return out;
  };

  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const ellipsised = new Set();
  let texts = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !/\S/.test(node.nodeValue)) continue;
    if (el.closest('script, style, noscript, template, [hidden], [inert]')) continue;
    let invisible = false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const c = cs(e);
      if (c.display === 'none' || c.opacity === '0' || c.visibility === 'hidden' || c.clipPath.startsWith('inset(50%')) {
        invisible = true;
        break;
      }
    }
    if (invisible) continue;
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width >= 1 && r.height >= 1);
    if (!rects.length) continue;
    const bb = range.getBoundingClientRect();
    const chain = chainOf(el);
    texts++;

    // The visible part of the text: its box cut by every clip on its way up.
    const vis = { l: bb.left, t: bb.top, r: bb.right, b: bb.bottom };
    for (const k of chain) {
      const [x, y, w, h] = k.box;
      if (k.x) {
        vis.l = Math.max(vis.l, x);
        vis.r = Math.min(vis.r, x + w);
      }
      if (k.y) {
        vis.t = Math.max(vis.t, y);
        vis.b = Math.min(vis.b, y + h);
      }
    }
    if (vis.r - vis.l < 1 || vis.b - vis.t < 1) continue; // scrolled or clipped away entirely: by design

    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const c = cs(e);
      if (c.textOverflow === 'ellipsis' || (c.webkitLineClamp && c.webkitLineClamp !== 'none')) ellipsised.add(e);
    }

    // (1) clipped: a line cut mid-glyph by a hard clip. Each clip narrows the line for the next one out, so a tab's name
    // that an ellipsis already shortens is not also reported against the button around it.
    for (const r of rects) {
      const cur = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      for (const k of chain) {
        const [x, y, w, h] = k.box;
        const c = cs(k.el);
        const clamp = c.webkitLineClamp && c.webkitLineClamp !== 'none';
        const ellipsis = c.textOverflow === 'ellipsis';
        const cutX = k.hardX && !ellipsis && (cur.l < x - 1 || cur.r > x + w + 1);
        const cutY = k.hardY && !clamp && (cur.t < y - 1 || cur.b > y + h + 1);
        const ix = Math.min(cur.r, x + w) - Math.max(cur.l, x);
        const iy = Math.min(cur.b, y + h) - Math.max(cur.t, y);
        // A line box a little shorter than its font box (descender space) is not a cut: the y side needs a fifth gone.
        const shownX = ix / (cur.r - cur.l);
        const shownY = iy / (cur.b - cur.t);
        if (((cutX && shownX < 0.98) || (cutY && shownY < 0.8)) && ix > 0 && iy > 0) {
          add('clipped', el, node.nodeValue, r, { box: k.box, note: `${cutX ? 'x' : 'y'} cut by ${sel(k.el)}` });
        }
        if (k.x) (cur.l = Math.max(cur.l, x)), (cur.r = Math.min(cur.r, x + w));
        if (k.y) (cur.t = Math.max(cur.t, y)), (cur.b = Math.min(cur.b, y + h));
        if (cur.r <= cur.l || cur.b <= cur.t) break;
      }
    }

    // (2) spills: past the border box of the nearest block that is not a scroller or a clip. A hanging indent starts left
    // of its box on purpose, and text in a scroller is reached by scrolling, so only the trailing edge counts there.
    let owner = el;
    while (owner && owner !== document.body && ['inline', 'contents'].includes(cs(owner).display)) owner = owner.parentElement;
    if (owner && owner !== document.body && cs(owner).overflowX === 'visible' && !chain.some((k) => k.x)) {
      const r = owner.getBoundingClientRect();
      let hangs = false;
      for (let e = el; e && e !== owner.parentElement; e = e.parentElement) hangs ||= parseFloat(cs(e).textIndent) < 0;
      // Where white space is kept, a wrapped line's trailing space hangs past the box: up to about one em is not text.
      const kept = /^(pre|pre-wrap|break-spaces)$/.test(cs(owner).whiteSpace);
      const slack = kept ? Math.max(1.5, 0.65 * parseFloat(cs(owner).fontSize)) : 1.5;
      if (bb.right > r.right + slack || (!hangs && bb.left < r.left - slack)) {
        add('spills', el, node.nodeValue, bb, { box: [r.left, r.top, r.width, r.height], note: `owner ${sel(owner)} is ${Math.round(r.width)} px wide, its text ${Math.round(bb.width)} px` });
      }
    }

    // (3) outside the window: no scroller on the axis to bring it back.
    const scrollerX = chain.some((k) => k.x);
    const scrollerY = chain.some((k) => k.y);
    const xOut = bb.right > VW + 1 || bb.left < -1;
    const yOut = bb.bottom > VH + 1 || bb.top < -1;
    if (xOut && !scrollerX) add('outside', el, node.nodeValue, bb, { note: `window ${VW}x${VH}` });
    else if (yOut && !scrollerY && (chain.fixed || !rootScrollsY || bb.top < -1)) add('outside', el, node.nodeValue, bb, { note: `window ${VW}x${VH}` });

    // Lines the reader can see are candidates for the covered and overlap checks.
    for (const r of rects) {
      const l = Math.max(r.left, vis.l);
      const t = Math.max(r.top, vis.t);
      const rr = Math.min(r.right, vis.r);
      const b = Math.min(r.bottom, vis.b);
      if (rr - l < 2 || b - t < 2 || rr < 0 || b < 0 || l > VW || t > VH) continue;
      lines.push({ el, node, l, t, r: rr, b, text: node.nodeValue });
    }
  }

  // (4) truncated with no reveal.
  for (const e of ellipsised) {
    const c = cs(e);
    const clamp = c.webkitLineClamp && c.webkitLineClamp !== 'none';
    const over = clamp ? e.scrollHeight > e.clientHeight + 1 : e.scrollWidth > e.clientWidth + 1;
    if (!over) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.bottom < 0 || r.top > VH || r.right < 0 || r.left > VW) continue;
    if (!e.closest('[title]:not([title=""]), [data-tooltip], [data-marxy-tab-path]')) add('truncated', e, e.textContent ?? '', r, { note: `${clamp ? 'clamped' : 'ellipsised'}: ${e.scrollWidth} px of text in ${e.clientWidth} px` });
  }

  // (5) covered: what is on top at the middle of a visible line is not its own.
  const free = [];
  for (const ln of lines) {
    const hit = document.elementFromPoint((ln.l + ln.r) / 2, (ln.t + ln.b) / 2);
    const group = (x) => x.closest('button, label, a, li');
    // Another piece of text with no background of its own on top is not a cover: both can be read, and (6) tells if they cross.
    const bareText = hit && [...hit.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue)) && /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(cs(hit).backgroundColor);
    if (!hit || bareText || ln.el.contains(hit) || hit.contains(ln.el) || (group(hit) && group(hit) === group(ln.el))) {
      free.push(ln);
      continue;
    }
    add('covered', ln.el, ln.text, { left: ln.l, top: ln.t, width: ln.r - ln.l, height: ln.b - ln.t }, { cover: sel(hit), coverEl: hit });
  }

  // (6) overlap: two visible lines of different text nodes whose boxes cross. Sweep on the top edge.
  free.sort((a, b) => a.t - b.t);
  for (let i = 0; i < free.length; i++) {
    const a = free[i];
    for (let j = i + 1; j < free.length && free[j].t < a.b; j++) {
      const b = free[j];
      if (a.node === b.node) continue;
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (w < 3 || h < 0.5 * Math.min(a.b - a.t, b.b - b.t)) continue;
      // Where they cross, is the lower one hidden by something opaque between them? Then there is nothing to read twice.
      const cx = Math.max(a.l, b.l) + w / 2;
      const cy = Math.max(a.t, b.t) + h / 2;
      const stack = document.elementsFromPoint(cx, cy);
      const at = (ln) => stack.findIndex((e) => ln.el === e || ln.el.contains(e) || e.contains(ln.el));
      const [ia, ib] = [at(a), at(b)];
      if (ia < 0 || ib < 0) continue;
      const lower = ia > ib ? a : b;
      const hidden = stack.slice(0, Math.max(ia, ib)).some((e) => {
        if (e.contains(lower.el) || lower.el.contains(e)) return false;
        const c = cs(e);
        const bg = c.backgroundColor.match(/[\d.]+/g);
        return (bg && bg.length >= 3 && (bg.length === 3 || Number(bg[3]) >= 0.95)) || c.backdropFilter !== 'none' || c.webkitBackdropFilter !== 'none';
      });
      if (hidden) continue;
      add('overlap', a.el, `${a.text} / ${b.text}`, { left: Math.max(a.l, b.l), top: Math.max(a.t, b.t), width: w, height: h }, { note: `with ${sel(b.el)}` });
    }
  }

  return { findings, texts, suppressed, window: [VW, VH] };
}

// ------------------------------------------------------------------ the fixtures

function loadCorpus() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(join(MOCK, 'shared/corpus.js'), 'utf8'), ctx);
  const docs = ctx.window.Marxy.docs;
  const toPath = (p) => p.replace(/^~/, '/Users/reader');
  const files = {
    ...Object.fromEntries(docs.filter((d) => d.src).map((d) => [toPath(d.path), d.src])),
    '/Users/reader/work/change.diff': readFileSync(join(ROOT, 'fixtures/corpus/36-change.diff'), 'utf8'),
  };
  const byId = (id) => toPath(docs.find((d) => d.id === id).path);
  // Names and a body that are longer than the corpus's own: what a real folder has.
  const long = Array.from({ length: 12 }, (_, i) => `/Users/reader/Work/plans/plans/2026-10-${String(i + 1).padStart(2, '0')}-quarterly-database-migration-readiness-review-draft-${i + 1}.md`);
  for (const [i, p] of long.entries()) files[p] = `# Quarterly database migration readiness review, draft ${i + 1}\n\nA paragraph for tab ${i + 1}.\n\n- one\n- two\n`;
  const stress = '/Users/reader/Work/plans/plans/stress-long-tokens.md';
  files[stress] = [
    '# Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '',
    'A link with a long address: https://example.com/a/very/long/path/that/goes/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on/and/on?query=string&and=more',
    '',
    'Inline code that does not break: `an_identifier_that_goes_on_and_on_and_on_and_on_and_on_and_on_and_on_and_on_and_on_and_on_and_on_and_on` end.',
    '',
    '| Column one | Column two | Column three | Column four | Column five | Column six | Column seven | Column eight |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| a long cell with plenty of words in it to need a wide column | b | c | d | e | f | g | h |',
    '',
    '```text',
    `a code line that is far wider than any window the app is run in, to see that it scrolls and does not float: ${'x'.repeat(260)}`,
    '```',
    '',
    `- [ ] a task with a long label ${'word '.repeat(30)}`,
    '- [x] done',
    '',
    '> A quote with a nested list',
    '>',
    '> - one',
    '>   - two',
    '',
    '日本語の見出しと本文が混じった段落。Mixed text, العربية, and emoji 🙂 together.',
    '',
  ].join('\n');
  const entries = docs.filter((d) => d.src).map((d, i) => ({
    path: toPath(d.path),
    root: toPath(d.path).split('/').slice(0, 4).join('/'),
    title: d.title,
    headings: [...d.src.matchAll(/^(#{1,6}) (.*)$/gm)].map((m, k) => ({ level: m[1].length, text: m[2], byteOffset: k })),
    mtimeMs: Date.now() - (i + 1) * 3_600_000,
    size: new TextEncoder().encode(d.src).length,
    kind: /\.(md|markdown)$/.test(d.path) ? 'markdown' : 'source',
    readerKind: d.kind,
  }));
  for (const p of [...long, stress]) {
    entries.push({ path: p, root: '/Users/reader/Work', title: p.split('/').pop(), headings: [], mtimeMs: Date.now() - 5 * 3_600_000, size: files[p].length, kind: 'markdown', readerKind: 'report' });
  }
  return {
    files,
    entries,
    long,
    P: {
      plan: byId('pg16-plan'), handoff: byId('auth-handoff'), chat: byId('indexer-chat'), article: byId('ragged-right'), book: byId('cartographer-ch3'),
      readme: byId('tidemark-readme'), rs: byId('indexer-rs'), csv: byId('bench-csv'), log: byId('build-log'), shell: byId('shell-session'),
      notes: byId('notes-1008'), changelog: byId('changelog'), odd: byId('odd-bytes'), diff: '/Users/reader/work/change.diff', stress,
    },
  };
}

const SAVED_QUERIES = '[[query]]\nname = "Reports"\nq = "kind:report"\n\n[[query]]\nname = "Notes this month"\nq = "kind:notes modified:<30d"\n';


// ------------------------------------------------------------------ the scenes

/**
 * A scene is one boot at one window width: `open` is the document the app starts on (`null`: an empty window; `piece`
 * pins which Commonplace piece it draws), `prepare` brings it to its state, and each step is one surface the audit
 * measures there. Booting at the width under test matters: the sidebar and the inspector are docked (or not) by the
 * width at which the workspace first unfolds. A step's `probe` is a selector that is there while its overlay is open;
 * after a resize that closed it, `run` opens it again, and `close` puts the scene back for the next step.
 */
function scenes(F) {
  const { P, long } = F;
  const cmd = (page, id) => page.evaluate((id) => window.__cmd(id), id);
  const open = (page, p) => page.evaluate((p) => window.__marxyHandle.open(p), p);
  const unfold = (page) => page.evaluate(() => window.__marxyHandle.workspace().unfold());
  const settle = (page, ms = 100) => page.waitForTimeout(ms);
  const withTabs = async (page) => {
    await unfold(page);
    for (const p of [P.handoff, P.rs, P.plan]) {
      await open(page, p);
      await settle(page, 60);
    }
  };
  const notify = (page, input) =>
    page.evaluate(async (input) => {
      const { notify } = await import('/src/notices/index.ts');
      // Buttons cannot cross from the harness: a notice that has actions is given two that do nothing.
      notify(input.actions ? { ...input, actions: input.actions.map((label) => ({ label, onClick() {} })) } : input);
    }, input);
  /** Closes what a step opened: Escape goes to the open overlay (with nothing open it would fold the workspace). */
  const escape = async (page, probe) => {
    for (let i = 0; i < 3 && (await page.$(probe)); i++) {
      await page.keyboard.press('Escape');
      await settle(page, 60);
    }
  };
  const PALETTE = '#marxy-palette[open]';
  const MENU = '.marxy-verb-menu';
  const palette = (key, query) => async (page) => {
    await page.keyboard.press(key);
    await page.waitForSelector(PALETTE);
    if (query) await page.locator('#marxy-palette .marxy-palette-query').fill(query);
    await settle(page, 100);
  };
  const overlay = (id, group, probe, run) => ({ id, group, probe, run, close: (p) => escape(p, probe) });
  const mode = (id, group, to, back) => ({
    id,
    group,
    run: async (p) => {
      await cmd(p, to);
      // The app refuses a split the window cannot hold (two columns at the typography floor): nothing to measure there.
      if (to === 'view.mode-split' && (await p.evaluate(() => window.__marxyHandle.panes().panes.length)) < 2) throw Object.assign(new Error('the app refuses a split at this width'), { skip: true });
    },
    close: async (p) => ((await p.evaluate(() => window.__marxyHandle.panes().panes.length)) === 2 || to !== 'view.mode-split' ? cmd(p, back) : undefined),
  });
  const S = [];
  const scene = (id, o) => S.push({ id, open: P.plan, steps: [], ...o });

  scene('folded', {
    steps: [
      { id: 'folded-read', group: 'Read', run: async () => {} },
      mode('folded-source', 'Source', 'view.mode-source', 'view.mode-read'),
      mode('folded-split', 'Split', 'view.mode-split', 'view.mode-split'),
      overlay('palette-commands-folded', 'Palette', PALETTE, palette('Meta+Shift+KeyP')),
      overlay('palette-files-folded', 'Palette', PALETTE, palette('Meta+KeyP', 'a')),
      overlay('menu-verbs-folded', 'Menus', MENU, async (p) => (await p.locator('#doc p').first().click({ button: 'right' }), settle(p, 83))),
      { id: 'notice-stack-folded', group: 'Notices', probe: '.marxy-notice', run: async (p) => {
        for (const [kind, text] of [['done', 'Copied'], ['blocked', 'This file opens in Source because it is large'], ['decision', 'Keep your changes or take the version on disk?'], ['info', 'Another note']]) {
          await notify(p, { kind, text, actions: kind === 'decision' ? ['Keep mine', 'Take disk'] : undefined });
        }
      }, close: (p) => p.evaluate(async () => (await import('/src/notices/index.ts')).clearNotices()) },
    ],
  });
  scene('unfolded', {
    prepare: withTabs,
    steps: [
      { id: 'unfolded-read', group: 'Read', run: async () => {} },
      mode('unfolded-source', 'Source', 'view.mode-source', 'view.mode-read'),
      mode('unfolded-split', 'Split', 'view.mode-split', 'view.mode-split'),
      overlay('palette-files', 'Palette', PALETTE, palette('Meta+KeyP')),
      overlay('palette-files-query', 'Palette', PALETTE, palette('Meta+KeyP', 'plan')),
      overlay('palette-commands', 'Palette', PALETTE, palette('Meta+Shift+KeyP')),
      overlay('palette-content', 'Palette', PALETTE, palette('Meta+Slash', 'postgres')),
      overlay('palette-headings', 'Palette', PALETTE, palette('Meta+KeyP', '@')),
      overlay('palette-empty', 'Palette', PALETTE, palette('Meta+KeyP', 'zzzzqqqq')),
      overlay('menu-verbs', 'Menus', MENU, async (p) => (await p.locator('#doc p').first().click({ button: 'right' }), settle(p, 83))),
      overlay('menu-verbs-corner', 'Menus', MENU, async (p) => {
        // The pointer is near the window's far corner: the menu has to stay inside the window.
        await p.mouse.click(p.viewportSize().width - 40, p.viewportSize().height - 80, { button: 'right' });
        await settle(p, 83);
      }),
      overlay('menu-copy-as', 'Menus', MENU, async (p) => (await cmd(p, 'copy-as.menu'), settle(p, 83))),
      overlay('menu-new', 'Menus', MENU, async (p) => (await cmd(p, 'document.new-menu'), settle(p, 83))),
      overlay('menu-kind-chip', 'Menus', MENU, async (p) => (await cmd(p, 'kind.chip'), settle(p, 83))),
      overlay('menu-toolbar-more', 'Menus', MENU, async (p) => {
        const more = p.locator('[data-marxy-toolbar-item="more"] button');
        if (await more.isVisible()) await more.click();
        await settle(p, 83);
      }),
      { id: 'notice-done', group: 'Notices', probe: '.marxy-notice', run: (p) => notify(p, { kind: 'done', text: 'Copied as Markdown, 3.1 KB' }), close: (p) => p.evaluate(async () => (await import('/src/notices/index.ts')).clearNotices()) },
      { id: 'notice-long', group: 'Notices', probe: '.marxy-notice', run: (p) => notify(p, { kind: 'error', text: 'Could not save /Users/reader/Work/plans/plans/2026-10-14-quarterly-database-migration-readiness-review-draft-14.md: the file changed on disk since it was opened and the copy in memory could not be merged.' }), close: (p) => p.evaluate(async () => (await import('/src/notices/index.ts')).clearNotices()) },
      { id: 'popup-find', group: 'Popups', probe: '#marxy-find:not([hidden])', run: async (p) => (await cmd(p, 'view.find'), await p.keyboard.type('postgres'), settle(p, 100)), close: (p) => p.locator('.marxy-find-input').press('Escape') },
      overlay('popup-transform-sheet', 'Popups', '#marxy-transform[open]', async (p) => {
        await p.keyboard.press('Meta+Slash');
        await p.waitForSelector('#marxy-palette[open] .marxy-palette-row');
        await p.locator('#marxy-palette .marxy-palette-query').fill('>Transform: Remove front matter');
        await p.locator('#marxy-palette .marxy-palette-title').filter({ hasText: /^Transform: Remove front matter$/ }).click();
        await p.waitForSelector('#marxy-transform[open]');
        await settle(p, 133);
      }),
      overlay('popup-outline', 'Popups', '#marxy-outline[open]', async (p) => (await cmd(p, 'view.outline'), settle(p, 116))),
      ...['links', 'outline', 'versions'].map((tab) => ({
        id: `inspector-${tab}`,
        group: 'Inspector',
        run: async (p) => {
          await p.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
          await p.locator(`[data-marxy-inspector-tab="${tab}"]`).click();
          await settle(p, 100);
        },
        close: (p) => p.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', false)),
      })),
    ],
  });
  scene('library', {
    prepare: async (p) => (await withTabs(p), p.evaluate((e) => window.__marxyHandle.palette.setIndexEntries(e), F.entries), cmd(p, 'library.open'), p.waitForSelector('[data-marxy-library]')),
    steps: [
      { id: 'popup-library', group: 'Popups', run: async (p) => settle(p, 133) },
      { id: 'popup-library-filter', group: 'Popups', probe: '.marxy-library-facet-menu:not([hidden])', run: async (p) => (await p.locator('.marxy-library-facet-button').first().click(), settle(p, 100)), close: (p) => p.keyboard.press('Escape') },
    ],
  });
  scene('settings', {
    prepare: async (p) => (await withTabs(p), cmd(p, 'view.settings'), p.waitForSelector('[data-marxy-settings]')),
    steps: [
      ...['general', 'appearance', 'reading', 'source', 'types', 'collections', 'accessibility', 'privacy', 'advanced'].map((c) => ({
        id: `settings-${c}`,
        group: 'Settings',
        run: async (p) => {
          if (!(await p.$(`[data-marxy-category="${c}"]`))) throw Object.assign(new Error(`the ${c} category is not drawn (it has no setting yet)`), { skip: true });
          await p.click(`[data-marxy-category="${c}"]`);
          await settle(p, 80);
        },
      })),
      { id: 'settings-search', group: 'Settings', run: async (p) => (await p.locator('[data-marxy-settings] input[type="search"]').fill('size'), settle(p, 100)) },
    ],
  });
  scene('kinds', {
    prepare: unfold,
    steps: [
      ...[['code', P.rs], ['transcript', P.chat], ['log', P.log], ['diff', P.diff], ['article', P.article], ['book', P.book], ['readme', P.readme], ['changelog', P.changelog], ['terminal', P.shell], ['notes-odd', P.odd], ['stress-long-tokens', P.stress], ['data', P.csv]].map(([id, path]) => ({
        id: `kind-${id}`,
        group: 'Reader kinds',
        run: async (p) => (await open(p, path), settle(p, 133)),
      })),
      { id: 'kind-data-table', group: 'Reader kinds', run: async (p) => (await open(p, P.csv), await cmd(p, 'data.table-lens'), settle(p, 133)) },
      { id: 'kind-stress-source', group: 'Source', run: async (p) => (await open(p, P.stress), await cmd(p, 'view.mode-source'), settle(p, 133)) },
    ],
  });
  scene('tab-strip', {
    prepare: async (p) => {
      await unfold(p);
      for (const x of long) {
        await open(p, x);
        await settle(p, 60);
      }
      await p.evaluate(async () => {
        const store = window.__marxyHandle.document();
        await store.apply({ range: { file: store.snapshot().path, start: 0, end: 0 }, replacement: 'x', label: 'edit' });
      });
    },
    steps: [{ id: 'tab-strip-twelve', group: 'Tab strip', run: async (p) => (await p.locator('.marxy-tab').nth(3).hover(), settle(p, 233)) }],
  });
  scene('sidebar', {
    prepare: async (p) => {
      await unfold(p);
      await p.evaluate(() => window.__marxyHandle.workspace().setPanel('sidebar', true)); // closed by default under 900 px
      await p.evaluate((e) => window.__marxyHandle.palette.setIndexEntries(e), F.entries);
      await settle(p, 133);
      for (let i = 0; i < 4; i++) {
        const nodes = p.locator('.marxy-sidebar-node[aria-expanded="false"]');
        if (!(await nodes.count())) break;
        await nodes.first().click();
        await settle(p, 60);
      }
    },
    steps: [{ id: 'sidebar-open-folders', group: 'Sidebar', run: async () => {} }],
  });
  // A split made in a wide window and then narrowed: the panes keep their two columns.
  scene('split-resized', {
    resizeFrom: 1920,
    prepare: async (p) => (await withTabs(p), cmd(p, 'view.mode-split')),
    steps: [{ id: 'unfolded-split-resized', group: 'Split', run: async () => {} }],
  });
  scene('split-two-documents', {
    prepare: async (p) => (await unfold(p), p.evaluate(async (other) => window.__marxyHandle.panes().openIn('other', other), P.stress)),
    steps: [{ id: 'split-two-documents', group: 'Split', run: async () => {} }],
  });
  scene('versions', {
    prepare: async (p) => {
      await withTabs(p);
      // The card's scenario on the plan: read at open, an edit saved, then another program rewrites a line.
      await p.evaluate(async () => {
        const { versionRecorder } = await import('/src/versions/recorder.ts');
        const h = window.__marxyHandle;
        const store = h.document();
        const path = store.snapshot().path;
        const text = new TextDecoder().decode(store.snapshot().buffer.bytes);
        const at = new TextEncoder().encode(text.slice(0, text.indexOf('\n## ') + 1)).length;
        await store.apply({ range: { file: path, start: at, end: at }, replacement: 'A line the reader added and saved.\n\n', label: 'edit' });
        await h.save();
        await versionRecorder()?.settled();
        const saved = new TextDecoder().decode(store.snapshot().buffer.bytes);
        const outside = saved.replace(/\n## [^\n]*\n/, (m) => `${m}\nA paragraph another program wrote while the file was open.\n`);
        await h.shell.writeFileAtomic(path, new TextEncoder().encode(outside));
        h.shell.emit([{ kind: 'modified', path }]);
      });
      await p.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('another program wrote'));
      await p.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', true));
      await p.locator('[data-marxy-inspector-tab="versions"]').click();
      await p.waitForSelector('.marxy-versions [data-marxy-versions-since]');
    },
    steps: [{ id: 'inspector-versions-history', group: 'Inspector', run: async (p) => settle(p, 100) }],
  });
  // The empty window shows one Commonplace piece at random; piece 6 is a parallel text (two columns), piece 0 plain prose.
  scene('empty-parallel', { open: null, piece: 6, steps: [{ id: 'empty-window-parallel', group: 'Empty window', run: async () => {} }] });
  scene('empty-prose', { open: null, piece: 0, steps: [{ id: 'empty-window-prose', group: 'Empty window', run: async () => {} }] });
  // The window is opened narrow and then widened: the same piece must lay itself out again.
  scene('empty-resized', { open: null, piece: 6, resizeFrom: 800, steps: [{ id: 'empty-window-resized', group: 'Empty window', run: async () => {} }] });
  scene('empty-unfolded', { open: null, piece: 6, prepare: unfold, steps: [{ id: 'empty-window-unfolded', group: 'Empty window', run: async () => {} }] });
  // Every bundled piece, one by one (--pieces), opened at 800 px and then widened: each is its own layout.
  if (process.argv.includes('--pieces')) {
    for (let k = 0; k < 38; k++) scene(`empty-piece-${String(k).padStart(2, '0')}`, { open: null, piece: k, resizeFrom: 800, steps: [{ id: `empty-piece-${String(k).padStart(2, '0')}`, group: 'Empty window', run: async () => {} }] });
  }
  return S;
}

// ------------------------------------------------------------------ the runner

export function parseArgs(argv) {
  const o = { only: null, themes: THEMES.map((t) => t.id), widths: WIDTHS, heights: HEIGHTS, workers: 6, shots: null, json: null, md: null, fail: false, list: false, pieces: false, every: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--only') o.only = v().split(',');
    else if (a === '--theme') o.themes = v().split(',');
    else if (a === '--widths') o.widths = v().split(',').map(Number);
    else if (a === '--heights') o.heights = v().split(',').map(Number);
    else if (a === '--quick') Object.assign(o, { themes: ['night'], widths: [800, 1920], heights: [600] });
    else if (a === '--workers') o.workers = Number(v());
    else if (a === '--shots') o.shots = resolve(v());
    else if (a === '--shots-every') o.every = true;
    else if (a === '--json') o.json = resolve(v());
    else if (a === '--md') o.md = resolve(v());
    else if (a === '--fail') o.fail = true;
    else if (a === '--pieces') o.pieces = true;
    else if (a === '--list') o.list = true;
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of o.themes) if (!THEMES.some((x) => x.id === t)) throw new Error(`unknown theme ${t}`);
  for (const n of [...o.widths, ...o.heights]) if (!(n > 0)) throw new Error(`bad size ${n}`);
  return o;
}

/** Waits until the page stops changing: fonts loaded, no finite animation running, the same text and size twice over. */
async function settled(page, limit = 3000) {
  await page.evaluate(async (limit) => {
    await document.fonts.ready;
    const sig = () => {
      const running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length;
      return `${running}|${document.body.innerText.length}|${document.documentElement.scrollHeight}|${document.querySelectorAll('*').length}`;
    };
    const t0 = performance.now();
    let last = '';
    let same = 0;
    while (performance.now() - t0 < limit && same < 2) {
      await new Promise((r) => setTimeout(r, 50));
      const now = sig();
      same = now === last && now.startsWith('0|') ? same + 1 : 0;
      last = now;
    }
  }, limit);
}

async function bootScene(contexts, support, F, scene, theme, width, height) {
  // One context per worker and variant: its HTTP cache keeps a worker's later boots to about a second.
  if (!contexts.byTheme.has(theme.id)) contexts.byTheme.set(theme.id, await contexts.browser.newContext({ colorScheme: theme.scheme, deviceScaleFactor: 1 }));
  const page = await contexts.byTheme.get(theme.id).newPage();
  // The empty window's piece is chosen at random: pin it (choosePiece takes floor(random() * count)).
  if (scene.piece !== undefined) await page.addInitScript((k) => { Math.random = () => (k + 0.5) / 38; }, scene.piece);
  page.setDefaultTimeout(5000);
  await page.setViewportSize({ width, height });
  const base = await support.harnessBase();
  const { style, body } = support.shippedSkeleton();
  await page.route(`${base}app.html`, async (route) => {
    try {
      const response = await route.fetch();
      const html = (await response.text())
        .replace('</head>', `<style>${style}</style></head>`)
        .replace(/<body[^>]*>/, `<body data-marxy-mode="rendered" data-marxy-variant="${theme.scheme}">`)
        .replace('<article id="doc" class="marxy-article"></article>', body);
      await route.fulfill({ response, body: html });
    } catch {
      await route.abort().catch(() => {}); // the page went away, or the dev server dropped the request: the task retries
    }
  });
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const all = { ...F.files, '/collection.toml': SAVED_QUERIES, ...(theme.scheme === 'light' ? { '/config': 'variant = "light"\n' } : {}) };
  const encoded = Object.fromEntries(Object.entries(all).map(([p, t]) => [p, support.b64(t)]));
  await page.evaluate(
    async ({ encoded, entries, open }) => {
      const bytes = {};
      for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: open ? [open] : [] });
      await handle.ready;
      window.__marxyHandle = handle;
      handle.palette.setIndexEntries(entries);
      window.__cmd = async (id) => {
        const { commands } = await import('/src/commands/index.ts');
        const c = commands().find((x) => x.id === id);
        if (!c) throw new Error(`no command ${id}`);
        return c.run({ showNotice(text, opts) { (window.__refused ??= []).push(String(text)); } });
      };
    },
    { encoded, entries: F.entries, open: scene.open },
  );
  await settled(page);
  return page;
}

/** One scene in one variant at one width: boot, prepare, then each step at each height. Resolves one result per step. */
async function runScene(contexts, support, F, scene, steps, theme, width, heights, opts) {
  const results = steps.map((s) => ({ surface: s.id, group: s.group, theme: theme.id, width, cells: [], errors: [] }));
  const page = await bootScene(contexts, support, F, scene, theme, scene.resizeFrom ?? width, heights[0]);
  try {
    try {
      await scene.prepare?.(page);
      await settled(page);
    } catch (e) {
      for (const r of results) r.errors.push(`${width}: prepare: ${e.message.split('\n')[0]}`);
      return results;
    }
    for (const [i, step] of steps.entries()) {
      const r = results[i];
      const t0 = Date.now();
      for (const height of heights) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
        try {
          // An overlay a resize closed is opened again; one still open is left alone.
          if (!(step.probe && (await page.$(step.probe)))) await step.run(page);
        } catch (e) {
          if (e.skip) {
            r.skipped = e.message;
            continue;
          }
          r.errors.push(`${width}x${height}: ${e.message.split('\n')[0]}`);
        }
        await settled(page);
        const result = await page.evaluate(auditInPage, { allow: ALLOW });
        r.cells.push({ size: [width, height], ...result });
        if (opts.shots && (opts.every || result.findings.some((f) => !f.known))) {
          mkdirSync(opts.shots, { recursive: true });
          await page.screenshot({ path: join(opts.shots, `${step.id}-${theme.id}-${width}x${height}.png`) });
        }
      }
      try {
        await step.close?.(page);
        await settled(page);
      } catch (e) {
        r.errors.push(`close: ${e.message.split('\n')[0]}`);
      }
      if (process.env.LAYOUT_AUDIT_TRACE) console.error(`${step.id} ${theme.id} ${width} ${Date.now() - t0} ms`);
    }
  } finally {
    await page.close();
  }
  return results;
}

/** Folds the cells into one row per defect: kind, surface, selector and text, with the sizes and variants it shows at. */
export function fold(results) {
  const rows = new Map();
  const counts = {};
  const suppressed = {};
  let texts = 0;
  const errors = [];
  const skipped = new Set();
  for (const r of results) {
    for (const e of r.errors) errors.push(`${r.surface} ${r.theme}: ${e}`);
    if (r.skipped) skipped.add(`${r.surface}: ${r.skipped}`);
    for (const c of r.cells) {
      texts += c.texts;
      for (const [why, n] of Object.entries(c.suppressed ?? {})) suppressed[why] = (suppressed[why] ?? 0) + n;
      for (const f of c.findings) {
        // One row per kind of box: the twelve lines of one paragraph, or the rows of one list, are one defect.
        const key = [f.kind, r.surface, f.sel.replace(/(#[\w-]*?)\d+/g, '$1N')].join('|');
        let row = rows.get(key);
        if (!row) rows.set(key, (row = { ...f, surface: r.surface, group: r.group, at: [], themes: new Set(), texts: new Set() }));
        row.at.push(c.size.join('x'));
        row.themes.add(r.theme);
        row.texts.add(f.text);
      }
    }
  }
  const list = [...rows.values()].map(({ texts, ...r }) => ({ ...r, themes: [...r.themes].sort(), at: [...new Set(r.at)], count: texts.size }));
  for (const r of list) if (!r.known) counts[r.group] = (counts[r.group] ?? 0) + 1;
  return { list, counts, suppressed, texts, errors: [...new Set(errors)], skipped: [...skipped] };
}

export function markdown({ list, counts, suppressed, texts, errors, skipped }, { cells, seconds, surfaces }) {
  const out = [];
  const fresh = list.filter((r) => !r.known);
  const known = list.filter((r) => r.known);
  out.push(`# Layout audit: ${fresh.length} defects, ${known.length} already boarded (${surfaces} surfaces, ${cells} cells, ${texts} text nodes, ${seconds} s)`, '');
  out.push('## Defects per surface group', '', '| Group | Defects |', '| --- | ---: |');
  for (const [g, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) out.push(`| ${g} | ${n} |`);
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  const row = (r) => `| ${r.kind} | ${r.surface} | \`${cell(r.sel)}\` | ${cell(r.text)}${r.count > 1 ? ` (+${r.count - 1} more)` : ''} | ${r.at.length > 4 ? `${r.at.length} sizes` : r.at.join(' ')} | ${r.themes.join('+')} | ${cell(r.note ?? r.cover ?? '')}${r.known ? ` (${r.known})` : ''} |`;
  const head = ['', '| Kind | Surface | Selector | Text | Sizes | Variants | Note |', '| --- | --- | --- | --- | --- | --- | --- |'];
  out.push('', '## Defects', ...head, ...fresh.sort((a, b) => a.surface.localeCompare(b.surface) || a.kind.localeCompare(b.kind)).map(row));
  if (known.length) out.push('', '## Already boarded (not counted)', ...head, ...known.map(row));
  out.push('', '## Pruned by the allowlist', '');
  for (const [why, n] of Object.entries(suppressed)) out.push(`- ${n} x ${why}`);
  if (!Object.keys(suppressed).length) out.push('- none');
  if (skipped.length) out.push('', '## Not reachable at some widths', '', ...skipped.map((e) => `- ${e}`));
  if (errors.length) out.push('', '## Surfaces that did not set up', '', ...errors.map((e) => `- ${e}`));
  return `${out.join('\n')}\n`;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const F = loadCorpus();
  let all = scenes(F);
  if (opts.list) {
    for (const sc of all) for (const s of sc.steps) console.log(`${s.id.padEnd(28)}${s.group.padEnd(14)}scene ${sc.id}`);
    return 0;
  }
  if (opts.only) {
    const hit = (s, o) => s.id === o || s.group.toLowerCase() === o.toLowerCase();
    const bad = opts.only.filter((o) => !all.some((sc) => sc.steps.some((s) => hit(s, o))));
    if (bad.length) throw new Error(`unknown surface ${bad.join(', ')}; --list shows them`);
    all = all.map((sc) => ({ ...sc, steps: sc.steps.filter((s) => opts.only.some((o) => hit(s, o))) })).filter((sc) => sc.steps.length);
  }
  const { launchWebkit } = await import('./playwright-webkit.mjs');
  const support = await import('../apps/desktop/test/support/two-pane.mjs');
  const browser = await launchWebkit();
  const t0 = Date.now();
  const tasks = all.flatMap((sc) => THEMES.filter((t) => opts.themes.includes(t.id)).flatMap((t) => opts.widths.map((w) => ({ sc, t, w }))));
  const results = [];
  try {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(opts.workers, tasks.length) }, async () => {
        const contexts = { browser, byTheme: new Map() };
        for (;;) {
          const task = tasks[next++];
          if (!task) return;
          for (let attempt = 1; ; attempt++) {
            try {
              results.push(...(await runScene(contexts, support, F, task.sc, task.sc.steps, task.t, task.w, opts.heights, opts)));
              break;
            } catch (e) {
              if (attempt < 3) continue; // a dropped dev-server request: boot it again
              for (const s of task.sc.steps) results.push({ surface: s.id, group: s.group, theme: task.t.id, width: task.w, cells: [], errors: [`${task.w}: boot: ${e.message.split('\n')[0]}`] });
              break;
            }
          }
        }
      }),
    );
  } finally {
    await browser.close();
    await support.closeHarness();
  }
  results.sort((a, b) => a.surface.localeCompare(b.surface) || a.theme.localeCompare(b.theme) || a.width - b.width);
  const folded = fold(results);
  const seconds = Math.round((Date.now() - t0) / 1000);
  const md = markdown(folded, { cells: results.reduce((n, r) => n + r.cells.length, 0), seconds, surfaces: new Set(results.map((r) => r.surface)).size });
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(folded.list, null, 1)}\n`);
  if (opts.md) writeFileSync(opts.md, md);
  process.stdout.write(md);
  return opts.fail && folded.list.some((r) => !r.known) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`layout-audit: ${e.message}`);
    process.exitCode = 2;
  }
}
