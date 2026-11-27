// Inputs that made a regex backtrack for seconds or minutes: a run of comments before a file that is
// not an SVG, a heading line with a long run of spaces inside it, a paragraph or line whose long space run is not at its
// end, a fence of blank lines, a file with thousands of heading jumps. Each is timed; the bound is far above what the
// work takes now and far below what it took.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { imageFormatOf } from '../viewer/image-facts.ts';
import { pdfMarkdown, pdfPlainText } from '../viewer/pdf.ts';
import { detectKind } from '../kind/detect.ts';
import { renderSafeHtml } from '../render/pipeline.ts';
import { runTransform } from '../transforms/registry.ts';
import { notesOf } from '../notes/notes.ts';
import { headingsFromMarkdown } from '../index-model/entry.ts';
import { joinLines } from '../source-edit/lines.ts';
import { classifyClipboard } from '../paste/classify.ts';
import { readingOf } from '../reading/index.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { dedupeLines } from '../operations/dedupe-lines.ts';
import { alignTablePipes } from '../operations/align-table-pipes.ts';
import { renumberList } from '../operations/list-markers.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function within<T>(ms: number, what: string, fn: () => T): T {
  const t = cpuNow();
  const out = fn();
  const took = cpuNow() - t;
  assert.ok(took < ms, `${what}: ${Math.round(took)} ms, the bound is ${ms}`);
  return out;
}

const SPACES = ' '.repeat(100_000);

test('comments before a file that is not an SVG are scanned once (21 s for 203 bytes before)', () => {
  assert.equal(within(100, 'comment run', () => imageFormatOf(enc(`${'<!---->'.repeat(70)}not svg`))), null);
  assert.equal(imageFormatOf(enc('<?xml version="1.0"?>\n<!-- a -->\n<!-- b -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">\n<svg xmlns="http://www.w3.org/2000/svg"/>')), 'svg');
  assert.equal(imageFormatOf(enc('  <SVG viewBox="0 0 1 1"></SVG>')), 'svg');
  assert.equal(imageFormatOf(enc('<svgx/>')), null);
  assert.equal(imageFormatOf(enc('<!-- never closed <svg>')), null);
  assert.equal(imageFormatOf(enc('<?xml version="1.0"?><html><svg/></html>')), null);
});

test('a heading line with a long run of spaces in it is read in one pass (16 s for a 3 KB head before)', () => {
  const head = enc(`# a${' '.repeat(12_000)}x#\n\ntext\n`);
  within(250, 'detectKind', () => detectKind({ path: '/r/notes.md', head }));
  const cell = `# a${' '.repeat(8_000)}x#`;
  const nb = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: 'markdown', source: cell, metadata: {} }] });
  const read = within(500, 'notebook headings', () => readingOf('h.ipynb', enc(nb)));
  assert.equal(read?.id, 'notebook');
  assert.equal(read?.contents?.items[0]?.text, `a${' '.repeat(8_000)}x`);
});

test('a long space run that does not end the text is trimmed in linear time at every site', () => {
  const para = `a b c d e f g h${SPACES}i \`c\`\n`;
  within(500, 'a paragraph that ends in code', () => renderSafeHtml(para));
  within(500, 'x-questions', () => runTransform('x-questions', `a${SPACES}b?\n`));
  within(500, 'x-headings', () => runTransform('x-headings', `# a${SPACES}b\n`));
  within(500, 'collapse-blank', () => runTransform('collapse-blank', `a${SPACES}b\n`));
  within(500, 'title-headings', () => runTransform('title-headings', `# a${SPACES}b\n`));
  within(250, 'index headings', () => headingsFromMarkdown(enc(`# a${SPACES}b\n`)));
  within(250, 'pdf plain text', () => pdfPlainText([`a${SPACES}b`]));
  within(250, 'pdf markdown', () => pdfMarkdown(null, [`a${SPACES}b`]));
  within(250, 'join lines', () => joinLines(`a${SPACES}b\nc`, [{ from: 0, to: 1 }]));
  within(250, 'paste json', () => classifyClipboard({ text: `[1${'\n'.repeat(100_000)}]` }));
  const lines = `a${SPACES}b\na${SPACES}b\n`;
  const doc = parseMarkdown(enc(lines), { file: 'd.md' });
  within(500, 'dedupe lines', () => dedupeLines.run({ document: doc, range: { file: 'd.md', start: 0, end: lines.length }, text: lines }));
  within(4000, 'a fence of blank lines', () => notesOf(`\`\`\`\n${'\n'.repeat(200_000)}x\n\`\`\`\n`));
});

