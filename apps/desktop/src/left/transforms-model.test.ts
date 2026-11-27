// Transforms as data: what each row would change, on a file or a selection's lines, every byte kept that it does not touch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdown, unifiedDiff, type Document } from '@marxy/core';
import { patchRows } from './search-model.ts';
import { changedOld, drain, effectWords, groupsFor, invisibleCounts, removeInvisible, txItem, txRowFor } from './transforms-model.ts';

const fx = (id: string, text: string, sel: { a: number; b: number } | null = null) => txItem(id)!.fx(text, sel);

const NOTES = 'Vendor notes  \r\nline two\r\n\r\nend\t \nlast';

test('trailing spaces: the lines that have them, and nothing else; CRLF and the missing final newline kept', () => {
  const e = fx('trim-trailing', NOTES);
  assert.equal(e.text, 'Vendor notes\r\nline two\r\n\r\nend\nlast');
  assert.deepEqual([e.c, e.d], [2, 0]);
  assert.equal(effectWords(e), '2 lines');
  assert.deepEqual(changedOld(NOTES, e.text), [0, 3]);
  const sel = fx('trim-trailing', NOTES, { a: 2, b: 4 });
  assert.equal(sel.text, 'Vendor notes  \r\nline two\r\n\r\nend\nlast', 'only inside the selection');
});

test('line ends all LF and a final newline each change only their bytes', () => {
  const lf = fx('eol-lf', NOTES);
  assert.equal(lf.text, NOTES.replace(/\r\n/g, '\n'));
  assert.equal(lf.c, 3);
  const nl = fx('final-newline', NOTES);
  assert.equal(nl.text, `${NOTES}\r\n`, 'the ending most of its lines have');
  assert.equal(nl.c, 1);
  assert.equal(fx('final-newline', `${NOTES}\n`).c, 0);
});

