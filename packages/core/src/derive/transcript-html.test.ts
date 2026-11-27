// The invisibles pass over an agent's sanitised Markdown: an HTML block keeps the references the file
// wrote, so a run is read back reference by reference. `&nbsp;` is a space, not the letters `&nbsp;`; a zero-width
// character written as a reference is marked as one written as itself is; a reference this does not know is left for
// the page to read.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { leafHtml, markInvisiblesInHtml } from './transcript-html.ts';
import { renderSafeHtml } from '../render/pipeline.ts';

const marked = (md: string): string => markInvisiblesInHtml(renderSafeHtml(md).html).replace(/ data-marxy-[se]="\d+"/g, '');
const ZWSP = String.fromCharCode(0x200b);

test('a reference in an HTML block is read as the page would read it, not shown as its letters', () => {
  assert.doesNotMatch(marked('<div>\na&nbsp;b é\n</div>\n'), /&amp;nbsp;/);
  assert.match(marked('<div>\na&nbsp;b é\n</div>\n'), new RegExp(`a${String.fromCharCode(0xa0)}b é`));
  assert.match(marked('<div>\nq &quot;x&quot; é &lt;\n</div>\n'), /q "x" é &lt;/);
  assert.match(marked('<div>\na &copy; é\n</div>\n'), /a &copy; é/, 'a reference not read back stays as written');
  assert.match(marked('<div>\nAT&amp;T é\n</div>\n'), /AT&amp;T é/);
});

test('a zero-width character written as a reference is marked, in an ASCII run too', () => {
  const plain = marked(`<div>\nzero${ZWSP}width\n</div>\n`);
  assert.match(plain, /marxy-invisible/);
  for (const ref of ['&#x200B;', '&#8203;', '&ZeroWidthSpace;']) {
    assert.match(marked(`<div>\nzero${ref}width\n</div>\n`), /marxy-invisible-glyph" aria-hidden="true">200B/, ref);
    assert.match(marked(`<div>\nzero${ref}width é\n</div>\n`), /marxy-invisible-glyph" aria-hidden="true">200B/, ref);
  }
  assert.match(marked('<div>\nx&zwj;y\n</div>\n'), /marxy-invisible/);
});

test('an agent’s code text keeps its quotes and attribute-shaped words: nothing in text is taken for an attribute', () => {
  const value = 'Use `<div id="main">` and `x data-marxy-s="5"` and `y data-marxy-speaker="a"` here.\n\n```html\n<section id="hero" title="Top">\n```\n';
  const leaf = { type: 'derivedText', src: { file: 'f', start: 0, end: value.length }, from: [], value, decoding: 'utf-8', syntax: 'markdown', role: 'agent-text', replaced: [] } as never;
  const html = leafHtml(leaf, { path: 'f.jsonl' });
  const shown = html.replace(/<[^>]*>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"');
  assert.match(shown, /<div id="main">/);
  assert.match(shown, /x data-marxy-s="5"/);
  assert.match(shown, /y data-marxy-speaker="a"/);
  assert.match(shown, /<section id="hero" title="Top">/);
});