test('the trims keep what the regexes kept', () => {
  assert.equal(runTransform('x-headings', '# Title ##  \n## Two\n'), '- Title\n  - Two');
  assert.deepEqual(headingsFromMarkdown(enc('# Title ##\n## C#\n### #\n')).map((h) => h.text), ['Title', 'C#']);
  assert.equal(runTransform('title-headings', '# a title ##\n'), '# A Title ##\n');
  assert.equal(pdfPlainText(['a  \n', 'b']), 'a\n\f\nb\n');
});

test('notes find their line and column from line starts made once (7 s for 20,000 heading jumps before)', () => {
  const text = '# a\n\n### b\n\n'.repeat(20_000);
  const notes = within(2500, 'heading jumps', () => notesOf(text));
  assert.equal(notes.length, 20_000);
  assert.deepEqual([notes[0]!.line, notes[0]!.column], [3, 1]);
  assert.deepEqual([notes[19_999]!.line, notes[19_999]!.column], [79_999, 1]);
});

test('150,000 tasks or headings are measured in a loop, not a spread past the engine\'s argument limit', () => {
  assert.equal(runTransform('x-tasks', '- [ ] a\n'.repeat(150_000)).split('\n').length, 150_000);
  assert.ok(runTransform('normalize-headings', '## a\n\n'.repeat(150_000)).startsWith('# a\n'));
});

test('a table cell with a long run of spaces inside it is trimmed in linear time by Align table pipes', () => {
  const text = `| a${SPACES}b | c |\n| --- | --- |\n| d | e |\n`;
  const doc = parseMarkdown(enc(text), { file: 't.md' });
  const table = doc.children.find((n) => n.type === 'table')!;
  const out = within(500, 'align table pipes', () => alignTablePipes.run({ document: doc, node: table, range: table.src, text: text.slice(table.src.start, table.src.end) }));
  assert.ok(out.replacement.startsWith(`| a${SPACES}b | c   |`), out.replacement.slice(0, 40));
});

test('renumbering every list and aligning every table of a long page finds each one\'s container from one map (over three minutes for 8,000 before)', () => {
  let md = '';
  for (let i = 0; i < 2000; i++) md += `Para ${i}\n\n1. a\n3. b\n\n> |a|b|\n> |-|-|\n> |1|2|\n\n`;
  const bytes = enc(md);
  const doc = parseMarkdown(bytes);
  const dec = new TextDecoder();
  const out: string[] = [];
  within(2000, '4,000 blocks', () => {
    for (const top of doc.children) {
      const node = top.type === 'blockquote' ? top.children[0]! : top;
      const op = node.type === 'list' ? renumberList : node.type === 'table' ? alignTablePipes : null;
      const input = { document: doc, node, range: node.src };
      if (op?.canApply(input)) out.push(op.run({ ...input, text: dec.decode(bytes.subarray(node.src.start, node.src.end)) }).replacement);
    }
  });
  assert.equal(out.length, 4000);
  assert.equal(out[0], '1. a\n2. b');
  assert.equal(out[1], '| a   | b   |\n> | --- | --- |\n> | 1   | 2   |', 'the rows after the first keep their quote marker');
});
