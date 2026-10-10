// collection.toml: parse, deny rules, and the byte-faithful append (C-03).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLLECTION_TEMPLATE, appendQuery, appendRoot, denyRulesFor, isIgnored, parseCollection } from './index.ts';

const home = '/Users/ian';
const ctx = { home };
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);

const EXAMPLE = `# Folders Marxy searches. Edit freely; Marxy re-reads this file when it changes.

[[root]]
path  = "~/.claude/plans"
name  = "Claude plans"      # optional; shown dim beside results
watch = true                # default true; false = rescan on launch only

[[root]]
path = "~/Dev/marxy/docs"

[deny]
globs = ["**/drafts/**", "**/*.generated.md"]    # added to the built-in deny list
`;

test('the 06 section 4.2 example parses to two roots, watch flags and deny globs', () => {
  const r = parseCollection(enc(EXAMPLE), ctx);
  assert.deepEqual(r.collection.roots, [
    { path: '/Users/ian/.claude/plans', name: 'Claude plans', watch: true },
    { path: '/Users/ian/Dev/marxy/docs', watch: true },
  ]);
  assert.deepEqual(r.collection.denyGlobs, ['**/drafts/**', '**/*.generated.md']);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.unknownKeys, []);
});

test('watch = false is kept; a non-boolean warns and defaults to true', () => {
  const r = parseCollection(enc('[[root]]\npath = "/a"\nwatch = false\n[[root]]\npath = "/b"\nwatch = "no"\n'), ctx);
  assert.deepEqual(
    r.collection.roots.map((x) => x.watch),
    [false, true],
  );
  assert.equal(r.warnings.length, 1);
});

test('~ and ~/ expand against ctx.home; a trailing slash is normalised', () => {
  const r = parseCollection(enc('[[root]]\npath = "~"\n[[root]]\npath = "~/x/"\n'), { home: '/h/' });
  assert.deepEqual(
    r.collection.roots.map((x) => x.path),
    ['/h', '/h/x'],
  );
});

test('relative and URL paths warn and are skipped', () => {
  const r = parseCollection(
    enc('[[root]]\npath = "docs"\n[[root]]\npath = "https://example.com/x"\n[[root]]\npath = "/ok"\n'),
    ctx,
  );
  assert.deepEqual(
    r.collection.roots.map((x) => x.path),
    ['/ok'],
  );
  assert.equal(r.warnings.length, 2);
});

test('duplicate roots fold after normalisation, with a warning', () => {
  const r = parseCollection(enc('[[root]]\npath = "~/a"\n[[root]]\npath = "/Users/ian/a/"\n'), ctx);
  assert.equal(r.collection.roots.length, 1);
  assert.equal(r.warnings.length, 1);
});

test('more than 32 roots warn and the rest are dropped', () => {
  const text = Array.from({ length: 40 }, (_, i) => `[[root]]\npath = "/r${i}"\n`).join('');
  const r = parseCollection(enc(text), ctx);
  assert.equal(r.collection.roots.length, 32);
  assert.equal(r.warnings.length, 8);
});

test('a malformed file gives an empty collection and exactly one warning', () => {
  const r = parseCollection(enc('[[root\npath = = \n'), ctx);
  assert.deepEqual(r.collection, { roots: [], denyGlobs: [], queries: [], captures: [] });
  assert.deepEqual(r.warnings, ['collection.toml could not be parsed; no extra folders']);
});

test('an empty file is an empty collection with no warning', () => {
  const r = parseCollection(enc(''), ctx);
  assert.deepEqual(r.collection, { roots: [], denyGlobs: [], queries: [], captures: [] });
  assert.deepEqual(r.warnings, []);
});

test('unknown keys are listed once', () => {
  const r = parseCollection(
    enc('color = 1\n[[root]]\npath = "/a"\nflavour = 1\n[[root]]\npath = "/b"\nflavour = 2\n[deny]\nx = 1\n'),
    ctx,
  );
  assert.deepEqual([...r.unknownKeys].sort(), ['color', 'deny.x', 'root.flavour']);
});

test('a BOM at the start does not break parsing', () => {
  const r = parseCollection(enc('﻿[[root]]\npath = "/a"\n'), ctx);
  assert.equal(r.collection.roots.length, 1);
});

