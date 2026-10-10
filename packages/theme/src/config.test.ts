// setTopLevelKey byte preservation (MARXY-47, docs/design/11-config-and-storage.md).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseConfig, setTopLevelKey } from './config.ts';

function outsideBytes(before: Uint8Array, after: Uint8Array, editedLineStart: number, editedLineEnd: number): boolean {
  const dec = new TextDecoder();
  const a = dec.decode(before);
  const b = dec.decode(after);
  if (a.slice(0, editedLineStart) !== b.slice(0, editedLineStart)) return false;
  if (a.slice(editedLineEnd) !== b.slice(editedLineEnd)) return false;
  return true;
}

test('appends theme before the first table with CRLF endings', () => {
  const before = new TextEncoder().encode('size = 17\r\n\r\n[linux]\r\nweight_offset = 75\r\n');
  const after = setTopLevelKey(before, 'theme', '"/t/quiet"');
  const text = new TextDecoder().decode(after);
  assert.match(text, /theme = "\/t\/quiet"/);
  assert.match(text, /size = 17\r\n/);
  assert.ok(text.indexOf('theme =') < text.indexOf('[linux]'));
  assert.match(text, /\r\n/);
});

test('replaces an existing top-level key in place', () => {
  const before = new TextEncoder().encode('theme = "/old"\nsize = 17\n');
  const after = setTopLevelKey(before, 'theme', '"/new"');
  assert.equal(new TextDecoder().decode(after), 'theme = "/new"\nsize = 17\n');
});

test('does not edit a key inside a table section', () => {
  const before = new TextEncoder().encode('[linux]\ntheme = "inside"\n');
  const after = setTopLevelKey(before, 'theme', '"/top"');
  const text = new TextDecoder().decode(after);
  assert.match(text, /\[linux\]\ntheme = "inside"/);
  assert.match(text, /^theme = "\/top"/m);
});

test('preserves bytes outside the edited line when replacing', () => {
  const before = new TextEncoder().encode('variant = dark\ntheme = "/a"\nmeasure = 68\n');
  const after = setTopLevelKey(before, 'theme', '"/b"');
  const textBefore = new TextDecoder().decode(before);
  const textAfter = new TextDecoder().decode(after);
  const lineStart = textBefore.indexOf('theme =');
  const lineEnd = textBefore.indexOf('\n', lineStart) + 1;
  assert.equal(textBefore.slice(0, lineStart), textAfter.slice(0, lineStart));
  assert.equal(textBefore.slice(lineEnd), textAfter.slice(lineEnd));
});

// 2026-09-26 review (MARXY-246).
const set = (text: string, value = '"y"') => new TextDecoder().decode(setTopLevelKey(new TextEncoder().encode(text), 'theme', value));

test('only the theme line changes: mixed endings, the final newline and leading blank lines stay', () => {
  assert.equal(set('a = 1\r\nb = 2\ntheme = "x"\n'), 'a = 1\r\nb = 2\ntheme = "y"\n');
  assert.equal(set('\ntheme = "x"\n'), '\ntheme = "y"\n');
  assert.equal(set('theme = "x"'), 'theme = "y"');
});

test('a trailing comment, a quoted key and indentation are kept', () => {
  assert.equal(set('theme = "x" # mine\n'), 'theme = "y" # mine\n');
  assert.equal(set('theme = "a#b" # mine\n'), 'theme = "y" # mine\n');
  assert.equal(set('"theme" = "x"\n'), '"theme" = "y"\n');
});

test('the spacing before a trailing comment survives an edit byte for byte (A-14.1)', () => {
  assert.equal(set('theme = "x"   # c\n'), 'theme = "y"   # c\n');
  assert.equal(set('theme = "x"\t\t# c\n'), 'theme = "y"\t\t# c\n');
  assert.equal(set('theme = "x" \t \t# c\n'), 'theme = "y" \t \t# c\n');
  assert.equal(set('theme = "x"# c\n'), 'theme = "y"# c\n');
  // A `#` inside the string is not the comment, and the real comment's spacing stays.
  assert.equal(set('theme = "a#b"   # c\n'), 'theme = "y"   # c\n');
  assert.equal(set("theme = 'a # b'\t# c\n"), 'theme = "y"\t# c\n');
  // Trailing blanks with no comment are not the value's bytes either.
  assert.equal(set('theme = "x"  \n'), 'theme = "y"  \n');
  // A multi-line array keeps the spacing before the comment on its closing line.
  assert.equal(set('theme = [\n  "o",\n]   # end\n'), 'theme = "y"   # end\n');
});

