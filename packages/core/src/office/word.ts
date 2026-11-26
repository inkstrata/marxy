// A Word document (.docx) read as text: headings from heading styles and outline levels, paragraphs, numbered and
// bulleted lists from the numbering part, tables, links, bold, italic, struck and code-like runs, footnotes and endnotes,
// comments, pictures by their alt text. Fonts, colours, sizes, page setup, headers, footers and sections are not read.
// Tracked insertions read as written and deletions as gone, as the document reads once its changes are accepted. Pure.
import { inlineText, run, type Block, type Inline, type OfficeDoc, type OfficeImage, type OfficeNote, type Run } from './model.ts';
import { officeProps, openPackage, relOfType, type Package, type PartRead, type Rel } from './parts.ts';
import { find, findAll, kid, kidsOf, newBudget, OfficeError, textOf, type XmlElement } from './xml.ts';

/** A style whose name says code: its paragraphs are a code block, its runs inline code. */
const CODE_STYLE = /code|source|preformatted|verbatim|listing|console|macro text/i;
const QUOTE_STYLE = /quot/i;
/** Faces set at a fixed width: a run in one reads as code. */
const MONO = /consolas|courier|menlo|monaco|lucida console|lucida sans typewriter|source code|fira (code|mono)|jetbrains|cascadia|inconsolata|dejavu sans mono|liberation mono|roboto mono|ubuntu mono|sf mono|\bmono\b|ocr/i;

interface Style {
  readonly name: string;
  readonly basedOn: string | null;
  readonly outline: number | null;
  readonly num: { readonly id: string; readonly level: number } | null;
  readonly b: boolean | null;
  readonly i: boolean | null;
  readonly s: boolean | null;
  readonly mono: boolean | null;
}

interface Level {
  readonly ordered: boolean;
  readonly start: number;
  readonly none: boolean;
}

interface Numbering {
  /** numId → its levels (from its abstract definition) and the starts its overrides set. */
  readonly nums: ReadonlyMap<string, { readonly levels: readonly Level[]; readonly restart: ReadonlyMap<number, number> }>;
}

const on = (el: XmlElement | null): boolean | null => {
  if (!el) return null;
  const v = (el.attrs.val ?? 'true').toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
};

const isMono = (rPr: XmlElement | null): boolean | null => {
  const f = kid(rPr, 'rFonts');
  if (!f) return null;
  const face = f.attrs.ascii ?? f.attrs.hAnsi ?? f.attrs.cs;
  return face ? MONO.test(face) : null;
};

function readStyles(root: XmlElement | null): Map<string, Style> {
  const out = new Map<string, Style>();
  for (const s of kidsOf(root, 'style')) {
    const id = s.attrs.styleId;
    if (!id) continue;
    const pPr = kid(s, 'pPr');
    const rPr = kid(s, 'rPr');
    const numPr = kid(pPr, 'numPr');
    const outline = kid(pPr, 'outlineLvl')?.attrs.val;
    const numId = kid(numPr, 'numId')?.attrs.val;
    out.set(id, {
      name: kid(s, 'name')?.attrs.val ?? id,
      basedOn: kid(s, 'basedOn')?.attrs.val ?? null,
      outline: outline !== undefined && /^\d$/.test(outline) ? Number(outline) : null,
      num: numId ? { id: numId, level: Number(kid(numPr, 'ilvl')?.attrs.val ?? 0) || 0 } : null,
      b: on(kid(rPr, 'b')),
      i: on(kid(rPr, 'i')),
      s: on(kid(rPr, 'strike')) ?? on(kid(rPr, 'dstrike')),
      mono: isMono(rPr),
    });
  }
  return out;
}

