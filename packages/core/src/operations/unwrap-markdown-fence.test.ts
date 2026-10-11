// unwrap-markdown-fence (E-06): table rows in LF, CRLF, CR, no trailing newline and BOM; corpus case; refusals; properties.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Document, Node, Source } from '../contracts/ast.ts';
import { corpusDocuments } from './testing/corpus.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { textIndex } from './text-helpers.ts';
import { unwrapMarkdownFence } from './unwrap-markdown-fence.ts';
import { corpusProperties, tableTest, type Row } from './testing/test-kit.ts';

function all(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  for (const c of n.children ?? []) all(c as Node, out);
  return out;
}
const fenceAt = (i: number) => (doc: Document): Node => all(doc).filter((n) => n.type === 'codeBlock')[i]!;
const row = (name: string, source: string, expect: string, at = 0, summary?: RegExp): Row => ({
  name, source, expect, pick: fenceAt(at), ...(summary ? { summary } : {}),
});
const S = /Unwrapped a markdown fence/;

tableTest(
  unwrapMarkdownFence,
  [
    row('a whole answer in a four-backtick fence', '````markdown\n# T\n\n- a\n- b\n\n```sh\nls\n```\n````\n', '# T\n\n- a\n- b\n\n```sh\nls\n```\n', 0, S),
    row('a fence among other blocks', 'Here you go:\n\n```markdown\n# T\n\ntext\n```\n\nEnjoy\n', 'Here you go:\n\n# T\n\ntext\n\nEnjoy\n', 0, S),
    row('a tilde fence', '~~~markdown\n# T\n~~~\n', '# T\n', 0, S),
    row('a fence longer than three, tildes', '~~~~~md\n# T\n~~~~~\n', '# T\n', 0, S),
    row('info string with attributes', '```markdown title="x"\n# T\n```\n', '# T\n', 0, S),
    row('the md alias', '```md\n# T\n```\n', '# T\n', 0, S),
    row('the language is case-insensitive', '```Markdown\n# T\n```\n', '# T\n', 0, S),
    row('a blank last content line is content', '```md\na\n\n```\n', 'a\n\n', 0, S),
    row('an unclosed fence keeps every content byte', '```md\n# T\n\ntext\n', '# T\n\ntext\n', 0, S),
    row('an unclosed fence with no content', '```md\n', '', 0, S),
    row('an empty fence', 'before\n\n```md\n```\n\nafter\n', 'before\n\n\n\nafter\n', 0, S),
    row('content containing its own shorter fence', '````md\n```js\nx\n```\n````\n', '```js\nx\n```\n', 0, S),
    row('a closing fence longer than the opening', '```md\n# T\n`````\n', '# T\n', 0, S),
    row('a closing fence with trailing spaces', '```md\n# T\n```  \n', '# T\n', 0, S),
    row('non-ASCII content', '```md\n# Café ✓ 🙂\n```\n', '# Café ✓ 🙂\n', 0, S),
    row('content lines with leading spaces are kept', '```md\n  - a\n\ttab\n```\n', '  - a\n\ttab\n', 0, S),
    row('a bash fence refuses', '```bash\nls\n```\n', '```bash\nls\n```\n'),
    row('a fence with no language refuses', '```\n# T\n```\n', '```\n# T\n```\n'),
    row('an indented fence refuses', '  ```md\n  # T\n  ```\n', '  ```md\n  # T\n  ```\n'),
    row('an indented code block refuses', '    code\n', '    code\n'),
    row('a fence in a list item refuses', '- item\n\n  ```md\n  # T\n  ```\n', '- item\n\n  ```md\n  # T\n  ```\n'),
    row('a fence in a blockquote refuses', '> ```md\n> # T\n> ```\n', '> ```md\n> # T\n> ```\n'),
  ],
  { bom: true },
);

