// OpenDocument text (.odt) and presentations (.odp), read into the same model as Word and PowerPoint: headings by
// outline level, paragraphs, lists (numbered or bulleted by their list style), tables, links, bold, italic, struck and
// fixed-width spans from the automatic styles, notes, comments, pictures by their description, and a presentation's
// pages with their speaker notes. Layout, fonts and page styles are not read. Pure.
import { inlineText, run, type Block, type Inline, type OfficeDoc, type OfficeFormat, type OfficeImage, type OfficeNote } from './model.ts';
import { odfProps, openPackage, resolvePart, type PartRead } from './parts.ts';
import { kid, kidsOf, newBudget, OfficeError, textOf, type XmlElement } from './xml.ts';
import { pushAll } from '../util/spread.ts';

const MONO = /mono|courier|consolas|menlo|monaco|source code|liberation mono|dejavu sans mono/i;
const CODE_STYLE = /code|preformatted|source|verbatim|listing/i;
const QUOTE_STYLE = /quot/i;

interface Look {
  readonly b?: boolean;
  readonly i?: boolean;
  readonly s?: boolean;
  readonly code?: boolean;
  readonly sub?: boolean;
  readonly sup?: boolean;
}

interface Styles {
  /** A text style's look, by name. */
  readonly text: Map<string, Look>;
  /** A paragraph style's name and the names of the styles it comes from. */
  readonly para: Map<string, { parent: string | null; display: string; look: Look }>;
  /** A list style's levels: numbered or not. */
  readonly lists: Map<string, boolean[]>;
}

function lookOf(props: XmlElement | null, faces: ReadonlyMap<string, string>): Look {
  if (!props) return {};
  const a = props.attrs;
  const pos = a['text-position'] ?? '';
  const face = faces.get(a['font-name'] ?? '') ?? a['font-name'] ?? a['font-family'] ?? '';
  return {
    b: a['font-weight'] === 'bold' || Number(a['font-weight']) >= 600 || undefined,
    i: a['font-style'] === 'italic' || a['font-style'] === 'oblique' || undefined,
    s: (a['text-line-through-style'] ?? 'none') !== 'none' || undefined,
    code: MONO.test(face) || undefined,
    sup: /^super/.test(pos) || (/^\d/.test(pos) && Number.parseFloat(pos) > 0) || undefined,
    sub: /^sub/.test(pos) || /^-\d/.test(pos) || undefined,
  };
}

function readStyles(roots: readonly (XmlElement | null)[], into: Styles): void {
  for (const root of roots) {
    const faces = new Map<string, string>();
    for (const f of kidsOf(kid(root, 'font-face-decls'), 'font-face')) faces.set(f.attrs.name ?? '', f.attrs['font-family'] ?? '');
    for (const holder of [kid(root, 'automatic-styles'), kid(root, 'styles')]) {
      for (const s of kidsOf(holder)) {
        const name = s.attrs.name;
        if (!name) continue;
        if (s.name === 'style') {
          const look = lookOf(kid(s, 'text-properties'), faces);
          if (s.attrs.family === 'text') into.text.set(name, look);
          else if (s.attrs.family === 'paragraph') into.para.set(name, { parent: s.attrs['parent-style-name'] ?? null, display: s.attrs['display-name'] ?? name.replace(/_20_/g, ' '), look });
        } else if (s.name === 'list-style') {
          const levels: boolean[] = [];
          for (const l of kidsOf(s)) {
            const lv = Number(l.attrs.level ?? 1) - 1;
            if (lv >= 0 && lv < 10) levels[lv] = l.name === 'list-level-style-number' && (l.attrs['num-format'] ?? '1') !== '';
          }
          into.lists.set(name, levels);
        }
      }
    }
  }
}

function paraNamed(styles: Styles, name: string | undefined, re: RegExp): boolean {
  const seen = new Set<string>();
  for (let at = name ?? null; at && !seen.has(at); at = styles.para.get(at)?.parent ?? null) {
    seen.add(at);
    if (re.test(styles.para.get(at)?.display ?? at.replace(/_20_/g, ' '))) return true;
  }
  return false;
}

interface Ctx {
  readonly styles: Styles;
  readonly images: OfficeImage[];
  readonly leftOut: Set<string>;
  readonly notes: OfficeNote[];
  readonly comments: Block[];
  readonly from: string;
  counted: { comments: number; footnotes: number; endnotes: number };
}

