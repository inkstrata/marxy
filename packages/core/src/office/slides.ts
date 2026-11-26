// A PowerPoint deck (.pptx) read as one continuous page: each slide a section headed by its number and title, its
// text frames in the deck's reading order (the order of its shape tree, which is what a screen reader follows), tables,
// pictures by their alt text, then its speaker notes. Positions, sizes, themes, masters, animations and transitions are
// not read. A body placeholder's paragraphs are bulleted, as the masters draw them, unless a paragraph says otherwise. Pure.
import { run, type Block, type Inline, type OfficeDoc, type OfficeImage } from './model.ts';
import { officeProps, openPackage, relOfType, type Package, type PartRead, type Rel } from './parts.ts';
import { kid, kidsOf, newBudget, OfficeError, textOf, type XmlElement } from './xml.ts';

const MONO = /consolas|courier|menlo|monaco|lucida console|source code|fira (code|mono)|jetbrains|cascadia|inconsolata|\bmono\b/i;
/** Placeholders that say where a slide is, not what it says. */
const FURNITURE = new Set(['dt', 'ftr', 'sldNum', 'hdr', 'sldImg']);

interface Ctx {
  readonly pkg: Package;
  readonly rels: ReadonlyMap<string, Rel>;
  readonly images: OfficeImage[];
  readonly leftOut: Set<string>;
}

const on = (v: string | undefined): boolean => v === '1' || v === 'true';

function runsOf(ctx: Ctx, p: XmlElement): Inline[] {
  const out: Inline[] = [];
  for (const k of kidsOf(p)) {
    if (k.name === 'br') out.push({ t: 'br' });
    else if (k.name === 'r' || k.name === 'fld') {
      const rPr = kid(k, 'rPr');
      const text = textOf(kid(k, 't'));
      if (text === '') continue;
      const face = kid(rPr, 'latin')?.attrs.typeface ?? '';
      const baseline = Number(rPr?.attrs.baseline ?? 0);
      const r = run(text, {
        b: on(rPr?.attrs.b) || undefined,
        i: on(rPr?.attrs.i) || undefined,
        s: (rPr?.attrs.strike ?? 'noStrike') !== 'noStrike' || undefined,
        code: MONO.test(face) || undefined,
        sub: baseline < 0 || undefined,
        sup: baseline > 0 || undefined,
      });
      const click = kid(rPr, 'hlinkClick');
      const rel = click ? ctx.rels.get(click.full['r:id'] ?? click.attrs.id ?? '') : undefined;
      const last = out[out.length - 1];
      if (rel?.external) {
        if (last?.t === 'link' && last.href === rel.target) last.kids.push(r);
        else out.push({ t: 'link', href: rel.target, kids: [r] });
      } else out.push(r);
    }
  }
  return out;
}

const hasWords = (kids: readonly Inline[]): boolean => kids.some((k) => (k.t === 'run' ? k.text.trim() !== '' : k.t === 'link' ? hasWords(k.kids) : false));

/** A text frame's paragraphs: bulleted ones as a list, nested by their level, the rest as paragraphs. */
function frameBlocks(ctx: Ctx, txBody: XmlElement, bulleted: boolean): Block[] {
  const out: Block[] = [];
  let lists: { list: Extract<Block, { t: 'list' }>; level: number }[] = [];
  for (const p of kidsOf(txBody, 'p')) {
    const kids = runsOf(ctx, p);
    if (!hasWords(kids)) continue;
    const pPr = kid(p, 'pPr');
    const level = Math.min(8, Number(pPr?.attrs.lvl ?? 0) || 0);
    const auto = kid(pPr, 'buAutoNum');
    const isList = !kid(pPr, 'buNone') && (bulleted || !!kid(pPr, 'buChar') || !!auto || !!kid(pPr, 'buBlip'));
    if (!isList) {
      lists = [];
      out.push({ t: 'para', kids });
      continue;
    }
    const ordered = !!auto;
    while (lists.length > 0 && lists[lists.length - 1]!.level > level) lists.pop();
    let top = lists[lists.length - 1];
    if (top && top.level === level && top.list.ordered !== ordered) {
      lists.pop();
      top = lists[lists.length - 1];
    }
    if (!top || top.level < level) {
      const list: Extract<Block, { t: 'list' }> = { t: 'list', ordered, start: Number(auto?.attrs.startAt ?? 1) || 1, items: [] };
      if (top) {
        if (top.list.items.length === 0) top.list.items.push([]);
        top.list.items[top.list.items.length - 1]!.push(list);
      } else out.push(list);
      lists.push({ list, level });
      top = lists[lists.length - 1];
    }
    top!.list.items.push([{ t: 'para', kids }]);
  }
  return out;
}

