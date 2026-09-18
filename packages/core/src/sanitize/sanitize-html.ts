// The sanitiser: HTML in, HTML out, and the only security boundary between a file a stranger wrote
// and the reader's DOM (ADR-0009). It rebuilds the markup from the allow-list rather than editing
// what it was given, so an element, an attribute or a URL that this code does not understand cannot
// survive by being unfamiliar. Runs in Node and in a browser (ADR-0020).

import { escapeAttribute, escapeAttributeKeepingReferences, decodeReferences } from './escape.ts';
import { DEFAULT_POLICY, VOID_ELEMENTS, type AttributeRule, type ElementRule, type Policy } from './policy.ts';
import { sanitizeUrl } from './urls.ts';

/** One thing the sanitiser took out, so a notice can later say what a document lost and why. */
export interface Removal {
  readonly what: 'element' | 'attribute' | 'comment' | 'doctype';
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
  const open: string[] = [];
  const out: string[] = [];
  const length = input.length;
  let index = 0;

  while (index < length) {
    const lt = input.indexOf('<', index);
    if (lt === -1) {
      out.push(input.slice(index));
      break;
    }
    out.push(input.slice(index, lt));

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
      removed.push({ what: 'doctype', name: '#declaration', reason: 'declarations are not content' });
      index = end === -1 ? length : end + 1;
      continue;
    }
    if (input.startsWith('</', lt)) {
      const tag = parseEndTag(input, lt);
      if (tag === null) {
        out.push('&lt;');
        index = lt + 1;
        continue;
      }
      const name = tag.name.toLowerCase();
      if (policy.elements[name] !== undefined && !VOID_ELEMENTS.has(name)) {
        // A close tag with nothing open would unbalance the output; the parser would ignore it too.
        const at = open.lastIndexOf(name);
        if (at !== -1) {
          for (let i = open.length - 1; i >= at; i -= 1) out.push(`</${open[i]}>`);
          open.length = at;
        }
      }
      index = tag.end;
      continue;
    }

    const tag = parseStartTag(input, lt);
    if (tag === null) {
      // `<` that starts nothing: literal text, which is how a parser reads it too.
      out.push('&lt;');
      index = lt + 1;
      continue;
    }
    const name = tag.name.toLowerCase();
    const rule: ElementRule | undefined = policy.elements[name];

    if (rule !== undefined) {
      const isVoid = VOID_ELEMENTS.has(name);
      const built = startTag(name, rule, tag, policy, removed, isVoid);
      const missing = (rule.requires ?? []).filter((required) => !built.kept.has(required));
      if (missing.length === 0) {
        out.push(built.html);
        if (!isVoid && !tag.selfClosing) open.push(name);
        index = tag.end;
        continue;
      }
      removed.push({ what: 'element', name, reason: `${name} lost ${missing.join(', ')}, without which it is not the element it claimed to be` });
      index = isVoid || tag.selfClosing ? tag.end : skipSubtree(input, tag.end, name);
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
    if (VOID_ELEMENTS.has(name) || tag.selfClosing) {
      index = tag.end;
      continue;
    }
    const after = skipSubtree(input, tag.end, name);
    if (after === length) {
      removed.push({ what: 'element', name, reason: `${name} was never closed; everything after it was removed` });
    }
    index = after;
  }

  for (let i = open.length - 1; i >= 0; i -= 1) out.push(`</${open[i]}>`);
  return { html: out.join(''), removed };
}

interface StartTag {
  readonly name: string;
  readonly attributes: readonly { readonly name: string; readonly value: string | null }[];
  readonly selfClosing: boolean;
  /** Index one past the tag. */
  readonly end: number;
}

function startTag(
  name: string,
  rule: ElementRule,
  tag: StartTag,
  policy: Policy,
  removed: Removal[],
  isVoid: boolean,
): { html: string; kept: Set<string> } {
  let text = `<${name}`;
  const seen = new Set<string>();
  const kept = new Set<string>();
  for (const attribute of tag.attributes) {
    const key = attribute.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
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
  return { html: `${text}${isVoid || tag.selfClosing ? ' />' : '>'}`, kept };
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
 * Finds the end of a removed element, counting nested tags of the same name. Comments are skipped so
 * a `</div>` inside one cannot close the element around it. When there is no end tag the removal
 * runs to the end of the input, which is also what a browser does with an unclosed raw-text element,
 * and is the safe direction: too much removed rather than too little kept.
 */
function skipSubtree(input: string, from: number, name: string): number {
  const length = input.length;
  let depth = 1;
  let index = from;
  while (index < length) {
    const lt = input.indexOf('<', index);
    if (lt === -1) return length;
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      index = end === -1 ? length : end + 3;
      continue;
    }
    const closing = input[lt + 1] === '/';
    const nameAt = lt + (closing ? 2 : 1);
    if (!matchesName(input, nameAt, name)) {
      index = lt + 1;
      continue;
    }
    const after = input.charCodeAt(nameAt + name.length);
    if (!(Number.isNaN(after) || isSpace(after) || input[nameAt + name.length] === '/' || input[nameAt + name.length] === '>')) {
      index = lt + 1;
      continue;
    }
    const close = input.indexOf('>', nameAt);
    if (closing) {
      depth -= 1;
      if (depth === 0) return close === -1 ? length : close + 1;
    } else if (!VOID_ELEMENTS.has(name) && !selfClosed(input, nameAt, close)) {
      depth += 1;
    }
    index = close === -1 ? length : close + 1;
  }
  return length;
}

function matchesName(input: string, at: number, name: string): boolean {
  if (at + name.length > input.length) return false;
  return input.slice(at, at + name.length).toLowerCase() === name;
}

function selfClosed(input: string, from: number, close: number): boolean {
  return close !== -1 && input[close - 1] === '/';
}