function inlinesOf(ctx: Ctx, el: XmlElement, look: Look, out: Inline[] = []): Inline[] {
  for (const k of el.kids) {
    if (typeof k === 'string') {
      out.push(run(k.replace(/[\r\n\t]+/g, ' '), look));
      continue;
    }
    switch (k.name) {
      case 's':
        out.push(run(' '.repeat(Math.min(64, Number(k.attrs.c ?? 1) || 1)), look));
        break;
      case 'tab':
        out.push(run(' ', look));
        break;
      case 'line-break':
        out.push({ t: 'br' });
        break;
      case 'span':
        inlinesOf(ctx, k, { ...look, ...strip(ctx.styles.text.get(k.attrs['style-name'] ?? '') ?? {}) }, out);
        break;
      case 'a': {
        const href = k.full['xlink:href'] ?? k.attrs.href ?? '';
        const link: Inline = { t: 'link', href: href.startsWith('#') ? '' : href, kids: [] };
        inlinesOf(ctx, k, look, link.kids);
        out.push(link);
        break;
      }
      case 'note': {
        const end = k.attrs['note-class'] === 'endnote';
        if (end) ctx.counted.endnotes += 1;
        else ctx.counted.footnotes += 1;
        const label = `n${ctx.notes.length + 1}`;
        const body = kid(k, 'note-body');
        ctx.notes.push({ label, blocks: [] });
        const note = ctx.notes[ctx.notes.length - 1]!;
        pushAll(note.blocks, blocksOf(ctx, body));
        out.push({ t: 'note', label });
        break;
      }
      case 'annotation': {
        ctx.counted.comments += 1;
        const who = textOf(kid(k, 'creator')).trim();
        const when = textOf(kid(k, 'date')).trim() || null;
        ctx.comments.push({ t: 'aside', who: who || 'A comment', when, blocks: blocksOf(ctx, k) });
        break;
      }
      case 'frame':
        pushAll(out, frame(ctx, k));
        break;
      case 'bookmark':
      case 'bookmark-start':
      case 'bookmark-end':
      case 'annotation-end':
      case 'soft-page-break':
      case 'reference-mark':
        break;
      default:
        // Fields (page numbers, dates, cross-references) are their shown text.
        inlinesOf(ctx, k, look, out);
    }
  }
  return out;
}

const strip = (l: Look): Look => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as Look;

/** A drawing frame inside text: its picture, or its text box's words. */
function frame(ctx: Ctx, f: XmlElement): Inline[] {
  const alt = (textOf(kid(f, 'desc')) || textOf(kid(f, 'title')) || '').replace(/\s+/g, ' ').trim();
  const image = kid(f, 'image');
  if (image) {
    const href = image.full['xlink:href'] ?? image.attrs.href ?? '';
    const external = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('..');
    const img: OfficeImage = href === '' ? { entry: null, alt, what: 'object' } : external ? { entry: null, alt, what: 'linked picture' } : { entry: resolvePart(ctx.from, href), alt, what: 'picture' };
    if (img.what === 'linked picture') ctx.leftOut.add('linked pictures');
    ctx.images.push(img);
    return [{ t: 'image', image: ctx.images.length - 1 }];
  }
  if (kid(f, 'object') || kid(f, 'object-ole')) {
    ctx.leftOut.add('embedded objects');
    ctx.images.push({ entry: null, alt, what: 'object' });
    return [{ t: 'image', image: ctx.images.length - 1 }];
  }
  const box = kid(f, 'text-box');
  if (!box) return [];
  const out: Inline[] = [];
  for (const b of blocksOf(ctx, box)) {
    if (b.t !== 'para' && b.t !== 'heading') continue;
    if (out.length > 0) out.push({ t: 'br' });
    pushAll(out, b.kids);
  }
  return out;
}

const hasWords = (kids: readonly Inline[]): boolean => kids.some((k) => (k.t === 'run' ? k.text.trim() !== '' : k.t === 'link' ? hasWords(k.kids) : k.t !== 'br'));

