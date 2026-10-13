// Front matter renders as a quiet key/value head with provenance and copy fidelity (MARXY-234).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { FRONTMATTER_HEAD_MAX_ROWS, frontmatterRows, headRows, outerQuotes, webUrlParts } from './frontmatter.ts';
import { renderSafeHtml } from './pipeline.ts';

const decode = (bytes: Uint8Array, start: number, end: number): string =>
  new TextDecoder().decode(bytes.slice(start, end));

test('YAML front matter lists every key, truncates at twelve rows, and carries provenance', () => {
  const keys = Array.from({ length: 15 }, (_, i) => `key${i + 1}: v${i + 1}`).join('\n');
  const source = `---\n${keys}\n---\n\n# Title\n`;
  const bytes = new TextEncoder().encode(source);
  const document = parseMarkdown(bytes, { file: 'skill.md' });
  const matter = document.children.find((child) => child.type === 'frontmatter');
  assert.ok(matter);
  assert.equal(frontmatterRows(matter.value).length, 15);
  const { html } = renderSafeHtml(bytes, { file: 'skill.md' });
  assert.match(html, /<dl data-marxy-s="/);
  assert.equal([...html.matchAll(/<dt data-marxy-fm-key="key[0-9]+">/g)].length, FRONTMATTER_HEAD_MAX_ROWS);
  assert.match(html, /<dd>3 more<\/dd>/);
  const range = html.match(/<dl data-marxy-s="([0-9]+)" data-marxy-e="([0-9]+)"/);
  assert.ok(range);
  assert.equal(decode(bytes, Number(range[1]), Number(range[2])), source.slice(0, source.indexOf('\n\n# Title')));
});

test('TOML front matter uses the same head shape', () => {
  const source = '+++\ntitle = "Skill"\nlicense = "MIT"\n+++\n\nBody\n';
  const bytes = new TextEncoder().encode(source);
  const { html } = renderSafeHtml(bytes, { file: 'skill.toml.md' });
  assert.match(html, /<dt data-marxy-fm-key="title">title<\/dt>/);
  assert.match(html, /<dd data-marxy-fm-key="title">"Skill"<\/dd>/);
  assert.match(html, /<dt data-marxy-fm-key="license">license<\/dt>/);
  const matter = parseMarkdown(bytes, { file: 'skill.toml.md' }).children.find((c) => c.type === 'frontmatter');
  assert.ok(matter);
  const range = html.match(/data-marxy-s="([0-9]+)" data-marxy-e="([0-9]+)"/);
  assert.ok(range);
  assert.equal(decode(bytes, Number(range[1]), Number(range[2])), source.slice(0, source.indexOf('\n\nBody')));
});

test('corpus skill fixture: description is visible and overflow counts three keys', () => {
  const file = new URL('../../../../fixtures/corpus/26-skill-front-matter.md', import.meta.url);
  const bytes = readFileSync(file);
  const { html } = renderSafeHtml(bytes, { file: '26-skill-front-matter.md' });
  assert.match(html, /<dd>/);
  assert.ok(html.includes('a'.repeat(64)));
  assert.match(html, /3 more/);
});

const head = (md: string): string => renderSafeHtml(md, { file: 't.md' }).html;

test('CRLF front matter lists every row', () => {
  const html = head('---\r\ntitle: a\r\nb: c\r\n---\r\nhi');
  assert.match(html, /<dt data-marxy-fm-key="title">title<\/dt>/);
  assert.match(html, /<dt data-marxy-fm-key="b">b<\/dt>/);
});

test('non-ASCII, quoted and spaced keys are listed', () => {
  const rows = frontmatterRows('título: a\n"quoted": y\nmy key: z\nurl: http://x.y/z\n');
  assert.deepEqual(
    rows.map((r) => r.key),
    ['título', 'quoted', 'my key', 'url'],
  );
  assert.deepEqual(rows[3]!.lines, ['http://x.y/z']);
});

test('unindented YAML list items belong to the previous key', () => {
  const rows = frontmatterRows('tags:\n- a\n- b\nnext: 1\n');
  assert.deepEqual(rows[0], { key: 'tags', lines: ['- a', '- b'] });
  assert.equal(rows.length, 2);
});

test('TOML listing stops at the first table header', () => {
  const rows = frontmatterRows('title = "x"\n[section]\nhidden = 1\n');
  assert.deepEqual(
    rows.map((r) => r.key),
    ['title'],
  );
});

test('the overflow line sits in a valid dt/dd group and stays escaped', () => {
  const keys = Array.from({ length: 13 }, (_, i) => `k${i}: <b>${i}`).join('\n');
  const html = head(`---\n${keys}\n---\n`);
  assert.match(html, /<dt>…<\/dt>\n<dd>1 more<\/dd>/);
  assert.doesNotMatch(html, /<b>/);
});

test('a TOML value holding ": " stays one row with its whole value (MARXY-337)', () => {
  assert.deepEqual(frontmatterRows('title = "Foo: Bar"\nauthor = "x"').map(r => [r.key, r.lines]), [
    ['title', ['"Foo: Bar"']],
    ['author', ['"x"']],
  ]);
  const html = renderSafeHtml('+++\ntitle = "Foo: Bar"\n+++\n# H', { file: 't.md' }).html;
  assert.match(html, /<dt data-marxy-fm-key="title">title<\/dt>/);
});

test('a TOML multi-line array is not cut at a column-0 bracket line (MARXY-337)', () => {
  assert.deepEqual(frontmatterRows('m = [\n[1,2]\n]\nz = 1').map(r => r.key), ['m', 'z']);
  assert.deepEqual(frontmatterRows('m = ["]"]\n[t]\nz = 1').map(r => r.key), ['m']);
});

// K-20: an article's byline and dek. The renderer marks them in every kind, in the bytes' order; only the article
// profile styles them, and only the app makes the source a link, in an article (render/byline-link.ts).
const keysOf = (html: string): string[] => [...html.matchAll(/<dt data-marxy-fm-key="([^"]*)"/g)].map((m) => m[1]!);
const sourceOf = (html: string): string => /<dd data-marxy-fm-key="source"[^>]*>(.*?)<\/dd>/.exec(html)?.[1] ?? '';

test('corpus 33: every row names its key, in the bytes\' order, and the byline\'s rows are marked (K-20)', () => {
  const file = new URL('../../../../fixtures/corpus/33-article-byline.md', import.meta.url);
  const { html } = renderSafeHtml(readFileSync(file), { file: '33-article-byline.md' });
  assert.deepEqual(keysOf(html), ['title', 'description', 'tags', 'author', 'published', 'source']);
  assert.equal((html.match(/<dd data-marxy-fm-key="/g) ?? []).length, 6, 'the value of every row names its key too');
  assert.equal((html.match(/data-marxy-fm-part="byline"/g) ?? []).length, 6, 'three rows, dt and dd');
  assert.match(html, /<dd data-marxy-fm-key="description" data-marxy-fm-part="dek">Why the space/);
  assert.doesNotMatch(html, /<a /, 'the core makes no link: the app does, in an article');
});

test('a head with no author keeps the bytes\' order and marks no part (K-20)', () => {
  const html = head('---\ntitle: a\nsource: https://example.org/x\npublished: 2026\ndescription: d\n---\n');
  assert.deepEqual(keysOf(html), ['title', 'source', 'published', 'description']);
  assert.doesNotMatch(html, /data-marxy-fm-part|<a |<span/);
  assert.match(html, /<dd data-marxy-fm-key="source">https:\/\/example.org\/x<\/dd>/);
});

test('an author on more than one line is no byline (K-20)', () => {
  const rows = headRows(frontmatterRows('title: t\nauthor:\n  - A\n  - B\npublished: 1\n'));
  assert.deepEqual(rows.map((r) => [r.row.key, r.part]), [['title', null], ['author', null], ['published', null]]);
});

test('the byline marks author, published and source where they are; the first one-line dek key is the dek (K-20)', () => {
  const rows = headRows(frontmatterRows('subtitle:\n  long\n  text\ndek: d\nsource: s\ndescription: x\nauthor: a\n'));
  assert.deepEqual(rows.map((r) => [r.row.key, r.part]), [
    ['subtitle', null], ['dek', 'dek'], ['source', 'byline'], ['description', null], ['author', 'byline'],
  ]);
});

test('one pair of matching outer quotes, and only a matching pair (K-20, question 3)', () => {
  assert.deepEqual(outerQuotes('"M. Ellery"'), { open: '"', inner: 'M. Ellery', close: '"' });
  assert.deepEqual(outerQuotes("'x'"), { open: "'", inner: 'x', close: "'" });
  assert.deepEqual(outerQuotes('""a""'), { open: '"', inner: '"a"', close: '"' });
  assert.equal(outerQuotes('"a\''), null);
  assert.equal(outerQuotes('a "b"'), null);
  assert.equal(outerQuotes('"'), null);
  const html = head('---\nauthor: \'O\'\'Brien\'\n---\n');
  assert.match(html, /<span data-marxy-fm-part="quote">'<\/span>O''Brien<span data-marxy-fm-part="quote">'<\/span>/);
});

test('a web source is marked url, shortened to its host only when the host shown is the host it goes to (K-20)', () => {
  assert.deepEqual(webUrlParts('https://example.org/a?b#c'), { scheme: 'https://', host: 'example.org', path: '/a?b#c', short: true });
  const short = head('---\nauthor: a\nsource: https://example.org\n---\n');
  assert.equal(sourceOf(short), '<span data-marxy-fm-part="url"><span data-marxy-fm-part="scheme">https://</span>example.org</span>');
  // Userinfo, a backslash (the parser ends the host there), a port, a percent-escape, capitals and IDN: shown whole.
  for (const url of ['https://good.com@evil.com/x', 'https://evil.com\\.good.com/x', 'https://example.org:8080/x', 'https://exa%6Dple.org/', 'https://Example.org/', 'https://bücher.de/']) {
    const parts = webUrlParts(url);
    assert.ok(parts !== null && !parts.short, url);
    const html = head(`---\nauthor: a\nsource: ${url}\n---\n`);
    assert.doesNotMatch(sourceOf(html), /scheme|path/, `${url} is shown whole`);
    assert.match(sourceOf(html), /^<span data-marxy-fm-part="url">/, `${url} is still a web URL`);
  }
});

test('a source holding a control character or space, or not a web URL, is plain text as written (K-20)', () => {
  for (const value of ['https://example.org/\u0001x', 'https://example.org/x\u007f', 'https://example.org/?q=\u0085', 'https://example.org/a b', 'example.org/a', 'javascript:alert(1)', 'https://', 'The Quarterly']) {
    assert.equal(webUrlParts(value), null, JSON.stringify(value));
    const html = head(`---\nauthor: a\nsource: ${value}\n---\n`);
    assert.doesNotMatch(sourceOf(html), /<span|<a /, JSON.stringify(value));
  }
  const hostile = head('---\nauthor: a\nsource: "https://example.org/\\"><script>x</script>"\n---\n');
  assert.doesNotMatch(hostile, /<script/);
});

test('the byline\'s rows stay where the bytes put them, so past twelve they are counted, not shown (K-20)', () => {
  const keys = Array.from({ length: 14 }, (_, i) => `k${i}: v`).join('\n');
  const html = head(`---\n${keys}\nauthor: a\n---\n`);
  assert.deepEqual(keysOf(html), Array.from({ length: 12 }, (_, i) => `k${i}`));
  assert.match(html, /<dd>3 more<\/dd>/);
});
