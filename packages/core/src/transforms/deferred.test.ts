// The five transforms J-03 left for J-03.1: Slack, Jira wiki, HTML, hard-wrap at 80 and delimited text to a table.
// The registry sweep (registry.test.ts) holds each to the fidelity properties; these tests hold what each one does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { corpusDocuments } from '../operations/testing/corpus.ts';
import { canFail, nestedCodeDocuments } from '../operations/testing/test-kit.ts';
import type { Node } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { NOT_YET, runTransform, transformById } from './registry.ts';

const run = (id: string, text: string): string => runTransform(id, text);

test('nothing is left in NOT_YET, and the five ids are registered', () => {
  assert.deepEqual(NOT_YET, {});
  for (const id of ['wrap-80', 'to-slack', 'to-jira', 'to-html', 'tsv-to-table']) assert.ok(transformById(id), id);
});

test('declared properties: wrap-80 is an idempotent prose edit, the converters derive new text', () => {
  const wrap = transformById('wrap-80')!;
  assert.deepEqual([wrap.kind, wrap.outsideCode, wrap.idempotent], ['edit', true, true]);
  for (const id of ['to-slack', 'to-jira', 'to-html', 'tsv-to-table']) {
    const t = transformById(id)!;
    assert.deepEqual([t.kind, t.outsideCode, t.idempotent], ['derive', false, false], id);
  }
});

// ---- Slack

test('to-slack: marks, links, lists, tasks, quotes, tables and rules in mrkdwn', () => {
  const md = '# Head **b**\n\nA *i* and **b** and ~~s~~ and `c` and [l](http://x.example/?a=1&b=2) & <tag>\n\n- one\n  - two\n    1. deep\n- [x] done\n- [ ] open\n\n> quoted\n\n| a | b |\n|---|--:|\n| 1 | 22 |\n\n---\n';
  assert.equal(
    run('to-slack', md),
    '*Head b*\n\nA _i_ and *b* and ~s~ and `c` and <http://x.example/?a=1&b=2|l> &amp; &lt;tag&gt;\n\n• one\n  • two\n    1. deep\n• [x] done\n• [ ] open\n\n> quoted\n\n```\na  b\n1  22\n```\n\n---\n',
  );
});

test('to-slack: a callout is a quoted label; code is kept and front matter is dropped', () => {
  assert.equal(run('to-slack', '---\nt: 1\n---\n\n> [!WARNING]\n> careful\n\n```js\nx * 2 < 3\n```\n'), '> *Warning*\n> careful\n\n```\nx * 2 < 3\n```\n');
});

test('to-slack: marks inside code are not marks', () => {
  assert.equal(run('to-slack', '`*not bold*` and \\*literal\\*\n'), '`*not bold*` and *literal*\n');
});

// ---- Jira

test('to-jira: headings, marks, links, nested mixed lists, panels, tables and code', () => {
  const md = '# T\n\nA *i* **b** ~~s~~ `c` [l](http://x.example) {braces} [brackets]\n\n- one\n  1. two\n     - three\n- [x] done\n\n> [!NOTE]\n> heads up\n\n> plain\n\n| a | b |\n|---|---|\n| x\\|y | 2 |\n\n```py\nprint(1)\n```\n\n---\n';
  assert.equal(
    run('to-jira', md),
    'h1. T\n\nA _i_ *b* -s- {{c}} [l|http://x.example] \\{braces\\} \\[brackets\\]\n\n* one\n*# two\n*#* three\n* (/) done\n\n{info}\nheads up\n{info}\n\n{quote}\nplain\n{quote}\n\n||a||b||\n|x\\|y|2|\n\n{code:py}\nprint(1)\n{code}\n\n----\n',
  );
});

test('to-jira: a language that is not a plain word does not reach the macro', () => {
  assert.equal(run('to-jira', '```a}b\nx\n```\n'), '{code}\nx\n{code}\n');
});

// ---- HTML

test('to-html: goes through the writer and the sanitiser; scripts and provenance attributes do not come out', () => {
  const out = run('to-html', '# Hi\n\ntext <script>alert(1)</script> *em*\n\n- a\n');
  assert.match(out, /<h1[^>]*>Hi<\/h1>/);
  assert.match(out, /<em>em<\/em>/);
  assert.doesNotMatch(out, /<script|data-marxy|alert\(1\)<\/script>/i);
  assert.ok(out.endsWith('\n'));
});

// ---- tsv-to-table

