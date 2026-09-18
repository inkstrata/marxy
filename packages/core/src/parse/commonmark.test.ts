// CommonMark conformance: our AST, rendered to HTML, must equal the reference implementation's HTML
// for every case in commonmark-cases.ts, and every AST_INVARIANTS entry must hold for every case.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Parser, HtmlRenderer } from 'commonmark';
import { COMMONMARK_CASES } from './commonmark-cases.ts';
import { checkInvariants } from './invariants.ts';
import { parseMarkdown } from './parse.ts';
import { toHtml } from './html.ts';

const reference = (input: string): string => new HtmlRenderer().render(new Parser().parse(input));

test('CommonMark: HTML output matches the reference implementation for every case', () => {
  const failures: string[] = [];
  for (const { section, input } of COMMONMARK_CASES) {
    // CommonMark only: GFM, frontmatter and math change what these inputs mean, by design.
    const document = parseMarkdown(input, { file: 'spec.md', gfm: false, frontmatter: false, math: false });
    const ours = toHtml(document);
    const theirs = reference(input);
    if (ours !== theirs) {
      failures.push(`[${section}] ${JSON.stringify(input)}\n  ours:      ${JSON.stringify(ours)}\n  reference: ${JSON.stringify(theirs)}`);
    }
  }
  assert.equal(failures.length, 0, `${failures.length}/${COMMONMARK_CASES.length} cases differ:\n${failures.slice(0, 20).join('\n')}`);
});

test('CommonMark: the invariants hold for every case', () => {
  const failures: string[] = [];
  for (const { section, input } of COMMONMARK_CASES) {
    const bytes = new TextEncoder().encode(input);
    const document = parseMarkdown(bytes, { file: 'spec.md', gfm: false, frontmatter: false, math: false });
    for (const violation of checkInvariants(document, bytes)) {
      failures.push(`[${section}] ${JSON.stringify(input)}: ${violation.invariant} — ${violation.detail}`);
    }
  }
  assert.deepEqual(failures.slice(0, 20), []);
});

test('CommonMark: the case set covers every block and inline section of the specification', () => {
  const sections = new Set(COMMONMARK_CASES.map((c) => c.section));
  for (const required of [
    'tabs', 'thematic breaks', 'atx headings', 'setext headings', 'indented code', 'fenced code',
    'html blocks', 'definitions', 'block quotes', 'list items', 'lists', 'escapes', 'entities',
    'code spans', 'emphasis', 'links', 'images', 'autolinks', 'raw html', 'hard breaks',
    'soft breaks', 'textual content',
  ]) {
    assert.ok(sections.has(required), `no case for ${required}`);
  }
  assert.ok(COMMONMARK_CASES.length >= 300, `only ${COMMONMARK_CASES.length} cases`);
});
