// format-yaml (E-10): table rows in LF, CRLF, CR, no trailing newline and BOM; declines; the corpus; properties.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CodeBlock, Document, Node } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { formatYaml, reindentYamlText, yamlIndentSpans } from './format-yaml.ts';
import { corpusDocuments } from './testing/corpus.ts';
import { corpusProperties, seededRandom, tableTest, type Row } from './testing/test-kit.ts';
import { textIndex } from './text-helpers.ts';

function all(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  for (const c of n.children ?? []) all(c as Node, out);
  return out;
}
const fenceAt = (i: number) => (doc: Document): Node => all(doc).filter((n) => n.type === 'codeBlock')[i]!;
const fence = (body: string, lang = 'yaml'): string => `\`\`\`${lang}\n${body}\`\`\`\n`;
const row = (name: string, source: string, expect: string, summary?: RegExp, at = 0): Row => ({
  name, source, expect, pick: fenceAt(at), ...(summary ? { summary } : {}),
});
/** A row where the operation must refuse with a reason. */
const declines = (name: string, body: string, why: RegExp): Row => row(name, fence(body), fence(body), new RegExp(`Not re-indented: ${why.source}`));
/** A row that re-indents `from` to `to`. */
const reindents = (name: string, from: string, to: string): Row => row(name, fence(from), fence(to), /Re-indented YAML/);
/** A row whose body is already normalised. */
const same = (name: string, body: string): Row => row(name, fence(body), fence(body), /Already indented/);

