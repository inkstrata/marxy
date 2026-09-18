// The invariants, over generated input rather than over examples someone thought of.
//
// A vector catches the attack it was written for. These four properties are what must hold for
// *every* input, including the ones nobody wrote down: an element or attribute outside the
// allow-list never reaches the output, the output is a tree with the shape the sanitiser decided
// on, a formatting element never spans a block, and a second pass changes nothing. The self-closed
// anchor that turned a whole document into a link to the attacker's host was missed by 27 vectors
// and is caught by property two below.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_POLICY } from './policy.ts';
import { sanitizeHtml } from './sanitize-html.ts';
import { VECTORS } from './testing/vectors.ts';

/** Deterministic, so a failure is reproducible from the seed printed with it. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const NAMES = ['a', 'p', 'img', 'em', 'h2', 'li', 'ul', 'input', 'br', 'table', 'td', 'blockquote', 'div', 'details', 'span', 'script', 'style', 'iframe', 'svg', 'math', 'template', 'title', 'textarea', 'noscript', 'object', 'form', 'custom-el', 'svg:script', 'A', 'BASE'];
const ATTRIBUTES = ['href', 'src', 'title', 'alt', 'id', 'class', 'onclick', 'onerror', 'style', 'srcdoc', 'formaction', 'xlink:href', 'type', 'checked', 'lang', 'data-x', 'srcset'];
const VALUES = ['https://remote.invalid/x.png', '/\\remote.invalid/x.png', '//remote.invalid/x', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'local.png', '#frag', '&bsol;&bsol;remote.invalid/x', 'alert(1)', 'a b"c', '', '\u0000', 'language-rust', 'checkbox'];
const TEXTS = ['prose', '', 'a < b', '&amp;', '"', '</a>', '\u0000', '<!-- c -->', '<![CDATA[x]]>'];

function generate(next: () => number, size: number): string {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  let html = '';
  for (let piece = 0; piece < size; piece += 1) {
    const shape = next();
    const name = pick(NAMES);
    if (shape < 0.15) {
      html += `</${name}>`;
    } else if (shape < 0.3) {
      html += pick(TEXTS);
    } else {
      let tag = `<${name}`;
      const count = Math.floor(next() * 3);
      for (let attribute = 0; attribute < count; attribute += 1) {
        const value = pick(VALUES);
        const quote = next() < 0.2 ? '' : next() < 0.5 ? '"' : "'";
        tag += next() < 0.1 ? ` ${pick(ATTRIBUTES)}` : ` ${pick(ATTRIBUTES)}=${quote}${value}${quote}`;
      }
      // A solidus on anything, because that is the shape that swallowed a document.
      html += next() < 0.25 ? `${tag} />` : `${tag}>`;
    }
  }
  return html;
}

/** Reads the output as a tree, which is only possible if it is one. */
function tree(html: string): { elements: { name: string; attributes: string[] }[]; open: string[] } {
  const open: string[] = [];
  const elements: { name: string; attributes: string[] }[] = [];
  const voidElements = new Set(['br', 'hr', 'img', 'input', 'wbr', 'col']);
  for (const match of html.matchAll(/<(\/?)([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const name = match[2]!.toLowerCase();
    if (match[1] === '/') {
      assert.equal(open.at(-1), name, `</${name}> does not close the element that is open`);
      open.pop();
      continue;
    }
    const attributes = [...(match[3] ?? '').matchAll(/([A-Za-z:@_-][^\s=/]*)(?:=("[^"]*"|'[^']*'|[^\s>]*))?/g)].map((found) => found[1]!.toLowerCase());
    elements.push({ name, attributes });
    if (!voidElements.has(name)) open.push(name);
  }
  return { elements, open };
}

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'pre', 'hr']);

test('every generated input holds every invariant the boundary is supposed to have', () => {
  const next = random(20_260_918);
  const allowed = new Set(Object.keys(DEFAULT_POLICY.elements));
  const globals = new Set(Object.keys(DEFAULT_POLICY.globalAttributes));
  let checked = 0;

  for (let iteration = 0; iteration < 20_000; iteration += 1) {
    const input = generate(next, 1 + Math.floor(next() * 8));
    const { html } = sanitizeHtml(input);
    const context = () => `input ${JSON.stringify(input)}\noutput ${JSON.stringify(html)}`;

    // 1. Nothing outside the allow-list, and no attribute outside the element's own rule.
    const { elements, open } = tree(html);
    for (const element of elements) {
      assert.ok(allowed.has(element.name), `${element.name} is not allow-listed\n${context()}`);
      const rule = DEFAULT_POLICY.elements[element.name]!;
      for (const attribute of element.attributes) {
        const permitted = globals.has(attribute) || rule.attributes?.[attribute] !== undefined || rule.forced?.[attribute] !== undefined;
        assert.ok(permitted, `${element.name}[${attribute}] is not allow-listed\n${context()}`);
      }
    }

    // 2. The output is balanced: everything opened is closed, and nothing closes what is not open.
    assert.deepEqual(open, [], `elements left open: ${open.join(', ')}\n${context()}`);

    // 3. No formatting element spans a block, so an unclosed one cannot capture the document.
    const ancestors: string[] = [];
    for (const match of html.matchAll(/<(\/?)([A-Za-z][^\s/>]*)[^>]*>/g)) {
      const name = match[2]!.toLowerCase();
      if (match[1] === '/') {
        ancestors.pop();
        continue;
      }
      if (BLOCK.has(name)) {
        const formatting = ancestors.find((ancestor) => !BLOCK.has(ancestor));
        assert.equal(formatting, undefined, `<${name}> inside <${formatting}>\n${context()}`);
      }
      if (!new Set(['br', 'hr', 'img', 'input', 'wbr', 'col']).has(name)) ancestors.push(name);
    }

    // 4. Idempotent: the boundary can be crossed twice, which is what makes it a boundary.
    assert.equal(sanitizeHtml(html).html, html, `a second pass changed the output\n${context()}`);

    // 5. And every named vector agrees, on a sample, because the vectors are the expensive check.
    if (iteration % 25 === 0) {
      for (const vector of VECTORS) vector.check(html, DEFAULT_POLICY);
      checked += 1;
    }
  }

  assert.ok(checked > 700, 'the vector sample should have run on hundreds of outputs');
});
