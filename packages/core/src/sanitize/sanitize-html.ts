// The sanitiser: HTML in, HTML out, and the only security boundary between a file a stranger wrote
// and the reader's DOM (ADR-0009). It rebuilds the markup from the allow-list rather than editing
// what it was given, so an element, an attribute or a URL that this code does not understand cannot
// survive by being unfamiliar. Runs in Node and in a browser (ADR-0020).
//
// Three properties hold by construction rather than by inspection, because each one was a hole once:
//
//  1. One tokenizer reads everything. The scan that *removes* an element uses the same tag parser as
//     the scan that keeps one, so a `</style>` written inside an attribute value cannot end a
//     removal that the browser's parser would not have ended there.
//  2. The output's tree shape is decided here and written by `writer`, which owns the open-element
//     stack. Nothing emits a tag directly, so an element cannot be opened and never closed, and a
//     solidus is honoured only where a parser honours it.
//  3. Every URL is decided by resolving it (`urls.ts`), never by reading the string.
//
// This is a tokenizer, not a tree builder, and the difference is visible: of 35 tree-construction
// shapes a reviewer measured, 22 produce a live tree that differs from the one written here —
// implied end tags, the adoption agency, foster parenting and the table insertion modes all
// restructure what a browser is given. The reason that is safe is narrower than "the divergences
// are only lexical", which is false: across 3,005 sanitised outputs re-parsed in both engines,
// *every divergence made the live tree shallower than the written one*, and the only ancestor any
// element ever gained was an implied `table`, `tbody` or `tr`. No element ever gained a formatting
// ancestor and no block ever came to sit inside a non-block, which is the property the reader is
// owed and the one `gate-no-network.mjs` checks in the live DOM on every run. A change that could
// make the live tree *deeper* than the written one — allowing an element whose end tag is implied
// by another, say — is outside what has been measured and needs a tree builder or a new proof.

import { escapeAttribute, escapeAttributeKeepingReferences, decodeReferences } from './escape.ts';
import {
  BLOCK_ELEMENTS, DEFAULT_POLICY, FOREIGN_ROOTS, RAW_TEXT_ELEMENTS, VOID_ELEMENTS,
  type AttributeRule, type ElementRule, type Policy,
} from './policy.ts';
import { sanitizeUrl } from './urls.ts';

/** One thing the sanitiser took out, so a notice can later say what a document lost and why. */
export interface Removal {
  readonly what: 'element' | 'attribute' | 'comment' | 'declaration' | 'structure' | 'truncation';
  /** Lowercased element name, or attribute name with `on` naming its element. */
  readonly name: string;
  readonly on?: string;
  /** The refused value, truncated; absent when the value never mattered. */
  readonly value?: string;
  readonly reason: string;
}

export interface SanitizeResult {
  readonly html: string;
  readonly removed: readonly Removal[];
}

/**
 * Sanitises an HTML fragment against a policy.
 *
 * Idempotent: the output of one pass is the input of the next unchanged, which is what lets the
 * pipeline treat this as a boundary that can be applied again anywhere without being thought about.
 */