test('canApply: a markdown fence at the top level, at its own range; not a document, a missing node or a part range', () => {
  const doc = parseMarkdown('```md\n# T\n```\n', { file: 't.md' });
  const f = doc.children[0]!;
  assert.equal(unwrapMarkdownFence.canApply({ document: doc, node: f, range: f.src }), true);
  assert.equal(unwrapMarkdownFence.canApply({ document: doc, node: f, range: { ...f.src, start: f.src.start + 1 } }), false);
  assert.equal(unwrapMarkdownFence.canApply({ document: doc, node: doc, range: doc.src }), false);
  assert.equal(unwrapMarkdownFence.canApply({ document: doc, range: f.src }), false);
  assert.deepEqual(unwrapMarkdownFence.appliesTo, ['block']);
});

test('corpus 28-llm-answer: the five-backtick fence unwraps into five more headings and keeps its inner fences', () => {
  const file = '28-llm-answer.md';
  const entry = corpusDocuments().find((d) => d.file === file);
  assert.ok(entry, `${file} is in the corpus`);
  const doc = parseMarkdown(entry.bytes, { file });
  const fence = all(doc).find((n): n is Node & { content: { start: number; end: number }; lang: string } => n.type === 'codeBlock' && (n as { lang?: string }).lang === 'markdown')!;
  assert.ok(fence, 'a markdown fence exists');
  const count = (d: Document, type: string): number => all(d).filter((n) => n.type === type).length;
  const innerFences = count(parseMarkdown(entry.bytes.slice(fence.content.start, fence.content.end), { file }), 'codeBlock');
  assert.equal(innerFences, 1);
  assert.equal(unwrapMarkdownFence.canApply({ document: doc, node: fence, range: fence.src }), true);
  const text = new TextDecoder().decode(entry.bytes.slice(fence.src.start, fence.src.end));
  const { replacement } = unwrapMarkdownFence.run({ document: doc, node: fence, range: fence.src, text });
  const next = new Uint8Array([...entry.bytes.slice(0, fence.src.start), ...new TextEncoder().encode(replacement), ...entry.bytes.slice(fence.src.end)]);
  const after = parseMarkdown(next, { file });
  assert.equal(count(after, 'heading'), count(doc, 'heading') + 5);
  assert.equal(count(after, 'codeBlock'), count(doc, 'codeBlock') - 1 + innerFences);
  const headingText = (d: Document) => all(d).filter((n) => n.type === 'heading').map((h) => new TextDecoder().decode(next.slice(h.src.start, h.src.end)));
  for (const h of ['# Migration ticket', '## Summary', '## Acceptance', '## Rollback', '## Owner']) {
    assert.ok(headingText(after).some((t) => t.startsWith(h)), h);
  }
  assert.equal(new TextDecoder().decode(next.slice(fence.src.start, fence.src.start + 18)), '# Migration ticket');
});

test('canApply is false for a bash fence, an indented code block and a list-item markdown fence in the corpus-shaped file', () => {
  const doc = parseMarkdown('```bash\nls\n```\n\n    code\n\n- x\n\n  ```markdown\n  # T\n  ```\n', { file: 't.md' });
  for (const n of all(doc).filter((x) => x.type === 'codeBlock')) {
    assert.equal(unwrapMarkdownFence.canApply({ document: doc, node: n, range: n.src }), false);
  }
});

corpusProperties(unwrapMarkdownFence, {
  // The two fence-line spans: the opening line, and (when closed) the ending before the closing fence plus that fence line.
  targets(_doc, node, text) {
    const c = (node as { content: Source }).content;
    const out: Source[] = [{ file: node.src.file, start: node.src.start, end: c.start }];
    if (node.src.end > c.end) {
      const contentText = text.slice(0, textIndex(text).toIndex(c.end - node.src.start));
      const ending = /(?:\r\n|\n|\r)$/.exec(contentText)?.[0] ?? '';
      out.push({ file: node.src.file, start: c.end - ending.length, end: node.src.end });
    }
    return out;
  },
});
