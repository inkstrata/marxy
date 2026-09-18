// The D-A13 rule table, idempotence, and the acceptance criterion: 09-gfm-everything.md is set with
// typographic quotes, dashes, ellipses and a widont, while its source bytes stay as they are.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import type { Inline, Node } from '../contracts/ast.ts';
import { renderSafeHtml } from './pipeline.ts';
import { renderToUnsanitisedHtml } from './render-html.ts';
import { smarten, type SmartenContext } from './typography.ts';

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const gfmName = '09-gfm-everything.md';
const gfmSource = readFileSync(new URL(gfmName, corpus), 'utf8');
const html = (markdown: string): string => renderSafeHtml(markdown, { file: 'test.md' }).html;

const none: SmartenContext = { atParagraphEnd: false, wordsInParagraph: 0 };
const widont: SmartenContext = { atParagraphEnd: true, wordsInParagraph: 8 };
const shortEnd: SmartenContext = { atParagraphEnd: true, wordsInParagraph: 7 };

const rules: { name: string; input: string; ctx: SmartenContext; expect: string }[] = [
  { name: 'opening double at start', input: '"Hello', ctx: none, expect: '\u201cHello' },
  { name: 'closing double after a letter', input: 'said"', ctx: none, expect: 'said\u201d' },
  { name: 'paired doubles', input: '"Hello"', ctx: none, expect: '\u201cHello\u201d' },
  { name: 'opening double after space', input: 'said "Hi"', ctx: none, expect: 'said \u201cHi\u201d' },
  { name: 'opening double after paren', input: '("Hi"', ctx: none, expect: '(\u201cHi\u201d' },
  { name: 'opening double after bracket', input: '["Hi"', ctx: none, expect: '[\u201cHi\u201d' },
  { name: 'opening double after newline', input: 'a\n"Hi"', ctx: none, expect: 'a\n\u201cHi\u201d' },
  { name: 'opening single at start', input: "'Hello'", ctx: none, expect: '\u2018Hello\u2019' },
  { name: 'apostrophe is a closing single', input: "don't", ctx: none, expect: 'don\u2019t' },
  { name: 'en dash keeps surrounding spaces', input: 'a -- b', ctx: none, expect: 'a \u2013 b' },
  { name: 'em dash from a triple hyphen', input: 'a --- b', ctx: none, expect: 'a \u2014 b' },
  { name: 'em dash wins over two en dashes', input: '---', ctx: none, expect: '\u2014' },
  { name: 'ellipsis', input: 'wait...', ctx: none, expect: 'wait\u2026' },
  {
    name: 'widont joins the last two words of a long paragraph',
    input: 'one two three four five six seven eight',
    ctx: widont,
    expect: 'one two three four five six seven\u00a0eight',
  },
  {
    name: 'no widont under eight words',
    input: 'one two three four five six seven',
    ctx: shortEnd,
    expect: 'one two three four five six seven',
  },
  {
    name: 'no widont when the run is not the paragraph end',
    input: 'one two three four five six seven eight',
    ctx: none,
    expect: 'one two three four five six seven eight',
  },
];

for (const rule of rules) {
  test(`rule: ${rule.name}`, () => {
    assert.equal(smarten(rule.input, rule.ctx), rule.expect);
  });
}

test('smarten is idempotent on every rule-table case', () => {
  for (const rule of rules) {
    const once = smarten(rule.input, rule.ctx);
    assert.equal(smarten(once, rule.ctx), once, rule.name);
  }
});

test('a seven-word paragraph keeps a breaking last space', () => {
  const out = html('one two three four five six seven\n');
  assert.equal(out, '<p>one two three four five six seven</p>');
  assert.ok(!out.includes('\u00a0'), 'a short paragraph must not receive a widont');
});

test('an eight-word paragraph joins the last two words', () => {
  assert.match(html('one two three four five six seven eight\n'), /seven\u00a0eight/);
});

test('code spans keep straight quotes, dashes and ellipses', () => {
  const out = html('See `"quotes"` and `a -- b` and `wait...`.\n');
  assert.match(out, /<code>"quotes"<\/code>/);
  assert.match(out, /<code>a -- b<\/code>/);
  assert.match(out, /<code>wait\.\.\.<\/code>/);
});