test('denyRulesFor ignores a/drafts/x.md and not a/draft.md; !node_modules does not un-deny', () => {
  const rules = denyRulesFor(['**/drafts/**']);
  assert.equal(isIgnored('a/drafts/x.md', false, rules), true);
  assert.equal(isIgnored('a/draft.md', false, rules), false);
  const neg = denyRulesFor(['!node_modules']);
  assert.equal(isIgnored('node_modules/x.md', false, neg), true);
});

test('appendRoot on empty input writes the template then the table', () => {
  const out = dec(appendRoot(new Uint8Array(), '/a/b', ctx));
  assert.equal(out, `${COLLECTION_TEMPLATE}[[root]]\npath = '/a/b'\n`);
  assert.deepEqual(parseCollection(enc(out), ctx).collection.roots, [{ path: '/a/b', watch: true }]);
});

test('appendRoot writes ~/ for a path under home, and quotes safely', () => {
  assert.match(dec(appendRoot(enc('x = 1\n'), '/Users/ian/Notes', ctx)), /path = '~\/Notes'\n$/);
  assert.match(dec(appendRoot(enc('x = 1\n'), "/Users/it's", { home: '/nope' })), /path = "\/Users\/it's"\n$/);
  assert.match(dec(appendRoot(enc('x = 1\n'), '/a"b/c\'', ctx)), /path = "\/a\\"b\/c'"\n$/);
  const tricky = '/a/it\'s "q" x';
  const out = appendRoot(enc(''), tricky, ctx);
  assert.equal(parseCollection(out, ctx).collection.roots[0]?.path, tricky);
});

test('a backslash is a file-name character on POSIX paths; a Windows drive path is normalised', () => {
  const r = parseCollection(enc("[[root]]\npath = '/Users/ian/a\\b'\n[[root]]\npath = 'C:\\Notes\\x'\n[[root]]\npath = '~/n\\m'\n"), ctx);
  assert.deepEqual(
    r.collection.roots.map((x) => x.path),
    ['/Users/ian/a\\b', 'C:/Notes/x', `${ctx.home}/n\\m`],
  );
  assert.deepEqual(r.warnings, []);
  // `~\x` on a POSIX home is a relative name, not a home path.
  assert.equal(parseCollection(enc("[[root]]\npath = '~\\x'\n"), ctx).collection.roots.length, 0);
  const win = parseCollection(enc("[[root]]\npath = '~\\x'\n"), { home: 'C:\\Users\\ian' });
  assert.deepEqual(win.collection.roots.map((x) => x.path), ['C:/Users/ian/x']);
});

test('appendRoot keeps a backslash name on POSIX and round-trips it', () => {
  const out = appendRoot(enc(''), '/Users/ian/a\\b', ctx);
  assert.equal(parseCollection(out, ctx).collection.roots[0]?.path, '/Users/ian/a\\b');
  assert.throws(() => appendRoot(enc(''), '~\\x', ctx), RangeError);
});

test('appendRoot throws on an inline root array, an unclosed string, and an already-broken file', () => {
  assert.throws(() => appendRoot(enc('root = [{path="/a"}]\n'), '/b', ctx), /not a list of \[\[root\]\] tables/);
  assert.throws(() => appendRoot(enc('x = \"\"\"abc\n'), '/b', ctx), Error);
  assert.throws(() => appendRoot(enc('[[root\npath = = \n'), '/b', ctx), /cannot be read as TOML/);
});

test('control characters in a path are escaped and survive a round trip', () => {
  const p = '/a/tab\there';
  const out = appendRoot(enc(''), p, ctx);
  assert.match(dec(out), /path = "\/a\/tab\\u0009here"\n$/);
  assert.equal(parseCollection(out, ctx).collection.roots[0]?.path, p);
});

test('appendRoot refuses a relative path or a URL', () => {
  assert.throws(() => appendRoot(enc(''), 'docs', ctx), RangeError);
  assert.throws(() => appendRoot(enc(''), 'https://x/y', ctx), RangeError);
});

test('a folder already listed returns the input unchanged', () => {
  const input = enc(EXAMPLE);
  assert.equal(appendRoot(input, '/Users/ian/Dev/marxy/docs/', ctx), input);
});

// Byte fidelity: the output starts with the input (plus at most one line ending), only text is added.
const FIXTURES: Record<string, string> = {
  empty: '',
  lf: EXAMPLE,
  crlf: EXAMPLE.replace(/\n/g, '\r\n'),
  noFinalNewline: '[[root]]\npath = "/a"',
  noFinalNewlineCrlf: '[[root]]\r\npath = "/a"',
  comments: '# only a comment',
  commentsEol: '# only a comment\n# another   \n',
  bom: '﻿[[root]]\npath = "/a"\n',
  oddSpacing: '  [[root]]  \n\tpath\t=\t"/a"   \n\n\n\n  # trailing   \n',
  trailingSpaceNoEol: '[deny]\nglobs = []   ',
  mixedEol: '[[root]]\r\npath = "/a"\n# x\r\n',
  unicode: '# café ☕ ​\nname = "日本語"\n',
  whitespaceOnly: '  \n  ',
};

for (const [name, text] of Object.entries(FIXTURES)) {
  test(`appendRoot keeps every input byte (${name}), lists the new root last, and is idempotent`, () => {
    const input = enc(text);
    const out = appendRoot(input, '/Users/ian/new folder', ctx);
    const prefixLen = input.length === 0 ? 0 : input.length;
    assert.deepEqual(out.slice(0, prefixLen), input, 'input bytes are a prefix of the output');
    const crlf = text.includes('\r\n');
    const added = dec(out.slice(prefixLen));
    if (text !== '' && !text.endsWith('\n')) assert.ok(added.startsWith(crlf ? '\r\n' : '\n'));
    if (crlf) assert.ok(!/(^|[^\r])\n/.test(added), 'CRLF files get only CRLF additions');
    const roots = parseCollection(out, ctx).collection.roots;
    assert.equal(roots.at(-1)?.path, '/Users/ian/new folder');
    assert.deepEqual(appendRoot(out, '/Users/ian/new folder', ctx), out);
  });
}

test('appendRoot fuzz: random prefixes keep their bytes; a second append adds only its own text', () => {
  let seed = 0xc03;
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const atoms = ['\n', '\r\n', ' ', '\t', '# c', '[[root]]', 'path = "/p"', 'x = 1', '﻿', 'é', '[deny]', "'", '#'];
  for (let i = 0; i < 300; i++) {
    let text = '';
    for (let j = rand(12); j > 0; j--) text += atoms[rand(atoms.length)];
    // Only well-formed prefixes matter for the root list; fidelity must hold for any bytes.
    const input = enc(text);
    const parses = !parseCollection(input, ctx).warnings.includes('collection.toml could not be parsed; no extra folders');
    let first: Uint8Array;
    try {
      first = appendRoot(input, `/z/${i}`, ctx);
    } catch {
      continue; // throw-or-valid: nothing is returned
    }
    assert.ok(parses, `appended to an unparseable file: ${JSON.stringify(text)}`);
    assert.deepEqual(first.slice(0, input.length), input, JSON.stringify(text));
    if (first === input) continue;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lead = text === '' ? COLLECTION_TEMPLATE.replace(/\n/g, eol) : text.endsWith('\n') ? '' : eol;
    assert.equal(dec(first.slice(input.length)), `${lead}[[root]]${eol}path = '/z/${i}'${eol}`, JSON.stringify(text));
    assert.equal(parseCollection(first, ctx).collection.roots.at(-1)?.path, `/z/${i}`);
    const second = appendRoot(first, `/y/${i}`, ctx);
    assert.deepEqual(second.slice(0, first.length), first, JSON.stringify(text));
    assert.ok(second.length > first.length);
  }
});

// Saved queries (Q-01): [[query]] tables.
const QEXAMPLE = `[[root]]
path = "/a"

[[query]]
name = "Open plans"
q = "kind:report has:tasks in:~/.claude/plans"
description = "Plans with open tasks"   # optional

[[query]]
name = "Recent"
q = "modified:<7d"
`;

const warnsOf = (text: string) => parseCollection(enc(text), ctx);

test('queries parse in file order, with description optional', () => {
  const r = warnsOf(QEXAMPLE);
  assert.deepEqual(r.collection.queries, [
    { name: 'Open plans', q: 'kind:report has:tasks in:~/.claude/plans', description: 'Plans with open tasks' },
    { name: 'Recent', q: 'modified:<7d' },
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.unknownKeys, []);
});

test('a query with no name warns and is skipped', () => {
  for (const body of ['q = "x"', 'name = "  "\nq = "x"', 'name = 3\nq = "x"']) {
    const r = warnsOf(`[[query]]\n${body}\n`);
    assert.deepEqual(r.collection.queries, [], body);
    assert.equal(r.warnings.length, 1, body);
  }
});

test('a query with no q warns and is skipped', () => {
  for (const body of ['name = "a"', 'name = "a"\nq = ""', 'name = "a"\nq = "  "', 'name = "a"\nq = 1']) {
    const r = warnsOf(`[[query]]\n${body}\n`);
    assert.deepEqual(r.collection.queries, [], body);
    assert.equal(r.warnings.length, 1, body);
  }
});

test('an over-long name or q warns and is skipped; the limit itself is kept', () => {
  const long = warnsOf(`[[query]]\nname = "${'n'.repeat(81)}"\nq = "x"\n[[query]]\nname = "a"\nq = "${'q'.repeat(1001)}"\n`);
  assert.deepEqual(long.collection.queries, []);
  assert.equal(long.warnings.length, 2);
  const ok = warnsOf(`[[query]]\nname = "${'n'.repeat(80)}"\nq = "${'q'.repeat(1000)}"\n`);
  assert.equal(ok.collection.queries.length, 1);
  assert.deepEqual(ok.warnings, []);
});

test('a duplicate name (case-insensitive) is dropped with a warning naming it', () => {
  const r = warnsOf('[[query]]\nname = "Plans"\nq = "a"\n[[query]]\nname = "plans "\nq = "b"\n');
  assert.deepEqual(r.collection.queries, [{ name: 'Plans', q: 'a' }]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0] ?? '', /plans /);
});

test('a query that is not an array of tables warns and yields no query', () => {
  const a = warnsOf('query = 3\n');
  assert.deepEqual(a.collection.queries, []);
  assert.equal(a.warnings.length, 1);
  const b = warnsOf('query = ["x", {name = "a", q = "b"}]\n');
  assert.deepEqual(b.collection.queries, [{ name: 'a', q: 'b' }]);
  assert.equal(b.warnings.length, 1);
  const c = warnsOf('[query]\nname = "a"\nq = "b"\n');
  assert.deepEqual(c.collection.queries, []);
  assert.equal(c.warnings.length, 1);
});

test('more than 200 queries warn and the rest are dropped', () => {
  const text = Array.from({ length: 205 }, (_, i) => `[[query]]\nname = "n${i}"\nq = "x"\n`).join('');
  const r = warnsOf(text);
  assert.equal(r.collection.queries.length, 200);
  assert.equal(r.warnings.length, 5);
});

test('unknown query keys are reported, and query itself is not unknown', () => {
  const r = warnsOf('[[query]]\nname = "a"\nq = "b"\nmodel = "x"\n');
  assert.deepEqual(r.unknownKeys, ['query.model']);
  assert.deepEqual(r.collection.queries, [{ name: 'a', q: 'b' }]);
});

test('a non-string description warns and is ignored', () => {
  const r = warnsOf('[[query]]\nname = "a"\nq = "b"\ndescription = 3\n');
  assert.deepEqual(r.collection.queries, [{ name: 'a', q: 'b' }]);
  assert.equal(r.warnings.length, 1);
});

test('a file with only [[root]] and [deny] has no queries and no new warnings', () => {
  const r = parseCollection(enc(EXAMPLE), ctx);
  assert.deepEqual(r.collection.queries, []);
  assert.deepEqual(r.warnings, []);
});

const QUERY = { name: 'Open plans', q: 'kind:report has:tasks', description: 'With tasks' };

test('appendQuery on empty input writes the template then the table', () => {
  const out = dec(appendQuery(new Uint8Array(), { name: 'A', q: 'b' }, ctx));
  assert.equal(out, `${COLLECTION_TEMPLATE}[[query]]\nname = 'A'\nq = 'b'\n`);
});

test('appendQuery round-trips quotes, backslashes, control characters and non-ASCII exactly', () => {
  const tricky = {
    name: 'it\'s "q" \\ back\ttab \u0001 café 日本語 ☕',
    q: 'text:"a \\ b" \'c\' \n line2 \u007f ✓',
    description: 'd\\"\'\r\n é',
  };
  const out = appendQuery(enc('x = 1\n'), tricky, ctx);
  assert.deepEqual(parseCollection(out, ctx).collection.queries, [tricky]);
  const plain = appendQuery(enc(''), { name: 'a\\b', q: 'c' }, ctx);
  assert.equal(parseCollection(plain, ctx).collection.queries[0]?.name, 'a\\b');
});

test('appendQuery refuses a duplicate name (case-insensitive), a blank or over-long field, and a broken file', () => {
  const base = appendQuery(enc(''), QUERY, ctx);
  assert.throws(() => appendQuery(base, { name: 'OPEN PLANS', q: 'z' }, ctx), /already exists/);
  assert.throws(() => appendQuery(enc(''), { name: ' ', q: 'z' }, ctx), RangeError);
  assert.throws(() => appendQuery(enc(''), { name: 'a', q: '' }, ctx), RangeError);
  assert.throws(() => appendQuery(enc(''), { name: 'n'.repeat(81), q: 'z' }, ctx), RangeError);
  assert.throws(() => appendQuery(enc(''), { name: 'a', q: 'q'.repeat(1001) }, ctx), RangeError);
  assert.throws(() => appendQuery(enc('[[query\n= =\n'), QUERY, ctx), /cannot be read as TOML/);
  assert.throws(() => appendQuery(enc('query = 3\n'), QUERY, ctx), /edit it by hand/);
  assert.throws(() => appendQuery(enc('query = [{name="a", q="b"}]\n'), QUERY, ctx), /not a list of \[\[query\]\] tables/);
});

for (const [name, text] of Object.entries(FIXTURES)) {
  test(`appendQuery keeps every input byte (${name}) and the query parses back equal`, () => {
    const input = enc(text);
    const out = appendQuery(input, QUERY, ctx);
    assert.deepEqual(out.slice(0, input.length), input, 'input bytes are a prefix of the output');
    const crlf = text.includes('\r\n');
    const added = dec(out.slice(input.length));
    if (text !== '' && !text.endsWith('\n')) assert.ok(added.startsWith(crlf ? '\r\n' : '\n'));
    if (crlf) assert.ok(!/(^|[^\r])\n/.test(added), 'CRLF files get only CRLF additions');
    assert.deepEqual(parseCollection(out, ctx).collection.queries.at(-1), QUERY);
    const second = appendQuery(out, { name: 'Second', q: 'x' }, ctx);
    assert.deepEqual(second.slice(0, out.length), out);
  });
}

test('appendQuery after appendRoot keeps both, and a roots-only file is untouched in its roots', () => {
  const withRoot = appendRoot(enc(EXAMPLE), '/z', ctx);
  const out = appendQuery(withRoot, QUERY, ctx);
  const r = parseCollection(out, ctx);
  assert.equal(r.collection.roots.at(-1)?.path, '/z');
  assert.deepEqual(r.collection.queries, [QUERY]);
  assert.deepEqual(r.collection.roots, parseCollection(withRoot, ctx).collection.roots);
});

test('a file with roots and captures yields both; one without captures has none (P-02)', () => {
  const r = parseCollection(
    enc('[[root]]\npath = "~/notes"\n\n[[capture]]\nfrom = "~/.claude/plans/*.md"\nto = "~/Notes/plans"\n'),
    ctx,
  );
  assert.deepEqual(r.collection.roots, [{ path: '/Users/ian/notes', watch: true }]);
  assert.deepEqual(r.collection.captures, [
    { from: '/Users/ian/.claude/plans/*.md', to: '/Users/ian/Notes/plans', fromBase: '/Users/ian/.claude/plans' },
  ]);
  assert.deepEqual([r.warnings, r.unknownKeys], [[], []]);
  assert.deepEqual(parseCollection(enc('[[root]]\npath = "/a"\n'), ctx).collection.captures, []);
});
