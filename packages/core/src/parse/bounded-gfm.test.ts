// F-90: a long paragraph after an unclosed `[` opens in time in proportion to its length.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { boundedGfm } from './bounded-gfm.ts';
import { parseMarkdown } from './parse.ts';

const unit = 'the reader opens a file and sees exactly what it holds ';
const words = (n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const ms = (text: string): number => {
  const t0 = performance.now();
  parseMarkdown(text, { file: '/bracket.md' });
  return performance.now() - t0;
};

test('80,000 characters after an unclosed [ parse in bounded time', () => {
  const text = words(80_000);
  ms(text);
  // Best of three each, so one slow scheduler tick is not a verdict.
  const plain = Math.min(ms(text), ms(text), ms(text));
  const bracket = Math.min(ms('[' + text), ms('[' + text), ms('[' + text));
  assert.ok(bracket < 400, `after an unclosed [: ${bracket.toFixed(0)} ms`);
  assert.ok(bracket < plain * 4, `after an unclosed [: ${bracket.toFixed(0)} ms, plain ${plain.toFixed(0)} ms`);
});

const tree = (text: string, extension: ReturnType<typeof gfm>): string =>
  JSON.stringify(fromMarkdown(text, { extensions: [extension], mdastExtensions: [gfmFromMarkdown()] }));

const cases = [
  'see www.example.com/a?b and https://example.org/x#y or mail me@example.com now',
  '[a www.example.com b](https://x.test) and www.after.example',
  '[ www.example.com and https://example.org and me@example.com',
  '![ www.example.com and https://example.org and me@example.com',
  '[unclosed https://a.test ](closed) then https://b.test and c@d.test',
  '[a [b www.inner.test c] https://d.test e@f.test',
  '[x] www.one.test [ www.two.test ] www.three.test',
  '> [ quote www.q.test\n\nnext https://para.test me@x.test [y](z) www.w.test',
  '- [ ] task www.t.test\n- [x] https://u.test [',
  '[a](b www.c.test) ![i](j) https://k.test [l]: m'
];

test('every autolink literal case parses to the same tree as stock GFM', () => {
  for (const text of cases) assert.equal(tree(text, boundedGfm()), tree(text, gfm()), text);
});

test('random bracket and autolink soup parses to the same tree as stock GFM', () => {
  const pieces = ['[', ']', '![', '(', ')', ' ', '\n', 'a', 'www.e.com', 'https://e.org/p', 'me@e.com', 'x_y', '-', '.', '<', '`'];
  let seed = 12345;
  const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 400; i += 1) {
    let text = '';
    for (let j = 0, n = 5 + (next() % 40); j < n; j += 1) text += pieces[next() % pieces.length];
    assert.equal(tree(text, boundedGfm()), tree(text, gfm()), JSON.stringify(text));
  }
});
