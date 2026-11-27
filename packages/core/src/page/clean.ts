// An HTML page cleaned to be drawn in a sandbox (E8 mail's HTML part, E10 an HTML file read as a page). It
// goes through the one sanitiser under a page's list: the elements a styled page, a table or a form is made of,
// with its own styles and classes, since it is drawn in a frame of its own and never in the reader's page. Scripts,
// event handlers and anything that would run go; what would load from the network is left out and counted by host; a
// frame becomes a line naming its host; a form is shown and never sent; a link is shown and never followed. The frame
// adds no scripts and a policy of no network on top, so a miss here still cannot run or fetch. Pure: no DOM, no I/O.
import { decodeReferences, escapeAttribute } from '../sanitize/escape.ts';
import { REMOTE_IMAGE_ATTR, type AttributeRule, type ElementRule, type Policy } from '../sanitize/policy.ts';
import { sanitizeHtml, type Removal } from '../sanitize/sanitize-html.ts';

const TEXT: AttributeRule = { kind: 'text' };
const BOOL: AttributeRule = { kind: 'boolean' };
const LINK: AttributeRule = { kind: 'url', context: 'link' };
const DIMENSION: AttributeRule = { kind: 'pattern', pattern: /^[0-9]{1,5}(?:%|px)?$/i };
const SMALL: AttributeRule = { kind: 'pattern', pattern: /^-?[0-9]{1,4}$/ };
const COLOUR: AttributeRule = { kind: 'pattern', pattern: /^(?:#[0-9a-f]{3,8}|[a-z]{3,20})$/i };
const ALIGN: AttributeRule = { kind: 'enum', values: ['left', 'center', 'right', 'justify', 'top', 'middle', 'bottom', 'absmiddle', 'baseline'] };
const NAME: AttributeRule = { kind: 'pattern', pattern: /^[A-Za-z][\w.:-]{0,63}$/ };

const CELL: Readonly<Record<string, AttributeRule>> = { colspan: SMALL, rowspan: SMALL, nowrap: BOOL, valign: ALIGN, bgcolor: COLOUR, background: { kind: 'url', context: 'subresource' }, scope: TEXT, headers: TEXT, abbr: TEXT };

const plain = (...names: string[]): Record<string, ElementRule> => Object.fromEntries(names.map((n) => [n, {}]));

const ELEMENTS: Readonly<Record<string, ElementRule>> = {
  ...plain(
    'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'dd', 'del', 'dfn',
    'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'i', 'ins', 'kbd', 'legend', 'main',
    'mark', 'nav', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strike', 'strong', 'sub', 'summary', 'sup', 'tbody', 'tfoot',
    'thead', 'time', 'tr', 'tt', 'u', 'var', 'wbr', 'div', 'hgroup', 'dir', 'menu',
  ),
  a: { attributes: { href: LINK, name: NAME } },
  bdo: { attributes: { dir: { kind: 'enum', values: ['ltr', 'rtl'] } } },
  body: { attributes: { bgcolor: COLOUR, text: COLOUR, link: COLOUR, vlink: COLOUR, alink: COLOUR, background: { kind: 'url', context: 'subresource' } } },
  col: { attributes: { span: SMALL } },
  colgroup: { attributes: { span: SMALL } },
  details: { attributes: { open: BOOL } },
  font: { attributes: { face: TEXT, size: { kind: 'pattern', pattern: /^[+-]?[0-9]$/ }, color: COLOUR } },
  hr: { attributes: { noshade: BOOL, size: SMALL } },
  img: { attributes: { src: { kind: 'url', context: 'subresource' }, alt: TEXT, border: SMALL, hspace: SMALL, vspace: SMALL } },
  li: { attributes: { value: SMALL, type: TEXT } },
  ol: { attributes: { start: SMALL, type: TEXT, reversed: BOOL } },
  ul: { attributes: { type: TEXT } },
  style: { attributes: { media: TEXT } },
  table: { attributes: { cellpadding: SMALL, cellspacing: SMALL, border: SMALL, bgcolor: COLOUR, summary: TEXT, background: { kind: 'url', context: 'subresource' }, frame: TEXT, rules: TEXT } },
  td: { attributes: CELL },
  th: { attributes: CELL },
  // Kept so their host can be said: each is taken out after the pass (`afterPass`), never drawn as itself.
  link: { attributes: { rel: TEXT, href: LINK } },
  iframe: { attributes: { src: LINK } },
  frame: { attributes: { src: LINK } },
  object: { attributes: { data: LINK } },
  embed: { attributes: { src: LINK } },
  // A form is shown and never sent: its action is said and dropped, and every control is disabled.
  form: { attributes: { action: LINK, method: TEXT } },
  fieldset: { forced: { disabled: true } },
  label: { attributes: { for: NAME } },
  input: {
    attributes: { type: { kind: 'enum', values: ['text', 'email', 'search', 'tel', 'url', 'number', 'password', 'checkbox', 'radio', 'date', 'hidden', 'button', 'submit', 'reset'] }, name: NAME, value: TEXT, placeholder: TEXT, checked: BOOL, size: SMALL },
    forced: { disabled: true },
  },
  button: { attributes: { type: { kind: 'enum', values: ['button', 'submit', 'reset'] }, name: NAME, value: TEXT }, forced: { disabled: true } },
  select: { attributes: { name: NAME, multiple: BOOL, size: SMALL }, forced: { disabled: true } },
  option: { attributes: { value: TEXT, selected: BOOL } },
  optgroup: { attributes: { label: TEXT } },
  textarea: { attributes: { name: NAME, rows: SMALL, cols: SMALL, placeholder: TEXT }, forced: { disabled: true } },
};

/**
 * How deep a page's elements may nest in the sandbox. The frame's layout costs about three times as much for each
 * doubling of a deeper page; past this an element's tags are dropped and its contents kept, as flat text of the same words.
 */
export const PAGE_MAX_DEPTH = 256;

export const PAGE_POLICY: Policy = {
  name: 'marxy-sandboxed-page',
  elements: ELEMENTS,
  transparent: ['html', 'head', 'picture', 'noscript', 'nobr'],
  globalAttributes: {
    dir: { kind: 'enum', values: ['ltr', 'rtl', 'auto'] },
    lang: { kind: 'pattern', pattern: /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/ },
    style: TEXT,
    class: { kind: 'tokens', token: /^[A-Za-z_-][\w-]{0,63}$/ },
    id: NAME,
    title: TEXT,
    align: ALIGN,
    valign: ALIGN,
    width: DIMENSION,
    height: DIMENSION,
    role: TEXT,
  },
  // `cid:` is the message's own part, read from memory; `data:` is carried in the page. Nothing else is a subresource.
  urlSchemes: { link: ['http', 'https', 'mailto'], subresource: ['data', 'cid'] },
  reservedIdPrefix: 'marxy-',
  maxOpen: PAGE_MAX_DEPTH,
};

/** An image the page would have fetched: where from, and the size the page gives it (0 when it gives none). */
export interface RemoteImage {
  readonly url: string;
  readonly host: string;
  readonly width: number;
  readonly height: number;
  /** Named in a style's `url(...)`, not an `<img>`. */
  readonly css: boolean;
}

export interface PageLink {
  readonly text: string;
  readonly href: string;
  /** The host the text names when it reads as an address, else ''. */
  readonly says: string;
  /** The host the link goes to, else '' (a relative link, mailto). */
  readonly goes: string;
  /** The text names one place and the link goes to another. */
  readonly odd: boolean;
}

/** What the cleaning left out, by what it was. */
export interface PageLeftOut {
  scripts: number;
  handlers: number;
  /** Links whose target was script (`javascript:`), taken out. */
  scriptLinks: number;
  /** Stylesheets from the network (a `<link>` or an `@import`), by URL. */
  readonly stylesheets: string[];
  readonly images: RemoteImage[];
  /** Frames, objects and embeds, by the URL each would have loaded ('' when it named none). */
  readonly frames: string[];
  forms: number;
  /** Elements whose tags were dropped for nesting deeper than `PAGE_MAX_DEPTH`, their contents kept. */
  flattened: number;
  /** Anything else taken out with its contents (an `<svg>`, a `<video>`), counted. */
  other: number;
}

export interface CleanedPage {
  /** The body's markup, cleaned, with the page's `<body>` attributes kept on a `<body>` the frame merges into its own. */
  readonly html: string;
  /** The page's own style blocks, cleaned: the frame adopts them as sheets. */
  readonly css: readonly string[];
  readonly title: string;
  readonly left: PageLeftOut;
  readonly links: readonly PageLink[];
  readonly removed: readonly Removal[];
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const ATTR = /\s([a-z-]+)(?:="([^"]*)")?/g;

/** Attributes of a tag the sanitiser wrote (canonical: lowercase names, double-quoted values, `"` escaped). */
function attrsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(ATTR)) out.set(m[1]!, decodeReferences(m[2] ?? ''));
  return out;
}