test('the spacing around `=` and the key survive an edit (A-14.1)', () => {
  assert.equal(set('theme="x"\n'), 'theme="y"\n');
  assert.equal(set('theme   =   "x"   # c\n'), 'theme   =   "y"   # c\n');
  assert.equal(set('  theme\t=\t"x"\t# c\n'), '  theme\t=\t"y"\t# c\n');
});

test('CRLF, a BOM, a missing final newline, tables, commented-out and duplicate keys behave as before (A-14.1)', () => {
  assert.equal(set('a = 1\r\ntheme = "x"  # c\r\nb = 2\r\n'), 'a = 1\r\ntheme = "y"  # c\r\nb = 2\r\n');
  const bom = new TextEncoder().encode('\ufefftheme = "x"\t# c');
  assert.equal(
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(setTopLevelKey(bom, 'theme', '"y"')),
    '\ufefftheme = "y"\t# c',
  );
  assert.equal(set('theme = "x"   # c'), 'theme = "y"   # c');
  assert.equal(set('[t]\ntheme = "x"   # c\n'), 'theme = "y"\n[t]\ntheme = "x"   # c\n');
  assert.equal(set('# theme = "x"   # c\n'), '# theme = "x"   # c\ntheme = "y"\n');
  assert.equal(set('theme = "a"   # one\ntheme = "b"  # two\n'), 'theme = "y"   # one\ntheme = "b"  # two\n');
});

test('a table header with a comment, an array of tables and a multi-line string end the top level', () => {
  assert.equal(set('size = 1\n[linux] # fonts\nweight = 1\n'), 'size = 1\ntheme = "y"\n[linux] # fonts\nweight = 1\n');
  assert.equal(set('[[x]]\ntheme = 1\n'), 'theme = "y"\n[[x]]\ntheme = 1\n');
  assert.equal(set('note = """\ntheme = 1\n"""\n'), 'note = """\ntheme = 1\n"""\ntheme = "y"\n');
});

test('a multi-line array value is replaced whole, not just its opening line', () => {
  assert.equal(
    set('name = "x"\ntheme = [\n  "old"\n]\nsize = 20\n'),
    'name = "x"\ntheme = "y"\nsize = 20\n',
  );
  // A bracket inside a quoted array element does not close the array early.
  assert.equal(
    set('theme = [\n  "a]b",\n  "c",\n]\nsize = 20\n'),
    'theme = "y"\nsize = 20\n',
  );
  // A trailing comment on the array's closing line is kept, not one on its opening line.
  assert.equal(
    set('theme = [ # start\n  "old",\n] # end\n'),
    'theme = "y" # end\n',
  );
});

test('non-finite numbers are rejected with a warning and the default is used (MARXY-337)', () => {
  const r = parseConfig(new TextEncoder().encode('size = nan\nmeasure = inf\n[linux]\nweight_offset = inf\n'));
  assert.equal(r.config.size, 20);
  assert.equal(r.config.measure, 66);
  assert.equal(r.config.linuxWeightOffset, null);
  assert.equal(r.warnings.length, 3);
  assert.equal(parseConfig(new TextEncoder().encode('linux = { weight_offset = -inf }\n')).config.linuxWeightOffset, null);
});

