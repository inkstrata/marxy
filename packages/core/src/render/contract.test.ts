// The DOM contract of docs/design/02-render.md, as far as provenance goes (ADR-0023, MARXY-75): every
// element the renderer makes for a node carries that node's byte range, nothing else carries one, and
// raw HTML keeps the shape it had before provenance existed.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Document, Node, Source } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { renderDocumentSafeHtml, renderSafeHtml } from './pipeline.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).filter((file) => file.endsWith('.md')).sort();

/**
 * Node types the §02 table renders to an element of their own. `text`, `softBreak`, `html`,
 * `htmlBlock` and `frontmatter` make none; a tight list item's paragraph makes none (its item's
 * `<li>` is the element); a reference to an undefined footnote is set as text.
 */
const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'thematicBreak', 'table',
  'tableRow', 'tableCell', 'mathBlock', 'footnoteDefinition', 'emphasis', 'strong', 'strikethrough',
  'code', 'link', 'image', 'hardBreak', 'footnoteReference', 'mathInline', 'taskMarker',
]);

const key = (src: Source): string => `${src.start}-${src.end}`;

/** The multiset of ranges the render must carry, walking the AST once. */
function expectedPairs(document: Document): string[] {
  const labels = new Set(document.children.flatMap((child) => (child.type === 'footnoteDefinition' ? [child.label] : [])));
  const pairs: string[] = [];
  const walk = (node: Node, tight: boolean): void => {
    const own =
      ELEMENT_TYPES.has(node.type) &&
      !(node.type === 'paragraph' && tight) &&
      !(node.type === 'footnoteReference' && !labels.has(node.label));
    if (own) pairs.push(key(node.src));
    // A fenced block's `<code>` carries the content range, inside the `<pre>` that carries the fence.
    if (node.type === 'codeBlock') pairs.push(key(node.content));
    const childTight = node.type === 'list' ? node.tight : node.type === 'listItem' ? tight : false;
    for (const child of node.children ?? []) walk(child, childTight);
  };
  for (const child of document.children) walk(child, false);
  return pairs.sort();
}

/** The multiset of ranges the HTML carries, read with a tag scanner rather than a DOM. */
function renderedPairs(html: string): string[] {
  const pairs: string[] = [];
  for (const tag of html.matchAll(/<[a-z][a-z0-9]*((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const attributes = tag[1] ?? '';
    const start = /\sdata-marxy-s="([0-9]+)"/.exec(attributes)?.[1];
    const end = /\sdata-marxy-e="([0-9]+)"/.exec(attributes)?.[1];
    assert.equal(start === undefined, end === undefined, `half a pair: ${tag[0]}`);
    if (start !== undefined) pairs.push(`${start}-${end}`);
  }
  return pairs.sort();
}

for (const file of files) {
  test(`${file}: every element made for a node carries its byte range, and nothing else carries one`, () => {
    const document = parseMarkdown(readFileSync(new URL(file, corpus)), { file });
    assert.deepEqual(renderedPairs(renderDocumentSafeHtml(document).html), expectedPairs(document));
  });
}

test('the sample of the §02 table: the element for each node type carries that node', () => {
  const source = [
    '# Head', '', 'Para *em* **st** ~~del~~ `code` [link](https://x.test/) ![alt](i.png) end  ', 'next[^1]', '',
    '> quote', '', '- [x] done', '- two', '', '1. one', '', '---', '', '```js', 'let a;', '```', '',
    '| a |', '| - |', '| 1 |', '', '$$', 'x', '$$', '', '$y$', '', '[^1]: note', '',
  ].join('\n');
  const bytes = new TextEncoder().encode(source);
  const html = renderSafeHtml(bytes, { file: 't.md' }).html;
  const slice = (tag: string): string => {
    const match = new RegExp(`<${tag}(?=[\\s/>])[^>]*\\sdata-marxy-s="([0-9]+)" data-marxy-e="([0-9]+)"`).exec(html);
    assert.ok(match, `no <${tag}> with provenance in ${html}`);
    return new TextDecoder().decode(bytes.slice(Number(match[1]), Number(match[2])));
  };
  assert.equal(slice('h1'), '# Head');
  assert.equal(slice('em'), '*em*');
  assert.equal(slice('strong'), '**st**');
  assert.equal(slice('del'), '~~del~~');
  assert.equal(slice('a'), '[link](https://x.test/)');
  assert.equal(slice('img'), '![alt](i.png)');
  assert.equal(slice('br'), '  \n');
  assert.equal(slice('blockquote'), '> quote');
  assert.equal(slice('input'), '[x]');
  assert.equal(slice('hr'), '---');
  assert.equal(slice('pre'), '```js\nlet a;\n```');
  assert.equal(slice('code class="language-js"'), 'let a;\n');
  assert.equal(slice('th'), '| a |');
  assert.equal(slice('sup'), '[^1]');
});

test('inline raw HTML keeps its shape across the two raw-HTML nodes that make it', () => {
  // `<kbd>` and `</kbd>` are separate inline `html` nodes. Sanitising each alone, as ADR-0023 first
  // proposed, closes the first at once and drops the second: `<kbd></kbd>Ctrl`.
  const html = renderSafeHtml('Press <kbd>Ctrl</kbd> now\n', { file: 't.md' }).html;
  assert.match(html, /<kbd>Ctrl<\/kbd>/);
});

test('the secret names never reach the output, so two renders of one document agree byte for byte', () => {
  // The renderer writes under names drawn per call (see `renderDocumentSafeHtml`); the rename to the
  // public names is the only way a `data-marxy-s` reaches the output.
  const a = renderSafeHtml('# a\n', { file: 't.md' }).html;
  const b = renderSafeHtml('# a\n', { file: 't.md' }).html;
  assert.equal(a, b);
  assert.equal(a, '<h1 data-marxy-s="0" data-marxy-e="3">a</h1>');
});
