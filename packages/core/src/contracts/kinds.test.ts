// KINDS against ADR-0060's kind table: add or drop a kind on either side and this fails (K-01).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_KIND, KINDS } from './kinds.ts';

const RECORD = new URL('../../../../docs/adr/0060-kinds.md', import.meta.url);
const HEADING = '### The kinds';

/** The first column of the first table under `### The kinds`, backticks removed. */
function kindsInRecord(markdown: string): string[] {
  const lines = markdown.split('\n');
  const at = lines.findIndex(line => line.trim() === HEADING);
  assert.ok(at >= 0, `docs/adr/0060-kinds.md has no "${HEADING}" heading; the kind table moved, update this test`);
  let row = at + 1;
  while (row < lines.length && !lines[row].trimStart().startsWith('|')) {
    assert.ok(!lines[row].startsWith('#'), `no table between "${HEADING}" and the next heading in docs/adr/0060-kinds.md`);
    row++;
  }
  const table: string[] = [];
  while (row < lines.length && lines[row].trimStart().startsWith('|')) table.push(lines[row++]);
  assert.ok(table.length > 2, `the table under "${HEADING}" has no rows`);
  assert.equal(table[0].split('|')[1].trim(), 'Kind', `the first column under "${HEADING}" must be "Kind"`);
  return table.slice(2).map(line => line.split('|')[1].trim().replace(/^`(.*)`$/, '$1'));
}

test('ADR-0060 lists exactly KINDS, in order', () => {
  assert.deepEqual(kindsInRecord(readFileSync(RECORD, 'utf8')), [...KINDS]);
});

test('KINDS has fourteen distinct names and article is the default', () => {
  assert.equal(KINDS.length, 14);
  assert.equal(new Set(KINDS).size, KINDS.length);
  assert.equal(DEFAULT_KIND, 'article');
  assert.equal(KINDS[0], DEFAULT_KIND);
});