export function sanitizeHtml(input: string, policy: Policy = DEFAULT_POLICY): SanitizeResult {
  const transparent = new Set(policy.transparent);
  const removed: Removal[] = [];
  const out = writer(removed);
  const length = input.length;
  let index = 0;

  while (index < length) {
    const lt = input.indexOf('<', index);
    if (lt === -1) {
      out.text(input.slice(index));
      break;
    }
    out.text(input.slice(index, lt));

    // A comment is a place to hide markup from a reader, never a place to keep it.
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      removed.push({ what: 'comment', name: '#comment', reason: 'comments are not content' });
      index = end === -1 ? length : end + 3;
      continue;
    }
    // Doctype, CDATA and processing instructions: the parser ends them at the first `>`, so we do.
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt + 1);
      removed.push({ what: 'declaration', name: '#declaration', reason: 'declarations are not content' });
      index = end === -1 ? length : end + 1;
      continue;
    }
    if (input.startsWith('</', lt)) {
      const tag = parseEndTag(input, lt);
      if (tag === null) {
        out.text('<');
        index = lt + 1;
        continue;
      }
      const name = tag.name.toLowerCase();
      if (policy.elements[name] !== undefined && !VOID_ELEMENTS.has(name)) out.close(name);
      index = tag.end;
      continue;
    }

    const tag = parseStartTag(input, lt);
    if (tag === null) {
      // `<` that starts nothing: literal text, which is how a parser reads it too.
      out.text('<');
      index = lt + 1;
      continue;
    }
    const name = tag.name.toLowerCase();
    const rule: ElementRule | undefined = policy.elements[name];

    if (rule !== undefined) {
      const built = attributes(name, rule, tag, policy, removed);
      const missing = (rule.requires ?? []).filter((required) => !built.kept.has(required));
      if (missing.length === 0) {
        // The solidus is honoured for a void element and nowhere else: a parser ignores it on an
        // HTML element, so `<a href="…" />` opens an anchor, and an anchor left open swallows the
        // document. `writer.open` will close it rather than let it.
        out.open(name, built.text);
        index = tag.end;
        continue;
      }
      removed.push({ what: 'element', name, reason: `${name} lost ${missing.join(', ')}, without which it is not the element it claimed to be` });
      index = removeFrom(input, tag, name, removed);
      continue;
    }

    if (transparent.has(name)) {
      removed.push({ what: 'element', name, reason: `${name} is not markdown-equivalent; its contents were kept` });
      index = tag.end;
      continue;
    }

    // Default-deny: an element that is in neither list loses its subtree as well as its tags,
    // because its contents may be script, style, a template or anything else we cannot read.
    removed.push({ what: 'element', name, reason: `${name} is not in the ${policy.name} allow-list; removed with its contents` });
    index = removeFrom(input, tag, name, removed);
  }

  return { html: out.done(), removed };
}

/** Where a removed element ends, and what it cost when it never ended. */
function removeFrom(input: string, tag: StartTag, name: string, removed: Removal[]): number {
  if (selfClosingHonoured(name, tag)) return tag.end;
  const { end, closed } = skipRemoved(input, tag.end, name);
  if (!closed) {
    // Safe, because it is what a browser does with an unclosed raw-text element, but never silent:
    // the reader lost the rest of the document and a notice has to be able to say so (MARXY-26).
    removed.push({ what: 'truncation', name, reason: `${name} was never closed; everything after it was removed` });
  }
  return end;
}

/**
 * A parser honours a trailing solidus on a void element, and inside foreign content, and nowhere
 * else: `<svg/>` closes itself, `<custom-el/>` does not, and neither does `<a/>` — measured in
 * WebKit and Chromium, not assumed.
 */
function selfClosingHonoured(name: string, tag: StartTag): boolean {
  return VOID_ELEMENTS.has(name) || (tag.selfClosing && FOREIGN_ROOTS.has(name));
}

interface Writer {
  text: (value: string) => void;
  open: (name: string, attributesText: string) => void;
  close: (name: string) => void;
  done: () => string;
}

/**
 * Owns the shape of the output. Everything is written through here, so the tree the sanitiser
 * decided on is the tree it emits: every element it opens is closed, a close tag for nothing open is
 * dropped rather than emitted, and a formatting element may not span a block boundary — which is
 * what keeps an unclosed `<a>` from turning the rest of a document into a link to its author's host.
 */
