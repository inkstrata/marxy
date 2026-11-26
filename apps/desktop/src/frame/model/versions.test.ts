// The Versions panel's words, without a browser: what each reason a file gets no versions says, what a listing that
// is not a list says (honestly: a damaged record, a newer Marxy's, nothing yet), sizes, and a kept copy's hour and minute.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hourMinute } from '../../versions/restore.ts';
import { failureWords, listingNote, notKeptWords, sizeWords } from './versions.ts';

test('why a file gets no versions, in words', () => {
  assert.match(notKeptWords({ kind: 'off' }), /Versions are off: config\.toml says versions = false/);
  assert.match(notKeptWords({ kind: 'large', limit: 2 * 1024 * 1024 }), /larger than 2\.0 MB, the large-file limit/);
  assert.match(notKeptWords({ kind: 'denied', rule: 'node_modules', builtIn: true }), /in a node_modules folder, which Marxy never reads into/);
  assert.match(notKeptWords({ kind: 'denied', rule: '**/drafts/**', builtIn: false }), /the \[deny\] rule \*\*\/drafts\/\*\* in collection\.toml covers it/);
  assert.match(notKeptWords({ kind: 'scratch' }), /not a file yet/);
  assert.match(notKeptWords({ kind: 'own' }), /Marxy's own files/);
});

test('a listing that is not a list says what it is, never nothing', () => {
  assert.equal(listingNote({ kind: 'ok', versions: [], saved: null }), null);
  assert.match(listingNote({ kind: 'none' })!, /No earlier versions are kept yet/);
  const damaged = listingNote({ kind: 'damaged', reason: 'it is not valid JSON' })!;
  assert.match(damaged, /could not be read: it is not valid JSON/);
  assert.match(damaged, /no new ones are kept; Clear versions of this file starts it again/);
  assert.match(listingNote({ kind: 'newer' })!, /A newer Marxy/);
  assert.match(listingNote({ kind: 'unreadable', error: new Error('permission denied') })!, /permission denied/);
  assert.match(failureWords({ path: '/r/x.md', reason: 'before save', error: new Error('No space left on device'), time: 0, count: 1, since: 0 }), /could not be kept: No space left on device\. The save went through and replaced those bytes/);
});

test("sizes in words, and a kept copy's hour and minute", () => {
  assert.deepEqual([sizeWords(1), sizeWords(312), sizeWords(4200), sizeWords(52_000), sizeWords(1_900_000)], ['1 byte', '312 bytes', '4.1 KB', '51 KB', '1.8 MB']);
  assert.equal(hourMinute(new Date(2026, 9, 13, 14, 32).getTime()), '14.32');
  assert.equal(hourMinute(new Date(2026, 9, 13, 9, 5).getTime()), '09.05');
});
