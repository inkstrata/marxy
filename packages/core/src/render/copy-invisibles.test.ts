// Copy operations keep invisible bytes and omit display markers (MARXY-236).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Heading } from '../contracts/ast.ts';
import { createBuffer, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { copySection } from '../operations/copy-section.ts';
import { markInvisibles } from './invisibles.ts';
import { sectionRange } from '../sourcemap/section.ts';

test('markInvisibles keeps the flagged bytes and puts hex only on the glyph', () => {
  const html = markInvisibles('a\u202eb', { inCode: false, sourceStart: 10 });
  assert.match(html, /marxy-invisible-glyph[^>]*>202E</);
  assert.match(html, /marxy-invisible-bidi[^>]*>\u202e</);
  const withoutGlyphs = html.replace(/<code class="marxy-invisible-glyph"[^>]*>[^<]*<\/code>/g, '');
  assert.ok(!withoutGlyphs.includes('202E'));
  assert.ok(withoutGlyphs.includes('\u202e'));
});

test('copy-section over text with invisible characters yields exact source bytes', () => {
  const zwsp = '\u200b';
  const source = `# Head\n\nPara${zwsp}graph.\n`;
  const document = parseMarkdown(source, { file: 'test.md' });
  const buffer = createBuffer('test.md', new TextEncoder().encode(source));
  const heading = document.children[0] as Heading;
  const range = sectionRange(document, heading);
  const text = textOf(buffer, range);
  const result = copySection.run({ document, node: heading, range, text });
  assert.equal(result.clipboard?.text, text);
  assert.ok(!result.clipboard?.text.includes('200B'));
  assert.ok(result.clipboard?.text.includes(zwsp));
});