const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]*)\1\s*\)?[^;]*;?/gi;

/** A style's text with every `@import` and every `url(...)` that is not carried in it (`data:`) taken out, and counted. */
export function cleanCss(css: string, left: PageLeftOut, cid?: (id: string) => string | null): string {
  return css
    .replace(CSS_IMPORT, (_all, _q, url: string) => {
      left.stylesheets.push(url);
      return '';
    })
    .replace(CSS_URL, (all, _q, url: string) => {
      const u = url.trim();
      if (/^data:image\//i.test(u) || /^data:(?:font|application\/(?:font|x-font))/i.test(u)) return all;
      if (/^cid:/i.test(u) && cid) {
        const local = cid(u.slice(4));
        if (local) return `url("${local}")`;
      }
      if (REMOTE_URL.test(u)) left.images.push({ url: u, host: hostOf(u.startsWith('//') ? `https:${u}` : u), width: 0, height: 0, css: true });
      return 'none';
    })
    // Old engines' ways to run script from a style, and a binding to another document: none of them may stay.
    .replace(/expression\s*\(|-moz-binding|behavior\s*:/gi, 'x-');
}

/** "harbour.example" when `text` reads as an address (`https://harbour.example/notices`, `harbour.example`), else ''. */
function hostSaid(text: string): string {
  const t = text.trim();
  if (!/^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i.test(t)) return '';
  return hostOf(/^https?:/i.test(t) ? t : `https://${t}`);
}

/**
 * `html` without its tags, as `html.replace(/<[^>]*>/g, '')` leaves it, in one pass: the pattern looked for a `>` from every
 * `<`, so a run of `<` with none after it was quadratic.
 */
function withoutTags(html: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    // No `>` after this `<` is none after any later one: the rest is text.
    const gt = lt < 0 ? -1 : html.indexOf('>', lt + 1);
    if (gt < 0) return out + html.slice(i);
    out += html.slice(i, lt);
    i = gt + 1;
  }
}

const stripTags = (html: string): string => decodeReferences(withoutTags(html)).replace(/\s+/g, ' ').trim();

/**
 * What the first `<title>` holds, as `/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i` reads it, in one pass. The pattern looked for
 * a close from every `<title`, so a page of unclosed ones was quadratic; the first one is enough, since a close after a later
 * one is after it too.
 */
function titleText(html: string): string {
  const open = /<title\b/i.exec(html);
  if (!open) return '';
  const from = html.indexOf('>', open.index + open[0].length);
  if (from < 0) return '';
  const close = /<\/title\s*>/gi;
  close.lastIndex = from + 1;
  const end = close.exec(html);
  return end ? html.slice(from + 1, end.index) : '';
}

/** A placeholder's picture: a quiet box at the image's own size, said in words only when there is room. */
export function placeholderImage(width: number, height: number, words: string): string {
  const w = width || 320;
  const h = height || 80;
  const label = h >= 28 && w >= 120 && words ? `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#6d6a63">${words.replace(/[<&]/g, '')}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#eceae4" stroke="#b9b5ab" stroke-dasharray="4 3"/>${label}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface CleanOptions {
  /** A `cid:` reference read from the message's parts: a `data:` URL, or null when the message has no such part. */
  readonly cid?: (id: string) => string | null;
}

const FRAMES = new Set(['iframe', 'frame', 'object', 'embed', 'frameset', 'applet', 'portal']);

/** `html` cleaned to be drawn in the sandbox frame, and what was left out. */
export function cleanPage(html: string, opts: CleanOptions = {}): CleanedPage {
  const title = stripTags(titleText(html));
  const { html: clean, removed } = sanitizeHtml(html, PAGE_POLICY);
  const left: PageLeftOut = { scripts: 0, handlers: 0, scriptLinks: 0, stylesheets: [], images: [], frames: [], forms: 0, flattened: 0, other: 0 };
  for (const r of removed) {
    if (r.what === 'structure' && r.reason.includes(' elements open;')) left.flattened++;
    else if (r.what === 'element') {
      if (r.name === 'script') left.scripts++;
      else if (FRAMES.has(r.name)) left.frames.push('');
      else if (r.reason.includes('its contents were kept') || r.name === 'title' || r.name === 'meta' || r.name === 'base') continue;
      else left.other++;
    } else if (r.what === 'attribute') {
      if (r.name.startsWith('on')) left.handlers++;
      else if (/^\s*(?:javascript|vbscript):/i.test(r.value ?? '')) left.scriptLinks++;
      else if (r.on === 'img' && r.name === 'src' && /^http:/i.test(r.url ?? '')) {
        // Over plain http: never loaded, even when asked. Its place is kept as the others' are.
        left.images.push({ url: r.url!, host: hostOf(r.url!), width: 0, height: 0, css: false });
      } else if (r.name === 'background' && REMOTE_URL.test(r.url ?? '')) left.images.push({ url: r.url!, host: hostOf(r.url!), width: 0, height: 0, css: true });
    }
  }
  const css: string[] = [];
  const links: PageLink[] = [];
  let out = clean
    // A block closes the writer's `<body>` at once; the frame's parser merges a stray `<body>`'s attributes into its own.
    .replace(/<\/body>/g, '')
    // Each style block goes to the frame as a sheet of its own; the markup keeps none.
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/g, (_all, text: string) => {
      // The writer escapes `<`, `>` and `"` in all text; a style's text is raw, so they go back before it is a sheet.
      css.push(cleanCss(text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"'), left, opts.cid));
      return '';
    })
    .replace(/<link\b([^>]*)\/>/g, (_all, attrs: string) => {
      const a = attrsOf(attrs);
      if (/\bstylesheet\b/i.test(a.get('rel') ?? '') && a.get('href')) left.stylesheets.push(a.get('href')!);
      return '';
    })
    .replace(/<(iframe|frame|object|embed)\b([^>]*?)(\/?)>/g, (_all, name: string, attrs: string, solidus: string) => {
      const a = attrsOf(attrs);
      const url = a.get(name === 'object' ? 'data' : 'src') ?? '';
      left.frames.push(url);
      const host = hostOf(url);
      const box = `<div style="padding:14px;margin:8px 0;border:1px dashed #b9b5ab;color:#6d6a63;font:13px sans-serif;background:#f3f1ec">A frame from ${escapeAttribute(host || 'elsewhere')}, not loaded.</div>`;
      // The frame's own fallback inside it is not drawn: a browser shows it only where frames are not.
      return solidus || name === 'embed' ? box : `${box}<div hidden>`;
    })
    .replace(/<\/(?:iframe|frame|object)>/g, '</div>')
    .replace(/<form\b([^>]*)>/g, (_all, attrs: string) => {
      left.forms++;
      return `<form${attrs.replace(/\saction="[^"]*"/, '')}>`;
    })
    .replace(/\sstyle="([^"]*)"/g, (_all, value: string) => ` style="${escapeAttribute(cleanCss(decodeReferences(value), left, opts.cid))}"`)
    .replace(/\sbackground="([^"]*)"/g, (_all, value: string) => {
      const url = decodeReferences(value);
      if (/^cid:/i.test(url)) {
        const local = opts.cid?.(url.slice(4));
        return local ? ` background="${escapeAttribute(local)}"` : '';
      }
      return /^data:image\//i.test(url) ? ` background="${escapeAttribute(url)}"` : '';
    })
    .replace(/<img\b([^>]*?)\s*\/>/g, (_all, attrs: string) => {
      const a = attrsOf(attrs);
      const keep = attrs.replace(/\s(?:src|data-marxy-remote|width|height)="[^"]*"/g, '');
      const w = Number.parseInt(a.get('width') ?? '', 10) || 0;
      const h = Number.parseInt(a.get('height') ?? '', 10) || 0;
      const size = `${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}`;
      const src = a.get('src');
      const remote = a.get(REMOTE_IMAGE_ATTR);
      if (src !== undefined && /^cid:/i.test(src)) {
        const local = opts.cid?.(src.slice(4)) ?? null;
        return local ? `<img${keep}${size} src="${escapeAttribute(local)}" />` : `<img${keep}${size} />`;
      }
      if (src !== undefined && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(src)) return `<img${keep}${size} src="${escapeAttribute(src)}" />`;
      if (remote !== undefined) {
        left.images.push({ url: remote, host: hostOf(remote), width: w, height: h, css: false });
        const pixel = w > 0 && h > 0 && w <= 2 && h <= 2;
        const box = placeholderImage(w, h, pixel ? '' : 'an image from the network, not loaded');
        return `<img${keep}${size} src="${escapeAttribute(box)}" ${REMOTE_IMAGE_ATTR}="${escapeAttribute(remote)}" />`;
      }
      // Plain http (counted above) or a local path the page cannot reach: its place, quietly.
      if (/^http:/i.test(a.get('src') ?? '') || src === undefined) return `<img${keep}${size} src="${escapeAttribute(placeholderImage(w, h, w > 2 || h > 2 ? 'an image not loaded' : ''))}" />`;
      return `<img${keep}${size} />`;
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (_all, attrs: string, inner: string) => {
      const a = attrsOf(attrs);
      const href = a.get('href');
      if (href === undefined) return `<a${attrs}>${inner}</a>`;
      const text = stripTags(inner);
      const says = hostSaid(text);
      const goes = hostOf(href);
      links.push({ text, href, says, goes, odd: says !== '' && goes !== '' && says.replace(/^www\./, '') !== goes.replace(/^www\./, '') });
      // Shown as a link and never followed: no href, so nothing in the frame can go anywhere.
      return `<a${attrs.replace(/\shref="[^"]*"/, '')} data-marxy-href="${escapeAttribute(href)}" title="${escapeAttribute(href)}">${inner}</a>`;
    });
  out = out.trim();
  return { html: out, css, title, left, links, removed };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The hosts the page would have reached, in the order first named. */
export function hostsOf(left: PageLeftOut): string[] {
  return [...new Set([...left.stylesheets, ...left.images.map((i) => i.url), ...left.frames].map((u) => hostOf(u.startsWith('//') ? `https:${u}` : u)).filter(Boolean))];
}

/**
 * The line above a page read in the sandbox: "2 scripts not run, 1 event handler left out; 1 stylesheet, 1 image,
 * 1 frame from the network not loaded (cdn.harbour.example, maps.harbour.example); 1 form shown, never sent".
 */
export function leftOutLine(left: PageLeftOut): string {
  const ran = [left.scripts && `${plural(left.scripts, 'script')} not run`, left.handlers && `${plural(left.handlers, 'event handler')} left out`, left.scriptLinks && `${plural(left.scriptLinks, 'link that runs script', 'links that run script')} left out`].filter(Boolean).join(', ') || 'no scripts';
  const images = left.images.length;
  const net = [left.stylesheets.length && plural(left.stylesheets.length, 'stylesheet'), images && plural(images, 'image'), left.frames.length && plural(left.frames.length, 'frame')].filter(Boolean);
  const hosts = hostsOf(left);
  const network = net.length ? `${net.join(', ')} from the network not loaded${hosts.length ? ` (${hosts.join(', ')})` : ''}` : 'nothing from the network';
  const forms = left.forms ? `; ${plural(left.forms, 'form')} shown, never sent` : '';
  const deep = left.flattened ? `; nesting past ${PAGE_MAX_DEPTH} levels flattened` : '';
  const other = left.other ? `; ${plural(left.other, 'other part')} left out` : '';
  return `${ran}; ${network}${forms}${deep}${other}`;
}
