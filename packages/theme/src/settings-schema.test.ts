// The Settings page's schema (W-12, ADR-0075): whole against config.ts, and its pure reads, writes and search.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KNOWN_KEYS, parseConfig, setTopLevelKey } from './config.ts';
import {
  CATEGORIES,
  SETTINGS,
  THEME_OPTIONS,
  drawnCategories,
  missingRows,
  readSettings,
  rowFor,
  searchSettings,
  writeFor,
} from './settings-schema.ts';

const enc = (t: string): Uint8Array => new TextEncoder().encode(t);

test('every key config.ts parses has exactly one schema row, and every row names a key config.ts parses', () => {
  assert.deepEqual(missingRows(), [], 'a key config.ts parses has no row');
  for (const key of KNOWN_KEYS) assert.equal(SETTINGS.filter((r) => r.key === key).length, 1, `${key} has exactly one row`);
  for (const row of SETTINGS) assert.ok(KNOWN_KEYS.includes(row.key), `${row.key} is a key config.ts parses`);
  assert.equal(new Set(SETTINGS.map((r) => r.key)).size, SETTINGS.length);
});

test('every row sits in a category, and a category with no row is not drawn', () => {
  const ids = CATEGORIES.map((c) => c.id);
  for (const row of SETTINGS) assert.ok(ids.includes(row.category), row.key);
  const drawn = drawnCategories().map((c) => c.id);
  assert.ok(!drawn.includes('collections'), 'Collections has no key of config.toml');
  assert.deepEqual(drawn, ['general', 'appearance', 'reading', 'source', 'types', 'accessibility', 'privacy', 'advanced']);
});

test('a row\'s default is what parseConfig gives for an empty file', () => {
  const config = parseConfig(new Uint8Array()).config;
  for (const row of SETTINGS) {
    if (row.control.kind === 'table') continue;
    const v = row.read(config);
    assert.equal(v, row.default, `${row.key}: the default said in the schema is the one in force`);
  }
});

test('an empty file changes nothing; a written key is changed, and one set to its own default is not', () => {
  const none = readSettings(new Uint8Array());
  assert.ok(none.states.every((s) => !s.changed && !s.present));
  const state = (text: string, key: string) => readSettings(enc(text)).states.find((s) => s.row.key === key)!;
  assert.equal(state('show_whitespace = true\n', 'show_whitespace').changed, true);
  assert.equal(state('show_whitespace = false\n', 'show_whitespace').changed, false);
  assert.equal(state('line_numbers = false\n', 'line_numbers').changed, true, 'a per-file default: any line is a choice');
  assert.equal(state('size = 20\n', 'size').changed, false);
  assert.equal(state('size = 22\n', 'size').changed, true);
  assert.equal(state('theme = ""\n', 'theme').changed, false);
  assert.equal(state('theme = "/t/quiet"\n', 'theme').changed, true);
});

test('a line that says something the key cannot take is marked invalid, and is changed so the dot can take it out', () => {
  const s = readSettings(enc('size = "big"\nmeasure = 200\nvariant = 3\n')).states;
  for (const key of ['size', 'measure', 'variant']) {
    const st = s.find((x) => x.row.key === key)!;
    assert.equal(st.invalid, true, key);
    assert.equal(st.changed, true, key);
  }
});

test('Measure is disabled while Typeset is off, and says why', () => {
  const on = readSettings(enc('')).states.find((s) => s.row.key === 'measure')!;
  assert.equal(on.disabled, null);
  const off = readSettings(enc('typeset = false\n')).states.find((s) => s.row.key === 'measure')!;
  assert.match(off.disabled ?? '', /Needs Typeset/);
  assert.equal(rowFor('column_guide')!.coupling?.note?.includes('.editorconfig'), true);
});

test('an unparseable file reads as the defaults and says so; unknown keys are listed', () => {
  const bad = readSettings(enc('size = \n'));
  assert.equal(bad.unparseable, true);
  assert.ok(bad.states.every((s) => !s.changed));
  assert.deepEqual(readSettings(enc('colour = "red"\nsize = 21\n')).unknownKeys, ['colour']);
});

test('writeFor: a toggle writes a bare boolean, a range a rounded number inside its range, a choice a string or takes the line out', () => {
  assert.deepEqual(writeFor(rowFor('show_whitespace')!, true), { toml: 'true' });
  assert.deepEqual(writeFor(rowFor('size')!, 22), { toml: '22' });
  assert.equal(writeFor(rowFor('size')!, 80), null);
  assert.equal(writeFor(rowFor('measure')!, 10), null);
  assert.deepEqual(writeFor(rowFor('variant')!, 'light'), { toml: '"light"' });
  assert.deepEqual(writeFor(rowFor('variant')!, 'dark'), { remove: true });
  assert.deepEqual(writeFor(rowFor('line_numbers')!, 'true'), { toml: 'true' });
  assert.deepEqual(writeFor(rowFor('line_numbers')!, ''), { remove: true });
  assert.equal(writeFor(rowFor('variant')!, 'sepia'), null);
  assert.deepEqual(writeFor(rowFor('external_editor')!, '  '), { remove: true });
  assert.deepEqual(writeFor(rowFor('external_editor')!, "code --goto {file}:{line}"), { toml: "'code --goto {file}:{line}'" });
  assert.equal(writeFor(rowFor('kind')!, 'x'), null);
});

test('what writeFor writes parses back to the value chosen, for every choice of every row', () => {
  for (const row of SETTINGS) {
    const c = row.control;
    const inputs: (string | boolean | number)[] = c.kind === 'toggle' ? [true, false] : c.kind === 'choice' ? c.options.map((o) => o.value) : c.kind === 'range' ? [c.min, c.max] : c.kind === 'text' ? ['a "b" \\ c', 'x y'] : [];
    for (const input of inputs) {
      const w = writeFor(row, input);
      assert.ok(w, `${row.key} ${String(input)}`);
      if ('remove' in w) continue;
      const parsed = readSettings(setTopLevelKey(new Uint8Array(), row.key, w.toml));
      const st = parsed.states.find((s) => s.row.key === row.key)!;
      assert.equal(st.invalid, false, `${row.key} = ${w.toml}`);
      assert.equal(String(st.value), String(input), row.key);
    }
  }
});

test('the theme choices are the bundled themes the app lists', () => {
  assert.deepEqual(THEME_OPTIONS.map((o) => o.value), ['', 'ink', 'warm', 'fjord', 'high-contrast']);
});

test('search: a word finds a setting by its label, its words or its key; every word must match', () => {
  const names = (q: string) => searchSettings(q).map((h) => h.row.key);
  assert.deepEqual(names('whitespace'), ['show_whitespace']);
  assert.ok(names('show_whitespace').includes('show_whitespace'));
  assert.deepEqual(names('show whitespace'), ['show_whitespace']);
  assert.ok(names('font').includes('size'), 'a hidden word');
  assert.ok(names('contrast').includes('contrast'));
  assert.deepEqual(names('line length measure'), ['measure']);
  assert.deepEqual(names('zzz'), []);
  assert.deepEqual(names('   '), []);
  assert.equal(searchSettings('whitespace')[0]!.via, 'label');
  assert.equal(searchSettings('baseline grid')[0]!.via, 'description');
  assert.equal(searchSettings('editorconfig')[0]!.via, 'words');
});

test('search reaches across every category', () => {
  const cats = new Set(searchSettings('o').map((h) => h.row.category));
  assert.ok(cats.size >= 6);
});
