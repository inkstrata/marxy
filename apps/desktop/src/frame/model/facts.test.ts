// The kind label, and the word counter cut every way against the whole and against the Outline's sections. No DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outlineFrom, parseMarkdown } from '@marxy/core';
import { countWords, createWordCounter, kindLabel } from './facts.ts';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

test('a code file names its language; a kind that is not code names none', () => {
  assert.equal(kindLabel('code', '/r/a.ts'), 'Code · TypeScript');
  assert.equal(kindLabel('code', '/r/a.cpp'), 'Code · C++');
  assert.equal(kindLabel('code', '/r/Dockerfile'), 'Code · Dockerfile');
  assert.equal(kindLabel('code', '/r/unknown.zzz'), 'Code');
  assert.equal(kindLabel('data', '/r/a.json'), 'Data');
});

test('the bar and the library count alike: one function, over odd text, any way of cutting it, and either reading', () => {
  const samples = [
    '', ' ', 'one', 'one two', '  leading and trailing  ', 'a-b c_d e.f', '--- *** ___', '12 34, 5.6', 'café naïve',
    '你好 世界', '我们今天去公园', '今日は公園に行きました', '𝒜 𝒞', 'x y z　w﻿v', '# Title\n\nBody text here.\n\n- item\n- item two\n',
    'a b c', '\u{1F600} \u{1F600}a', 'tab\tseparated\tvalues', '---\na: b\n---\nbody `x` 世界\n\n```\ncode here\n```\n',
  ];
  for (const markdown of [false, true]) {
    for (const text of samples) {
      const expected = countWords(text, { markdown });
      for (const size of [1, 2, 3, 5]) {
        const counter = createWordCounter({ markdown });
        for (let i = 0; i < text.length; i += size) counter.feed(text.slice(i, i + size));
        assert.equal(counter.done(), expected, `${JSON.stringify(text)} in chunks of ${size}`);
      }
    }
  }
});

test('the sections of the Outline add up to the bar\'s total, however much code, front matter and comment lies between', () => {
  const text = [
    '---', 'title: Front', 'tags: a b c', '---', '', 'Intro words before any heading.', '',
    '# One', '', 'Alpha beta gamma.', '', '```md', '# Not a heading', 'fenced words here', '```', '',
    '## Two', '', '<!-- a note', '## also not a heading', '-->', '', 'Delta 我们今天去公园 epsilon.', '', '    indented code lines', '',
    '# Three', '', '- item one', '- item two', '', '  ```', '  in a list fence', '  ```', '', 'Last words.', '',
  ].join('\n');
  const bytes = bytesOf(text);
  const doc = parseMarkdown(bytes);
  const cuts = [...new Set(outlineFrom(doc).map((e) => e.src.start).filter((at) => at > 0))].sort((a, b) => a - b);
  assert.ok(cuts.length >= 3, 'the heading lines are the section starts');
  const decoder = new TextDecoder();
  const edges = [0, ...cuts, bytes.length];
  let sum = 0;
  for (let i = 0; i + 1 < edges.length; i++) sum += countWords(decoder.decode(bytes.subarray(edges[i], edges[i + 1])), { markdown: true });
  const total = countWords(text, { markdown: true });
  assert.equal(sum, total);
  assert.ok(total > 10 && total < countWords(text), 'and the skips took something out');
});
