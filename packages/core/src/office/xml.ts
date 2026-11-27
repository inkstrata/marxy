// The XML inside a Word, PowerPoint or OpenDocument file, read into a small element tree. These files are untrusted, so
// the reader is deliberately narrow: a DTD is refused (no entity is ever declared, so none is ever expanded), only the
// five predefined entities and character references are decoded, and every part is read under a budget of elements and
// characters shared by the whole file. Names keep their local part only: Office writes `w:`, `a:`, `p:`, `text:` with
// fixed meanings, and the readers ask for `p`, `r`, `t` within the part they know they are in. Text is kept as written
// (a run's spaces matter), unlike the data tree's reader, which trims. Pure.

export interface XmlElement {
  /** The local name: `w:p` is `p`. */
  readonly name: string;
  /** Attributes by local name, decoded: `w:val` is `val`. Where a bare name and a prefixed one share it, the bare one. */
  readonly attrs: Readonly<Record<string, string>>;
  /** Attributes by their name as written, for the few where the prefix tells two apart (`r:id` against `w:id`). */
  readonly full: Readonly<Record<string, string>>;
  readonly kids: readonly (XmlElement | string)[];
}

/** What reading one file may spend, across all its parts. */
export interface XmlBudget {
  elements: number;
  chars: number;
  /** Bytes of XML read and of attributes held, across every part. */
  bytes: number;
}

export const OFFICE_LIMITS = {
  /** Elements across every part read: a long report is a few hundred thousand. */
  elements: 2_000_000,
  /** Characters of text across every part read. */
  chars: 16 * 1024 * 1024,
  /** Bytes of XML parsed and of attribute names and values held, across every part: what reading may take in memory. */
  bytes: 128 * 1024 * 1024,
  depth: 256,
} as const;

export const newBudget = (): XmlBudget => ({ elements: OFFICE_LIMITS.elements, chars: OFFICE_LIMITS.chars, bytes: OFFICE_LIMITS.bytes });

export const tooMuchXml = (): OfficeError => new OfficeLimit(`The file's parts hold more than ${OFFICE_LIMITS.bytes / 1024 / 1024} MB of XML: too much to read here.`);

/** Why a part could not be read: the sentence the page says. */
export class OfficeError extends Error {}

/** A budget spent: the whole file is past what is read, not one part of it badly made. */
export class OfficeLimit extends OfficeError {}

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * The XHTML entities a book's chapters use, which its document type would declare: a fixed table read in place of that
 * declaration, so nothing the file declares is ever expanded. A name not here is left as written.
 */
const XHTML_ENTITIES: Readonly<Record<string, string>> = {
  ...ENTITIES,
  nbsp: ' ', shy: '­', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”',
  bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', hellip: '…', bull: '•',
  middot: '·', prime: '′', Prime: '″', dagger: '†', Dagger: '‡', permil: '‰', sect: '§',
  para: '¶', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×',
  divide: '÷', minus: '−', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²',
  sup3: '³', micro: 'µ', cent: '¢', pound: '£', euro: '€', yen: '¥', iexcl: '¡',
  iquest: '¿', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', le: '≤',
  ge: '≥', ne: '≠', asymp: '≈', infin: '∞', hearts: '♥', ordf: 'ª', ordm: 'º',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È',
  Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', Ntilde: 'Ñ', Ograve: 'Ò',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú',
  ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', eth: 'ð', thorn: 'þ',
};

/** How a part is read. */
export interface XmlOptions {
  /** A book's part: it may name an external document type (never fetched) and use XHTML's entities. */
  readonly xhtml?: boolean;
  /**
   * A book's chapter that failed as XML, read again as a browser would: HTML's void elements need no close, an attribute
   * may be bare or unquoted, a close that skips open elements closes them, a stray close or `<` is passed over, and what
   * is open at the end is closed, HTML's implied end tags close a paragraph, a list item or a cell, and everything at
   * the top level is kept (wrapped in `LENIENT_ROOT` when there is more than one element). Names, attributes' too, are
   * lower-cased. The same budget is charged.
   */
  readonly lenient?: boolean;
  /** Told when a lenient read stopped short (a script, a comment or a tag never closed) and the rest is left out. */
  readonly onTruncated?: () => void;
}

