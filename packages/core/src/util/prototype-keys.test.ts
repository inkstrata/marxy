// A name the file chooses is looked up only among a table's own entries: `constructor`,
// `__proto__` and `toString` are a cell magic, a fence language, an HTML tag or attribute, an XML entity, a log level or
// a query unit like any other unknown one, never a member of Object.prototype.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readingOf } from '../reading/index.ts';
import { highlight, grammarTokens, hasGrammarRuns } from '../highlight/grammar.ts';
import { logRankOf } from '../highlight/line-classes.ts';
import { partsOf } from '../reading/parts.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { sanitizeHtml } from '../sanitize/sanitize-html.ts';
import { renderSafeHtml } from '../render/pipeline.ts';
import { cleanOutputHtml } from '../reading/notebook-html.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

test('a notebook cell whose magic is a prototype name reads, its language the kernel\'s', () => {
  for (const name of NAMES) {
    const nb = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [{ cell_type: 'code', source: `%%${name}\nx`, outputs: [], execution_count: 1, metadata: {} }] });
    const read = readingOf(`${name}.ipynb`, enc(nb));
    assert.equal(read?.id, 'notebook', name);
    assert.match(read!.html, /data-marxy-lang="python"/, name);
  }
});

test('a fence language that is a prototype name has no grammar and is not a data part', async () => {
  for (const name of NAMES) {
    assert.equal(await highlight('const x = 1', name), null, name);
    assert.equal(await grammarTokens(['x'], name), null, name);
    assert.equal(hasGrammarRuns(name), false, name);
    const md = `# t\n\n\`\`\`${name}\n{"a":1}\n\`\`\`\n`;
    const bytes = enc(md);
    const parts = partsOf(parseMarkdown(bytes), bytes);
    assert.notEqual(parts[0]?.guess, 'data', name);
  }
});

test('an HTML element named for a prototype member is not on the allow-list, as no unknown element is', () => {
  const unknown = sanitizeHtml('<p>a <notatag dir="rtl">kept</notatag> b</p>').html;
  for (const name of ['constructor', 'tostring', 'valueof', 'hasownproperty']) {
    const html = sanitizeHtml(`<p>a <${name} dir="rtl">kept</${name}> b</p>`).html;
    assert.equal(html, unknown.replaceAll('notatag', name), name);
    assert.doesNotMatch(html, new RegExp(`<${name}`), name);
    assert.doesNotMatch(renderSafeHtml(`<${name} lang="en">hi</${name}>\n\npara <${name}>inline</${name}>`).html, new RegExp(`<${name}`), name);
    assert.doesNotMatch(cleanOutputHtml(`<${name}>x</${name}>`).html, new RegExp(`<${name}`), name);
  }
});

test('an attribute named for a prototype member is refused and said, as any unknown attribute is', () => {
  const result = sanitizeHtml('<p constructor="x" __proto__="y" tostring="z">t</p>');
  assert.equal(result.html, '<p>t</p>');
  assert.deepEqual(result.removed.filter((r) => r.what === 'attribute').map((r) => r.name), ['constructor', '__proto__', 'tostring']);
  const forced = sanitizeHtml('<input type="checkbox" constructor="1" checked>');
  assert.ok(forced.removed.some((r) => r.what === 'attribute' && r.name === 'constructor'), JSON.stringify(forced.removed));
});

test('an XML entity named constructor is left as written, not a function\'s source', () => {
  const read = readingOf('a.xml', enc('<a>&constructor; &amp;</a>'));
  assert.equal(read?.id, 'tree');
  assert.match(read!.html, /&amp;constructor; &amp;/);
  assert.doesNotMatch(read!.html, /native code/);
});

test('a log level word that is a prototype name has no rank', () => {
  for (const name of NAMES) assert.equal(logRankOf(name), undefined, name);
  assert.notEqual(logRankOf('error'), undefined);
});
