import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { plainHeadingText, scanHeadings, SCANNED_HEADINGS_MAX } from './heading-scan.ts';
import { indexLines, LINES_FROM, markdownPastLines, renderedChosen, setRenderedChosen, linesTier } from './lines.ts';
import { readingOf, setsPlainReading } from './index.ts';
import { outlineFrom } from '../outline/outline.ts';
import { parseMarkdown } from '../parse/parse.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const pace = { yieldNow: async (): Promise<void> => {} };

async function scan(md: string): Promise<{ level: number; text: string; start: number; end: number; line: number }[]> {
  const lines = indexLines(enc(md), false, null, true);
  const got = await scanHeadings(lines, pace);
  assert.ok(got);
  return got.items.map((h) => ({ ...h }));
}
const brief = async (md: string): Promise<string[]> => (await scan(md)).map((h) => `${h.level} ${h.text}`);

test('ATX headings: one to six marks and a space, a closing run dropped, seven marks or no space are text', async () => {
  assert.deepEqual(await brief('# One\n## Two ##\n###### Six\n####### Seven\n#Tight\n   ### Indented three\n#\n'), ['1 One', '2 Two', '6 Six', '3 Indented three', '1 ']);
  assert.deepEqual(await brief('# Ends in a hash#\n# C# and F# #\n'), ['1 Ends in a hash#', '1 C# and F#']);
});

test('each heading carries its bytes and its line', async () => {
  const md = 'intro\n\n## Second\ntext\n';
  const [h] = await scan(md);
  assert.equal(md.slice(h!.start, h!.end), '## Second');
  assert.equal(h!.line, 2);
});

test('setext underlines make the paragraph above a heading, its first line its start', async () => {
  const md = 'Title\n=====\n\nSub one\nand two\n---\n\n---\n\nText\n- - -\n';
  const got = await scan(md);
  assert.deepEqual(got.map((h) => `${h.level} ${h.text}`), ['1 Title', '2 Sub one and two']);
  assert.equal(md.slice(got[1]!.start, got[1]!.end), 'Sub one\nand two\n---');
  assert.equal(got[1]!.line, 3);
});

test('fences with backticks and tildes hide what they hold until a closing fence at least as long', async () => {
  const md = ['```js', '# not a heading', '```', '# A', '~~~~', '# not', '~~~', 'still === code', '~~~~', '# B', '``` has ` tick', '# C', '````', '# open to the end'].join('\n');
  assert.deepEqual(await brief(md), ['1 A', '1 B', '1 C']);
});

test('indented code is never a heading, nor a setext underline under it', async () => {
  assert.deepEqual(await brief('    # code\n\n\t# tab code\n\n    text\n    ===\n# Real\n'), ['1 Real']);
});

test('front matter is passed over and gives the title when no heading is level one; unclosed it is the file', async () => {
  assert.deepEqual(await brief('---\ntitle: "The page"\n# not a heading\n---\n## Part\n'), ['1 The page', '2 Part']);
  assert.deepEqual(await brief('+++\ntitle = "Toml"\n+++\n# Own\n'), ['1 Own']);
  assert.deepEqual(await brief('---\na: 1\n# Heading\n'), ['1 Heading'], 'front matter that never closes is none');
});

test('HTML blocks hide headings until they end: a blank line, or their end marker', async () => {
  const md = ['<div>', '# inside a div', '', '# after the div', '<!--', '# in a comment', '-->', '# after it', '<pre>', '# in pre', '', '# still pre', '</pre>', '# done'].join('\n');
  assert.deepEqual(await brief(md), ['1 after the div', '1 after it', '1 done']);
});

test('CRLF lines and a last heading with no newline', async () => {
  const md = 'A\r\n===\r\n\r\n# B\r\n## C';
  const got = await scan(md);
  assert.deepEqual(got.map((h) => `${h.level} ${h.text}`), ['1 A', '1 B', '2 C']);
  assert.equal(md.slice(got[2]!.start, got[2]!.end), '## C');
});

test('list items and quotes are not looked into, and a line after them is no setext text', async () => {
  assert.deepEqual(await brief('- item\n---\n\n> quote\n===\n\n1. one\n---\n# After\n'), ['1 After']);
});