function picture(ctx: Ctx, pic: XmlElement): Block {
  const nv = kid(kid(pic, 'nvPicPr'), 'cNvPr');
  const alt = (nv?.attrs.descr ?? nv?.attrs.title ?? '').replace(/\s+/g, ' ').trim();
  const blip = kid(kid(pic, 'blipFill'), 'blip');
  const id = blip?.full['r:embed'] ?? blip?.full['r:link'];
  const rel = id ? ctx.rels.get(id) : undefined;
  const image: OfficeImage = rel && !rel.external ? { entry: rel.target, alt, what: 'picture' } : { entry: null, alt, what: rel?.external ? 'linked picture' : 'object' };
  if (image.what === 'linked picture') ctx.leftOut.add('linked pictures');
  ctx.images.push(image);
  return { t: 'para', kids: [{ t: 'image', image: ctx.images.length - 1 }] };
}

function tableRows(ctx: Ctx, tbl: XmlElement): Inline[][][] {
  return kidsOf(tbl, 'tr').map((tr) =>
    kidsOf(tr, 'tc').map((tc) => {
      if (tc.attrs.hMerge === '1' || tc.attrs.vMerge === '1') return [];
      const out: Inline[] = [];
      for (const p of kidsOf(kid(tc, 'txBody'), 'p')) {
        const kids = runsOf(ctx, p);
        if (!hasWords(kids)) continue;
        if (out.length > 0) out.push({ t: 'br' });
        out.push(...kids);
      }
      return out;
    }),
  );
}

interface SlideRead {
  title: Inline[] | null;
  blocks: Block[];
}

/** The shapes of a tree in order, into `into`; the title is kept apart. */
function shapes(ctx: Ctx, tree: XmlElement, into: SlideRead): void {
  for (const k of kidsOf(tree)) {
    switch (k.name) {
      case 'sp': {
        const ph = kid(kid(kid(k, 'nvSpPr'), 'nvPr'), 'ph');
        const type = ph?.attrs.type ?? (ph ? 'body' : null);
        if (type && FURNITURE.has(type)) break;
        const txBody = kid(k, 'txBody');
        if (!txBody) break;
        if ((type === 'title' || type === 'ctrTitle') && into.title === null) {
          const words: Inline[] = [];
          for (const p of kidsOf(txBody, 'p')) {
            const kids = runsOf(ctx, p);
            if (!hasWords(kids)) continue;
            if (words.length > 0) words.push(run(' '));
            words.push(...kids.map((x) => (x.t === 'br' ? run(' ') : x)));
          }
          if (words.length > 0) into.title = words;
          break;
        }
        const bulleted = type === 'body' || type === 'obj';
        into.blocks.push(...frameBlocks(ctx, txBody, bulleted));
        break;
      }
      case 'grpSp':
        shapes(ctx, k, into);
        break;
      case 'pic':
        into.blocks.push(picture(ctx, k));
        break;
      case 'graphicFrame': {
        const data = kid(kid(k, 'graphic'), 'graphicData');
        const tbl = kid(data, 'tbl');
        if (tbl) {
          const rows = tableRows(ctx, tbl);
          if (rows.some((r) => r.some((c) => c.length > 0))) into.blocks.push({ t: 'table', rows });
          break;
        }
        const uri = data?.attrs.uri ?? '';
        const nv = kid(kid(k, 'nvGraphicFramePr'), 'cNvPr');
        const what: OfficeImage['what'] = /chart/.test(uri) ? 'chart' : /diagram/.test(uri) ? 'diagram' : 'object';
        ctx.leftOut.add(what === 'chart' ? 'charts' : what === 'diagram' ? 'diagrams' : 'embedded objects');
        ctx.images.push({ entry: null, alt: (nv?.attrs.descr ?? nv?.attrs.title ?? '').trim(), what });
        into.blocks.push({ t: 'para', kids: [{ t: 'image', image: ctx.images.length - 1 }] });
        break;
      }
      case 'AlternateContent': {
        const choice = kid(k, 'Choice');
        if (choice) shapes(ctx, choice, into);
        break;
      }
      default:
        break;
    }
  }
}

