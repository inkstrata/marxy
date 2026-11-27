// One chapter of a book, its XHTML read into the office page's model of blocks and runs, so it is written as Markdown by
// the one writer and drawn by the one renderer and sanitiser. What is read: headings, paragraphs, lists, tables, quotes,
// code, rules, links, emphasis and pictures. What is not: styles, classes, scripts, forms, media, and anything the chapter
// names outside the book (a picture on the web is held back and named). An `id` a link or the contents may lead to is
// kept as a mark before the top-level block that holds it. Pure.
import { inlineText, run, type Block, type Inline, type OfficeImage, type Run } from '../office/model.ts';
import { find, LENIENT_ROOT, type XmlElement } from '../office/xml.ts';
import { entryOf } from './package.ts';
import { pushAll } from '../util/spread.ts';

export interface ChapterContext {
  /** The chapter's own zip entry, which its addresses are read against. */
  readonly path: string;
  /** Whether the book holds a zip entry of this name. */
  has(name: string): boolean;
  /** The key a link inside the book is written under (`#bkN`), or null when it leads to no chapter. */
  linkKey(path: string, frag: string | null): string | null;
  /** The mark id for a place in a chapter. */
  markOf(path: string, id: string): string;
  readonly images: OfficeImage[];
  /** Pictures the chapter names on the web or by a data address: held back, never fetched. */
  heldBack: number;
  readonly leftOut: Set<string>;
}

type Look = Omit<Run, 't' | 'text'>;

const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption', 'blockquote', 'ul', 'ol',
  'dl', 'dt', 'dd', 'li', 'pre', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'address', 'hgroup', 'center', 'body', 'details', 'summary',
]);
/** Never read: what would run, ask, play or style; a chapter's head. */
const SKIP = new Set(['script', 'style', 'head', 'noscript', 'template', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'audio', 'video', 'canvas', 'link', 'meta', 'title', 'rt', 'rp']);
const LEFT_OUT: Readonly<Record<string, string>> = { audio: 'sound', video: 'film', object: 'embedded objects', embed: 'embedded objects', iframe: 'embedded pages', form: 'forms', math: 'equations as markup (their text is kept)', canvas: 'drawings made by scripts', script: 'scripts, which never run' };

const space = (s: string): string => s.replace(/[\t\n\r\f ]+/g, ' ');

/** The ids in `el` and below, in document order: the places a link or the contents may name. */
function idsIn(el: XmlElement, out: string[] = []): string[] {
  if (el.attrs.id) out.push(el.attrs.id);
  for (const k of el.kids) if (typeof k !== 'string') idsIn(k, out);
  return out;
}