function writer(removed: Removal[]): Writer {
  const open: string[] = [];
  const parts: string[] = [];
  const closeOne = (): void => {
    const name = open.pop();
    if (name !== undefined) parts.push(`</${name}>`);
  };
  return {
    text(value) {
      if (value.length > 0) parts.push(value.replaceAll('<', '&lt;'));
    },
    open(name, attributesText) {
      if (BLOCK_ELEMENTS.has(name)) {
        while (open.length > 0 && !BLOCK_ELEMENTS.has(open[open.length - 1]!)) {
          removed.push({
            what: 'structure',
            name: open[open.length - 1]!,
            reason: `closed at <${name}>: a formatting element may not span a block, or an unclosed one makes the rest of the document part of it`,
          });
          closeOne();
        }
      }
      if (VOID_ELEMENTS.has(name)) {
        parts.push(`<${name}${attributesText} />`);
        return;
      }
      parts.push(`<${name}${attributesText}>`);
      open.push(name);
    },
    close(name) {
      const at = open.lastIndexOf(name);
      // A close tag with nothing open would unbalance the output; a parser ignores it too.
      if (at === -1) return;
      while (open.length > at) closeOne();
    },
    done() {
      while (open.length > 0) closeOne();
      return parts.join('');
    },
  };
}

interface StartTag {
  readonly name: string;
  readonly attributes: readonly { readonly name: string; readonly value: string | null }[];
  readonly selfClosing: boolean;
  /** Index one past the tag. */
  readonly end: number;
}

function attributes(
  name: string,
  rule: ElementRule,
  tag: StartTag,
  policy: Policy,
  removed: Removal[],
): { text: string; kept: Set<string> } {
  let text = '';
  const seen = new Set<string>();
  const kept = new Set<string>();
  for (const attribute of tag.attributes) {
    const key = attribute.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (rule.forced?.[key] !== undefined) continue;
    const attributeRule: AttributeRule | undefined = rule.attributes?.[key] ?? policy.globalAttributes[key];
    if (attributeRule === undefined) {
      removed.push({ what: 'attribute', name: key, on: name, value: truncate(attribute.value), reason: `${key} is not in the ${policy.name} allow-list` });
      continue;
    }
    const emitted = attributeValue(key, attribute.value, attributeRule, name, policy, removed);
    if (emitted !== null) {
      text += emitted;
      kept.add(key);
    }
  }
  // Forced attributes are the element's own terms: a checkbox in a document a reader cannot edit is
  // `disabled` whatever the document said (ADR-0001).
  for (const [key, value] of Object.entries(rule.forced ?? {})) {
    text += value === true ? ` ${key}` : ` ${key}="${escapeAttribute(value)}"`;
    kept.add(key);
  }
  return { text, kept };
}

function attributeValue(
  key: string,
  raw: string | null,
  rule: AttributeRule,
  element: string,
  policy: Policy,
  removed: Removal[],
): string | null {
  const refuse = (reason: string): null => {
    removed.push({ what: 'attribute', name: key, on: element, value: truncate(raw), reason });
    return null;
  };
  switch (rule.kind) {
    case 'boolean':
      return ` ${key}`;
    case 'text':
      return ` ${key}="${escapeAttributeKeepingReferences(raw ?? '')}"`;
    case 'url': {
      const decision = sanitizeUrl(raw ?? '', rule.context, policy);
      return decision.allowed
        ? ` ${key}="${escapeAttribute(decision.value)}"`
        : refuse(decision.reason ?? 'refused');
    }
    case 'enum': {
      const value = decodeReferences(raw ?? '').trim().toLowerCase();
      return rule.values.includes(value)
        ? ` ${key}="${escapeAttribute(value)}"`
        : refuse(`${key} must be one of ${rule.values.join(', ')}`);
    }
    case 'pattern': {
      const value = decodeReferences(raw ?? '').trim();
      return rule.pattern.test(value)
        ? ` ${key}="${escapeAttribute(value)}"`
        : refuse(`${key} does not match ${String(rule.pattern)}`);
    }
    case 'tokens': {
      const tokens = decodeReferences(raw ?? '').trim().split(/\s+/).filter((token) => rule.token.test(token));
      return tokens.length > 0
        ? ` ${key}="${escapeAttribute(tokens.join(' '))}"`
        : refuse(`no ${key} token matches ${String(rule.token)}`);
    }
    default:
      return refuse('unknown attribute rule');
  }
}