test('setTopLevelKey keeps a BOM and invalid UTF-8 in untouched lines byte for byte (MARXY-337)', () => {
  const input = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# '), 0xff, 0xfe, 0x0a, ...new TextEncoder().encode('theme = "x"\n# é\n')]);
  const out = setTopLevelKey(input, 'theme', '"y"');
  const expected = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# '), 0xff, 0xfe, 0x0a, ...new TextEncoder().encode('theme = "y"\n# é\n')]);
  assert.deepEqual([...out], [...expected]);
  // Appending to a BOM file keeps the BOM and the bad bytes too.
  const appended = setTopLevelKey(new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0x0a]), 'theme', '"é"');
  assert.deepEqual([...appended], [0xef, 0xbb, 0xbf, 0xff, 0x0a, ...new TextEncoder().encode('theme = "é"\n')]);
  // A first-line key behind a BOM is found, not duplicated.
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(setTopLevelKey(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('theme = "x"\n')]), 'theme', '"y"')), '﻿theme = "y"\n');
});

test('setTopLevelKey refuses when a dotted key already defines the key (MARXY-337)', () => {
  assert.throws(() => set('theme.x = 1\n'), /dotted key/);
  assert.throws(() => set('"theme".x = 1\nsize = 2\n'), /dotted key/);
  assert.equal(set('themes.x = 1\n'), 'themes.x = 1\ntheme = "y"\n');
});

test('line_numbers is true, false or undefined: absent leaves the per-path default (L-06.1)', () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  assert.equal(parseConfig(enc('')).config.lineNumbers, undefined);
  assert.equal(parseConfig(enc('size = 20\n')).config.lineNumbers, undefined);
  assert.equal(parseConfig(enc('line_numbers = true\n')).config.lineNumbers, true);
  assert.equal(parseConfig(enc('line_numbers = false\n')).config.lineNumbers, false);
});

test('a malformed line_numbers warns and falls back to the default for the file (L-06.1)', () => {
  const r = parseConfig(new TextEncoder().encode('line_numbers = "yes"\n'));
  assert.equal(r.config.lineNumbers, undefined);
  assert.deepEqual(r.warnings, ['line_numbers was invalid; using the default for the file']);
});

test('setTopLevelKey on line_numbers changes only the value bytes: comments, CRLF and spacing stay (L-06.1)', () => {
  const dec = new TextDecoder();
  const enc = (t: string) => new TextEncoder().encode(t);
  const before = '# mine\r\nvariant = "light"\r\n  line_numbers   =   false   # gutter\r\nsize = 22\r\n\r\n[linux]\r\nweight_offset = 75\r\n';
  const after = dec.decode(setTopLevelKey(enc(before), 'line_numbers', 'true'));
  assert.equal(after, before.replace('=   false', '=   true'));
  assert.equal(
    dec.decode(setTopLevelKey(enc('# top\r\nunknown = 1\r\n[linux]\r\n'), 'line_numbers', 'true')),
    '# top\r\nunknown = 1\r\nline_numbers = true\r\n[linux]\r\n',
  );
});

// ---- [[kind]] rules (K-04, ADR-0060 item 9) ----

import { readFileSync } from 'node:fs';
import { KIND_NAMES, appendKindRule, resolveKindGlob } from './config.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
const HOME = '/Users/ian';
const rules = (toml: string, ctx: { home?: string } = { home: HOME }) => parseConfig(enc(toml), ctx);

test('KIND_NAMES equals core KINDS, in order (theme cannot import core, so the list is restated)', () => {
  const src = readFileSync(new URL('../../core/src/contracts/kinds.ts', import.meta.url), 'utf8');
  const block = /KINDS = \[([^\]]*)\] as const/.exec(src)![1]!;
  assert.deepEqual([...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]), [...KIND_NAMES]);
});