export function chapterBlocks(body: XmlElement, ctx: ChapterContext): Block[] {
  const picture = (src: string, alt: string): Inline | null => {
    const at = entryOf(ctx.path, src);
    if (!at || !ctx.has(at.path)) {
      if (/^(?:https?:|data:|\/\/)/i.test(src.trim())) ctx.heldBack++;
      ctx.images.push({ entry: null, alt, what: 'linked picture' });
    } else ctx.images.push({ entry: at.path, alt, what: 'picture' });
    return { t: 'image', image: ctx.images.length - 1 };
  };

  /** An inline SVG as a picture: the image it holds when it holds one from the book; its drawing is not drawn. */
  const svgPicture = (svg: XmlElement): Inline | null => {
    const stack: XmlElement[] = [svg];
    while (stack.length > 0) {
      const at = stack.shift()!;
      if (at.name === 'image') return picture(at.full['xlink:href'] ?? at.attrs.href ?? '', clean(textOf(svg, 'title')) ?? '');
      for (const k of at.kids) if (typeof k !== 'string') stack.push(k);
    }
    ctx.leftOut.add('drawings in SVG');
    return null;
  };

  const inlines = (el: XmlElement, look: Look, out: Inline[]): Inline[] => {
    for (const k of el.kids) {
      if (typeof k === 'string') {
        const text = space(k);
        if (text !== '') out.push(run(text, look));
        continue;
      }
      inlineOf(k, look, out);
    }
    return out;
  };

  const inlineOf = (k: XmlElement, look: Look, out: Inline[]): void => {
    const name = k.name;
    if (SKIP.has(name)) {
      const why = LEFT_OUT[name];
      if (why) ctx.leftOut.add(why);
      return;
    }
    switch (name) {
      case 'br':
        out.push({ t: 'br' });
        return;
      case 'img':
        if (k.attrs.src !== undefined) {
          const p = picture(k.attrs.src, k.attrs.alt ?? '');
          if (p) out.push(p);
        }
        return;
      case 'svg': {
        const p = svgPicture(k);
        if (p) out.push(p);
        return;
      }
      case 'b':
      case 'strong':
        inlines(k, { ...look, b: true }, out);
        return;
      case 'i':
      case 'em':
      case 'cite':
      case 'dfn':
      case 'var':
        inlines(k, { ...look, i: true }, out);
        return;
      case 's':
      case 'del':
      case 'strike':
        inlines(k, { ...look, s: true }, out);
        return;
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        inlines(k, { ...look, code: true }, out);
        return;
      case 'sub':
        inlines(k, { ...look, sub: true }, out);
        return;
      case 'sup':
        inlines(k, { ...look, sup: true }, out);
        return;
      case 'math':
        ctx.leftOut.add(LEFT_OUT.math!);
        out.push(run(space(textOf(k)), look));
        return;
      case 'a': {
        const kids = inlines(k, look, []);
        const href = (k.attrs.href ?? '').trim();
        let to = '';
        if (/^(?:https?|mailto):/i.test(href)) to = href;
        else if (href !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          const at = entryOf(ctx.path, href);
          to = at ? (ctx.linkKey(at.path, at.frag) ?? '') : '';
        }
        if (to) out.push({ t: 'link', href: to, kids });
        else pushAll(out, kids);
        return;
      }
      default:
        inlines(k, look, out);
    }
  };

  const trimmed = (kids: Inline[]): Inline[] => {
    // XHTML's spaces between tags are not the text's: a run's leading and trailing spaces at a block's edges go.
    const first = kids.findIndex((x) => x.t !== 'run' || x.text.trim() !== '');
    let last = kids.length - 1;
    while (last >= 0 && kids[last]!.t === 'run' && (kids[last] as Run).text.trim() === '') last--;
    if (first < 0) return [];
    const out = kids.slice(first, last + 1);
    const a = out[0];
    if (a?.t === 'run') out[0] = { ...a, text: a.text.replace(/^ +/, '') };
    const z = out[out.length - 1];
    if (z?.t === 'run') out[out.length - 1] = { ...z, text: z.text.replace(/ +$/, '') };
    return out;
  };

  /** The blocks of `el`'s children; runs of inline content between blocks become paragraphs. */
  const blocksOf = (el: XmlElement): Block[] => {
    const out: Block[] = [];
    let loose: Inline[] = [];
    const flush = (): void => {
      const kids = trimmed(loose);
      loose = [];
      if (kids.length > 0) out.push({ t: 'para', kids });
    };
    for (const k of el.kids) {
      if (typeof k === 'string') {
        loose.push(run(space(k)));
        continue;
      }
      if (BLOCK.has(k.name) || (k.name === 'img' && loose.every((x) => x.t === 'run' && x.text.trim() === ''))) {
        flush();
        pushAll(out, blockOf(k));
      } else inlineOf(k, {}, loose);
    }
    flush();
    return out;
  };

  const blockOf = (k: XmlElement): Block[] => {
    switch (k.name) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const kids = trimmed(inlines(k, {}, []));
        return kids.length > 0 ? [{ t: 'heading', level: Number(k.name[1]), kids }] : [];
      }
      case 'p':
      case 'dt':
      case 'figcaption':
      case 'summary':
      case 'address': {
        // A paragraph that holds blocks (a `p` around a `div`, which XHTML allows no more than HTML does) is read as them.
        if (k.kids.some((x) => typeof x !== 'string' && BLOCK.has(x.name))) return blocksOf(k);
        const kids = trimmed(inlines(k, k.name === 'dt' ? { b: true } : {}, []));
        return kids.length > 0 ? [{ t: 'para', kids }] : [];
      }
      case 'blockquote':
      case 'dd': {
        const blocks = blocksOf(k);
        return blocks.length > 0 ? [{ t: 'quote', blocks }] : [];
      }
      case 'pre':
        return [{ t: 'code', text: textOf(k).replace(/^\n/, '').replace(/\s+$/, '') }];
      case 'hr':
        return [{ t: 'rule' }];
      case 'ul':
      case 'ol': {
        const items = kidsOf(k, 'li').map((li) => blocksOf(li));
        if (items.length === 0) return [];
        const start = Number.parseInt(k.attrs.start ?? '1', 10);
        return [{ t: 'list', ordered: k.name === 'ol', start: Number.isFinite(start) ? start : 1, items }];
      }
      case 'table': {
        const rows: Inline[][][] = [];
        const walk = (el: XmlElement): void => {
          for (const x of el.kids) {
            if (typeof x === 'string') continue;
            if (x.name === 'tr') rows.push(kidsOf(x).filter((c) => c.name === 'td' || c.name === 'th').map((c) => trimmed(inlines(c, {}, []))));
            else if (x.name === 'thead' || x.name === 'tbody' || x.name === 'tfoot') walk(x);
          }
        };
        walk(k);
        return rows.length > 0 ? [{ t: 'table', rows }] : [];
      }
      case 'img': {
        const p = k.attrs.src !== undefined ? picture(k.attrs.src, k.attrs.alt ?? '') : null;
        return p ? [{ t: 'para', kids: [p] }] : [];
      }
      default:
        return SKIP.has(k.name) ? [] : blocksOf(k);
    }
  };

  // The page's top-level blocks: wrappers (a chapter's one `section`, a `div` per scene) are gone into, and each block is
  // led by the marks of the ids inside it, so a link to any of them lands on it.
  const out: Block[] = [];
  const mark = (id: string): void => void out.push({ t: 'mark', id: ctx.markOf(ctx.path, id) });
  const topLevel = (el: XmlElement, depth: number): void => {
    if (el.attrs.id) mark(el.attrs.id);
    let loose: (XmlElement | string)[] = [];
    const flush = (): void => {
      for (const x of loose) if (typeof x !== 'string') for (const id of idsIn(x)) mark(id);
      const kids = trimmed(inlines({ name: 'p', attrs: {}, full: {}, kids: loose }, {}, []));
      loose = [];
      if (kids.length > 0) out.push({ t: 'para', kids });
    };
    for (const k of el.kids) {
      if (typeof k === 'string' || SKIP.has(k.name)) {
        loose.push(k);
        continue;
      }
      if (CONTAINER.has(k.name) && depth < 64) {
        flush();
        topLevel(k, depth + 1);
      } else if (BLOCK.has(k.name) || (k.name === 'img' && loose.every((x) => typeof x === 'string' && x.trim() === ''))) {
        flush();
        for (const id of idsIn(k)) mark(id);
        pushAll(out, blockOf(k));
      } else loose.push(k);
    }
    flush();
  };
  topLevel(body, 0);
  return out;
}

/** Elements that only wrap blocks: the page's top level goes on inside them. */
const CONTAINER = new Set([LENIENT_ROOT, 'html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'hgroup', 'center', 'details', 'figure']);

const kidsOf = (el: XmlElement, name?: string): XmlElement[] => el.kids.filter((k): k is XmlElement => typeof k !== 'string' && (name === undefined || k.name === name));

function textOf(el: XmlElement | null | undefined, only?: string): string {
  if (!el) return '';
  if (only !== undefined) {
    const k = el.kids.find((x): x is XmlElement => typeof x !== 'string' && x.name === only);
    return k ? textOf(k) : '';
  }
  let s = '';
  for (const k of el.kids) s += typeof k === 'string' ? k : textOf(k);
  return s;
}

const clean = (s: string): string | null => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

/** A chapter's own name: its first heading, else its `<title>`. */
export function chapterTitle(blocks: readonly Block[], html: XmlElement): string | null {
  for (const b of blocks) if (b.t === 'heading') return clean(inlineText(b.kids));
  const head = find(html, 'head');
  return head ? clean(textOf(head, 'title')) : null;
}
