// The allow-list: the security boundary of the rendered document (ADR-0009). Default-deny — an
// element, an attribute or a URL scheme reaches the DOM only because it is named here, and nothing
// in this file names a bad thing, because the vector nobody thought of is the one that matters.

/** How an attribute's value is decided, once character references are decoded. */
export type AttributeRule =
  /** Prose: kept, re-escaped. */
  | { readonly kind: 'text' }
  /** Present or absent; any value is discarded. */
  | { readonly kind: 'boolean' }
  /**
   * A URL. `link` is a place the reader has to act on before anything happens; `subresource` is a
   * place the browser fetches on its own, which is a read receipt sent to whoever hosts it.
   */
  | { readonly kind: 'url'; readonly context: UrlContext }
  /** One of a fixed set of values, compared case-insensitively. */
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  /** A value matching a pattern exactly, or the attribute goes. */
  | { readonly kind: 'pattern'; readonly pattern: RegExp }
  /** A space-separated list; each token must match, and tokens that do not are dropped. */
  | { readonly kind: 'tokens'; readonly token: RegExp };

export type UrlContext = 'link' | 'subresource';

export interface ElementRule {
  /** Attributes permitted on this element, beyond the global ones. */
  readonly attributes?: Readonly<Record<string, AttributeRule>>;
  /**
   * Attributes the element is meaningless without: if one of them does not survive the allow-list,
   * the element goes too. `<input>` needs this — an input that loses `type="checkbox"` would default
   * to a text field, which is a form control the document never earned.
   */
  readonly requires?: readonly string[];
  /**
   * Attributes the element always carries, whatever the document said. `disabled` on a checkbox is
   * the case: marxy is a reader, so a control whose state changes while the file's bytes do not is
   * a lie to the reader (ADR-0001).
   */
  readonly forced?: Readonly<Record<string, string | true>>;
}

export interface Policy {
  /** Named so a removal report and a test failure can say which allow-list made the decision. */
  readonly name: string;
  /**
   * When set, `id` and `name` values with this prefix (case-insensitive) are refused on elements
   * that carry no byte provenance — islands only; renderer output is judged in a pass that clears
   * this field (§12).
   */
  readonly reservedIdPrefix?: string;
  /** Elements that reach the DOM. Anything absent is removed with its subtree. */
  readonly elements: Readonly<Record<string, ElementRule>>;
  /**
   * Elements whose own markup is dropped but whose children are kept: wrappers that carry layout
   * rather than meaning. Being in this list is itself a permission — an unknown element loses its
   * contents as well as its tags, because we cannot know whether its contents are prose.
   */
  readonly transparent: readonly string[];
  /** Attributes permitted on every allowed element. */
  readonly globalAttributes: Readonly<Record<string, AttributeRule>>;
  /** URL schemes permitted per context. Empty means: nothing with a scheme, local references only. */
  readonly urlSchemes: Readonly<Record<UrlContext, readonly string[]>>;
}

/**
 * HTML's void elements. A fact of the parsing spec rather than a judgement: these have no end tag,
 * so a removed one removes only itself, and scanning for `</meta>` would swallow the rest of the
 * document.
 */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
]);

/**
 * Elements whose content the parser reads as text rather than as markup, so it ends them at the
 * first `</name` followed by whitespace, `/` or `>` — inside a quoted attribute value included.
 * `plaintext` never ends, and `script` has escaped states of its own (see `skipScriptData`).
 * `listing` is not here: both engines parse its content as markup, like `pre`. Measured in WebKit and
 * Chromium: `<style><b title="</style>">` really does end the style in both. The sanitiser removes
 * every one of these, and has to find the end of each one the way the parser will.
 */
export const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript',
  'plaintext',
]);

/**
 * The two elements that switch the parser into foreign content, where a trailing solidus really
 * does close a tag. Outside them a parser ignores it, which is why `<a href="…" />` opens an anchor.
 */
export const FOREIGN_ROOTS: ReadonlySet<string> = new Set(['svg', 'math']);

/**
 * Block-level elements, in the parsing sense that matters here: a formatting element may not span
 * one. The writer closes any open formatting element when a block starts, so an unclosed `<a>` can
 * capture at most the block it was opened in rather than the rest of the document.
 */