test('a fenced code block is not a typography target', () => {
  const out = html('```\nreturn "ok" -- done...\n```\n');
  assert.match(out, /return "ok" -- done\.\.\./);
  assert.ok(!out.includes('\u201c'));
  assert.ok(!out.includes('\u2013'));
  assert.ok(!out.includes('\u2026'));
});

test('a link URL is written as the AST has it', () => {
  const out = html('[text](https://example.invalid/a--b...c)\n');
  assert.match(out, /href="https:\/\/example.invalid\/a--b\.\.\.c"/);
});

test('an HTML island is not a typography target', () => {
  const out = html('<p>"hello" -- dash...</p>\n');
  assert.match(out, /"hello"/);
  assert.match(out, / -- /);
  assert.match(out, /\.\.\./);
});

test('inline math source is not smartened', () => {
  const out = html('See $x -- y$ here\n');
  assert.match(out, /<code class="marxy-math">x -- y<\/code>/);
});

test('smart typography is in the render, not the sanitiser', () => {
  const document = parseMarkdown('"Hello" -- dash...\n', { file: 't.md' });
  const raw = renderToUnsanitisedHtml(document);
  assert.ok(raw.includes('\u201cHello\u201d'), raw);
  assert.ok(raw.includes('\u2013'), raw);
  assert.ok(raw.includes('\u2026'), raw);
});

test(`${gfmName}: source bytes still carry the ASCII forms`, () => {
  // The criterion is a render pass. If this file were rewritten, the fidelity gate would be
  // testing a fixture that no longer has the marks the story asked us to substitute.
  assert.match(gfmSource, /"smart quotes"/);
  assert.match(gfmSource, /'singles'/);
  assert.match(gfmSource, / -- /);
  assert.match(gfmSource, / --- /);
  assert.match(gfmSource, /\.\.\. ellipsis/);
  assert.ok(!gfmSource.includes('\u00a0'));
  assert.ok(!gfmSource.includes('\u201c'));
  assert.ok(!gfmSource.includes('\u2018'));
  assert.ok(!gfmSource.includes('\u2013'));
  assert.ok(!gfmSource.includes('\u2026'));
});

test(`${gfmName}: rendered HTML has quotes, dashes, an ellipsis and a widont`, () => {
  const out = renderSafeHtml(gfmSource, { file: gfmName }).html;
  assert.ok(out.includes('\u201csmart quotes\u201d'), out);
  assert.ok(out.includes('\u2018singles\u2019'), out);
  assert.ok(out.includes('\u2013'), 'en dash from --');
  assert.ok(out.includes('\u2014'), 'em dash from ---');
  assert.ok(out.includes('\u2026'), 'ellipsis from ...');
  assert.ok(out.includes('\u00a0ellipsis.'), 'widont before the short last word');
});

const files = readdirSync(corpus).filter((file) => file.endsWith('.md'));

function* textValues(node: Node): Generator<string> {
  if (node.type === 'text') {
    yield node.value;
    return;
  }
  if ('children' in node && node.children !== undefined) {
    for (const child of node.children) yield* textValues(child);
  }
}

function lastTextValue(nodes: readonly Inline[]): string | undefined {
  let last: string | undefined;
  const walk = (list: readonly Inline[]): void => {
    for (const node of list) {
      if (node.type === 'text') last = node.value;
      else if (
        node.type === 'emphasis' ||
        node.type === 'strong' ||
        node.type === 'strikethrough' ||
        node.type === 'link'
      ) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return last;
}

for (const file of files) {
  test(`${file}: smarten is idempotent on every prose text node`, () => {
    const source = readFileSync(new URL(file, corpus), 'utf8');
    const document = parseMarkdown(source, { file });
    for (const value of textValues(document)) {
      const once = smarten(value, widont);
      assert.equal(smarten(once, widont), once);
    }
  });
}

test(`${gfmName}: the long GFM paragraph is the one that receives the widont`, () => {
  const document = parseMarkdown(gfmSource, { file: gfmName });
  const paragraph = document.children.find((child) => child.type === 'paragraph');
  assert.ok(paragraph && paragraph.type === 'paragraph');
  const last = lastTextValue(paragraph.children);
  assert.ok(last !== undefined && last.includes('"smart quotes"'));
  const words = last.trim().split(/\s+/).length;
  assert.ok(words >= 8, `last run should be long enough to widont; it has ${words} words`);
});