test('[[kind]] rules parse in file order; ~ expands; read is optional', () => {
  const r = rules('[[kind]]\nglob = "~/.claude/projects/**/*.jsonl"\nis = "transcript"\nread = true\n\n[[kind]]\nglob = "/logs/**"\nis = "log"\n');
  assert.deepEqual(r.config.kindRules, [
    { glob: '/Users/ian/.claude/projects/**/*.jsonl', is: 'transcript', read: true },
    { glob: '/logs/**', is: 'log' },
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.unknownKeys, []);
});

test('no [[kind]] parses as before: no rules, no warning, `kind` is a known key', () => {
  const r = rules('size = 22\n');
  assert.deepEqual(r.config.kindRules, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.unknownKeys, []);
});

test('is = "nonsense" is dropped with a warning naming its index; the others stay', () => {
  const r = rules('[[kind]]\nglob = "/a/**"\nis = "log"\n[[kind]]\nglob = "/b/**"\nis = "nonsense"\n[[kind]]\nglob = "/c/**"\nis = "diff"\n');
  assert.deepEqual(r.config.kindRules.map((x) => x.glob), ['/a/**', '/c/**']);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /^kind 2 .*"nonsense".*skipped/);
});

test('each refusal warns by index and yields no rule', () => {
  const cases: Array<[string, RegExp]> = [
    ['[[kind]]\nis = "log"\n', /^kind 1 has no glob/],
    ['[[kind]]\nglob = "/a/**"\n', /^kind 1 .*not one of the kinds/],
    ['[[kind]]\nglob = "/a/**"\nis = 3\n', /^kind 1 .*not one of the kinds/],
    ['[[kind]]\nglob = 4\nis = "log"\n', /^kind 1 has no glob/],
    ['[[kind]]\nglob = "notes/*.md"\nis = "notes"\n', /^kind 1 glob "notes\/\*\.md" is not an absolute path/],
    ['[[kind]]\nglob = "~other/x"\nis = "notes"\n', /not an absolute path/],
    ['[[kind]]\nglob = "/a/../../x"\nis = "notes"\n', /climbs above/],
    ['[[kind]]\nglob = "/a/*/../x"\nis = "notes"\n', /follows a glob/],
    ['[[kind]]\nglob = "\\\\\\\\host\\\\share\\\\x"\nis = "notes"\n', /not an absolute path/],
    ['kind = ["x"]\n', /^kind 1 is not a table/],
  ];
  for (const [toml, warning] of cases) {
    const r = rules(toml);
    assert.deepEqual(r.config.kindRules, [], toml);
    assert.match(r.warnings[0] ?? '', warning, toml);
  }
  const notList = rules('kind = "x"\n');
  assert.deepEqual(notList.warnings, ['kind must be a list of [[kind]] tables; ignored']);
});

test('read that is not a boolean is ignored with a warning; the rule stays', () => {
  const r = rules('[[kind]]\nglob = "/a/**"\nis = "log"\nread = "yes"\n');
  assert.deepEqual(r.config.kindRules, [{ glob: '/a/**', is: 'log' }]);
  assert.match(r.warnings[0]!, /^kind 1 read was not true or false/);
});

test('unknown [[kind]] keys are reported, not fatal', () => {
  const r = rules('[[kind]]\nglob = "/a/**"\nis = "log"\nfoo = 1\n');
  assert.equal(r.config.kindRules.length, 1);
  assert.deepEqual(r.unknownKeys, ['kind.foo']);
  assert.deepEqual(r.warnings, []);
});

test('a ~ glob with no home is skipped with a warning, not guessed', () => {
  const r = rules('[[kind]]\nglob = "~/x/**"\nis = "log"\n', {});
  assert.deepEqual(r.config.kindRules, []);
  assert.match(r.warnings[0]!, /not an absolute path/);
});

test('a glob is resolved lexically and composed, as P-02 resolves a path: ., .., //, NFC', () => {
  assert.equal(resolveKindGlob('/a//b/./c/../d/**', HOME), '/a/b/d/**');
  assert.equal(resolveKindGlob('~/x/../y/*.md', HOME), '/Users/ian/y/*.md');
  assert.equal(resolveKindGlob('~', HOME), '/Users/ian');
  assert.equal(resolveKindGlob('/n/cafe\u0301/**', HOME), '/n/caf\u00e9/**');
  assert.equal(resolveKindGlob('**/*.jsonl', HOME), '**/*.jsonl');
  assert.equal(resolveKindGlob('**/./x/*.log', HOME), '**/x/*.log');
  assert.equal(resolveKindGlob('C:\\Users\\ian\\**', HOME), 'C:/Users/ian/**');
  assert.equal(resolveKindGlob('/..', HOME), null);
  assert.equal(resolveKindGlob('**/..', HOME), null);
  assert.equal(resolveKindGlob('relative/x', HOME), null);
});

