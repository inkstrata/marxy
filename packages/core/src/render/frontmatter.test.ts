// Front matter renders as a head with provenance: every row in the bytes' order, the byline's marked with their own bytes.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { FRONTMATTER_HEAD_MAX_ROWS, bylineDate, frontmatterRows, headRows, outerQuotes, titleFirst } from './frontmatter.ts';
import { renderSafeHtml } from './pipeline.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

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
  assert.match(html, /<dl data-marxy-fm-part="head" data-marxy-s="/);
  assert.equal([...html.matchAll(/<dt data-marxy-fm-key="key[0-9]+">/g)].length, FRONTMATTER_HEAD_MAX_ROWS);
  assert.match(html, /<dd>3 more<\/dd>/);
  const range = html.match(/<dl data-marxy-fm-part="head" data-marxy-s="([0-9]+)" data-marxy-e="([0-9]+)"/);
  assert.ok(range);
  assert.equal(decode(bytes, Number(range[1]), Number(range[2])), source.slice(0, source.indexOf('\n\n# Title')));
});

test('TOML front matter uses the same head shape', () => {
  const source = '+++\ntitle = "Skill"\nlicense = "MIT"\n+++\n\nBody\n';
  const bytes = new TextEncoder().encode(source);
  const { html } = renderSafeHtml(bytes, { file: 'skill.toml.md' });
  assert.match(html, /<dt data-marxy-fm-key="title">title<\/dt>/);
  assert.match(html, /<dd data-marxy-fm-key="title">&quot;Skill&quot;<\/dd>/);
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

test('a TOML value holding ": " stays one row with its whole value', () => {
  assert.deepEqual(frontmatterRows('title = "Foo: Bar"\nauthor = "x"').map(r => [r.key, r.lines]), [
    ['title', ['"Foo: Bar"']],
    ['author', ['"x"']],
  ]);
  const html = renderSafeHtml('+++\ntitle = "Foo: Bar"\n+++\n# H', { file: 't.md' }).html;
  assert.match(html, /<dt data-marxy-fm-key="title">title<\/dt>/);
});

test('a TOML multi-line array is not cut at a column-0 bracket line', () => {
  assert.deepEqual(frontmatterRows('m = [\n[1,2]\n]\nz = 1').map(r => r.key), ['m', 'z']);
  assert.deepEqual(frontmatterRows('m = ["]"]\n[t]\nz = 1').map(r => r.key), ['m']);
});

// The byline: the author and the first date, marked in every kind, each value carrying the range of its own bytes.
const keysOf = (html: string): string[] => [...html.matchAll(/<dt data-marxy-fm-key="([^"]*)"/g)].map((m) => m[1]!);
const ddOf = (html: string, key: string): RegExpExecArray | null =>
  new RegExp(`<dd data-marxy-fm-key="${key}" data-marxy-fm-part="byline" data-marxy-s="([0-9]+)" data-marxy-e="([0-9]+)">(.*?)</dd>`).exec(html);

test('corpus 33: every row names its key, in the bytes\' order, and the author and the date are the byline', () => {
  const file = new URL('../../../../fixtures/corpus/33-article-byline.md', import.meta.url);
  const bytes = readFileSync(file);
  const { html } = renderSafeHtml(bytes, { file: '33-article-byline.md' });
  assert.deepEqual(keysOf(html), ['title', 'description', 'tags', 'author', 'published', 'source']);
  assert.equal((html.match(/<dd data-marxy-fm-key="/g) ?? []).length, 6, 'the value of every row names its key too');
  assert.equal((html.match(/data-marxy-fm-part="byline"/g) ?? []).length, 4, 'two rows, dt and dd');
  const author = ddOf(html, 'author');
  const date = ddOf(html, 'published');
  assert.ok(author && date, html);
  assert.equal(decode(bytes, Number(author[1]), Number(author[2])), '"M. Ellery"');
  assert.equal(decode(bytes, Number(date[1]), Number(date[2])), '2026-09-12');
  assert.equal(date[3], '12 September 2026');
  assert.doesNotMatch(html, /<a /);
});

test('the title is drawn first, then the head; the head\'s own bytes are the whole front matter', () => {
  const source = '---\ntitle: T\nauthor: A\n---\n\n# T\n\nText\n';
  const { html } = renderSafeHtml(source, { file: 't.md' });
  assert.ok(html.indexOf('<h1') < html.indexOf('<dl'), html);
  assert.ok(html.indexOf('<dl') < html.indexOf('<p'), html);
  const doc = parseMarkdown(new TextEncoder().encode(source), { file: 't.md' });
  assert.equal(titleFirst(doc.children), true);
  // A title that is not a level-one heading, or no heading at all: the bytes' order.
  assert.equal(titleFirst(parseMarkdown(new TextEncoder().encode('---\na: 1\n---\n\n## T\n'), { file: 't.md' }).children), false);
  assert.ok(head('---\nauthor: A\n---\n\nText\n').indexOf('<dl') < head('---\nauthor: A\n---\n\nText\n').indexOf('<p'));
});

test('a byline value names its bytes through CRLF, quotes and characters past ASCII', () => {
  const source = '---\r\ntítulo: x\r\nauthor: \'Zoë Ó\'  \r\ndate: "2026-02-29"\r\ncreated: 2026-01-02\r\n---\r\n\r\n# H\r\n';
  const bytes = new TextEncoder().encode(source);
  const html = renderSafeHtml(bytes, { file: 't.md' }).html;
  const author = ddOf(html, 'author');
  assert.ok(author, html);
  assert.equal(decode(bytes, Number(author[1]), Number(author[2])), "'Zoë Ó'");
  assert.equal(author[3], '<span data-marxy-fm-part="quote">\'</span>Zoë Ó<span data-marxy-fm-part="quote">\'</span>');
  // Not a calendar day (2026 is no leap year): shown as written, and the first date key is the byline's still.
  const date = ddOf(html, 'date');
  assert.ok(date, html);
  assert.equal(decode(bytes, Number(date[1]), Number(date[2])), '"2026-02-29"');
  assert.match(date[3]!, /2026-02-29/);
  assert.doesNotMatch(html, /data-marxy-fm-key="created" data-marxy-fm-part/);
});

test('a head with a date and no author marks the date alone; one with neither marks nothing', () => {
  const html = head('---\ntitle: a\nsource: https://example.org/x\npublished: 2026-10-01\ndescription: d\n---\n');
  assert.deepEqual(keysOf(html), ['title', 'source', 'published', 'description']);
  assert.equal((html.match(/data-marxy-fm-part="byline"/g) ?? []).length, 2);
  assert.match(html, /<dd data-marxy-fm-key="source">https:\/\/example.org\/x<\/dd>/);
  assert.doesNotMatch(head('---\ntitle: a\ntags: [x]\n---\n'), /data-marxy-fm-part="byline"|<span/);
});

test('an author on more than one line is no byline', () => {
  const rows = headRows(frontmatterRows('title: t\nauthor:\n  - A\n  - B\npublished: 1\n'));
  assert.deepEqual(rows.map((r) => [r.row.key, r.part]), [['title', null], ['author', null], ['published', 'byline']]);
});

test('the byline is the author and a date, date before published before created, wherever they are; nothing else', () => {
  const rows = headRows(frontmatterRows('subtitle:\n  long\n  text\ncreated: c\ndek: d\nsource: s\ndate: x\nauthor: a\n'));
  assert.deepEqual(rows.map((r) => [r.row.key, r.part]), [
    ['subtitle', null], ['created', null], ['dek', null], ['source', null], ['date', 'byline'], ['author', 'byline'],
  ]);
  const later = headRows(frontmatterRows('created: c\npublished: p\n'));
  assert.deepEqual(later.map((r) => [r.row.key, r.part]), [['created', null], ['published', 'byline']]);
  // A date key of several lines, or of none, is no byline's: the next date key that has one line is.
  const long = headRows(frontmatterRows('date:\n  - a\n  - b\npublished: 2026-01-01\n'));
  assert.deepEqual(long.map((r) => [r.row.key, r.part]), [['date', null], ['published', 'byline']]);
  const nested = headRows(frontmatterRows('date:\n  day: 1\ncreated: c\n'));
  assert.deepEqual(nested.map((r) => [r.row.key, r.part]), [['date', null], ['created', 'byline']]);
  const empty = headRows(frontmatterRows('date:\npublished: 2026-01-01\n'));
  assert.deepEqual(empty.map((r) => [r.row.key, r.part]), [['date', null], ['published', 'byline']]);
  assert.match(renderSafeHtml('---\ndate:\n  - a\npublished: 2026-01-01\n---\n\n# T\n', { file: 't.md' }).html, /data-marxy-fm-key="published" data-marxy-fm-part="byline"[^>]*>1 January 2026</);
});

test('of two author keys the last of one line is the byline\'s', () => {
  const rows = headRows(frontmatterRows('author: First\ntitle: t\nauthor: Second\n'));
  assert.deepEqual(rows.map((r) => [r.row.key, r.row.lines[0], r.part]), [['author', 'First', null], ['title', 't', null], ['author', 'Second', 'byline']]);
  const listed = headRows(frontmatterRows('author: First\nauthor:\n  - A\n  - B\n'));
  assert.deepEqual(listed.map((r) => [r.row.key, r.part]), [['author', 'byline'], ['author', null]]);
});

test('a calendar day in words, and nothing else', () => {
  assert.equal(bylineDate('2026-09-14'), '14 September 2026');
  assert.equal(bylineDate('2024-02-29'), '29 February 2024');
  assert.equal(bylineDate('2000-02-29'), '29 February 2000');
  assert.equal(bylineDate('0001-01-01'), '1 January 1');
  for (const not of ['2026-02-29', '1900-02-29', '0000-01-01', '2026-13-01', '2026-00-10', '2026-04-31', '2026-9-14', '14 September 2026', '2026-09-14T10:00']) assert.equal(bylineDate(not), null, not);
});

test('one pair of matching outer quotes, and only a matching pair', () => {
  assert.deepEqual(outerQuotes('"M. Ellery"'), { open: '"', inner: 'M. Ellery', close: '"' });
  assert.deepEqual(outerQuotes("'x'"), { open: "'", inner: 'x', close: "'" });
  assert.deepEqual(outerQuotes('""a""'), { open: '"', inner: '"a"', close: '"' });
  assert.equal(outerQuotes('"a\''), null);
  assert.equal(outerQuotes('a "b"'), null);
  assert.equal(outerQuotes('"'), null);
  const html = head('---\nauthor: \'O\'\'Brien\'\n---\n');
  assert.match(html, /<span data-marxy-fm-part="quote">'<\/span>O''Brien<span data-marxy-fm-part="quote">'<\/span>/);
});

test('past twelve rows the rest are counted, and a byline row among them is still the byline', () => {
  const keys = Array.from({ length: 14 }, (_, i) => `k${i}: v`).join('\n');
  const html = head(`---\n${keys}\nauthor: a\n---\n`);
  assert.deepEqual(keysOf(html), [...Array.from({ length: 12 }, (_, i) => `k${i}`), 'author']);
  assert.match(html, /<dd>2 more<\/dd>/, 'the two not drawn, not the byline drawn after them');
  assert.match(html, /<dd data-marxy-fm-key="author" data-marxy-fm-part="byline"[^>]*>a<\/dd>/);
});

test('a front matter line of a key and 80,000 spaces or tabs reads in time', () => {
  for (const line of [`a${' '.repeat(80_000)}`, `a${'\t '.repeat(40_000)}b`, `-a${' '.repeat(80_000)}`]) {
    const t0 = cpuNow();
    assert.deepEqual(frontmatterRows(line), []);
    assert.ok(cpuNow() - t0 < 200, `${JSON.stringify(line.slice(0, 3))}: ${(cpuNow() - t0).toFixed(0)} ms`);
  }
  assert.deepEqual(frontmatterRows(`title ${' '.repeat(10_000)}: Tide tables`).map((r) => [r.key, r.lines]), [['title', ['Tide tables']]]);
});
