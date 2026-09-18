// Byte provenance over the fixture corpus: the invariants, the UTF-16 → byte conversion, the
// constructs the contract names, and the parse budget for the long technical document.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Block, Inline, Node } from '../contracts/ast.ts';
import { byteOffsetTableBuilds, byteOffsets } from './byte-offsets.ts';
import { checkInvariants } from './invariants.ts';
import { parseMarkdown } from './parse.ts';

const corpusDir = new URL('../../../../fixtures/corpus/', import.meta.url);
const markdownFixtures = readdirSync(corpusDir).filter((name) => name.endsWith('.md')).sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpusDir)));

const nodes = (root: Node): Node[] => {
  const out: Node[] = [root];
  for (const child of root.children ?? []) out.push(...nodes(child));
  return out;
};

test('the corpus has the markdown fixtures the gates depend on', () => {
  assert.ok(markdownFixtures.length >= 12, `only ${markdownFixtures.length} markdown fixtures`);
  for (const required of ['01-long-technical.md', '07-cjk.md', '08-rtl.md', '12-crlf-and-bom.md', '13-no-trailing-newline.md']) {
    assert.ok(markdownFixtures.includes(required), `missing ${required}`);
  }
});

for (const name of markdownFixtures) {
  test(`every AST_INVARIANTS entry holds for ${name}`, () => {
    const bytes = read(name);
    const document = parseMarkdown(bytes, { file: name });
    assert.deepEqual(checkInvariants(document, bytes), []);
  });

  test(`every node of ${name} carries byte provenance into the file`, () => {
    const bytes = read(name);
    const document = parseMarkdown(bytes, { file: name });
    for (const node of nodes(document)) {
      assert.equal(node.src.file, name, `${node.type} names ${node.src.file}`);
      assert.ok(Number.isInteger(node.src.start) && node.src.start >= 0, `${node.type} start ${node.src.start}`);
      assert.ok(node.src.end <= bytes.byteLength, `${node.type} ends at ${node.src.end}, past ${bytes.byteLength}`);
    }
  });
}

test('offsets are byte offsets, not code-unit offsets (07-cjk.md)', () => {
  const bytes = read('07-cjk.md');
  const text = new TextDecoder().decode(bytes);
  const document = parseMarkdown(bytes, { file: '07-cjk.md' });
  const heading = document.children.find((block) => block.type === 'heading');
  assert.ok(heading, 'no heading in the CJK fixture');
  // The first heading's text is multi-byte, so a code-unit offset would land mid-character.
  const slice = new TextDecoder().decode(bytes.subarray(heading.src.start, heading.src.end));
  assert.equal(slice, text.split('\n')[0]);
  assert.ok(Buffer.byteLength(slice, 'utf8') > slice.length, 'the fixture is no longer multi-byte');
});

test('a byte-order mark is counted but not parsed (12-crlf-and-bom.md)', () => {
  const bytes = read('12-crlf-and-bom.md');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the fixture lost its BOM');
  const document = parseMarkdown(bytes, { file: '12-crlf-and-bom.md' });
  assert.deepEqual({ start: document.src.start, end: document.src.end }, { start: 0, end: bytes.byteLength });
  const first = document.children[0];
  assert.equal(first?.type, 'heading', 'the BOM stopped the first line from being a heading');
  assert.equal(first?.src.start, 3, 'the first block starts after the BOM bytes');
});

test('a file with no trailing newline keeps its last byte (13-no-trailing-newline.md)', () => {
  const bytes = read('13-no-trailing-newline.md');
  const document = parseMarkdown(bytes, { file: '13-no-trailing-newline.md' });
  const last = document.children.at(-1);
  assert.equal(document.src.end, bytes.byteLength);
  assert.equal(last?.src.end, bytes.byteLength);
});

test('the surrogate pair and the emoji in 08-rtl.md and elsewhere convert whole', () => {
  const text = 'a😀b *c*\n';
  const bytes = new TextEncoder().encode(text);
  const document = parseMarkdown(bytes, { file: 'emoji.md' });
  for (const node of nodes(document)) {
    const slice = new TextDecoder('utf-8', { fatal: true });
    assert.doesNotThrow(() => slice.decode(bytes.subarray(node.src.start, node.src.end)), `${node.type} splits a character`);
  }
});

test('the UTF-16 → byte table is built once per document', () => {
  const bytes = read('07-cjk.md');
  const before = byteOffsetTableBuilds();
  parseMarkdown(bytes, { file: '07-cjk.md' });
  assert.equal(byteOffsetTableBuilds() - before, 1);
});

test('byteOffsets converts every code unit of a mixed-width string', () => {
  const text = 'a£€😀b';
  const table = byteOffsets(text);
  for (const index of [0, 1, 2, 3, 5, 6]) {
    assert.equal(table.at(index), Buffer.byteLength(text.slice(0, index), 'utf8'), `at ${index}`);
  }
  // Index 4 is inside the emoji's surrogate pair, where micromark's offsets never land: the pair is
  // one character of four bytes, and the second half of it reports that character's end.
  assert.equal(table.at(4), Buffer.byteLength('a£€😀', 'utf8'));
  assert.equal(table.byteLength, Buffer.byteLength(text, 'utf8'));
});

test('byteOffsets adds the base a stripped byte-order mark paid for', () => {
  const table = byteOffsets('ab', 3);
  assert.deepEqual([table.at(0), table.at(1), table.at(2), table.byteLength], [3, 4, 5, 5]);
});