function paraBlock(ctx: Ctx, p: XmlElement): Block | null {
  const style = p.attrs['style-name'];
  const kids = inlinesOf(ctx, p, strip(ctx.styles.para.get(style ?? '')?.look ?? {}));
  if (!hasWords(kids)) return null;
  if (p.name === 'h') return { t: 'heading', level: Math.min(6, Math.max(1, Number(p.attrs['outline-level'] ?? 1) || 1)), kids };
  if (paraNamed(ctx.styles, style, /^title$/i)) return { t: 'heading', level: 1, kids };
  if (paraNamed(ctx.styles, style, CODE_STYLE)) return { t: 'code', text: kids.map((k) => (k.t === 'br' ? '\n' : k.t === 'run' ? k.text : k.t === 'link' ? inlineText(k.kids) : '')).join('') };
  if (paraNamed(ctx.styles, style, QUOTE_STYLE)) return { t: 'quote', blocks: [{ t: 'para', kids }] };
  return { t: 'para', kids };
}

function listBlock(ctx: Ctx, list: XmlElement, styleName: string | undefined, level: number): Block | null {
  const name = list.attrs['style-name'] ?? styleName;
  const ordered = ctx.styles.lists.get(name ?? '')?.[Math.min(level, 9)] ?? false;
  const items: Block[][] = [];
  for (const li of kidsOf(list)) {
    if (li.name !== 'list-item' && li.name !== 'list-header') continue;
    const item: Block[] = [];
    for (const k of kidsOf(li)) {
      if (k.name === 'list') {
        const nested = listBlock(ctx, k, name, level + 1);
        if (nested) item.push(nested);
      } else if (k.name === 'p' || k.name === 'h') {
        const b = paraBlock(ctx, k);
        if (b) item.push(b.t === 'heading' ? { t: 'para', kids: b.kids } : b);
      }
    }
    if (item.length > 0) items.push(item);
  }
  const start = Number(kidsOf(list)[0]?.attrs['start-value'] ?? 1) || 1;
  return items.length > 0 ? { t: 'list', ordered, start, items } : null;
}