function truncate(value: string | null): string | undefined {
  if (value === null) return undefined;
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function parseEndTag(input: string, start: number): { name: string; end: number } | null {
  let index = start + 2;
  if (!isAsciiAlpha(input.charCodeAt(index))) return null;
  const from = index;
  while (index < input.length && !isSpace(input.charCodeAt(index)) && input[index] !== '>') index += 1;
  const name = input.slice(from, index);
  const close = input.indexOf('>', index);
  return { name, end: close === -1 ? input.length : close + 1 };
}

/**
 * Reads a start tag the way the HTML parser does, so the sanitiser judges the same element name and
 * the same attribute names it will. A name here may be anything up to whitespace, `/` or `>`,
 * including `svg:script` or `a:b`, because a namespaced name must reach the allow-list to be refused
 * by it rather than be silently split.
 */
function parseStartTag(input: string, start: number): StartTag | null {
  const length = input.length;
  let index = start + 1;
  if (!isAsciiAlpha(input.charCodeAt(index))) return null;
  const from = index;
  while (index < length && !isSpace(input.charCodeAt(index)) && input[index] !== '/' && input[index] !== '>') index += 1;
  const name = input.slice(from, index);
  const attributes: { name: string; value: string | null }[] = [];
  let selfClosing = false;

  while (index < length) {
    while (index < length && isSpace(input.charCodeAt(index))) index += 1;
    if (index >= length) break;
    const char = input[index];
    if (char === '>') return { name, attributes, selfClosing, end: index + 1 };
    if (char === '/') {
      selfClosing = true;
      index += 1;
      continue;
    }
    selfClosing = false;
    const nameFrom = index;
    while (index < length && !isSpace(input.charCodeAt(index)) && input[index] !== '=' && input[index] !== '>' && input[index] !== '/') index += 1;
    const attributeName = input.slice(nameFrom, index);
    while (index < length && isSpace(input.charCodeAt(index))) index += 1;
    let value: string | null = null;
    if (input[index] === '=') {
      index += 1;
      while (index < length && isSpace(input.charCodeAt(index))) index += 1;
      const quote = input[index];
      if (quote === '"' || quote === "'") {
        const close = input.indexOf(quote, index + 1);
        value = close === -1 ? input.slice(index + 1) : input.slice(index + 1, close);
        index = close === -1 ? length : close + 1;
      } else {
        const valueFrom = index;
        while (index < length && !isSpace(input.charCodeAt(index)) && input[index] !== '>') index += 1;
        value = input.slice(valueFrom, index);
      }
    }
    if (attributeName.length > 0) attributes.push({ name: attributeName, value });
  }
  // An unterminated tag: the parser would swallow the rest of the input, and so do we.
  return { name, attributes, selfClosing, end: length };
}

/**
 * Finds the end of a removed element, by the same rules the browser will use to find it.
 *
 * For a raw-text element the browser scans the text for `</name` and stops there, quotes and all —
 * which is why `<style><b title="</style>">` really does end the style in both engines, and why
 * this function must not be cleverer than that. For every other element it parses tags properly, so
 * a `</name>` inside a quoted attribute value is not an end tag and must not end the removal here
 * either. When there is no end tag the removal runs to the end of the input: safe, and reported by
 * the caller as a truncation rather than silently.
 */
function skipRemoved(input: string, from: number, name: string): Skip {
  return RAW_TEXT_ELEMENTS.has(name) ? skipRawText(input, from, name) : skipElement(input, from, name);
}

/** Where a removal ended, and whether it ended because the element was closed or because input ran out. */
interface Skip {
  readonly end: number;
  readonly closed: boolean;
}

function skipRawText(input: string, from: number, name: string): Skip {
  // Nothing ends a plaintext element: the tokenizer never leaves that state.
  if (name === 'plaintext') return { end: input.length, closed: false };
  if (name === 'script') return skipScriptData(input, from);
  for (let lt = input.indexOf('</', from); lt !== -1; lt = input.indexOf('</', lt + 2)) {
    const end = appropriateEndTag(input, lt, name);
    if (end !== -1) return { end, closed: true };
  }
  return { end: input.length, closed: false };
}

/**
 * Where `</name` at `lt` ends, or -1 when it is not an end tag for `name`. The parser only
 * accepts the name followed by whitespace, `/` or `>` (`</styled>` does not end a style), and it
 * reads an end tag's attributes like a start tag's, quotes and all.
 */
function appropriateEndTag(input: string, lt: number, name: string): number {
  const after = lt + 2 + name.length;
  if (input.slice(lt + 2, after).toLowerCase() !== name || after >= input.length) return -1;
  const delimiter = input[after];
  if (!isSpace(input.charCodeAt(after)) && delimiter !== '/' && delimiter !== '>') return -1;
  // parseStartTag reads from the character before the name, so hand it the `/`.
  return parseStartTag(input, lt + 1)?.end ?? input.length;
}

/**
 * The script data states. `<!--` inside a script enters the escaped state, where `<script` enters
 * the double-escaped state, where `</script>` only returns to escaped; `-->` returns to data from
 * either. Both engines keep `<script><!--<script></script><img></script>` as one script, so the
 * `<img>` stays text and must not come out as an element.
 */
function skipScriptData(input: string, from: number): Skip {
  type State = 'data' | 'escaped' | 'double';
  let state: State = 'data';
  let dashes = 0;
  let index = from;
  while (index < input.length) {
    const char = input[index];
    if (state === 'data') {
      if (input.startsWith('<!--', index)) {
        state = 'escaped';
        dashes = 2;
        index += 4;
        continue;
      }
    } else if (char === '-') {
      dashes += 1;
      index += 1;
      continue;
    } else if (char === '>' && dashes >= 2) {
      state = 'data';
      dashes = 0;
      index += 1;
      continue;
    }
    dashes = 0;
    if (char === '<') {
      if (input[index + 1] === '/' && appropriateEndTag(input, index, 'script') !== -1) {
        if (state === 'double') {
          state = 'escaped';
          index += '</script'.length;
          continue;
        }
        return { end: appropriateEndTag(input, index, 'script'), closed: true };
      }
      if (state === 'escaped' && startsScriptName(input, index + 1)) {
        state = 'double';
        index += '<script'.length;
        continue;
      }
    }
    index += 1;
  }
  return { end: input.length, closed: false };
}

/** `script` at `at`, case-insensitively, followed by whitespace, `/` or `>`. */
function startsScriptName(input: string, at: number): boolean {
  const after = at + 'script'.length;
  if (input.slice(at, after).toLowerCase() !== 'script' || after >= input.length) return false;
  return isSpace(input.charCodeAt(after)) || input[after] === '/' || input[after] === '>';
}

function skipElement(input: string, from: number, name: string): Skip {
  const length = input.length;
  let depth = 1;
  let index = from;
  while (index < length) {
    const lt = input.indexOf('<', index);
    if (lt === -1) return { end: length, closed: false };
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt + 1);
      index = end === -1 ? length : end + 1;
      continue;
    }
    if (input.startsWith('</', lt)) {
      const tag = parseEndTag(input, lt);
      if (tag === null) {
        index = lt + 1;
        continue;
      }
      if (tag.name.toLowerCase() === name) {
        depth -= 1;
        if (depth === 0) return { end: tag.end, closed: true };
      }
      index = tag.end;
      continue;
    }
    const tag = parseStartTag(input, lt);
    if (tag === null) {
      index = lt + 1;
      continue;
    }
    const found = tag.name.toLowerCase();
    if (found === name && !selfClosingHonoured(found, tag)) depth += 1;
    // A nested raw-text element hides end tags from the parser too, so skip it as raw text.
    index = found !== name && RAW_TEXT_ELEMENTS.has(found) && !VOID_ELEMENTS.has(found)
      ? skipRawText(input, tag.end, found).end
      : tag.end;
  }
  return { end: length, closed: false };
}
