// HTML from a chat tool, a document editor or a web page, as markdown (E-14, ADR-0065). The HTML is
// untrusted: it goes through the core sanitiser first (so a script, an event handler, a javascript:
// URL, a style and every remote resource are gone before anything reads it), then into an inert
// document made by DOMParser (no script runs, no resource loads, nothing is inserted into the live
// page), then is walked once. Nothing here fetches anything. Pure: the same HTML gives the same bytes.
import { fenceFor } from '@marxy/core/src/paste/classify.ts';
import { DEFAULT_POLICY, type Policy } from '@marxy/core/src/sanitize/policy.ts';
import { sanitizeHtml } from '@marxy/core/src/sanitize/sanitize-html.ts';

// Sentinels for what inline text cannot say yet. NUL never survives HTML parsing, so a payload
// cannot forge one (input NULs are removed first anyway).
const BR = '\u0001'; // <br>
const SEP = '\u0002'; // the edge of a block seen from inside inline content

const BLOCKS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'pre', 'blockquote', 'hr', 'dl', 'dt', 'dd',
  'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption', 'details', 'summary', 'address',
  'tr', 'thead', 'tbody', 'tfoot', 'caption',
]);
const isElement = (n: Node): n is Element => n.nodeType === 1;
const isText = (n: Node): n is Text => n.nodeType === 3;
const tag = (e: Element): string => e.tagName.toLowerCase();
const isBlock = (n: Node): n is Element => isElement(n) && BLOCKS.has(tag(n));
const containsBlock = (e: Element): boolean => [...e.querySelectorAll('*')].some((c) => BLOCKS.has(tag(c)));

/**
 * The default allow-list (same elements, attributes and URL schemes: a script, a handler, a style,
 * a javascript: URL and every remote resource are refused exactly as for a document), with one
 * widening that cannot carry anything: attribute-less block wrappers stay as elements, so that
 * `div` soup keeps its block structure instead of fusing into one line, and the document shell a
 * clipboard wraps its fragment in (html, head, body) is unwrapped, not discarded with its contents.
 */
const WRAPPERS = ['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'details', 'summary'];
const PASTE_POLICY: Policy = {
  ...DEFAULT_POLICY,
  name: 'marxy-paste',
  elements: { ...DEFAULT_POLICY.elements, ...Object.fromEntries(WRAPPERS.map((w) => [w, {}])) },
  transparent: [...DEFAULT_POLICY.transparent.filter((t) => !WRAPPERS.includes(t)), 'html', 'head', 'body'],
};

// --- escaping --------------------------------------------------------------------------------

function escapeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === '\\' || c === '`' || c === '*' || c === '[' || c === ']' || c === '<' || c === '~') out += `\\${c}`;
    else if (c === '_') {
      // CommonMark does not open emphasis inside a word, so snake_case stays readable.
      const word = /\p{L}|\p{N}/u;
      out += word.test(s[i - 1] ?? '') && word.test(s[i + 1] ?? '') ? c : `\\${c}`;
    } else if (c === '&' && /^&(?:#\d+|#[xX][0-9a-fA-F]+|\w+);/.test(s.slice(i))) out += '\\&';
    else out += c;
  }
  return out;
}

/** A character that would start a block at the head of a line is escaped there. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^( {0,3})(#{1,6})(?=[ \t]|$)/, '$1\\$2')
    .replace(/^( {0,3})([-+])(?=[ \t]|$)/, '$1\\$2')
    .replace(/^( {0,3})(-{2,}|={2,})[ \t]*$/, '$1\\$2')
    .replace(/^( {0,3})>/, '$1\\>')
    .replace(/^( {0,3})(\d{1,9})([.)])(?=[ \t]|$)/, '$1$2\\$3')
    .replace(/^( {0,3})\|/, '$1\\|');
}

function codeSpan(text: string): string {
  const body = text.replace(/\r\n|[\r\n]/g, ' ');
  if (body === '') return '';
  let longest = 0;
  for (const run of body.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(body) || (/^ .* $/.test(body) && body.trim() !== '') ? ' ' : '';
  return `${ticks}${pad}${body}${pad}${ticks}`;
}

function destination(url: string): string {
  return url.replace(/[\u0000- \u007f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/</g, '%3C').replace(/>/g, '%3E');
}

// --- inline ----------------------------------------------------------------------------------

function mark(inner: string, m: string): string {
  const lead = /^\s*/.exec(inner)?.[0] ?? '';
  const trail = /\s*$/.exec(inner)?.[0] ?? '';
  const core = inner.trim();
  if (/^[\u0001\u0002\s]*$/.test(core)) return inner;
  return `${lead}${m}${core}${m}${trail}`;
}