test('tsv-to-table: a spreadsheet copy becomes an aligned table; number columns are right-aligned', () => {
  assert.equal(
    run('tsv-to-table', 'name\tqty\tnote\napple\t3\t"a, b"\nfig\t12.5\t\n'),
    '| name  | qty  | note |\n| ----- | ---: | ---- |\n| apple | 3    | a, b |\n| fig   | 12.5 |      |\n',
  );
});

test('tsv-to-table: CSV with quotes, a pipe, a line break in a cell and a short row', () => {
  assert.equal(run('tsv-to-table', 'a,b\n"x ""q""",1\n"p|q","l1\nl2"\nonly\n'), '| a     | b        |\n| ----- | -------- |\n| x "q" | 1        |\n| p\\|q  | l1<br>l2 |\n| only  |          |\n');
});

test('tsv-to-table: text with no delimiter comes back as it was; a column mixing words and numbers is not numeric', () => {
  assert.equal(run('tsv-to-table', 'just a line\n'), 'just a line\n');
  assert.match(run('tsv-to-table', 'a,b\n1,x\n2,3\n'), /\| ---: \| --- \|/);
});

// ---- wrap-80

const LONG = 'word '.repeat(40).trim();
const longest = (s: string): number => Math.max(...s.split('\n').map((l) => [...l].length));

test('wrap-80: prose is filled to 80 columns, short lines are joined, and the words stay in order', () => {
  const out = run('wrap-80', `${LONG}\n`);
  assert.ok(longest(out) <= 80);
  assert.equal(out.replace(/\s+/g, ' ').trim(), LONG);
  assert.equal(run('wrap-80', 'one\ntwo\nthree\n'), 'one two three\n');
});

test('wrap-80: a list item and a quote wrap inside their container', () => {
  assert.equal(run('wrap-80', `- ${LONG}\n`).split('\n').slice(1, 3).every((l) => l.startsWith('  ') || l === ''), true);
  const quoted = run('wrap-80', `> ${LONG}\n`).trimEnd().split('\n');
  assert.ok(quoted.length > 1 && quoted.every((l) => l.startsWith('> ') && l.length <= 80));
  const numbered = run('wrap-80', `1. ${LONG}\n`).trimEnd().split('\n');
  assert.ok(numbered.slice(1).every((l) => l.startsWith('   ') && l.length <= 80));
  const nested = run('wrap-80', `> - ${LONG}\n`).trimEnd().split('\n');
  assert.ok(nested.slice(1).every((l) => l.startsWith('>   ')));
});

test('wrap-80: tables, headings, code, hard breaks and code spans are left alone', () => {
  const table = `| ${LONG} | b |\n|---|---|\n| 1 | 2 |\n`;
  const heading = `# ${LONG}\n`;
  const code = `\`\`\`\n${LONG}\n\`\`\`\n`;
  const hard = `${LONG}  \nnext line\n`;
  for (const t of [table, heading, code, hard]) assert.equal(run('wrap-80', t), t);
  const span = run('wrap-80', `${'x '.repeat(38)}\`a  long   code span\` end\n`);
  assert.ok(span.includes('`a  long   code span`'));
});