tableTest(
  formatYaml,
  [
    reindents('four spaces become two', 'a:\n    b:\n        c: 1\n    d: 2\n', 'a:\n  b:\n    c: 1\n  d: 2\n'),
    reindents('mixed indents (3, 5, 8) become two per level', 'a:\n   b: 1\n   c:\n        d: 2\n   e:\n     f: 3\n', 'a:\n  b: 1\n  c:\n    d: 2\n  e:\n    f: 3\n'),
    reindents('a whole block indented is moved to the margin', '    a: 1\n    b:\n        c: 2\n', 'a: 1\nb:\n  c: 2\n'),
    reindents('a sequence under a key, four spaces', 'items:\n    - name: a\n      v: 1\n    - b\nz: 1\n', 'items:\n  - name: a\n    v: 1\n  - b\nz: 1\n'),
    reindents('a sequence item with a nested map keeps its columns', 'items:\n    - name: a\n      sub:\n          x: 1\n', 'items:\n  - name: a\n    sub:\n      x: 1\n'),
    reindents('nested sequences', 'a:\n    - - x\n      - y\n    - - z\n', 'a:\n  - - x\n    - y\n  - - z\n'),
    reindents('comments between keys follow their keys', 'a:\n    # note\n    b: 1\n    # tail\nc: 2\n', 'a:\n  # note\n  b: 1\n  # tail\nc: 2\n'),
    reindents('a trailing comment at the end of the block', 'a:\n    b: 1\n    # end\n', 'a:\n  b: 1\n  # end\n'),
    reindents('anchors, aliases and merge keys', 'base: &b\n    x: 1\nuse:\n    <<: *b\n    y: 2\n', 'base: &b\n  x: 1\nuse:\n  <<: *b\n  y: 2\n'),
    reindents('trailing spaces and the blank lines stay', 'a:\n    b: 1  \n   \n    c: 2\n', 'a:\n  b: 1  \n   \n  c: 2\n'),
    reindents('a leading document marker', '---\na:\n    b: 1\n', '---\na:\n  b: 1\n'),
    reindents('quotes, urls and # inside values are not touched', 'a:\n    u: "http://x/#y"   # c\n    s: \'it\'\'s\'\n    t: it\'s: fine\n', 'a:\n  u: "http://x/#y"   # c\n  s: \'it\'\'s\'\n  t: it\'s: fine\n'),
    reindents('a single-line flow collection stays', 'a:\n    b: [1, 2, {c: 3}]\n', 'a:\n  b: [1, 2, {c: 3}]\n'),
    reindents('a pipe in a plain value is not a block scalar', 'a:\n    cmd: a | b\n', 'a:\n  cmd: a | b\n'),
    reindents('a plain scalar continued on the next line', 'a:\n    text: one\n        two\n    b: 1\n', 'a:\n  text: one\n    two\n  b: 1\n'),
    row('the yml alias', fence('a:\n    b: 1\n', 'yml'), fence('a:\n  b: 1\n', 'yml'), /Re-indented YAML/),
    reindents('non-ASCII text', 'ключ:\n    значение: "日本語 🙂"\n', 'ключ:\n  значение: "日本語 🙂"\n'),
    reindents('text around the fence is untouched', 'Intro\n\n' + fence('a:\n    b: 1\n') + '\n    after\n', 'Intro\n\n' + fence('a:\n  b: 1\n') + '\n    after\n'),
    reindents('an unclosed fence', '```yaml\na:\n    b: 1', '```yaml\na:\n  b: 1'),
    same('already normalised', 'a:\n  b:\n    c: 1\n  d: 2\n'),
    same('a sequence under a key at the same indent', 'items:\n- name: a\n  v: 1\n- b\nother: 1\n'),
    same('a nested comment already in place', 'a:\n  b: 1\n  # inside a\nc: 2\n'),
    same('an empty fence', ''),
    declines('a block scalar |', 'a: |\n    text\nb: 1\n', /a block scalar/),
    declines('a folded scalar with chomp', 'a: >-\n    text\n', /a block scalar/),
    declines('a block scalar with an indent digit and a comment', 'a: |2+ # why\n    text\n', /a block scalar/),
    declines('a block scalar after a sequence dash', '- |\n    text\n', /a block scalar/),
    declines('a block scalar on the document marker >', '--- >\n   t\n', /a block scalar/),
    declines('a block scalar on the document marker |', '--- |\n    t\n', /a block scalar/),
    declines('a block scalar on the document marker with indicators', '--- |2-\n    t\n', /a block scalar/),
    declines('a block scalar on the document marker with a comment', '--- >+ # c\n    t\n', /a block scalar/),
    declines('a keep-chomp block scalar', 'k: |+\n    t\n\nz: 1\n', /a block scalar/),
    declines('a strip-chomp folded scalar in a sequence', 'a:\n    - >-\n        t\n', /a block scalar/),
    declines('an explicit-indent block scalar', 'k: |2\n      t\n', /a block scalar/),
    declines('a block scalar behind an anchor and tag', 'k: &a !!str |\n    t\n', /a block scalar/),
    declines('a tab in the indentation', 'a:\n\tb: 1\n', /a tab in the indentation/),
    declines('a flow list across lines', 'a: [1,\n    2]\n', /a flow collection continues/),
    declines('a flow map across lines', 'a: {b: 1,\n    c: 2}\n', /a flow collection continues/),
    declines('a double-quoted scalar across lines', 'a: "one\n    two"\n', /a quoted scalar continues/),
    declines('a single-quoted scalar across lines', "a: 'one\n    two'\n", /a quoted scalar continues/),
    declines('two documents', 'a: 1\n---\nb: 2\n', /more than one YAML document/),
    declines('a leading marker and a second one', '---\na: 1\n---\nb: 2\n', /more than one YAML document/),
    declines('a document end marker', 'a: 1\n...\n', /more than one YAML document/),
    declines('an explicit key', '? a\n: b\n', /an explicit key/),
    declines('extra spaces after a dash', '-   a: 1\n    b: 2\n', /more than one space after a dash/),
    declines('a dedent to no enclosing level', 'a:\n    b: 1\n  c: 2\n', /indentation that matches no enclosing level/),
    row('a json fence is not offered', fence('a:\n    b: 1\n', 'json'), fence('a:\n    b: 1\n', 'json')),
    row('a fence with no language is not offered', '```\na:\n    b: 1\n```\n', '```\na:\n    b: 1\n```\n'),
    row('an indented fence is not offered', '  ```yaml\n  a:\n      b: 1\n  ```\n', '  ```yaml\n  a:\n      b: 1\n  ```\n'),
    row('a fence in a list item is not offered', '- item\n\n  ```yaml\n  a:\n      b: 1\n  ```\n', '- item\n\n  ```yaml\n  a:\n      b: 1\n  ```\n'),
    row('a fence in a blockquote is not offered', '> ```yaml\n> a:\n>     b: 1\n> ```\n', '> ```yaml\n> a:\n>     b: 1\n> ```\n'),
  ],
  { bom: true },
);

test('canApply: a yaml fence at the top level, at its own range; not a document, a missing node or a part range', () => {
  const doc = parseMarkdown('```yaml\na: 1\n```\n', { file: 't.md' });
  const f = doc.children[0]!;
  assert.equal(formatYaml.canApply({ document: doc, node: f, range: f.src }), true);
  assert.equal(formatYaml.canApply({ document: doc, node: f, range: { ...f.src, start: f.src.start + 1 } }), false);
  assert.equal(formatYaml.canApply({ document: doc, node: doc, range: doc.src }), false);
  assert.equal(formatYaml.canApply({ document: doc, range: f.src }), false);
  assert.deepEqual(formatYaml.appliesTo, ['block']);
});