function tableBlock(ctx: Ctx, table: XmlElement): Block | null {
  const rows: Inline[][][] = [];
  const rowsOf = (el: XmlElement): XmlElement[] => kidsOf(el).flatMap((k) => (k.name === 'table-row' ? [k] : /^table-(header-)?rows$|^table-row-group$/.test(k.name) ? rowsOf(k) : []));
  for (const tr of rowsOf(table)) {
    const cells: Inline[][] = [];
    for (const tc of kidsOf(tr)) {
      if (tc.name === 'covered-table-cell') {
        cells.push([]);
        continue;
      }
      if (tc.name !== 'table-cell') continue;
      const out: Inline[] = [];
      for (const b of blocksOf(ctx, tc)) {
        const words = b.t === 'para' || b.t === 'heading' ? b.kids : b.t === 'list' ? b.items.flatMap((i) => i.flatMap((x) => (x.t === 'para' ? [run('• '), ...x.kids] : []))) : [];
        if (words.length === 0) continue;
        if (out.length > 0) out.push({ t: 'br' });
        pushAll(out, words);
      }
      cells.push(out);
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows.some((r) => r.some((c) => c.length > 0)) ? { t: 'table', rows } : null;
}

/** The blocks of a body, a section, a note, a comment or a cell; comments come after the block they sit in. */
function blocksOf(ctx: Ctx, body: XmlElement | null): Block[] {
  const out: Block[] = [];
  const asides = (): void => {
    if (ctx.comments.length > 0) pushAll(out, ctx.comments.splice(0));
  };
  for (const k of kidsOf(body)) {
    let b: Block | null = null;
    if (k.name === 'p' || k.name === 'h') b = paraBlock(ctx, k);
    else if (k.name === 'list') b = listBlock(ctx, k, undefined, 0);
    else if (k.name === 'table') b = tableBlock(ctx, k);
    else if (k.name === 'section' || k.name === 'index-body' || k.name === 'deletion') {
      if (k.name !== 'deletion') pushAll(out, blocksOf(ctx, k));
      continue;
    } else if (/-index$|^table-of-content$/.test(k.name)) {
      pushAll(out, blocksOf(ctx, kid(k, 'index-body')));
      continue;
    } else if (k.name === 'tracked-changes') continue;
    const last = out[out.length - 1];
    if (b?.t === 'code' && last?.t === 'code') out[out.length - 1] = { t: 'code', text: `${last.text}\n${b.text}` };
    else if (b?.t === 'quote' && last?.t === 'quote') pushAll(last.blocks, b.blocks);
    else if (b) out.push(b);
    asides();
  }
  return out;
}

/** An OpenDocument presentation's page: its title frame, its other frames in order, then its notes. */
function pageBlocks(ctx: Ctx, page: XmlElement, n: number): { blocks: Block[]; noted: boolean } {
  let title: Inline[] | null = null;
  const body: Block[] = [];
  const frames = (el: XmlElement): void => {
    for (const k of kidsOf(el)) {
      if (k.name === 'g') {
        frames(k);
        continue;
      }
      if (k.name !== 'frame' && k.name !== 'custom-shape' && k.name !== 'rect' && k.name !== 'ellipse') continue;
      const cls = k.attrs.class ?? '';
      if (cls === 'page-number' || cls === 'footer' || cls === 'date-time' || cls === 'header') continue;
      const box = kid(k, 'text-box') ?? (k.name === 'frame' ? null : k);
      if (cls === 'title' && box && title === null) {
        const words = blocksOf(ctx, box).flatMap((b) => (b.t === 'para' || b.t === 'heading' ? b.kids : []));
        if (hasWords(words)) title = words.map((x) => (x.t === 'br' ? run(' ') : x));
        continue;
      }
      const table = kid(k, 'table');
      if (table) {
        const t = tableBlock(ctx, table);
        if (t) body.push(t);
        continue;
      }
      if (box) {
        const blocks = blocksOf(ctx, box);
        // An outline frame's paragraphs are its bullets, as the master draws them.
        if (cls === 'outline' && blocks.length > 0 && blocks.every((b) => b.t === 'para')) body.push({ t: 'list', ordered: false, start: 1, items: blocks.map((b) => [b]) });
        else pushAll(body, blocks);
        continue;
      }
      const pic = frame(ctx, k);
      if (pic.length > 0) body.push({ t: 'para', kids: pic });
    }
  };
  frames(page);
  const notesBox = kidsOf(kid(page, 'notes')).filter((f) => f.attrs.class === 'notes').map((f) => kid(f, 'text-box'));
  const notes = notesBox.flatMap((b) => (b ? blocksOf(ctx, b) : []));
  const blocks: Block[] = [{ t: 'heading', level: 2, kids: title ?? [], slide: { n, hidden: page.attrs.visibility === 'hidden' } }, ...body];
  if (notes.length > 0) blocks.push({ t: 'aside', who: 'Speaker notes', when: null, blocks: notes });
  return { blocks, noted: notes.length > 0 };
}

export async function readOdf(format: OfficeFormat, read: PartRead): Promise<OfficeDoc> {
  const pkg = openPackage(read, newBudget());
  const content = await pkg.xml('content.xml');
  if (!content) throw new OfficeError('The file holds no content.xml: it is a zip, but not an OpenDocument file Marxy can read.');
  const styles: Styles = { text: new Map(), para: new Map(), lists: new Map() };
  readStyles([await pkg.xml('styles.xml').catch(() => null), content], styles);
  const ctx: Ctx = { styles, images: [], leftOut: new Set(), notes: [], comments: [], from: 'content.xml', counted: { comments: 0, footnotes: 0, endnotes: 0 } };
  const body = kid(content, 'body');
  const counts = { comments: 0, footnotes: 0, endnotes: 0, slides: 0, hiddenSlides: 0, speakerNotes: 0 };
  let blocks: Block[] = [];
  if (format === 'odp') {
    const pres = kid(body, 'presentation');
    if (!pres) throw new OfficeError('content.xml holds no presentation.');
    for (const page of kidsOf(pres, 'page')) {
      counts.slides += 1;
      if (page.attrs.visibility === 'hidden') counts.hiddenSlides += 1;
      const got = pageBlocks(ctx, page, counts.slides);
      if (got.noted) counts.speakerNotes += 1;
      pushAll(blocks, got.blocks);
    }
  } else {
    const text = kid(body, 'text');
    if (!text) throw new OfficeError('content.xml holds no text body.');
    blocks = blocksOf(ctx, text);
  }
  const props = await odfProps(pkg);
  return {
    format,
    blocks,
    notes: ctx.notes,
    images: ctx.images,
    props,
    counts: { ...counts, comments: ctx.counted.comments, footnotes: ctx.counted.footnotes, endnotes: ctx.counted.endnotes },
    leftOut: ctx.leftOut,
  };
}

