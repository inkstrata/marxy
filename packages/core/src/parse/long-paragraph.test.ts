// one long paragraph parses in time in proportion to its length, whatever it is made of.
// micromark's text resolvers splice per run (patched: patches/micromark@4.0.2.patch), its attention and GFM's
// strikethrough walk back per closer (capped: bounded-attention.ts), and the autolink guard walked back per `_`.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { boundedAttention, MAX_DELIMITER_RUNS } from './bounded-attention.ts';
import { boundedGfm } from './bounded-gfm.ts';
import { parseMarkdown } from './parse.ts';
import type { Block, Inline } from '../contracts/ast.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const ms = (text: string): number => {
  const t0 = cpuNow();
  parseMarkdown(text, { file: '/long.md' });
  return cpuNow() - t0;
};

/** The same lines as one paragraph and as one paragraph each: the first may cost a few times the second, not n times. */
function proportionate(name: string, lines: string[]): void {
  const apart = lines.join('\n\n');
  const together = lines.join('\n');
  ms(apart);
  const separate = ms(apart);
  const one = ms(together);
  assert.ok(one < Math.max(separate * 4, 300), `${name}: one paragraph ${one.toFixed(0)} ms, ${lines.length} paragraphs ${separate.toFixed(0)} ms`);
}

const many = (n: number, line: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => line(i));

test('a paragraph of 40,000 plain lines', () => proportionate('plain', many(40_000, (i) => `line ${i}`)));

test('a paragraph of 40,000 lines with trailing spaces', () => proportionate('trailing', many(40_000, (i) => `line ${i}  `)));

test('a paragraph of 40,000 reference links', () => proportionate('references', many(40_000, (i) => `[a${i}][b]`)));

test('a paragraph of 40,000 emphasised words', () => proportionate('emphasis', many(40_000, (i) => `line *${i}* x`)));

test('a paragraph of 40,000 struck words', () => proportionate('strikethrough', many(40_000, (i) => `line ~${i}~ x`)));

test('a paragraph of 20,000 closers with no opener', () => proportionate('closers', many(20_000, () => 'a* ')));

test('32,000 `_a` in one run of text', () => {
  const t = ms('_a'.repeat(32_000));
  assert.ok(t < Math.max(ms('xa'.repeat(32_000)) * 4, 300), `_a run: ${t.toFixed(0)} ms`);
});

const inlineTypes = (blocks: readonly Block[]): string[] => {
  const out: string[] = [];
  const walk = (nodes: readonly Inline[]): void => {
    for (const node of nodes) {
      out.push(node.type);
      if ('children' in node) walk(node.children as Inline[]);
    }
  };
  for (const block of blocks) if (block.type === 'paragraph') walk(block.children);
  return out;
};

test('past the cap, a span keeps its delimiters as text; at the cap it is emphasis', () => {
  const at = '*a* '.repeat(MAX_DELIMITER_RUNS / 2).trim();
  assert.equal(inlineTypes(parseMarkdown(at).children).filter((t) => t === 'emphasis').length, MAX_DELIMITER_RUNS / 2);
  const past = `${at} *b*`;
  const types = inlineTypes(parseMarkdown(past).children);
  assert.deepEqual([...new Set(types)], ['text']);
  // A small paragraph after it is its own span and keeps its emphasis.
  assert.ok(inlineTypes(parseMarkdown(`${past}\n\n*c* ~~d~~`).children).includes('emphasis'));
  const struck = `${'~a~ '.repeat(MAX_DELIMITER_RUNS / 2 + 1)}`;
  assert.ok(!inlineTypes(parseMarkdown(struck).children).includes('strikethrough'));
  assert.ok(inlineTypes(parseMarkdown('~a~ ~~b~~').children).includes('strikethrough'));
});

test('a link text past the cap keeps its delimiters as text', () => {
  const t0 = cpuNow();
  const document = parseMarkdown(`[${'a* '.repeat(40_000)}](https://x.test)`);
  assert.ok(cpuNow() - t0 < 3000, `link text: ${(cpuNow() - t0).toFixed(0)} ms`);
  assert.deepEqual([...new Set(inlineTypes(document.children))], ['link', 'text']);
});

const tree = (text: string, extensions: unknown[]): string =>
  JSON.stringify(fromMarkdown(text, { extensions: extensions as never, mdastExtensions: [gfmFromMarkdown()] }));

test('below the cap, emphasis and strikethrough parse to the same tree as stock micromark and GFM', () => {
  const pieces = ['*', '**', '_', '__', '~', '~~', '***', 'a', ' ', '\n', '[', '](u)', '`', '\\', 'x_y', '!', 'me@e.com', ' _x@y.test'];
  let seed = 4242;
  const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 2000; i += 1) {
    let text = '';
    for (let j = 0, n = 3 + (next() % 30); j < n; j += 1) text += pieces[next() % pieces.length];
    assert.equal(tree(text, [boundedAttention(), boundedGfm()]), tree(text, [gfm()]), JSON.stringify(text));
    assert.equal(tree(text, [boundedAttention()]), tree(text, []), JSON.stringify(text));
  }
});

// a node's lines are not spread into one call, past the engine's argument limit.
test('a paragraph of 140,000 lines and an indented code block of 140,000 lines convert', () => {
  const lines = many(140_000, (i) => `l${i}`);
  assert.equal(parseMarkdown(lines.join('\n')).children.length, 1);
  assert.equal(parseMarkdown(lines.map((line) => `    ${line}`).join('\n')).children[0]!.type, 'codeBlock');
});