function inlineNodes(nodes: Iterable<Node>, pre: boolean): string {
  let out = '';
  for (const n of nodes) out += inline(n, pre);
  return out;
}

/** Text with the whitespace of HTML, and (outside `pre`) with it collapsed. */
function textOf(n: Text, pre: boolean): string {
  const raw = n.data.replace(/\u0000/g, '');
  return pre ? raw : raw.replace(/ /g, ' ').replace(/[ \t\r\n\f]+/g, ' ');
}

function inline(n: Node, pre: boolean): string {
  if (isText(n)) return pre ? n.data : escapeText(textOf(n, false));
  if (!isElement(n)) return '';
  const name = tag(n);
  if (BLOCKS.has(name)) return `${SEP}${inlineNodes(n.childNodes, pre)}${SEP}`;
  switch (name) {
    case 'br': return BR;
    case 'strong': case 'b':
      // A bold that wraps blocks is a wrapper (Google Docs wraps a whole copy in one), not emphasis.
      return containsBlock(n) ? inlineNodes(n.childNodes, pre) : mark(inlineNodes(n.childNodes, pre), '**');
    case 'em': case 'i':
      return containsBlock(n) ? inlineNodes(n.childNodes, pre) : mark(inlineNodes(n.childNodes, pre), '*');
    case 'del': case 's': return mark(inlineNodes(n.childNodes, pre), '~~');
    case 'code': return codeSpan(plain(n).replace(/[ \t\r\n\f]+/g, ' ').replace(/ /g, ' '));
    case 'a': {
      const href = n.getAttribute('href');
      const label = inlineNodes(n.childNodes, pre);
      if (!href) return label;
      return `[${label.trim() === '' ? escapeText(href) : label}](${destination(href)})`;
    }
    case 'img': {
      // The sanitiser keeps only a local reference; a remote image arrives without its src, so
      // nothing here can name (let alone fetch) a remote URL. No source, no image: tracking pixels vanish.
      const src = n.getAttribute('src');
      const alt = (n.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim();
      return src ? `![${escapeText(alt)}](${destination(src)})` : '';
    }
    case 'input': return ''; // a checkbox outside a list item's head means nothing
    default: return inlineNodes(n.childNodes, pre); // span, font, o:p, unknown: transparent
  }
}

/** textContent, with <br> as a newline. */
function plain(n: Node): string {
  if (isText(n)) return n.data.replace(/\u0000/g, '');
  if (!isElement(n)) return '';
  if (tag(n) === 'br') return '\n';
  let out = '';
  for (const c of n.childNodes) out += plain(c);
  return out;
}

/** Turns inline sentinels and runs of space into the paragraph's final text. */
function paragraph(s: string, br: string): string {
  const text = s
    .replace(/ *([\u0001\u0002]) */g, '$1')
    .replace(/[\u0002]+/g, '\u0002')
    .replace(/\u0002/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/^[\u0001 ]+|[\u0001 ]+$/g, '')
    .replace(/ ?\u0001 ?/g, '\u0001')
    .replace(/\u0001{2,}/g, '\u0001')
    .replace(/^ +| +$/g, '');
  return text.replace(/\u0001/g, br);
}

const block = (s: string): string => paragraph(s, '\\\n').split('\n').map(escapeLineStart).join('\n');
const oneLine = (s: string): string => paragraph(s, ' ');

// --- blocks ----------------------------------------------------------------------------------

function language(code: Element | null): string {
  const cls = code?.getAttribute('class') ?? '';
  return /(?:^|\s)(?:language|lang)-([A-Za-z0-9_+#.-]{1,40})(?=\s|$)/.exec(cls)?.[1] ?? '';
}

function fenced(pre: Element): string {
  const code = [...pre.children].length === 1 && tag(pre.children[0] as Element) === 'code' ? (pre.children[0] as Element) : null;
  const lang = language(code) || language(pre);
  const body = plain(code ?? pre).replace(/\r\n|\r/g, '\n').replace(/\n$/, '');
  const fence = fenceFor(body);
  return `${fence}${lang}\n${body}\n${fence}`;
}

function indentLines(s: string, pad: string, skipFirst: boolean): string {
  return s.split('\n').map((l, i) => (i === 0 && skipFirst) || l === '' ? l : pad + l).join('\n');
}

function listItem(li: Element, marker: string): string {
  let nodes = [...li.childNodes];
  let task = '';
  const firstContent = nodes.find((c) => !(isText(c) && c.data.trim() === ''));
  if (firstContent && isElement(firstContent) && tag(firstContent) === 'input') {
    task = firstContent.hasAttribute('checked') ? '[x] ' : '[ ] ';
    nodes = nodes.filter((c) => c !== firstContent);
  }
  const blocks = blocksOf(nodes);
  const lists = blocks.filter((b) => b.list);
  const rest = blocks.filter((b) => !b.list);
  const tight = rest.length <= 1;
  const body = [...rest, ...lists].map((b) => b.text);
  const text = body.join(tight ? '\n' : '\n\n');
  return `${marker}${task}${indentLines(text, ' '.repeat(marker.length), true)}`.replace(/[ ]+$/, '');
}

function listOf(list: Element): string {
  const ordered = tag(list) === 'ol';
  const start = ordered ? Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1 : 1;
  const items = [...list.children].filter((c) => tag(c) === 'li');
  const lines: string[] = [];
  items.forEach((li, i) => lines.push(listItem(li, ordered ? `${start + i}. ` : '- ')));
  // A list item with no tag around it (stray text) is not an item: blocksOf handles it as a paragraph.
  return lines.join('\n');
}

function tableOf(table: Element): string {
  const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  if (rows.length === 0) return '';
  const cellText = (cell: Element): string => {
    const s = inlineNodes(cell.childNodes, false);
    return paragraph(s.replace(/\u0002+/g, '\u0001'), '<br>').replace(/\|/g, '\\|');
  };
  const grid = rows.map((tr) => [...tr.children].filter((c) => tag(c) === 'td' || tag(c) === 'th').map(cellText));
  const width = Math.max(...grid.map((r) => r.length));
  if (width === 0) return '';
  const line = (r: string[]): string => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`.replace(/ +\|/g, ' |');
  const [head, ...body] = grid as [string[], ...string[][]];
  return [line(head), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(line)].join('\n');
}

interface Out { readonly text: string; readonly list?: boolean }

function blocksOf(nodes: Iterable<Node>): Out[] {
  const out: Out[] = [];
  let run: Node[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const text = block(inlineNodes(run, false));
    run = [];
    if (text !== '') out.push({ text });
  };
  for (const n of nodes) {
    if (!isBlock(n)) { run.push(n); continue; }
    flush();
    const name = tag(n);
    if (/^h[1-6]$/.test(name)) {
      const t = oneLine(inlineNodes(n.childNodes, false));
      if (t !== '') out.push({ text: `${'#'.repeat(Number(name[1]))} ${t}` });
    } else if (name === 'p' || name === 'dt' || name === 'dd' || name === 'summary' || name === 'caption' || name === 'figcaption') {
      if (containsBlock(n)) out.push(...blocksOf(n.childNodes));
      else { const t = block(inlineNodes(n.childNodes, false)); if (t !== '') out.push({ text: t }); }
    } else if (name === 'ul' || name === 'ol') {
      const t = listOf(n);
      if (t !== '') out.push({ text: t, list: true });
    } else if (name === 'pre') out.push({ text: fenced(n) });
    else if (name === 'hr') out.push({ text: '---' });
    else if (name === 'blockquote') {
      const inner = blocksOf(n.childNodes).map((b) => b.text).join('\n\n');
      if (inner !== '') out.push({ text: inner.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)).join('\n') });
    } else if (name === 'table') {
      const t = tableOf(n);
      if (t !== '') out.push({ text: t });
    } else if (name === 'li') {
      // An item with no list around it (a clipboard fragment can start mid-list): a one-item list.
      const t = listItem(n, '- ');
      if (t !== '- ') out.push({ text: t, list: true });
    } else out.push(...blocksOf(n.childNodes)); // div, section, tr, tbody ...: transparent containers
  }
  flush();
  return out;
}

/** Sanitised, parsed inertly, walked once; one trailing newline, or '' when nothing readable is left. */
export function htmlToMarkdown(html: string): string {
  // Word marks the bullet or number it draws by hand "for targets without list support": a target
  // that has lists (this one) is told to skip it. A hint only: the sanitiser is the boundary.
  const input = html.replace(/\u0000/g, '').replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/gi, '');
  const clean = sanitizeHtml(input, PASTE_POLICY).html;
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const md = blocksOf(doc.body.childNodes).map((b) => b.text).join('\n\n');
  return md === '' ? '' : `${md}\n`;
}