test('more than the cap warns and drops', () => {
  const many = Array.from({ length: 201 }, (_, i) => `[[kind]]\nglob = "/g${i}/**"\nis = "log"\n`).join('');
  const r = rules(many);
  assert.equal(r.config.kindRules.length, 200);
  assert.match(r.warnings.at(-1)!, /more than 200 kind rules/);
});

// appendKindRule: every input byte survives as a prefix.
const RULE = { glob: '~/.claude/projects/**', is: 'transcript' } as const;
const FIXTURES: Array<[string, Uint8Array]> = [
  ['empty', enc('')],
  ['LF', enc('size = 21\n')],
  ['CRLF', enc('size = 21\r\ntheme = "x"\r\n')],
  ['no trailing newline', enc('size = 21')],
  ['no trailing newline, CRLF file', enc('size = 21\r\nmeasure = 60')],
  ['comments only', enc('# a comment\n# another\n')],
  ['comment without newline', enc('# a comment')],
  ['trailing blank line', enc('size = 21\n\n')],
  ['BOM', new Uint8Array([0xef, 0xbb, 0xbf, ...enc('size = 21\n')])],
  ['BOM only', new Uint8Array([0xef, 0xbb, 0xbf])],
  ['invalid UTF-8 in a comment', new Uint8Array([...enc('# '), 0xff, 0xfe, 0x0a, ...enc('size = 21\n')])],
  ['existing [[kind]] with comments (CRLF)', enc('# mine\r\n[[kind]]\r\nglob = "/a/**" # why\r\nis = "log"\r\n# end\r\n')],
  ['existing [[kind]] no trailing newline', enc('[[kind]]\nglob = "/a/**"\nis = "log"')],
  ['a table first', enc('size = 1\n\n[linux]\nweight_offset = 75\n')],
  ['mixed endings', enc('a = 1\r\nb = 2\nc = 3\r')],
  ['non-ASCII', enc('# café\ntheme = "日本"\n')],
];

for (const [name, input] of FIXTURES) {
  test(`appendKindRule keeps every input byte (${name}) and parses back`, () => {
    const out = appendKindRule(input, RULE, { home: HOME });
    assert.ok(out.length > input.length);
    assert.deepEqual([...out.subarray(0, input.length)], [...input]);
    const parsed = parseConfig(out, { home: HOME });
    assert.equal(parsed.config.kindRules.at(-1)?.is, 'transcript');
    assert.equal(parsed.config.kindRules.at(-1)?.glob, '/Users/ian/.claude/projects/**');
    assert.deepEqual(parsed.warnings, parseConfig(input, { home: HOME }).warnings);
    // The appended span uses the file's own line ending.
    const added = dec(out.subarray(input.length));
    if (dec(input).includes('\r\n')) assert.doesNotMatch(added.replace(/\r\n/g, ''), /[\r\n]/);
    else assert.doesNotMatch(added, /\r/);
  });
}

test('appendKindRule to an existing [[kind]]: earlier rules and bytes unchanged, new rule last, first match order kept', () => {
  const input = enc('# mine\r\n[[kind]]\r\nglob = "/a/**" # why\r\nis = "log"\r\n');
  const out = appendKindRule(input, { glob: '/b/**', is: 'diff', read: false }, { home: HOME });
  assert.equal(dec(out), `${dec(input)}\r\n[[kind]]\r\nglob = '/b/**'\r\nis = 'diff'\r\nread = false\r\n`);
  assert.deepEqual(parseConfig(out, { home: HOME }).config.kindRules.map((r) => r.glob), ['/a/**', '/b/**']);
});