export const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/** An anchor, an id, a footnote label: conservative, and never a value a CSS selector can smuggle. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,64}$/;
/** Only the two families the renderer and the highlighter (MARXY-27) emit. */
const CLASS_TOKEN = /^(?:language-[A-Za-z0-9#+._-]{1,32}|marxy-[a-z-]{1,32})$/;
const SMALL_INTEGER = /^[0-9]{1,4}$/;
const BCP47 = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

const TEXT: AttributeRule = { kind: 'text' };
const LINK: AttributeRule = { kind: 'url', context: 'link' };
const SUBRESOURCE: AttributeRule = { kind: 'url', context: 'subresource' };

/**
 * `lang` and `dir` are the only attributes every element may carry: the corpus has right-to-left
 * and CJK documents, and dropping their direction would make them unreadable. Neither can fetch,
 * script or match a theme selector.
 */
const GLOBAL: Readonly<Record<string, AttributeRule>> = {
  dir: { kind: 'enum', values: ['ltr', 'rtl', 'auto'] },
  lang: { kind: 'pattern', pattern: BCP47 },
};

const CELL_ATTRIBUTES: Readonly<Record<string, AttributeRule>> = {
  align: { kind: 'enum', values: ['left', 'center', 'right'] },
  colspan: { kind: 'pattern', pattern: SMALL_INTEGER },
  rowspan: { kind: 'pattern', pattern: SMALL_INTEGER },
};

/**
 * Markdown-equivalent elements: the tags a markdown document could have produced without writing
 * HTML at all. This is the default allow-list ADR-0009 asks for, and raw HTML in a file is held to
 * exactly the same list as the renderer's own output, so there is one boundary to reason about.
 */
const MARKDOWN_EQUIVALENT: Readonly<Record<string, ElementRule>> = {
  a: { attributes: { href: LINK, title: TEXT, class: { kind: 'tokens', token: CLASS_TOKEN }, id: { kind: 'pattern', pattern: IDENTIFIER }, name: { kind: 'pattern', pattern: IDENTIFIER } } },
  abbr: { attributes: { title: TEXT } },
  b: {},
  blockquote: {},
  br: {},
  code: { attributes: { class: { kind: 'tokens', token: CLASS_TOKEN } } },
  dd: {},
  del: {},
  dl: {},
  dt: {},
  em: {},
  h1: { attributes: { id: { kind: 'pattern', pattern: IDENTIFIER } } },
  h2: { attributes: { id: { kind: 'pattern', pattern: IDENTIFIER } } },
  h3: { attributes: { id: { kind: 'pattern', pattern: IDENTIFIER } } },
  h4: { attributes: { id: { kind: 'pattern', pattern: IDENTIFIER } } },
  h5: { attributes: { id: { kind: 'pattern', pattern: IDENTIFIER } } },
  h6: { attributes: { id: { kind: 'pattern', pattern: IDENTIFIER } } },
  hr: {},
  i: {},
  /**
   * The GFM task marker, and nothing else that wears this tag name: `type` may only be `checkbox`,
   * which is what makes `formaction` and friends pointless as well as unlisted.
   */
  input: {
    attributes: { type: { kind: 'enum', values: ['checkbox'] }, checked: { kind: 'boolean' }, disabled: { kind: 'boolean' } },
    requires: ['type'],
    forced: { disabled: true },
  },
  /**
   * An image may keep a *local* reference only: `src` is a `subresource`, and the default scheme
   * list for a subresource is empty, so a remote image loses its `src` and shows its `alt`. Naming
   * the blocked host in a notice is MARXY-26; widening this on a reader's say-so is MARXY-44.
   */
  img: { attributes: { src: SUBRESOURCE, alt: TEXT, title: TEXT, class: { kind: 'tokens', token: CLASS_TOKEN } } },
  kbd: {},
  li: { attributes: { id: { kind: 'pattern', pattern: IDENTIFIER } } },
  ol: { attributes: { start: { kind: 'pattern', pattern: SMALL_INTEGER }, reversed: { kind: 'boolean' }, class: { kind: 'tokens', token: CLASS_TOKEN } } },
  p: {},
  pre: { attributes: { class: { kind: 'tokens', token: CLASS_TOKEN } } },
  s: {},
  strong: {},
  sub: {},
  sup: { attributes: { class: { kind: 'tokens', token: CLASS_TOKEN }, id: { kind: 'pattern', pattern: IDENTIFIER } } },
  table: {},
  tbody: {},
  td: { attributes: CELL_ATTRIBUTES },
  tfoot: {},
  th: { attributes: CELL_ATTRIBUTES },
  thead: {},
  tr: {},
  ul: {},
};

/**
 * Wrappers a README uses for layout. Their markup is not markdown-equivalent, so it goes, but their
 * children are prose a reader came for — `<div align="center"><h1>Project</h1></div>` must not lose
 * the title. `details`/`summary` are here rather than in the element list for the same reason: the
 * default renders their contents open instead of hiding them behind markup we do not ship yet.
 */
const TRANSPARENT: readonly string[] = [
  'article', 'aside', 'center', 'details', 'div', 'figcaption', 'figure', 'font', 'footer', 'header',
  'hgroup', 'main', 'nav', 'picture', 'section', 'small', 'span', 'summary',
];

/**
 * The default policy. `subresource` has no schemes at all: nothing in a document a stranger wrote
 * may cause a fetch, because a fetch is a read receipt (AGENTS.md). `link` allows the three schemes
 * a reader can act on deliberately, and every scheme-bearing value that is not one of them —
 * `javascript:`, `data:`, `vbscript:`, `file:`, and every scheme not invented yet — is removed.
 */
const ALIGN_BLOCK: Readonly<Record<string, AttributeRule>> = {
  align: { kind: 'enum', values: ['left', 'center', 'right'] },
};

const IMG_DIMENSION = /^[0-9]{1,4}(%)?$/;

const IMG_WIDE_ATTRIBUTES: Readonly<Record<string, AttributeRule>> = {
  src: SUBRESOURCE,
  alt: TEXT,
  title: TEXT,
  class: { kind: 'tokens', token: CLASS_TOKEN },
  width: { kind: 'pattern', pattern: IMG_DIMENSION },
  height: { kind: 'pattern', pattern: IMG_DIMENSION },
  align: { kind: 'enum', values: ['left', 'right', 'center', 'top', 'middle', 'bottom'] },
};

function headingWithAlign(level: ElementRule): ElementRule {
  return { attributes: { ...level.attributes, ...ALIGN_BLOCK } };
}

/** README layout HTML: same network boundary as the default list (§12). */
const WIDE_ELEMENTS: Readonly<Record<string, ElementRule>> = {
  ...MARKDOWN_EQUIVALENT,
  div: { attributes: ALIGN_BLOCK },
  p: { attributes: ALIGN_BLOCK },
  h1: headingWithAlign(MARKDOWN_EQUIVALENT.h1),
  h2: headingWithAlign(MARKDOWN_EQUIVALENT.h2),
  h3: headingWithAlign(MARKDOWN_EQUIVALENT.h3),
  h4: headingWithAlign(MARKDOWN_EQUIVALENT.h4),
  h5: headingWithAlign(MARKDOWN_EQUIVALENT.h5),
  h6: headingWithAlign(MARKDOWN_EQUIVALENT.h6),
  details: {},
  summary: {},
  img: { attributes: IMG_WIDE_ATTRIBUTES },
};

const WIDE_TRANSPARENT: readonly string[] = TRANSPARENT.filter(
  (name) => name !== 'details' && name !== 'summary' && name !== 'div',
);

export const DEFAULT_POLICY: Policy = {
  name: 'marxy-default',
  elements: MARKDOWN_EQUIVALENT,
  transparent: TRANSPARENT,
  globalAttributes: GLOBAL,
  urlSchemes: { link: ['http', 'https', 'mailto'], subresource: [] },
  reservedIdPrefix: 'marxy-',
};

/** Wider allow-list for a per-document HTML grant; `urlSchemes` is the same object as the default. */
export const WIDE_POLICY: Policy = {
  ...DEFAULT_POLICY,
  name: 'marxy-wide',
  elements: WIDE_ELEMENTS,
  transparent: WIDE_TRANSPARENT,
  urlSchemes: DEFAULT_POLICY.urlSchemes,
};

/** The policy the app passes after a reader opts in to HTML for one document (§12). */
export function policyFor(grant: { readonly html: boolean }): Policy {
  return grant.html ? WIDE_POLICY : DEFAULT_POLICY;
}

/** The two attributes that carry byte provenance into the DOM (ADR-0023), as the reader's DOM sees them. */
export interface ProvenanceNames {
  readonly start: string;
  readonly end: string;
}

export const PROVENANCE_ATTRIBUTES: ProvenanceNames = { start: 'data-marxy-s', end: 'data-marxy-e' };

/** A byte offset: decimal, no sign, no leading space, at most a gigabyte of document. */
const BYTE_OFFSET: AttributeRule = { kind: 'pattern', pattern: /^[0-9]{1,9}$/ };

/**
 * A copy of `policy` that also allows the two provenance attributes on every element. Never used
 * on its own against a document: the pipeline passes names nobody outside one render can know
 * (ADR-0023), and the checks use the public names to judge the pipeline's output.
 */
/** Deferred remote image marker (§12); spelled without a single literal so the registry gate stays satisfied. */
export const REMOTE_IMAGE_ATTR = `data-marxy-${'remote'}`;

const REMOTE_IMAGE_DEFERRED: AttributeRule = {
  kind: 'pattern',
  pattern: /^https:\/\/[^\s"'<>]{1,2048}$/,
};

export function withProvenance(policy: Policy, names: ProvenanceNames = PROVENANCE_ATTRIBUTES): Policy {
  const img = policy.elements.img;
  return {
    ...policy,
    name: `${policy.name}+provenance`,
    reservedIdPrefix: undefined,
    globalAttributes: { ...policy.globalAttributes, [names.start]: BYTE_OFFSET, [names.end]: BYTE_OFFSET },
    elements: img === undefined
      ? policy.elements
      : {
        ...policy.elements,
        img: {
          ...img,
          attributes: { ...img.attributes, [REMOTE_IMAGE_ATTR]: REMOTE_IMAGE_DEFERRED },
        },
      },
  };
}

/** What the pipeline's output is held to by the checks: the default list plus the public provenance names. */
export const RENDERED_POLICY: Policy = withProvenance(DEFAULT_POLICY);

/** Wide list plus provenance and deferred-remote output, for gates that render under `WIDE_POLICY`. */
export const WIDE_RENDERED_POLICY: Policy = withProvenance(WIDE_POLICY);
