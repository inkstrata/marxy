// A notebook's HTML output, cleaned before it is shown. It goes through the same sanitiser as
// every document under a narrower list: the elements a table or a styled paragraph is made of, links the
// reader acts on, and images only when they are carried in the output itself (a `data:` image, which loads nothing).
// No script, no event handler, no style, no form, no frame, no id, name or class, nothing fetched. What was taken out is
// counted by what it was, so the line under the output can say so. Pure.
import { DEFAULT_POLICY, type AttributeRule, type ElementRule, type Policy } from '../sanitize/policy.ts';
import { sanitizeHtml, type Removal } from '../sanitize/sanitize-html.ts';

const TEXT: AttributeRule = { kind: 'text' };
const DIMENSION: AttributeRule = { kind: 'pattern', pattern: /^[0-9]{1,4}(%)?$/ };
/** Attributes no output keeps: an id or a name can shadow the page's own, and a class can dress as Marxy's chrome. */
const NAMING = new Set(['id', 'name', 'class']);

function withoutNaming(rule: ElementRule): ElementRule {
  const attributes = Object.fromEntries(Object.entries(rule.attributes ?? {}).filter(([k]) => !NAMING.has(k)));
  return { ...rule, attributes };
}

const ELEMENTS: Readonly<Record<string, ElementRule>> = {
  ...Object.fromEntries(Object.entries(DEFAULT_POLICY.elements).filter(([name]) => name !== 'input').map(([name, rule]) => [name, withoutNaming(rule)])),
  // A pandas table sits in a `div`; a styled output wraps its text in spans. Neither can fetch, run or name anything.
  div: {},
  span: {},
  small: {},
  caption: {},
  // `src` is a subresource and only `data:` is allowed for one here; an image that loses it goes whole.
  img: { attributes: { src: { kind: 'url', context: 'subresource' }, alt: TEXT, title: TEXT, width: DIMENSION, height: DIMENSION }, requires: ['src'] },
};

export const NOTEBOOK_HTML_POLICY: Policy = {
  name: 'marxy-notebook-output',
  elements: ELEMENTS,
  transparent: ['article', 'aside', 'center', 'details', 'figcaption', 'figure', 'font', 'footer', 'header', 'hgroup', 'main', 'nav', 'picture', 'section', 'summary'],
  globalAttributes: DEFAULT_POLICY.globalAttributes,
  urlSchemes: { link: ['http', 'https', 'mailto'], subresource: ['data'] },
  reservedIdPrefix: 'marxy-',
};

/** An image carried in the output: the four raster formats the webview draws, and SVG, which `<img>` never runs. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i;

/** What the cleaning left out, by what it was: the line under the output names each. */
export interface LeftOut {
  script: number;
  handler: number;
  remote: number;
  jsLink: number;
  style: number;
  frame: number;
  form: number;
  other: number;
}

const none = (): LeftOut => ({ script: 0, handler: 0, remote: 0, jsLink: 0, style: 0, frame: 0, form: 0, other: 0 });

const FRAMES = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal']);
const FORMS = new Set(['form', 'button', 'select', 'textarea', 'input', 'option', 'fieldset']);
const REMOTE = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;

function count(removed: readonly Removal[]): LeftOut {
  const n = none();
  for (const r of removed) {
    if (r.what === 'element') {
      // An image that lost its `src` is counted once, by why its `src` went.
      if (r.name === 'img' && r.reason.includes(' lost ')) continue;
      if (r.name === 'script') n.script++;
      else if (r.name === 'style') n.style++;
      else if (FRAMES.has(r.name)) n.frame++;
      else if (FORMS.has(r.name)) n.form++;
      // An element unwrapped with its contents kept is not something left out.
      else if (!r.reason.includes('its contents were kept')) n.other++;
    } else if (r.what === 'attribute') {
      if (r.name.startsWith('on')) n.handler++;
      else if (r.name === 'src' && r.on === 'img') {
        if (REMOTE.test(r.value ?? '') || /^https?:/i.test(r.value ?? '')) n.remote++;
        else n.other++;
      } else if ((r.name === 'href' || r.name === 'src' || r.name === 'action' || r.name === 'formaction') && /^\s*(?:javascript|vbscript):/i.test(r.value ?? '')) n.jsLink++;
      else if (r.name === 'href') n.other++;
      // Presentation (style, class, border, an id) goes without a word.
    } else if (r.what === 'truncation') n.other++;
  }
  return n;
}

const plural = (k: number, one: string, many = `${one}s`): string => `${k} ${k === 1 ? one : many}`;

/** "1 script, 1 event handler, 1 image from the network": what was left out, or '' when nothing was. */
export function leftOutWords(n: LeftOut): string {
  return [
    n.script && plural(n.script, 'script'),
    n.handler && plural(n.handler, 'event handler'),
    n.remote && plural(n.remote, 'image from the network', 'images from the network'),
    n.jsLink && plural(n.jsLink, 'link that runs script', 'links that run script'),
    n.style && plural(n.style, 'style block'),
    n.frame && plural(n.frame, 'embedded frame'),
    n.form && plural(n.form, 'form part'),
    n.other && plural(n.other, 'other part'),
  ]
    .filter(Boolean)
    .join(', ');
}

/** The sanitiser's `<img …/>` (canonical: double-quoted values, `"` escaped), its attributes captured. */
const IMG_TAG = /<img((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/>/g;

export interface CleanedHtml {
  readonly html: string;
  readonly left: LeftOut;
  /** Everything the sanitiser reported, for a test or a notice to read. */
  readonly removed: readonly Removal[];
}

/**
 * `html` cleaned for the page. Images that survive are `data:` images: each is marked done for the page's image pass,
 * which would otherwise take a `src` it cannot resolve as a file. Any other `src` (a relative path) is taken out here.
 */
export function cleanOutputHtml(html: string): CleanedHtml {
  const { html: clean, removed } = sanitizeHtml(html, NOTEBOOK_HTML_POLICY);
  const left = count(removed);
  const out = clean.replace(IMG_TAG, (tag, attrs: string) => {
    const src = /\ssrc="([^"]*)"/.exec(attrs)?.[1];
    if (src === undefined || !DATA_IMAGE.test(src)) {
      // An image whose `src` the sanitiser refused (a remote one) is counted already; a local path is not.
      if (src !== undefined) left.other++;
      return '';
    }
    return `<img${attrs} data-marxy-done="images" />`;
  });
  return { html: out, left, removed };
}