test('Markdown rows run core: renumber, align, ticks, promote; a JSON file sorts and minifies', () => {
  const md = '# Title\n\n3. a\n7. b\n\n- [ ] one\n- [x] two\n\n|a|bb|\n|-|-|\n|ccc|d|\n';
  assert.match(fx('renumber-list', md).text, /3\. a\n4\. b/);
  assert.equal(fx('renumber-list', md).c, 1);
  assert.match(fx('tick-all', md).text, /- \[x\] one\n- \[x\] two/);
  assert.match(fx('untick-all', md).text, /- \[ \] one\n- \[ \] two/);
  assert.match(fx('table-align', md).text, /\| a {3}\| bb {2}\|/);
  assert.match(fx('demote', md).text, /^## Title/);
  assert.equal(fx('sort-lines', 'b\na\n').text, 'a\nb\n');
  const json = '{"b": 1, "a": [2, 1]}\n';
  assert.equal(fx('json-sort-keys', json).text, '{\n  "a": [\n    2,\n    1\n  ],\n  "b": 1\n}\n');
  assert.equal(fx('json-minify', json).text, '{"b":1,"a":[2,1]}\n');
  assert.equal(fx('json-sort-keys', 'not json').c, 0);
});

test('the groups follow the file: Markdown for prose, JSON for JSON, Bytes always', () => {
  assert.deepEqual(groupsFor('markdown').map((g) => g.group), ['Space', 'Lines', 'Markdown', 'Bytes']);
  assert.deepEqual(groupsFor('json').map((g) => g.group), ['Space', 'Lines', 'JSON', 'Bytes']);
  assert.deepEqual(groupsFor('other').map((g) => g.group), ['Space', 'Lines', 'Bytes']);
});

test('invisible characters are counted by kind and removed one kind at a time; a byte-order mark stays', () => {
  const text = '﻿a​b c\n­d\n';
  assert.deepEqual(invisibleCounts(text, null), { zw: 1, nbsp: 1, 'soft-hyphen': 1 });
  assert.equal(removeInvisible(text, null, ['zw']).text, '﻿ab c\n­d\n');
  assert.equal(removeInvisible(text, null, ['nbsp', 'soft-hyphen']).text, '﻿a​b c\nd\n');
});

test('the Line names a transform by core id; the row that runs it here is found, or none', () => {
  assert.equal(txRowFor('sort')?.id, 'sort-lines');
  assert.equal(txRowFor('json-pretty')?.id, 'json-format');
  assert.equal(txRowFor('unwrap')?.id, 'unwrap');
  assert.equal(txRowFor('title-case'), null);
});

test('a changed line that begins -- or ++ is a changed line, not a patch header', () => {
  const sql = 'select 1;\n-- old note\n++counter;\nend\n';
  const next = 'select 1;\n-- new note\n++counter2;\nend\n';
  // A line count that changes takes the diff, not the line-by-line compare.
  assert.deepEqual(changedOld(sql, `${next}more\n`), [1, 2, 3], 'both lines, and the last, which the new one follows');
  const rows = patchRows(unifiedDiff(sql, next, { context: 1 })!.text);
  assert.deepEqual(
    rows.map((r) => `${r.sign}${r.no} ${r.text}`),
    ['-2 -- old note', '-3 ++counter;', '+2 -- new note', '+3 ++counter2;'],
  );
});

test('Sort the keys changes the order of keys only: integer keys sort too, and a file it would change more is left', () => {
  assert.equal(fx('json-sort-keys', '{"b": 1, "10": 2, "9": 3, "a": {}}\n').text, '{\n  "10": 2,\n  "9": 3,\n  "a": {},\n  "b": 1\n}\n');
  for (const json of ['{"b": 1.0, "a": 1}', '{"b": 1e2, "a": 1}', '{"b": 12345678901234567890, "a": 1}', '{"a": 1, "a": 2}', '{"b": -0, "a": 1}']) {
    assert.equal(fx('json-sort-keys', json).c, 0, json);
  }
  assert.equal(fx('json-sort-keys', '{"b": "x:1.0", "a": [1.5, -2, 3e-7]}').c, 1, 'numbers JSON writes the same, and digits in strings, sort');
});

// ---- one parse, and work in pieces -----------------------------------------------------------------------------------

/** The hunt's shape of a large page: per section a heading, a paragraph with a link, a numbered list, tasks and a table. */
const sections = (n: number): string => {
  let s = '';
  for (let h = 0; h < n; h++) s += `## Heading ${h}\n\nSome prose for section ${h}, with a [link](https://e.com/${h}).\n\n1. one\n3. two\n\n- [ ] task\n- [x] done\n\n|a|b|\n|-|-|\n|1|2|\n\n`;
  return s;
};

test('every row given the store’s parse leaves what it leaves when it parses for itself', () => {
  const text = sections(40);
  const parsed = { text, doc: parseMarkdown(new TextEncoder().encode(text)) };
  for (const g of groupsFor('markdown')) for (const it of g.items) assert.deepEqual(it.fx(text, null, parsed), it.fx(text, null), it.id);
  const sel = { a: 10, b: 60 };
  for (const g of groupsFor('markdown')) for (const it of g.items) assert.deepEqual(it.fx(text, sel, parsed), it.fx(text, sel), `${it.id} on a selection`);
});

test('a Markdown row reads the parse it is given, and parses nothing itself', () => {
  const text = '- [ ] one\n- [ ] two\n';
  const src = { file: 'x.md', start: 0, end: text.length };
  // A parse that holds the file as one code block: read from it there is no task to tick; parsed again there would be two.
  const doc = { type: 'document', src, children: [{ type: 'codeBlock', src, lang: null, meta: null, value: text }] } as unknown as Document;
  assert.equal(fx('tick-all', text).c, 2);
  assert.equal(txItem('tick-all')!.fx(text, null, { text, doc }).c, 0);
});

test('on a large page every row comes in many short pieces, and the pieces add up to the row', () => {
  const text = sections(1200);
  const parsed = { text, doc: parseMarkdown(new TextEncoder().encode(text)) };
  for (const id of ['renumber-list', 'table-align', 'tick-all', 'trim-trailing', 'invisible']) {
    const steps = txItem(id)!.steps(text, null, parsed);
    let pieces = 1;
    let r = steps.next();
    while (!r.done) {
      pieces++;
      r = steps.next();
    }
    assert.ok(pieces > 5, `${id}: ${pieces} pieces`);
    assert.deepEqual(r.value, drain(txItem(id)!.steps(text, null, parsed)), id);
  }
  assert.equal(txItem('renumber-list')!.fx(text, null, parsed).c, 1200, 'each list’s second item renumbered');
});