test('a mixed-separator body keeps every line ending', () => {
  const source = '```yaml\na:\r\n    b: 1\n    c: 2\r```\n';
  const doc = parseMarkdown(source, { file: 't.md' });
  const f = doc.children[0] as CodeBlock;
  const out = formatYaml.run({ document: doc, node: f, range: f.src, text: source.slice(f.src.start, f.src.end) });
  assert.equal(out.replacement, '```yaml\na:\r\n  b: 1\n  c: 2\r```');
});

const yamlFences = () => {
  const found: { file: string; line: number; body: string; node: CodeBlock }[] = [];
  const dec = new TextDecoder();
  for (const { file, bytes, document } of corpusDocuments()) {
    for (const n of all(document)) {
      const lang = (n as CodeBlock).lang?.toLowerCase();
      if (n.type !== 'codeBlock' || (lang !== 'yaml' && lang !== 'yml')) continue;
      const block = n as CodeBlock;
      found.push({ file, line: dec.decode(bytes.subarray(0, block.src.start)).split('\n').length, body: dec.decode(bytes.subarray(block.content.start, block.content.end)), node: block });
    }
  }
  return found;
};

test('corpus: the yaml fence of 28-llm-answer.md is already normalised, and its four-space form is brought back to it', () => {
  const f = yamlFences().find((x) => x.file === '28-llm-answer.md')!;
  assert.equal(f.line, 193);
  assert.deepEqual(reindentYamlText(f.body), { ok: true, text: f.body });
  // The same block written with four-space levels comes back to the fence's own text.
  const wide = f.body.replace(/^( {2}- | {4}(?=\S))/gm, (m) => (m === '  - ' ? '    - ' : '      '));
  assert.notEqual(wide, f.body);
  assert.deepEqual(reindentYamlText(wide), { ok: true, text: f.body });
});

test('corpus: every yaml fence is re-indented to itself or declined with a reason; none changes shape', () => {
  const fences = yamlFences();
  assert.ok(fences.length >= 20);
  for (const { file, line, body } of fences) {
    const r = reindentYamlText(body);
    if (!r.ok) {
      assert.ok(r.why.length > 0);
      continue;
    }
    assert.equal(r.text, body, `${file}:${line}: an already-normalised block must come back unchanged`);
  }
});

test('corpus: format-yaml changes only leading whitespace, in every separator variant, and is idempotent', () => {
  const stats = corpusProperties(formatYaml, {
    targets: (_doc, node, text) => {
      const block = node as CodeBlock;
      const index = textIndex(text);
      const from = index.toIndex(block.content.start - block.src.start);
      const to = index.toIndex(block.content.end - block.src.start);
      const body = text.slice(from, to);
      const inner = textIndex(body);
      return yamlIndentSpans(body).map((s) => ({ file: block.src.file, start: block.src.start + index.toByte(from) + inner.toByte(s.start), end: block.src.start + index.toByte(from) + inner.toByte(s.end) }));
    },
    accepts: (n) => n.type === 'codeBlock' && /^ya?ml$/i.test((n as CodeBlock).lang ?? ''),
    idempotent: true,
  });
  assert.ok(stats.applied > 0);
});

// A small seeded generator of YAML-ish documents with random indent widths: re-indenting is idempotent, touches only
// leading whitespace, and never throws.
function generate(next: () => number): string {
  const lines: string[] = [];
  const width = 1 + Math.floor(next() * 5);
  const walk = (depth: number, budget: number): void => {
    for (let i = 0; i < 1 + Math.floor(next() * 3) && budget > 0; i++, budget--) {
      const pad = ' '.repeat(depth * width);
      const r = next();
      if (r < 0.3) lines.push(`${pad}# note ${i}`);
      if (r < 0.55 && depth < 4) {
        lines.push(`${pad}k${i}:`);
        walk(depth + 1, budget - 1);
      } else if (r < 0.8 && depth < 4) {
        lines.push(`${pad}- n${i}: ${i}`);
        lines.push(`${pad}  m${i}: "v"`);
      } else lines.push(`${pad}k${i}: v${i} # c`);
    }
  };
  walk(0, 8);
  return `${lines.join('\n')}\n`;
}

test('property: re-indent is idempotent, changes only leading whitespace, and keeps the shape (seeded)', () => {
  const next = seededRandom(20261010);
  let changed = 0;
  for (let n = 0; n < 400; n++) {
    const body = generate(next);
    const r = reindentYamlText(body);
    if (!r.ok) continue;
    const again = reindentYamlText(r.text);
    assert.deepEqual(again, { ok: true, text: r.text }, `not idempotent for ${JSON.stringify(body)}`);
    const strip = (s: string): string[] => s.split('\n').map((l) => l.replace(/^ +/, ''));
    assert.deepEqual(strip(r.text), strip(body));
    if (r.text !== body) changed++;
  }
  assert.ok(changed > 50, `only ${changed} of 400 generated documents changed`);
});