test('appendKindRule on an empty file writes the template first, with the file ending', () => {
  const out = dec(appendKindRule(enc(''), RULE, { home: HOME }));
  assert.match(out, /^# Marxy configuration/);
  assert.match(out, /\[\[kind\]\]\nglob = '~\/\.claude\/projects\/\*\*'\nis = 'transcript'\n$/);
});

test('appendKindRule: the same rule again returns the input unchanged; another kind for a glob already ruled throws', () => {
  const once = appendKindRule(enc('size = 20\n'), RULE, { home: HOME });
  assert.equal(appendKindRule(once, RULE, { home: HOME }), once);
  // Spelled with the expanded home, or another case: the same rule.
  assert.equal(appendKindRule(once, { glob: '/users/ian/.claude/projects/**', is: 'transcript' }, { home: HOME }), once);
  assert.throws(() => appendKindRule(once, { ...RULE, is: 'log' }, { home: HOME }), /already says transcript/);
});

test('appendKindRule refuses an unreadable file, a non-list kind, an invalid rule; the bytes are not touched', () => {
  assert.throws(() => appendKindRule(enc('size = = 1\n'), RULE, { home: HOME }), /cannot be read as TOML/);
  assert.throws(() => appendKindRule(enc('kind = "x"\n'), RULE, { home: HOME }), /not a list of \[\[kind\]\] tables/);
  assert.throws(() => appendKindRule(enc(''), { glob: '/a/**', is: 'nonsense' }, { home: HOME }), /not one of the kinds/);
  assert.throws(() => appendKindRule(enc(''), { glob: 'relative', is: 'log' }, { home: HOME }), /not a usable kind glob/);
  assert.throws(() => appendKindRule(enc(''), { glob: '/a/../../b', is: 'log' }, { home: HOME }), /not a usable kind glob/);
});

test('appendKindRule writes globs with quotes and control characters so they read back equal', () => {
  const glob = "/it's/a\ttab/**";
  const out = appendKindRule(enc(''), { glob, is: 'log' }, { home: HOME });
  assert.equal(parseConfig(out, { home: HOME }).config.kindRules[0]!.glob, glob);
});

// A property test: random config prefixes (generated from a seeded generator, so a failure replays) of the
// shapes the fixtures name, crossed with random rules; every byte outside the appended span is unchanged.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('property: for random configs and rules, the input is an exact prefix of the output (500 cases)', () => {
  const rnd = lcg(0x4b04);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const pieces = ['size = 21', 'theme = "x"', '# comment é', '', '[linux]', 'weight_offset = 75', '[[kind]]', 'glob = "/z/**"', 'is = "log"', '  ', '# "quoted" # hash', 'resident = true'];
  const kinds = [...KIND_NAMES];
  let appended = 0;
  for (let n = 0; n < 500; n++) {
    const eol = pick(['\n', '\r\n', '\r']);
    // Build a valid-ish document: scalar keys, then optional tables; pieces that would break TOML are skipped by the parse check.
    const body = Array.from({ length: Math.floor(rnd() * 7) }, () => pick(pieces)).join(eol) + pick(['', eol, eol + eol]);
    const bom = rnd() < 0.3 ? [0xef, 0xbb, 0xbf] : [];
    const junk = rnd() < 0.15 ? [0xff] : [];
    const input = new Uint8Array([...bom, ...enc(body), ...junk]);
    const rule = {
      glob: pick(['~/a/**', '/proj/**/*.jsonl', "/it's/**", '**/*.log', '/n/cafe\u0301/**', '/x/./y//z/**']),
      is: pick(kinds),
      ...(rnd() < 0.5 ? { read: rnd() < 0.5 } : {}),
    };
    let out: Uint8Array;
    try {
      out = appendKindRule(input, rule, { home: HOME });
    } catch {
      continue; // an unreadable or conflicting file is refused whole, never half-written
    }
    appended++;
    assert.deepEqual([...out.subarray(0, input.length)], [...input], `case ${n}`);
    const rules2 = parseConfig(out, { home: HOME }).config.kindRules;
    assert.equal(rules2.at(-1)!.is, rule.is, `case ${n}`);
  }
  assert.ok(appended > 150, `only ${appended} cases appended; the generator is too hostile to test anything`);
});