/** A slide's speaker notes: the text of its notes page's body placeholder. */
async function speakerNotes(pkg: Package, rels: ReadonlyMap<string, Rel>): Promise<Block[]> {
  const rel = relOfType(rels, 'notesSlide');
  if (!rel) return [];
  const root = await pkg.xml(rel.target);
  const ctx: Ctx = { pkg, rels: await pkg.rels(rel.target), images: [], leftOut: new Set() };
  const out: Block[] = [];
  const tree = kid(kid(root, 'cSld'), 'spTree');
  const visit = (el: XmlElement | null): void => {
    for (const sp of kidsOf(el)) {
      if (sp.name === 'grpSp') visit(sp);
      if (sp.name !== 'sp') continue;
      const ph = kid(kid(kid(sp, 'nvSpPr'), 'nvPr'), 'ph');
      if (ph?.attrs.type !== 'body') continue;
      const body = kid(sp, 'txBody');
      if (body) out.push(...frameBlocks(ctx, body, false));
    }
  };
  visit(tree);
  return out;
}

export async function readSlides(read: PartRead): Promise<OfficeDoc> {
  const pkg = openPackage(read, newBudget());
  const main = relOfType(await pkg.rels(''), 'officeDocument')?.target ?? 'ppt/presentation.xml';
  const pres = await pkg.xml(main);
  if (!pres) throw new OfficeError('The file holds no presentation part: it is a zip, but not a .pptx Marxy can read.');
  const rels = await pkg.rels(main);
  const images: OfficeImage[] = [];
  const leftOut = new Set<string>();
  const blocks: Block[] = [];
  let n = 0;
  let hidden = 0;
  let noted = 0;
  const seen = new Set<string>();
  for (const s of kidsOf(kid(pres, 'sldIdLst'), 'sldId')) {
    const rel = rels.get(s.full['r:id'] ?? '');
    // A slide listed twice is shown once: the list is the file's to write, and it may repeat one without end.
    if (!rel || rel.external || seen.has(rel.target)) continue;
    seen.add(rel.target);
    const slide = await pkg.xml(rel.target);
    if (!slide) continue;
    n += 1;
    const slideRels = await pkg.rels(rel.target);
    const ctx: Ctx = { pkg, rels: slideRels, images, leftOut };
    const got: SlideRead = { title: null, blocks: [] };
    shapes(ctx, kid(kid(slide, 'cSld'), 'spTree') ?? slide, got);
    const isHidden = slide.attrs.show === '0' || slide.attrs.show === 'false';
    if (isHidden) hidden += 1;
    blocks.push({ t: 'heading', level: 2, kids: got.title ?? [], slide: { n, hidden: isHidden } }, ...got.blocks);
    const notes = await speakerNotes(pkg, slideRels);
    if (notes.length > 0) {
      noted += 1;
      blocks.push({ t: 'aside', who: 'Speaker notes', when: null, blocks: notes });
    }
    if (kid(slide, 'timing')) leftOut.add('animations');
  }
  if (n === 0 && kidsOf(kid(pres, 'sldIdLst'), 'sldId').length > 0) throw new OfficeError('The deck lists slides, but none of them is in the file.');
  return {
    format: 'pptx',
    blocks,
    notes: [],
    images,
    props: await officeProps(pkg),
    counts: { comments: 0, footnotes: 0, endnotes: 0, slides: n, hiddenSlides: hidden, speakerNotes: noted },
    leftOut,
  };
}