/** A style's value of `key`, from it or the first style it is based on that sets it. */
function inherited<K extends keyof Style>(styles: ReadonlyMap<string, Style>, id: string | null | undefined, key: K): Style[K] | null {
  const seen = new Set<string>();
  for (let at = id ?? null; at && !seen.has(at); at = styles.get(at)?.basedOn ?? null) {
    seen.add(at);
    const v = styles.get(at)?.[key];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Whether the style or one it is based on is named so. */
function styleNamed(styles: ReadonlyMap<string, Style>, id: string | null | undefined, re: RegExp): boolean {
  const seen = new Set<string>();
  for (let at = id ?? null; at && !seen.has(at); at = styles.get(at)?.basedOn ?? null) {
    seen.add(at);
    if (re.test(styles.get(at)?.name ?? at)) return true;
  }
  return false;
}

function readNumbering(root: XmlElement | null): Numbering {
  const abstracts = new Map<string, Level[]>();
  for (const a of kidsOf(root, 'abstractNum')) {
    const levels: Level[] = [];
    for (const l of kidsOf(a, 'lvl')) {
      const at = Number(l.attrs.ilvl ?? 0);
      const fmt = kid(l, 'numFmt')?.attrs.val ?? 'decimal';
      levels[at] = { ordered: fmt !== 'bullet', none: fmt === 'none', start: Number(kid(l, 'start')?.attrs.val ?? 1) || 0 };
    }
    abstracts.set(a.attrs.abstractNumId ?? '', levels);
  }
  const nums = new Map<string, { levels: Level[]; restart: Map<number, number> }>();
  for (const n of kidsOf(root, 'num')) {
    const levels = abstracts.get(kid(n, 'abstractNumId')?.attrs.val ?? '') ?? [];
    const restart = new Map<number, number>();
    for (const o of kidsOf(n, 'lvlOverride')) {
      const start = kid(o, 'startOverride')?.attrs.val;
      if (start !== undefined) restart.set(Number(o.attrs.ilvl ?? 0), Number(start) || 0);
    }
    nums.set(n.attrs.numId ?? '', { levels, restart });
  }
  return { nums };
}

/** A paragraph as read: what it is, its runs, and what it carries along (comments, text boxes). */
interface Para {
  readonly kind: 'heading' | 'title' | 'para' | 'code' | 'quote';
  readonly level: number;
  readonly list: { readonly num: string; readonly level: number } | null;
  readonly kids: Inline[];
  readonly comments: string[];
  readonly boxes: Block[];
}

interface Ctx {
  readonly pkg: Package;
  readonly part: string;
  readonly rels: ReadonlyMap<string, Rel>;
  readonly styles: ReadonlyMap<string, Style>;
  readonly numbering: Numbering;
  readonly images: OfficeImage[];
  readonly leftOut: Set<string>;
  /** Footnotes and endnotes in the order they are first marked, by kind and id: the label each is written with. */
  readonly marked: Map<string, { readonly kind: 'fn' | 'en'; readonly id: string; readonly label: string }>;
}

interface RunLook {
  readonly b?: boolean;
  readonly i?: boolean;
  readonly s?: boolean;
  readonly code?: boolean;
  readonly sub?: boolean;
  readonly sup?: boolean;
}

function runLook(ctx: Ctx, rPr: XmlElement | null, paraCode: boolean): RunLook {
  const style = kid(rPr, 'rStyle')?.attrs.val;
  const named = (re: RegExp): boolean => !!style && styleNamed(ctx.styles, style, re);
  const vert = kid(rPr, 'vertAlign')?.attrs.val;
  const b = on(kid(rPr, 'b')) ?? inherited(ctx.styles, style, 'b') ?? named(/^strong$/i);
  const i = on(kid(rPr, 'i')) ?? inherited(ctx.styles, style, 'i') ?? named(/^emphasis$/i);
  const s = on(kid(rPr, 'strike')) ?? on(kid(rPr, 'dstrike')) ?? inherited(ctx.styles, style, 's');
  const code = !paraCode && ((isMono(rPr) ?? inherited(ctx.styles, style, 'mono')) || named(CODE_STYLE));
  return { b: b || undefined, i: i || undefined, s: s || undefined, code: code || undefined, sub: vert === 'subscript' || undefined, sup: vert === 'superscript' || undefined };
}

/** The picture a `w:drawing` or `w:pict` holds, as an image the page draws or names. */
function drawingImage(ctx: Ctx, el: XmlElement): Inline | null {
  const docPr = find(el, 'docPr') ?? find(el, 'cNvPr');
  const shape = find(el, 'shape');
  const alt = (docPr?.attrs.descr ?? shape?.attrs.alt ?? docPr?.attrs.title ?? find(el, 'imagedata')?.attrs.title ?? '').replace(/\s+/g, ' ').trim();
  const graphic = find(el, 'graphicData');
  const uri = graphic?.attrs.uri ?? '';
  let image: OfficeImage | null = null;
  if (/chart/.test(uri)) image = { entry: null, alt, what: 'chart' };
  else if (/diagram/.test(uri)) image = { entry: null, alt, what: 'diagram' };
  else {
    const blip = find(el, 'blip');
    const data = find(el, 'imagedata');
    const embed = blip?.full['r:embed'] ?? data?.full['r:id'] ?? blip?.attrs.embed;
    const link = blip?.full['r:link'] ?? blip?.attrs.link;
    const rel = embed ? ctx.rels.get(embed) : link ? ctx.rels.get(link) : undefined;
    if (rel) image = rel.external ? { entry: null, alt, what: 'linked picture' } : { entry: rel.target, alt, what: 'picture' };
    // A drawn shape or a group of them: its words, if any, are read as a text box; the shape itself is decoration.
    else if (find(el, 'txbxContent') || /wordprocessing(Shape|Group|Canvas)/.test(uri)) return null;
    else if (graphic || data) image = { entry: null, alt, what: 'object' };
  }
  if (!image) return null;
  if (image.what === 'chart') ctx.leftOut.add('charts');
  if (image.what === 'diagram') ctx.leftOut.add('diagrams');
  if (image.what === 'linked picture') ctx.leftOut.add('linked pictures');
  ctx.images.push(image);
  return { t: 'image', image: ctx.images.length - 1 };
}

/** The address a field's code links to (`HYPERLINK "https://…"`), or null; a link inside the document (`\l`) is none. */
function fieldHref(instr: string): string | null {
  const m = /^\s*HYPERLINK\s+(?:"([^"]*)"|(\S+))/i.exec(instr);
  if (!m) return null;
  const href = (m[1] ?? m[2] ?? '').trim();
  return href === '' || /^\\l\b/i.test(href) ? null : href;
}

/** A paragraph's runs, with the fields, links, comments, notes and text boxes inside it. */
function paraInlines(ctx: Ctx, p: XmlElement, paraCode: boolean, comments: string[], boxes: Block[]): Inline[] {
  const root: Inline[] = [];
  // Where runs go now: the paragraph, or a link a field opened.
  let into: Inline[] = root;
  const fields: { instr: string; result: boolean; outer: Inline[] }[] = [];
  const inField = (): boolean => fields.some((f) => !f.result);

  const runKids = (r: XmlElement): void => {
    const look = runLook(ctx, kid(r, 'rPr'), paraCode);
    const text = (t: string): void => {
      if (t !== '' && !inField()) into.push(run(t, look));
    };
    for (const k of r.kids) {
      if (typeof k === 'string') continue;
      switch (k.name) {
        case 't':
          text(textOf(k));
          break;
        case 'tab':
        case 'ptab':
          text(' ');
          break;
        case 'br':
        case 'cr':
          if ((k.attrs.type ?? 'textWrapping') === 'textWrapping' && !inField()) into.push({ t: 'br' });
          break;
        case 'noBreakHyphen':
          text('‑');
          break;
        case 'softHyphen':
          text('­');
          break;
        case 'sym': {
          const code = Number.parseInt(k.attrs.char ?? '', 16);
          // A symbol font's private-use characters draw nothing in another face.
          if (code > 0 && !(code >= 0xe000 && code <= 0xf8ff)) text(String.fromCodePoint(code));
          break;
        }
        case 'fldChar': {
          const type = k.attrs.fldCharType;
          if (type === 'begin') fields.push({ instr: '', result: false, outer: into });
          else if (type === 'separate') {
            const f = fields[fields.length - 1];
            if (f && !f.result) {
              f.result = true;
              const href = fieldHref(f.instr);
              if (href && !inField()) {
                const link: Inline = { t: 'link', href, kids: [] };
                into.push(link);
                into = link.kids;
              }
            }
          } else if (type === 'end') {
            const f = fields.pop();
            if (f) into = f.outer;
          }
          break;
        }
        case 'instrText': {
          const f = fields[fields.length - 1];
          if (f && !f.result) f.instr += textOf(k);
          break;
        }
        case 'footnoteReference':
        case 'endnoteReference': {
          // Labelled by the order they are marked, never by the id the file gives them, which could say anything.
          const kind = k.name === 'footnoteReference' ? 'fn' : 'en';
          const id = k.attrs.id ?? '';
          const key = `${kind} ${id}`;
          let mark = ctx.marked.get(key);
          if (!mark) {
            mark = { kind, id, label: `n${ctx.marked.size + 1}` };
            ctx.marked.set(key, mark);
          }
          into.push({ t: 'note', label: mark.label });
          break;
        }
        case 'commentReference':
          if (k.attrs.id !== undefined) comments.push(k.attrs.id);
          break;
        case 'drawing':
        case 'pict': {
          const img = drawingImage(ctx, k);
          if (img) into.push(img);
          for (const box of findAll(k, 'txbxContent')) boxes.push(...bodyBlocks(ctx, box));
          break;
        }
        case 'object':
          ctx.leftOut.add('embedded objects');
          ctx.images.push({ entry: null, alt: '', what: 'object' });
          into.push({ t: 'image', image: ctx.images.length - 1 });
          break;
        case 'AlternateContent': {
          const choice = kid(k, 'Choice');
          if (choice) runKids({ ...r, kids: choice.kids });
          break;
        }
        default:
          break;
      }
    }
  };

  const walk = (el: XmlElement): void => {
    for (const k of el.kids) {
      if (typeof k === 'string') continue;
      switch (k.name) {
        case 'r':
          runKids(k);
          break;
        case 'hyperlink': {
          const id = k.full['r:id'];
          const rel = id ? ctx.rels.get(id) : undefined;
          if (rel?.external && !inField()) {
            const link: Inline = { t: 'link', href: rel.target, kids: [] };
            const outer = into;
            into.push(link);
            into = link.kids;
            walk(k);
            into = outer;
          } else walk(k);
          break;
        }
        case 'fldSimple': {
          const href = fieldHref(k.attrs.instr ?? '');
          if (href && !inField()) {
            const link: Inline = { t: 'link', href, kids: [] };
            const outer = into;
            into.push(link);
            into = link.kids;
            walk(k);
            into = outer;
          } else walk(k);
          break;
        }
        case 'ins':
        case 'moveTo':
        case 'smartTag':
        case 'customXml':
        case 'dir':
        case 'bdo':
          walk(k);
          break;
        case 'sdt':
          walk(kid(k, 'sdtContent') ?? k);
          break;
        case 'oMath':
        case 'oMathPara':
          ctx.leftOut.add('equations, shown as their text');
          into.push(run(findAll(k, 't').map(textOf).join(''), { i: true }));
          break;
        case 'AlternateContent': {
          const choice = kid(k, 'Choice');
          if (choice) walk(choice);
          break;
        }
        default:
          break;
      }
    }
  };
  walk(p);
  return root;
}

function readPara(ctx: Ctx, p: XmlElement): Para {
  const pPr = kid(p, 'pPr');
  const style = kid(pPr, 'pStyle')?.attrs.val ?? null;
  const name = style ? (ctx.styles.get(style)?.name ?? style) : '';
  const outlineOwn = kid(pPr, 'outlineLvl')?.attrs.val;
  const outline = outlineOwn !== undefined && /^\d$/.test(outlineOwn) ? Number(outlineOwn) : inherited(ctx.styles, style, 'outline');
  const heading = /^heading\s*([1-9])$/i.exec(name);
  const code = !!style && styleNamed(ctx.styles, style, CODE_STYLE);
  const numPr = kid(pPr, 'numPr');
  const ownNum = kid(numPr, 'numId')?.attrs.val;
  const styleNum = inherited(ctx.styles, style, 'num');
  const num = ownNum !== undefined ? { id: ownNum, level: Number(kid(numPr, 'ilvl')?.attrs.val ?? styleNum?.level ?? 0) || 0 } : styleNum;
  const comments: string[] = [];
  const boxes: Block[] = [];
  const kids = paraInlines(ctx, p, code, comments, boxes);
  let kind: Para['kind'] = 'para';
  let level = 0;
  if (/^title$/i.test(name)) kind = 'title';
  else if (heading) {
    kind = 'heading';
    level = Number(heading[1]);
  } else if (outline !== null && outline < 9) {
    kind = 'heading';
    level = outline + 1;
  } else if (code) kind = 'code';
  else if (!!style && styleNamed(ctx.styles, style, QUOTE_STYLE)) kind = 'quote';
  else if (kids.length > 0 && kids.every((k) => k.t === 'run' && (k.code || k.text.trim() === '')) && kids.some((k) => k.t === 'run' && k.code)) kind = 'code';
  const def = num && num.id !== '0' ? ctx.numbering.nums.get(num.id) : undefined;
  const list = kind === 'para' && def && !def.levels[num!.level]?.none ? { num: num!.id, level: num!.level } : null;
  return { kind, level, list, kids, comments, boxes };
}

/** The text of a paragraph read as code: runs and breaks as lines. */
const codeText = (kids: readonly Inline[]): string => kids.map((k) => (k.t === 'br' ? '\n' : k.t === 'run' ? k.text : k.t === 'link' ? inlineText(k.kids) : '')).join('');

/** A table's rows of cells; a cell's paragraphs are lines of it, and a table inside a cell is read into it the same way. */
function readTable(ctx: Ctx, tbl: XmlElement, comments: string[], boxes: Block[]): Inline[][][] {
  const rows: Inline[][][] = [];
  const rowsOf = (el: XmlElement): XmlElement[] => kidsOf(el).flatMap((k) => (k.name === 'tr' ? [k] : k.name === 'sdt' || k.name === 'customXml' ? rowsOf(kid(k, 'sdtContent') ?? k) : []));
  for (const tr of rowsOf(tbl)) {
    const cells: Inline[][] = [];
    const cellsOf = (el: XmlElement): XmlElement[] => kidsOf(el).flatMap((k) => (k.name === 'tc' ? [k] : k.name === 'sdt' || k.name === 'customXml' ? cellsOf(kid(k, 'sdtContent') ?? k) : []));
    for (const tc of cellsOf(tr)) {
      const out: Inline[] = [];
      const lineBreak = (): void => {
        if (out.length > 0) out.push({ t: 'br' });
      };
      const fill = (el: XmlElement): void => {
        for (const k of kidsOf(el)) {
          if (k.name === 'p') {
            const para = readPara(ctx, k);
            comments.push(...para.comments);
            boxes.push(...para.boxes);
            if (para.kids.length === 0) continue;
            lineBreak();
            if (para.list) out.push(run(ctx.numbering.nums.get(para.list.num)?.levels[para.list.level]?.ordered ? '' : '• '));
            out.push(...para.kids);
          } else if (k.name === 'tbl') {
            for (const row of readTable(ctx, k, comments, boxes)) {
              lineBreak();
              row.forEach((c, i) => {
                if (i > 0) out.push(run(' · '));
                out.push(...c);
              });
            }
          } else if (k.name === 'sdt') fill(kid(k, 'sdtContent') ?? k);
          else if (k.name === 'customXml') fill(k);
        }
      };
      fill(tc);
      cells.push(out);
      const span = Number(kid(kid(tc, 'tcPr'), 'gridSpan')?.attrs.val ?? 1);
      for (let s = 1; s < Math.min(span, 64); s++) cells.push([]);
    }
    rows.push(cells);
  }
  return rows;
}

/** The blocks of a body: the document's, a note's, a comment's or a text box's. */
function bodyBlocks(ctx: Ctx, body: XmlElement, asides?: (ids: readonly string[]) => Block[]): Block[] {
  const out: Block[] = [];
  // Open lists, outermost first: the list, the level its items sit at.
  let lists: { list: Extract<Block, { t: 'list' }>; level: number }[] = [];
  const counters = new Map<string, number[]>();
  const pendingAsides: string[] = [];
  const closeLists = (): void => {
    lists = [];
    if (pendingAsides.length > 0 && asides) out.push(...asides(pendingAsides.splice(0)));
  };
  const after = (comments: readonly string[], boxes: readonly Block[]): void => {
    if (lists.length > 0) pendingAsides.push(...comments);
    else if (comments.length > 0 && asides) out.push(...asides(comments));
    if (boxes.length > 0) {
      closeLists();
      out.push(...boxes);
    }
  };

  const item = (para: Para): void => {
    const def = ctx.numbering.nums.get(para.list!.num)!;
    const lv = Math.max(0, Math.min(8, para.list!.level));
    const level = def.levels[lv] ?? { ordered: true, start: 1, none: false };
    const count = counters.get(para.list!.num) ?? [];
    counters.set(para.list!.num, count);
    if (count[lv] === undefined) count[lv] = def.restart.get(lv) ?? level.start;
    else count[lv]! += 1;
    count.length = lv + 1;
    while (lists.length > 0 && lists[lists.length - 1]!.level > lv) lists.pop();
    let top = lists[lists.length - 1];
    if (top && top.level === lv && top.list.ordered !== level.ordered) {
      lists.pop();
      top = lists[lists.length - 1];
      if (!top) closeLists();
    }
    if (!top || top.level < lv) {
      const list: Extract<Block, { t: 'list' }> = { t: 'list', ordered: level.ordered, start: count[lv]!, items: [] };
      if (top) {
        const parentItems = top.list.items;
        if (parentItems.length === 0) parentItems.push([]);
        parentItems[parentItems.length - 1]!.push(list);
      } else out.push(list);
      lists.push({ list, level: lv });
      top = lists[lists.length - 1];
    }
    top!.list.items.push([{ t: 'para', kids: para.kids }]);
  };

  const each = (el: XmlElement): void => {
    for (const k of kidsOf(el)) {
      if (k.name === 'p') {
        const para = readPara(ctx, k);
        if (para.list) item(para);
        else {
          const empty = para.kids.length === 0 || (para.kids.every((x) => x.t === 'run' && x.text.trim() === '') && para.kind !== 'code');
          if (!empty) {
            closeLists();
            const last = out[out.length - 1];
            if (para.kind === 'heading' || para.kind === 'title') out.push({ t: 'heading', level: para.kind === 'title' ? 0 : para.level, kids: para.kids });
            else if (para.kind === 'code') {
              if (last?.t === 'code') out[out.length - 1] = { t: 'code', text: `${last.text}\n${codeText(para.kids)}` };
              else out.push({ t: 'code', text: codeText(para.kids) });
            } else if (para.kind === 'quote') {
              if (last?.t === 'quote') last.blocks.push({ t: 'para', kids: para.kids });
              else out.push({ t: 'quote', blocks: [{ t: 'para', kids: para.kids }] });
            } else out.push({ t: 'para', kids: para.kids });
          }
        }
        after(para.comments, para.boxes);
      } else if (k.name === 'tbl') {
        closeLists();
        const comments: string[] = [];
        const boxes: Block[] = [];
        const rows = readTable(ctx, k, comments, boxes);
        if (rows.some((r) => r.some((c) => c.length > 0))) out.push({ t: 'table', rows });
        after(comments, boxes);
      } else if (k.name === 'sdt') each(kid(k, 'sdtContent') ?? k);
      else if (k.name === 'customXml' || k.name === 'ins' || k.name === 'moveTo') each(k);
      else if (k.name === 'AlternateContent') {
        const choice = kid(k, 'Choice');
        if (choice) each(choice);
      } else if (k.name === 'altChunk') ctx.leftOut.add('embedded documents');
    }
  };
  each(body);
  closeLists();
  return out;
}

/** Heading levels from what the document uses: a Title is the top, and Heading 1 sits under it when there is one. */
function levelHeadings(blocks: Block[]): void {
  const titled = blocks.some((b) => b.t === 'heading' && b.level === 0);
  for (const b of blocks) if (b.t === 'heading') b.level = Math.min(6, b.level === 0 ? 1 : b.level + (titled ? 1 : 0));
}

/** Footnotes, endnotes or comments by id: each one's blocks, and for a comment its author and date. */
async function readSide(ctx: Ctx, rel: Rel | null, item: string): Promise<Map<string, { blocks: Block[]; who: string; when: string | null }>> {
  const out = new Map<string, { blocks: Block[]; who: string; when: string | null }>();
  if (!rel) return out;
  const root = await ctx.pkg.xml(rel.target);
  const rels = await ctx.pkg.rels(rel.target);
  const side: Ctx = { ...ctx, part: rel.target, rels };
  for (const el of kidsOf(root, item)) {
    const type = el.attrs.type;
    if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue;
    out.set(el.attrs.id ?? '', { blocks: trimLead(bodyBlocks(side, el)), who: el.attrs.author ?? el.attrs.initials ?? '', when: el.attrs.date ?? null });
  }
  return out;
}

/** A note's text opens with the space after its number mark: the number is the page's to draw. */
function trimLead(blocks: Block[]): Block[] {
  const first = blocks[0];
  if (first?.t === 'para') {
    const r = first.kids[0];
    if (r?.t === 'run') first.kids[0] = { ...r, text: r.text.replace(/^\s+/, '') } as Run;
  }
  return blocks;
}

export async function readWord(read: PartRead): Promise<OfficeDoc> {
  const pkg = openPackage(read, newBudget());
  const top = await pkg.rels('');
  const main = relOfType(top, 'officeDocument')?.target ?? 'word/document.xml';
  const doc = await pkg.xml(main);
  if (!doc) throw new OfficeError('The file holds no Word document part: it is a zip, but not a .docx Marxy can read.');
  const body = kid(doc, 'body');
  if (!body) throw new OfficeError(`${main} has no body.`);
  const rels = await pkg.rels(main);
  const part = (type: string): Rel | null => relOfType(rels, type);
  const read1 = async (type: string): Promise<XmlElement | null> => {
    const r = part(type);
    return r ? pkg.xml(r.target) : null;
  };
  const ctx: Ctx = {
    pkg,
    part: main,
    rels,
    styles: readStyles(await read1('styles')),
    numbering: readNumbering(await read1('numbering')),
    images: [],
    leftOut: new Set(),
    marked: new Map(),
  };
  const comments = await readSide(ctx, part('comments'), 'comment');
  const asides = (ids: readonly string[]): Block[] =>
    ids.flatMap((id) => {
      const c = comments.get(id);
      return c ? [{ t: 'aside', who: c.who || 'A comment', when: c.when, blocks: c.blocks } as Block] : [];
    });
  const blocks = bodyBlocks(ctx, body, asides);
  levelHeadings(blocks);
  // Notes are read after the body, so their own marks (a note in a note) come after the ones the body makes.
  const footnotes = await readSide(ctx, part('footnotes'), 'footnote');
  const endnotes = await readSide(ctx, part('endnotes'), 'endnote');
  const notes: OfficeNote[] = [];
  let foot = 0;
  let end = 0;
  for (const mark of ctx.marked.values()) {
    const got = (mark.kind === 'fn' ? footnotes : endnotes).get(mark.id);
    if (!got) continue;
    notes.push({ label: mark.label, blocks: got.blocks });
    if (mark.kind === 'fn') foot += 1;
    else end += 1;
  }
  if (findAll(body, 'headerReference').length > 0 || findAll(body, 'footerReference').length > 0) ctx.leftOut.add('headers and footers');
  return {
    format: 'docx',
    blocks,
    notes,
    images: ctx.images,
    props: await officeProps(pkg),
    counts: {
      comments: comments.size,
      footnotes: foot,
      endnotes: end,
      slides: 0,
      hiddenSlides: 0,
      speakerNotes: 0,
    },
    leftOut: ctx.leftOut,
  };
}

