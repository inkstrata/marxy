// The specimen: one long proof, read top to bottom, in
// which every kind of text follows the last at its true width (prose, code, data, a table, a log, a patch, a talk, and
// a few lines in each language with a palette), each set as the look sets that kind. Not a grid: a theme is judged the
// way it is read, a page at a time, and the pointer over a theme on the shelf turns the whole proof to it.
import { LANG_PALETTES } from '@marxy/theme';
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { btn, el } from '../frame/dom.ts';
import { fillStudioPage } from '../render/studio-pages.ts';
import type { Leaf, SpecimenKind, StudioPiece } from './context.ts';
import css from './galley.css?inline';
import { KIND_NAMES, LANGUAGE_SPECIMENS } from './specimens.ts';

const LINES = 4;

/** The first few lines of each language's specimen, each under its name, in the palettes' order. */
function languagesPage(): string {
  const parts: string[] = [];
  for (const [id, pal] of Object.entries(LANG_PALETTES)) {
    const spec = LANGUAGE_SPECIMENS[id];
    if (!spec) continue;
    const lines = spec.split('\n');
    const body = lines.slice(1, -1).filter((l) => l.trim() !== '').slice(0, LINES);
    parts.push(`#### ${pal.name}`, '', lines[0]!, ...body, '```', '');
  }
  return parts.join('\n');
}

interface Section {
  readonly kind: SpecimenKind;
  readonly langs: boolean;
  readonly el: HTMLElement;
  readonly frame: HTMLElement;
  readonly leaf: Leaf;
}

export const mountGalley: StudioPiece = (host, ctx) => {
  adoptRuntimeSheet(document, 'marxy-studio-galley-style', css);
  const column = el('div', 'marxy-studio-galley');
  column.tabIndex = 0;
  column.setAttribute('aria-label', 'The specimen: every kind of text in the look');
  const sections: Section[] = [];
  // In the document before any page is made: the highlighter drops a queued job whose block is not connected when the next
  // one arrives (highlight.ts dropClosedJobs), so each page goes in before the next is filled, or only the last is coloured.
  host.append(column);
  const kinds: (readonly [SpecimenKind, string, boolean])[] = [...KIND_NAMES.map(([k, n]) => [k, n, false] as const), ['code', 'Languages', true]];
  // A line of the proof's own contents: each name scrolls to its page (the top bar keeps no row of kinds).
  const index = el('nav', 'marxy-studio-galley-index');
  index.setAttribute('aria-label', 'The kinds of text in the specimen');
  column.append(index);
  for (const [kind, name, langs] of kinds) {
    const sec = el('section', 'marxy-studio-galley-sec');
    sec.dataset.marxyKind = langs ? 'languages' : kind;
    const head = el('div', 'marxy-studio-galley-h');
    head.append(el('span', 'marxy-studio-galley-name', name));
    head.append(btn('marxy-studio-link', langs ? 'work on code alone' : `work on ${name.toLowerCase()} alone`, () => ctx.setView({ sheet: false, kind, lang: null })));
    const frame = el('div', 'marxy-studio-galley-page');
    sec.append(head, frame);
    column.append(sec);
    const leaf = ctx.makeLeaf(kind, { short: kind === 'prose' ? 1400 : true, width: ctx.logicalWidth() });
    frame.append(leaf.el);
    sections.push({ kind, langs, el: sec, frame, leaf });
    index.append(btn('marxy-studio-galley-to', name, () => {
      sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (!langs) ctx.setView({ kind });
    }));
    if (langs) {
      // The leaf fills itself with one language first; the whole set replaces it once that is in.
      void leaf.ready
        .then(() => fillStudioPage(leaf.article, languagesPage()))
        .then(() => {
          for (const h of leaf.article.querySelectorAll('h4')) h.classList.add('marxy-studio-galley-langh');
          size();
        })
        .catch(() => undefined);
    }
    void leaf.ready.then(() => size());
  }

  /** Each page at its logical width, scaled to the column when the column is narrower; its frame as tall as it reads. */
  function size(): void {
    const W = ctx.logicalWidth();
    const avail = column.clientWidth - 48;
    if (avail <= 0) return;
    const s = Math.min(1, avail / W);
    // Writes, then every read, then writes: one layout for all eight pages, not one for each.
    for (const sec of sections) {
      const width = `${W}px`;
      const transform = s < 0.995 ? `scale(${s})` : '';
      if (sec.leaf.el.style.width !== width) sec.leaf.el.style.width = width;
      if (sec.leaf.el.style.transform !== transform) sec.leaf.el.style.transform = transform;
    }
    const heights = sections.map((sec) => sec.leaf.el.offsetHeight);
    sections.forEach((sec, i) => {
      const w = `${Math.round(W * s)}px`;
      const h = `${Math.ceil(heights[i]! * s)}px`;
      if (sec.frame.style.width !== w) sec.frame.style.width = w;
      if (sec.frame.style.height !== h) sec.frame.style.height = h;
    });
  }
  const grow = new ResizeObserver(() => size());
  grow.observe(column);
  for (const sec of sections) grow.observe(sec.leaf.el);

  let lastKind = ctx.view().kind;
  function paint(): void {
    const v = ctx.view();
    const W = ctx.logicalWidth();
    const over = ctx.canvasOver();
    for (const sec of sections) {
      ctx.paint(sec.leaf.el, ctx.contextOf(sec.kind, W), over);
      sec.el.toggleAttribute('data-marxy-on', !sec.langs && sec.kind === v.kind);
    }
    if (v.kind !== lastKind) {
      lastKind = v.kind;
      sections.find((sec) => !sec.langs && sec.kind === v.kind)?.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    size();
  }
  const off = ctx.onPaint(paint);
  paint();

  return () => {
    off();
    grow.disconnect();
    column.remove();
  };
};