test('inline marks come off simply', () => {
  assert.equal(plainHeadingText('**Bold** and _it_ and `code` [link](http://x) ![alt](i.png) <b>tag</b> snake_case \\*'), 'Bold and it and code link alt tag snake_case *');
  assert.equal(plainHeadingText('A &amp; B &#65;'), 'A & B A');
});

test('the scan agrees with the parse on a mixed document', async () => {
  const md = [
    '---', 'title: x', '---', '# One', 'para', 'Two', '---', '```', '# no', '```', '<div>', '# no', '', '## Three *em*', '    # no', '', 'Four', '====', '',
  ].join('\n');
  const parsed = outlineFrom(parseMarkdown(enc(md), { file: '/a.md' })).map((e) => `${e.level} ${e.text}`);
  assert.deepEqual(await brief(md), parsed);
});

test('the scan is bounded: past the most headings it keeps the first and says so', async () => {
  const md = '# h\n'.repeat(SCANNED_HEADINGS_MAX + 5);
  const got = await scanHeadings(indexLines(enc(md), false, null, true), pace);
  assert.equal(got!.items.length, SCANNED_HEADINGS_MAX);
  assert.equal(got!.capped, true);
});

test('Markdown past 5 MB reads as lines until it is asked to be shown rendered', () => {
  const one = enc('# Heading\nsome text\n\n');
  const bytes = new Uint8Array(Math.ceil(LINES_FROM / one.length) * one.length);
  for (let at = 0; at < bytes.length; at += one.length) bytes.set(one, at);
  assert.equal(markdownPastLines('/big.md', bytes), true);
  assert.equal(setsPlainReading('/big.md', bytes), true, 'its parse is left until asked for');
  const reading = readingOf('/big.md', bytes);
  assert.equal(reading?.id, 'lines');
  assert.equal(reading?.lines?.markdown, true);
  setRenderedChosen('/big.md', true);
  try {
    assert.equal(renderedChosen('/big.md'), true);
    assert.equal(linesTier('/big.md', bytes, null), null);
    assert.equal(readingOf('/big.md', bytes), null, 'the Markdown page, with the same bytes');
    assert.equal(setsPlainReading('/big.md', bytes), false);
  } finally {
    setRenderedChosen('/big.md', false);
  }
  assert.equal(readingOf('/big.md', bytes)?.id, 'lines');
});

test('an ATX heading, a fence or a thematic break ends a list, so a setext heading after it is found', async () => {
  assert.deepEqual(await brief('- item\n# H\nPara\n---\n'), ['1 H', '2 Para']);
  assert.deepEqual(await brief('- item\n```\ncode\n```\nPara\n===\n'), ['1 Para']);
  assert.deepEqual(await brief('> quote\n***\nPara\n---\n'), ['2 Para']);
});

test('a paragraph made only of link reference definitions is no setext heading', async () => {
  assert.deepEqual(await brief('[a]: /u\n[b]: /v "t"\n---\n# After\n'), ['1 After']);
  assert.deepEqual(await brief('Text\n[a]: /u\n---\n'), ['2 Text [a]: /u'], 'a definition cannot interrupt a paragraph');
});

test('the front matter title keeps the list within its most', async () => {
  const md = `---\ntitle: T\n---\n${'## h\n'.repeat(SCANNED_HEADINGS_MAX + 2)}`;
  const got = await scanHeadings(indexLines(enc(md), false, null, true), pace);
  assert.equal(got!.items.length, SCANNED_HEADINGS_MAX);
  assert.equal(got!.items[0]!.text, 'T');
  assert.equal(got!.capped, true);
});

test('a heading cut to its most characters never splits a surrogate pair', () => {
  const t = plainHeadingText(`${'a'.repeat(198)}😀😀`);
  assert.equal(t.length, 199);
  assert.ok(t.endsWith('a…'), JSON.stringify(t.slice(-3)));
  assert.equal(plainHeadingText(`${'a'.repeat(197)}😀😀`).slice(-3), '😀…');
});

test('a line of megabytes that opens with # or < is read only at its head', async () => {
  const long = 'x'.repeat(8 * 1024 * 1024);
  const got = await scan(`# Big ${long}\n<div ${long}\n# hidden in the div\n\n<!-- ${long} -->\n# After\n`);
  assert.deepEqual(got.map((h) => h.level), [1, 1]);
  assert.ok(got[0]!.text.length <= 200);
  assert.equal(got[1]!.text, 'After');
});
