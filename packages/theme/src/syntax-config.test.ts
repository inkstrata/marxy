// `[syntax]`: parsing the reader's colours by language, and the one-line writes Look makes into a table.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConfigNotReadableError, parseConfig, removeTableKey, setTableKey } from './config.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

test('[syntax] parses: both switches on by default, a language\'s colours by role, the rest warned and skipped', () => {
  assert.deepEqual(parseConfig(new Uint8Array()).config.syntax, { byLanguage: true, accent: true, langs: {} });
  const { config, warnings, unknownKeys } = parseConfig(enc('[syntax]\nby_language = false\naccent = "no"\n\n[syntax.rust]\nkeyword = "#C45A22"\nstring = "red"\nwhatever = "#fff"\n\n[syntax.python]\ntype = "#abc"\n'));
  assert.equal(config.syntax.byLanguage, false);
  assert.equal(config.syntax.accent, true);
  assert.deepEqual(config.syntax.langs, { rust: { keyword: '#c45a22' }, python: { type: '#abc' } });
  assert.equal(unknownKeys.length, 0);
  assert.ok(warnings.some((w) => w.includes('syntax.accent')));
  assert.ok(warnings.some((w) => w.includes('syntax.rust.string')));
  assert.ok(warnings.some((w) => w.includes('syntax.rust.whatever is not a role')));
});

test('setTableKey appends the table to a file without one, one line under its header', () => {
  const before = enc('size = 22\n\n[[kind]]\nglob = "/a/**"\nis = "notes"\n');
  const after = dec(setTableKey(before, ['syntax', 'rust'], 'keyword', '"#c45a22"'));
  assert.equal(after, 'size = 22\n\n[[kind]]\nglob = "/a/**"\nis = "notes"\n\n[syntax.rust]\nkeyword = "#c45a22"\n');
  assert.equal(dec(setTableKey(new Uint8Array(), ['syntax'], 'by_language', 'false')), '[syntax]\nby_language = false\n');
});

test('setTableKey replaces a key in place and adds a new one after the table\'s last, every other byte kept', () => {
  const before = enc('# mine\r\n[syntax.rust]\r\nkeyword = "#111111" # dark\r\n\r\n[syntax.go]\r\ntype = "#222222"\r\n');
  assert.equal(dec(setTableKey(before, ['syntax', 'rust'], 'keyword', '"#c45a22"')), '# mine\r\n[syntax.rust]\r\nkeyword = "#c45a22" # dark\r\n\r\n[syntax.go]\r\ntype = "#222222"\r\n');
  assert.equal(dec(setTableKey(before, ['syntax', 'rust'], 'string', '"#333333"')), '# mine\r\n[syntax.rust]\r\nkeyword = "#111111" # dark\r\nstring = "#333333"\r\n\r\n[syntax.go]\r\ntype = "#222222"\r\n');
});

test('setTableKey refuses a table written another way, and an unreadable file', () => {
  assert.throws(() => setTableKey(enc('syntax = { rust = { keyword = "#111111" } }\n'), ['syntax', 'rust'], 'string', '"#333333"'), ConfigNotReadableError);
  assert.throws(() => setTableKey(enc('[syntax]\nrust.keyword = "#111111"\n'), ['syntax', 'rust'], 'string', '"#333333"'), ConfigNotReadableError);
  assert.throws(() => setTableKey(enc('size = = 3\n'), ['syntax'], 'accent', 'false'), ConfigNotReadableError);
});

test('removeTableKey takes the one line out; an absent key is the same bytes', () => {
  const before = enc('[syntax.rust]\nkeyword = "#111111"\nstring = "#333333"\n');
  assert.equal(dec(removeTableKey(before, ['syntax', 'rust'], 'keyword')), '[syntax.rust]\nstring = "#333333"\n');
  assert.equal(removeTableKey(before, ['syntax', 'go'], 'keyword'), before);
  assert.equal(removeTableKey(before, ['syntax', 'rust'], 'type'), before);
});