test('GFM, frontmatter and math produce the contract nodes (09-gfm-everything.md, 06-math.md)', () => {
  const gfmBytes = read('09-gfm-everything.md');
  const gfm = nodes(parseMarkdown(gfmBytes, { file: '09-gfm-everything.md' }));
  const types = new Set<string>(gfm.map((node) => node.type));
  for (const required of [
    'frontmatter', 'heading', 'paragraph', 'blockquote', 'list', 'listItem', 'codeBlock', 'htmlBlock',
    'thematicBreak', 'table', 'tableRow', 'tableCell', 'footnoteDefinition', 'text', 'emphasis',
    'strong', 'strikethrough', 'code', 'link', 'image', 'html', 'softBreak', 'hardBreak',
    'footnoteReference', 'taskMarker',
  ]) {
    assert.ok(types.has(required), `no ${required} node in the GFM fixture`);
  }
  const mathBytes = read('06-math.md');
  const math = new Set(nodes(parseMarkdown(mathBytes, { file: '06-math.md' })).map((node) => node.type));
  assert.ok(math.has('mathBlock') && math.has('mathInline'), 'math did not parse');
});

test('a task marker is the exact bytes a toggle would splice', () => {
  const text = '- [x] done\n- [ ] not\n';
  const bytes = new TextEncoder().encode(text);
  const document = parseMarkdown(bytes, { file: 'tasks.md' });
  const markers = nodes(document).filter((node): node is Extract<Inline, { type: 'taskMarker' }> => node.type === 'taskMarker');
  assert.equal(markers.length, 2);
  assert.deepEqual(markers.map((marker) => text.slice(marker.src.start, marker.src.end)), ['[x]', '[ ]']);
  assert.deepEqual(markers.map((marker) => marker.checked), [true, false]);
});

test('a reference link carries the definition url and the reference bytes', () => {
  const text = 'see [it][ref] and [gone][missing]\n\n[ref]: /url "t"\n';
  const document = parseMarkdown(text, { file: 'refs.md' });
  const links = nodes(document).filter((node) => node.type === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0]?.type === 'link' ? links[0].url : undefined, '/url');
  assert.equal(text.slice(links[0]!.src.start, links[0]!.src.end), '[it][ref]');
  const texts = nodes(document).filter((node) => node.type === 'text').map((node) => node.type === 'text' ? node.value : '');
  assert.ok(texts.some((value) => value.includes('[gone][missing]')), 'an unresolved reference lost its source text');
});

test('a soft break owns the line ending and the block markers that continue the quote', () => {
  const text = '> a\n> b\n';
  const document = parseMarkdown(text, { file: 'quote.md' });
  const quote = document.children[0];
  assert.equal(quote?.type, 'blockquote');
  const paragraph = quote.type === 'blockquote' ? quote.children[0] : undefined;
  const children = (paragraph?.children ?? []) as readonly Inline[];
  assert.deepEqual(children.map((child) => child.type), ['text', 'softBreak', 'text']);
  assert.equal(text.slice(children[1]!.src.start, children[1]!.src.end), '\n> ');
});

test('a code block content range is the code alone', () => {
  const text = '```ts meta\nconst x = 1;\n```\n';
  const document = parseMarkdown(text, { file: 'code.md' });
  const code = document.children[0] as Extract<Block, { type: 'codeBlock' }>;
  assert.equal(code.type, 'codeBlock');
  assert.equal(code.lang, 'ts');
  assert.equal(code.info, 'ts meta');
  assert.equal(text.slice(code.content.start, code.content.end), 'const x = 1;\n');
});

/**
 * How much slower this machine is than the one the 10 ms budget was set on, measured rather than
 * assumed: a shared CI runner is several times slower than a developer's machine, and a budget that
 * fails for that reason stops being a signal. The workload is string building, regex scanning and
 * small-object allocation, which is the work a parser does.
 */
const PROBE_REFERENCE_MS = 4.3;

function machineFactor(): number {
  const words = 'the quick brown fox jumps over the lazy dog'.split(' ');
  const run = (): number => {
    const started = performance.now();
    let sink = 0;
    for (let round = 0; round < 3000; round++) {
      let line = '';
      for (const word of words) line += `${word} *${word}* \`${word}\` `;
      for (const match of line.matchAll(/[*`]\w+[*`]/g)) sink += match.index;
      sink += line.split(/\s+/).map((word) => ({ word, length: word.length })).filter((token) => token.length > 3).length;
    }
    return performance.now() - started;
  };
  run();
  const runs = [run(), run(), run(), run(), run()].sort((a, b) => a - b);
  return Math.max(1, runs[2]! / PROBE_REFERENCE_MS);
}

test('parsing 01-long-technical.md stays inside the 10 ms budget', () => {
  const bytes = read('01-long-technical.md');
  for (let warmup = 0; warmup < 25; warmup++) parseMarkdown(bytes, { file: '01-long-technical.md' });
  const runs: number[] = [];
  for (let run = 0; run < 25; run++) {
    const started = performance.now();
    parseMarkdown(bytes, { file: '01-long-technical.md' });
    runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)]!;
  const factor = machineFactor();
  const budget = 10 * factor;
  console.log(`parse 01-long-technical.md: ${median.toFixed(2)} ms median, machine ${factor.toFixed(2)}× the reference, budget ${budget.toFixed(1)} ms`);
  assert.ok(
    median < budget,
    `parse took ${median.toFixed(2)} ms (median of ${runs.length}); budget is 10 ms on the reference machine, ${budget.toFixed(1)} ms on this one (measured ${factor.toFixed(2)}× slower)`,
  );
});