test('wrap-80: a word that would start a block stays with the line before it', () => {
  const out = run('wrap-80', `${'a'.repeat(79)} - b\n`);
  assert.equal(out, `${'a'.repeat(79)} -\nb\n`);
  const lines = run('wrap-80', `${'a'.repeat(70)} aaaaaaaaaa 1. x # y > z\n`).split('\n');
  for (const l of lines.slice(1)) assert.doesNotMatch(l, /^(?:[-+*>#]|\d+[.)])(?:\s|$)/);
});

/** What reading the text sees: the block structure, and each paragraph's inline marks and words with a line break read as a space. */
function signature(text: string): string {
  const doc = parseMarkdown(new TextEncoder().encode(text), { file: 'x' });
  const inline = (n: Node): string => {
    const kids = (n as { children?: readonly Node[] }).children;
    if (n.type === 'softBreak') return ' ';
    if (n.type === 'text') return (n as { value: string }).value;
    return `<${n.type}${(n as { url?: string }).url ?? ''}>${(kids ?? []).map(inline).join('')}${(n as { value?: string }).value ?? ''}</>`;
  };
  const out: string[] = [];
  const visit = (n: Node, depth: number): void => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'tableCell') {
      out.push(`${depth} ${n.type} ${inline(n).replace(/\s+/g, ' ').trim()}`);
      return;
    }
    out.push(`${depth} ${n.type}${n.type === 'codeBlock' || n.type === 'mathBlock' ? (n as { value: string }).value : ''}`);
    for (const c of (n as { children?: readonly Node[] }).children ?? []) visit(c, depth + 1);
  };
  visit(doc, 0);
  return out.join('\n');
}

// The reflow property: wrapping changes where lines break and nothing else. The document has the same blocks, and the
// same words in them, whatever the input; and no line is wider than 80 unless one word is.
function assertReflows(fn: (s: string) => string): void {
  let wrapped = 0;
  const inputs = [
    ...corpusDocuments().map(({ bytes }) => new TextDecoder().decode(bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n')),
    ...nestedCodeDocuments(),
    ...[
      `- ${LONG}\n  - ${LONG}\n\n  ${LONG}\n\n1. ${LONG}\n`,
      `> ${LONG}\n>\n> - ${LONG}\n`,
      `[^n]: ${LONG}\n\n${'a'.repeat(75)} - b 1. c # d > e ---\n`,
      `${'word '.repeat(16)}- item-looking\n${'a '.repeat(30)}1) x\n`,
    ],
  ];
  for (const text of inputs) {
    const out = fn(text);
    if (out !== text) wrapped++;
    assert.equal(signature(out), signature(text), `the document changed shape: ${JSON.stringify(text.slice(0, 200))}`);
    assert.equal(fn(out), out, `not idempotent: ${JSON.stringify(text.slice(0, 200))}`);
  }
  assert.ok(wrapped > 3, 'the inputs must hold paragraphs worth wrapping');
}

test('wrap-80: the reflow property holds over the corpus, nested containers and block-looking words', () => {
  assertReflows((s) => run('wrap-80', s));
});

test('the reflow property can fail', () => {
  canFail(() => assertReflows((s) => s.replace(/(\w+ \w+) /g, '$1\n- ')));
  canFail(() => assertReflows((s) => s.replace(/aaa/g, 'b')));
});

// ---- review fixes (J-03.1)

test('wrap-80: words that merely start with a marker character wrap like any other', () => {
  for (const unit of ['**word** ', '_word_ ', '-x --flag ']) {
    const out = run('wrap-80', unit.repeat(40).trimEnd() + '\n');
    assert.ok(longest(out) <= 80, JSON.stringify(unit));
    assert.equal(out.replace(/\s+/g, ' ').trim(), unit.repeat(40).trim());
  }
});

test('wrap-80: a link destination in angle brackets is never broken, nor is one with a title', () => {
  const text = 'text '.repeat(15) + '[a b](<http://x/y z w> "t") more '.repeat(3) + '\n';
  assert.equal(run('wrap-80', text), text);
  const out = run('wrap-80', 'word '.repeat(14) + '[a b](http://x.example/path "a title here") tail\n');
  assert.ok(out.includes('](http://x.example/path'));
});

test('to-jira: a pipe in code in a cell, literal -word-, and inline HTML', () => {
  assert.equal(run('to-jira', '| a |\n|--|\n| `x\\|y` |\n'), '||a||\n|{{x\\|y}}|\n');
  assert.equal(run('to-jira', 'a -no- and +yes+ and well-known, 1 - 2 and why??\n'), 'a \\-no\\- and \\+yes\\+ and well-known, 1 - 2 and why\\?\\?\n');
  assert.equal(run('to-jira', 'x <b>raw</b> y\n'), 'x raw y\n');
});

test('wrap-80: a word in mid-paragraph is never glued whatever character it starts with', () => {
  for (const unit of ['|x ', '>x ', '>= ', '<x ', '$$x ', '|a|b| ']) {
    const text = unit.repeat(50).trimEnd();
    const out = run('wrap-80', `start ${text}\n`);
    assert.ok(longest(out) <= 80, JSON.stringify(unit));
    assert.equal(signature(out), signature(`start ${text}\n`), `${unit}: the document changed shape`);
    assert.equal(run('wrap-80', out), out, `${unit}: not idempotent`);
  }
});

test('wrap-80: every line is at most 80 columns for random words starting with each special character', () => {
  let seed = 7;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const specials = ['|', '>', '<', '*', '_', '-', ':', '=', '+', '#', '~', '.', '1'];
  for (let round = 0; round < 40; round++) {
    const words = Array.from({ length: 30 + rnd(30) }, () => specials[rnd(specials.length)]! + 'abcdefghijkl'.slice(0, 1 + rnd(11)));
    const text = `start ${words.join(' ')}\n`;
    const out = run('wrap-80', text);
    for (const line of out.split('\n')) assert.ok(line.length <= 80 || !line.includes(' '), `${JSON.stringify(line)} in ${JSON.stringify(text)}`);
    assert.equal(signature(out), signature(text), `shape changed: ${JSON.stringify(text)}`);
    assert.equal(run('wrap-80', out), out, `not idempotent: ${JSON.stringify(text)}`);
  }
});