/** HTML's elements that never hold anything, closed or not. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** HTML's elements whose text is not markup: read to their close, and kept empty. */
const RAW = new Set(['script', 'style']);

/** The element a lenient read wraps everything in when a chapter holds more than one top-level thing. */
export const LENIENT_ROOT = '#root';

/**
 * HTML's implied end tags: opening one of these closes the nearest open element of `closes`, unless one of `stops` is
 * open nearer (a list item closes the last item of its own list, not one of a list outside it).
 */
const IMPLIED: Readonly<Record<string, { readonly closes: ReadonlySet<string>; readonly stops: ReadonlySet<string> }>> = (() => {
  const rule = (closes: string[], stops: string[]) => ({ closes: new Set(closes), stops: new Set(stops) });
  const cells = rule(['td', 'th'], ['tr', 'table']);
  const terms = rule(['dt', 'dd'], ['dl']);
  const sections = rule(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'], ['table']);
  return {
    li: rule(['li'], ['ul', 'ol', 'menu']),
    dt: terms,
    dd: terms,
    tr: rule(['tr', 'td', 'th'], ['table', 'thead', 'tbody', 'tfoot']),
    td: cells,
    th: cells,
    thead: sections,
    tbody: sections,
    tfoot: sections,
    option: rule(['option'], ['select', 'datalist']),
  };
})();
/** Elements whose start closes an open paragraph, as in HTML; the paragraph is looked for up to a table cell or a button. */
const CLOSES_P = new Set([
  'p', 'div', 'ul', 'ol', 'dl', 'li', 'dt', 'dd', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'hr', 'section',
  'article', 'aside', 'header', 'footer', 'nav', 'figure', 'figcaption', 'address', 'main', 'form', 'details', 'fieldset', 'menu',
]);
const P_RULE = { closes: new Set(['p']), stops: new Set(['table', 'td', 'th', 'caption', 'button', 'object', 'template', 'html']) };

function decodeWith(s: string, table: Readonly<Record<string, string>>): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);/g, (whole, e: string) => {
    if (e[0] !== '#') return Object.hasOwn(table, e) ? table[e]! : whole;
    const code = e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

const local = (name: string): string => {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
};

const NAME = /[A-Za-z_][\w.:-]*/y;
const ATTR = /\s*([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const ATTR_LOOSE = /\s*([A-Za-z_][\w.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;

/** Reads `text` (a part's XML, decoded) into its root element. Throws `OfficeError` with a sentence. */
export function readXml(text: string, budget: XmlBudget, part: string, opts: XmlOptions = {}): XmlElement {
  let i = 0;
  const n = text.length;
  const table = opts.xhtml ? XHTML_ENTITIES : ENTITIES;
  const decode = (s: string): string => decodeWith(s, table);
  const lenient = opts.lenient === true;
  const nameOf = (written: string): string => (lenient ? local(written).toLowerCase() : local(written));
  const fail = (why: string): never => {
    throw new OfficeError(`${part} is not XML the app reads: ${why}.`);
  };
  type Open = { name: string; written: string; attrs: Record<string, string>; full: Record<string, string>; kids: (XmlElement | string)[] };
  // A lenient read keeps everything at the top level under one root of its own, at the bottom of the stack.
  const stack: Open[] = lenient ? [{ name: LENIENT_ROOT, written: LENIENT_ROOT, attrs: {}, full: {}, kids: [] }] : [];
  const floor = lenient ? 1 : 0;
  let root: XmlElement | null = null;
  const finish = (o: Open): void => {
    const done: XmlElement = { name: o.name, attrs: o.attrs, full: o.full, kids: o.kids };
    const parent = stack[stack.length - 1];
    if (parent) parent.kids.push(done);
    else root = done;
  };
  /** A construct never closed: strict reading refuses the part; a lenient one keeps what came before and stops. */
  const cut = (why: string): void => {
    if (!lenient) fail(why);
    opts.onTruncated?.();
    i = n;
  };
  /**
   * Closes, with all inside it, the outermost open element `rule` names below the nearest one it stops at: a new row
   * closes the open row and its cell, a new item the open item of its own list.
   */
  const imply = (rule: { readonly closes: ReadonlySet<string>; readonly stops: ReadonlySet<string> }): void => {
    let at = -1;
    for (let k = stack.length - 1; k >= floor; k--) {
      const name = stack[k]!.name;
      if (rule.stops.has(name)) break;
      if (rule.closes.has(name)) at = k;
    }
    if (at >= 0) while (stack.length > at) finish(stack.pop()!);
  };
  const addText = (s: string): void => {
    if (s === '') return;
    const top = stack[stack.length - 1];
    if (!top) {
      if (s.trim() !== '' && !lenient) fail('text outside the root element');
      return;
    }
    budget.chars -= s.length;
    if (budget.chars < 0) throw new OfficeLimit(`The file holds more than ${(OFFICE_LIMITS.chars / 1024 / 1024).toFixed(0)} MB of text: too much to read here.`);
    const last = top.kids[top.kids.length - 1];
    if (typeof last === 'string') top.kids[top.kids.length - 1] = last + s;
    else top.kids.push(s);
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      addText(decode(text.slice(i)));
      break;
    }
    if (lt > i) addText(decode(text.slice(i, lt)));
    i = lt;
    if (text.startsWith('<?', i)) {
      const close = text.indexOf('?>', i + 2);
      if (close < 0) cut('a declaration is not closed');
      else i = close + 2;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      if (close < 0) cut('a comment is not closed');
      else i = close + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const close = text.indexOf(']]>', i + 9);
      if (close < 0) {
        cut('a CDATA section is not closed');
        continue;
      }
      addText(text.slice(i + 9, close));
      i = close + 3;
      continue;
    }
    // A document type could declare entities that expand without bound; no Office part has one, so it is refused. A
    // book's chapter may name XHTML's external one, which is never fetched; one that declares anything itself is refused.
    if (opts.xhtml && /^<!DOCTYPE\s/i.test(text.slice(i, i + 10)) && !root && stack.length === floor) {
      let quote = '';
      let j = i + 9;
      for (; j < n; j++) {
        const c = text[j]!;
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '[') fail('it declares a document type of its own, which the app never reads');
        else if (c === '>') break;
      }
      if (j >= n) fail('a document type is not closed');
      i = j + 1;
      continue;
    }
    if (text.startsWith('<!', i)) fail('it declares a document type, which the app never reads');
    if (text[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(text);
      if (!m && lenient) {
        addText('<');
        i++;
        continue;
      }
      if (!m) fail('a closing tag has no name');
      const gt = text.indexOf('>', NAME.lastIndex);
      if (gt < 0) {
        cut(`</${m![0]}> is not closed`);
        continue;
      }
      i = gt + 1;
      if (lenient) {
        // The nearest open element of that name, closing what is open inside it; a close nothing opened is passed over.
        const want = nameOf(m![0]);
        let k = stack.length - 1;
        while (k >= floor && stack[k]!.name !== want) k--;
        while (k >= floor && stack.length > k) finish(stack.pop()!);
        continue;
      }
      const top = stack.pop();
      if (!top || top.written !== m![0]) fail(`</${m![0]}> closes ${top ? `<${top.written}>` : 'nothing'}`);
      finish(top!);
      continue;
    }
    NAME.lastIndex = i + 1;
    const m = NAME.exec(text);
    if (!m && lenient) {
      addText('<');
      i++;
      continue;
    }
    if (!m) fail('a tag has no name');
    if (root) fail('there is more than one root element');
    const written = m![0];
    i = NAME.lastIndex;
    const attrs: Record<string, string> = {};
    const full: Record<string, string> = {};
    const pattern = lenient ? ATTR_LOOSE : ATTR;
    for (;;) {
      pattern.lastIndex = i;
      const a = pattern.exec(text);
      if (!a) break;
      const value = decode(a[2] ?? a[3] ?? a[4] ?? '');
      // HTML's attribute names are any case (`HREF`); the readers ask in lower case.
      const aname = lenient ? a[1]!.toLowerCase() : a[1]!;
      // Each attribute is held twice (by its name as written and by its local name): charged as such.
      budget.bytes -= 2 * (aname.length + value.length);
      if (budget.bytes < 0) throw tooMuchXml();
      full[aname] = value;
      const key = local(aname);
      // `xmlns:w` and the like say nothing the readers ask for; a bare name wins over a prefixed one (`id` and `r:id`).
      if (!aname.startsWith('xmlns') && (!(key in attrs) || !aname.includes(':'))) attrs[key] = value;
      i = pattern.lastIndex;
    }
    while (i < n && /\s/.test(text[i]!)) i++;
    let selfClosing = text.startsWith('/>', i);
    if (!selfClosing && text[i] !== '>') {
      if (!lenient) fail(`<${written}> is not closed`);
      // What the tag holds past its attributes is passed over, to the tag's end.
      const gt = text.indexOf('>', i);
      if (gt < 0) {
        cut(`<${written}> is not closed`);
        continue;
      }
      selfClosing = text[gt - 1] === '/';
      i = selfClosing ? gt - 1 : gt;
    }
    i += selfClosing ? 2 : 1;
    if (--budget.elements < 0) throw new OfficeLimit(`The file holds more than ${OFFICE_LIMITS.elements.toLocaleString('en-GB')} XML elements: too many to read here.`);
    const el: Open = { name: nameOf(written), written, attrs, full, kids: [] };
    if (lenient) {
      const own = IMPLIED[el.name];
      if (own) imply(own);
      if (CLOSES_P.has(el.name)) imply(P_RULE);
    }
    if (stack.length >= OFFICE_LIMITS.depth + floor) fail(`it nests deeper than ${OFFICE_LIMITS.depth} elements`);
    if (selfClosing || (lenient && VOID.has(el.name))) finish(el);
    else if (lenient && RAW.has(el.name)) {
      // A script's or a style's text is never markup, and never kept.
      const end = new RegExp(`</${el.name}`, 'gi');
      end.lastIndex = i;
      const close = end.exec(text)?.index ?? -1;
      const gt = close < 0 ? -1 : text.indexOf('>', close);
      finish(el);
      if (gt < 0) cut(`<${el.name}> is not closed`);
      else i = gt + 1;
    } else stack.push(el);
  }
  if (lenient) {
    while (stack.length > 1) finish(stack.pop()!);
    const doc = stack.pop()!;
    // One element and nothing beside it is the part as it would be read strictly; anything else keeps its wrapper.
    const els = doc.kids.filter((k): k is XmlElement => typeof k !== 'string');
    const loose = doc.kids.some((k) => typeof k === 'string' && k.trim() !== '');
    if (els.length === 0 && !loose) fail('it holds no element');
    return els.length === 1 && !loose ? els[0]! : { name: LENIENT_ROOT, attrs: {}, full: {}, kids: doc.kids };
  }
  if (stack.length > 0) fail(`<${stack[stack.length - 1]!.written}> is not closed`);
  if (!root) fail('it holds no element');
  return root!;
}

/** UTF-8, or UTF-16 by its byte order mark (some writers save parts so). */
export function xmlText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder().decode(bytes.subarray(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0));
}

// ---- walking ------------------------------------------------------------------------------------------------------------

export const kidsOf = (el: XmlElement | null | undefined, name?: string): XmlElement[] =>
  el ? (el.kids.filter((k) => typeof k !== 'string' && (name === undefined || k.name === name)) as XmlElement[]) : [];

export const kid = (el: XmlElement | null | undefined, name: string): XmlElement | null =>
  (el?.kids.find((k) => typeof k !== 'string' && k.name === name) as XmlElement | undefined) ?? null;

/** The first element named `name` at any depth below `el`, breadth first: the nearest level, then document order. */
export function find(el: XmlElement | null | undefined, name: string): XmlElement | null {
  if (!el) return null;
  const todo: XmlElement[] = [el];
  // A read index, not `shift()`: shifting moves every element left, the square of a wide tree's width.
  for (let head = 0; head < todo.length; head++) {
    const at = todo[head]!;
    for (const k of at.kids) {
      if (typeof k === 'string') continue;
      if (k.name === name) return k;
      todo.push(k);
    }
  }
  return null;
}

/** Every element named `name` below `el`, in document order, not looking inside a match. */
export function findAll(el: XmlElement | null | undefined, name: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  for (const k of el.kids) {
    if (typeof k === 'string') continue;
    if (k.name === name) out.push(k);
    else findAll(k, name, out);
  }
  return out;
}

/** The text below `el`, every string joined. */
export function textOf(el: XmlElement | null | undefined): string {
  if (!el) return '';
  let s = '';
  for (const k of el.kids) s += typeof k === 'string' ? k : textOf(k);
  return s;
}
