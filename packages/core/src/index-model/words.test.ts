// The one word counter (F-86): a reference table over mixed scripts, the Markdown skips, and the cut-anywhere property.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countsAsMarkdown, countWords, createWordCounter } from './words.ts';

/** A segmenter that is not the system's, so the table is the same on every ICU: words are the runs of the same script class. */
const count = (text: string, markdown = false): number => countWords(text, { markdown });

const TABLE: readonly [string, string, number][] = [
  ['empty', '', 0],
  ['spaces only', '  \t\n ', 0],
  ['two English words', 'hello world', 2],
  ['punctuation alone is no word', '--- *** ___ ...', 0],
  ['numbers count', '12 34, 5.6', 3],
  ['accents', 'café naïve', 2],
  ['ideographic space separates', 'x y z　w﻿v', 5],
  ['emoji alone is no word, with a letter it is', '\u{1F600} \u{1F600}a', 1],
  ['astral letters', '𝒜 𝒞', 2],
  ['Chinese is cut by word', '我们今天去公园', 4],
  ['Chinese with punctuation', '我们，今天去公园。', 4],
  ['Japanese is cut by word', '今日は公園に行きました', 7],
  ['Thai is cut by word', 'วันนี้ไปสวนสาธารณะ', 5],
  ['Chinese beside English', 'hello 世界 foo', 3],
  ['English joined to Chinese in one run', 'hello世界', 2],
  ['a number beside Chinese', '2024年发布', 3],
  ['Korean is spaced, so one per run', '안녕하세요 세계', 2],
  ['Arabic is spaced', 'مرحبا بالعالم', 2],
  ['two Chinese lines', '我们今天去公园\n你好世界', 6],
];

test('the reference table: mixed-script samples and the words each holds', () => {
  for (const [name, text, expected] of TABLE) assert.equal(count(text), expected, `${name}: ${JSON.stringify(text)}`);
});

test('a Chinese, Japanese or Thai run is more than one word, which the old whitespace rule called one', () => {
  const old = (t: string): number => t.split(/\s+/).filter((r) => r !== '' && /[\p{L}\p{N}]/u.test(r)).length;
  for (const t of ['我们今天去公园', '今日は公園に行きました。明日は雨が降るでしょう。天気予報を見ました。', 'วันนี้ไปสวนสาธารณะ']) {
    assert.equal(old(t), 1);
    assert.ok(count(t) > 1, t);
  }
  assert.ok(count('今日は公園に行きました。明日は雨が降るでしょう。天気予報を見ました。') > 3);
});

test('where Intl.Segmenter is missing, a character of an unspaced script is a word and other text counts as before', () => {
  const noBreaker = (t: string): number => countWords(t, { segmenter: null });
  assert.equal(noBreaker('我们今天去公园'), 7, 'overcounts, never hides');
  assert.equal(noBreaker('hello world'), 2);
  assert.equal(noBreaker('hello世界 foo'), 4);
  assert.equal(noBreaker('你好，世界'), 4);
});

test('the count is the same however the text is cut, a pair or a run split at a piece\'s end included', () => {
  const samples = [
    ...TABLE.map(([, t]) => t),
    '# Title\n\nBody text here with 我们今天去公园 in it.\n\n- item\n- item two\n',
    'tab\tseparated\tvalues', 'a\u{20000}b \u{1F600}a \u{20000}\u{20001}x',
    '---\ntitle: Hello there\n---\n\nBody 世界 words.\n\n```js\nconst a = 1;\n```\n\n<!-- one\ntwo -->\nlast 今天\n',
    '﻿---\r\na: b\r\n---\r\ntext\r\n\r\n    code here\r\n\r\nmore\r\n',
  ];
  for (const markdown of [false, true]) {
    for (const text of samples) {
      const whole = count(text, markdown);
      for (const size of [1, 2, 3, 5, 7, 64]) {
        const counter = createWordCounter({ markdown });
        for (let i = 0; i < text.length; i += size) counter.feed(text.slice(i, i + size));
        assert.equal(counter.done(), whole, `${JSON.stringify(text)} in pieces of ${size}${markdown ? ' (markdown)' : ''}`);
      }
    }
  }
});

test('a lone high surrogate at the end of a piece is carried to the next, and one at the very end counts nothing', () => {
  const pair = '\u{20001}';
  const counter = createWordCounter();
  counter.feed(`a ${pair[0]}`);
  counter.feed(`${pair[1]} b`);
  assert.equal(counter.done(), count(`a ${pair} b`));
  assert.equal(count('word \ud800'), 1);
});

test('a run is cut by word only for the scripts that need it: plain English costs a whitespace pass', () => {
  assert.equal(count('well-known state-of-the-art'), 2, 'a hyphen joins, as the whitespace rule has it');
  assert.equal(count('don\'t stop'), 2);
});

// ---- Markdown

test('front matter, fenced code, indented code and HTML comments are not counted; everything else is', () => {
  const fence = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ');
  const front = Array.from({ length: 10 }, (_, i) => `f${i}`).join(' ');
  const doc = `---\ntitle: ${front}\n---\n\n# Heading here\n\nOne two three.\n\n\`\`\`ts\n${fence}\n\`\`\`\n\nFour five.\n`;
  assert.equal(count(doc, true), 2 + 3 + 2, 'a heading, a paragraph, a paragraph');
  assert.equal(count(doc, false), 11 + 2 + 3 + 1 + 50 + 2, 'plain text counts all of it, as the library did');
});

const md = (text: string): number => count(text, true);

test('front matter: a closed block at the top, `---` or `+++`, `...` closing YAML; an unclosed one, or one not at the top, is text', () => {
  assert.equal(md('---\na: b c d\n---\nbody'), 1);
  assert.equal(md('---\na: b c d\n...\nbody'), 1);
  assert.equal(md('+++\na = "b c"\n+++\nbody'), 1);
  assert.equal(md('---\na: b c d\nbody'), 5, 'never closed: it is text');
  assert.equal(md('+++\na\n---\nbody'), 2, 'closed by the other marker: not closed');
  assert.equal(md('intro\n---\na b\n---\nbody'), 4, 'not at the top');
  assert.equal(md('﻿---\na b\n---\nbody'), 1, 'after a byte-order mark');
  assert.equal(md('---\r\na b\r\n---\r\nbody\r\n'), 1, 'CRLF');
});

test('fenced code: backticks or tildes, closed by at least as many of the same, or by the end of the file', () => {
  assert.equal(md('a\n```\nx y z\n```\nb'), 2);
  assert.equal(md('a\n~~~\nx y z\n~~~\nb'), 2);
  assert.equal(md('a\n````\nx\n```\ny\n````\nb'), 2, 'a shorter fence inside does not close it');
  assert.equal(md('a\n```\n~~~\nx\n```\nb'), 2, 'a different mark does not close it');
  assert.equal(md('a\n```\nx y z'), 1, 'unclosed: to the end');
  assert.equal(md('a\n   ```js title\nx y\n   ```\nb'), 2, 'three spaces of indent, an info string');
  assert.equal(md('a `````` b'), 2, 'a fence mark inside a line is not a fence');
  assert.equal(md('a\n``` not `code\nb c'), 5, 'a backtick fence has no backtick in its info');
  assert.equal(md('- item\n  ```\n  x y\n  ```\n- two'), 2, 'a fence inside a list item');
});

test('indented code: after a blank line, outside a list; a paragraph\'s continuation and a list item\'s are text', () => {
  assert.equal(md('a\n\n    x y z\n\nb'), 2);
  assert.equal(md('a\n\n    x y\n\n    z w\n\nb'), 2, 'a blank line inside it does not end it');
  assert.equal(md('a\n\t\tx y\nb'), 4, 'no blank line before: a continuation');
  assert.equal(md('    x y z\n\nb'), 1, 'at the start of the file');
  assert.equal(md('- item\n\n    more of the item\n'), 5, 'in a list');
  assert.equal(md('a\n\n    x\n\nback to text'), 4);
});

test('HTML comments: inline, over lines, unclosed to the end; the text around them is counted', () => {
  assert.equal(md('a <!-- b c --> d'), 2);
  assert.equal(md('a <!--\nb c\n--> d\ne'), 3);
  assert.equal(md('a <!-- b\nc d'), 1, 'unclosed: to the end');
  assert.equal(md('a<!-- x -->b'), 1, 'a word split by a comment is one');
  assert.equal(md('<!-- one -->\n<!-- two -->\nword'), 1);
  assert.equal(count('a <!-- b c --> d', false), 4, 'plain text keeps them');
});

test('a very long line is read a piece at a time in the mode it began in, however it is fed', () => {
  const long = 'word '.repeat(60_000);
  const text = `\`\`\`\n${long}\n\`\`\`\nafter\n${long}\n`;
  const whole = md(text);
  assert.equal(whole, 1 + 60_000);
  for (const size of [1000, 40_000, 70_000, 300_000]) {
    const counter = createWordCounter({ markdown: true });
    for (let i = 0; i < text.length; i += size) counter.feed(text.slice(i, i + size));
    assert.equal(counter.done(), whole, `pieces of ${size}`);
  }
});

test('countsAsMarkdown: by the file type table', () => {
  assert.equal(countsAsMarkdown('/r/a.md'), true);
  assert.equal(countsAsMarkdown('/r/a.markdown'), true);
  assert.equal(countsAsMarkdown('/r/a.txt'), false);
  assert.equal(countsAsMarkdown('/r/a.ts'), false);
  assert.equal(countsAsMarkdown('/r/noext'), false);
});

test('count() reads the number part-way without ending the counter: feeding on gives the same total, whatever is read between', () => {
  const text = '---\nt: a b\n---\nIntro 我们今天 words\n\n```\ncode more\n```\n\n> # Quoted head\n> more <!-- hid\nden --> text\n\n    code\n\nlast line no break';
  for (const markdown of [false, true]) {
    const whole = countWords(text, { markdown });
    for (const size of [1, 2, 5, 11]) {
      const counter = createWordCounter({ markdown });
      let last = 0;
      for (let i = 0; i < text.length; i += size) {
        counter.feed(text.slice(i, i + size));
        const now = counter.count();
        assert.equal(counter.count(), now, 'reading twice gives the same');
        assert.equal(countWords(text.slice(0, i + size), { markdown }), now, `the count so far equals counting the text so far (${size}, ${i})`);
        last = now;
      }
      assert.equal(counter.done(), whole);
      assert.equal(last, whole);
    }
  }
});
