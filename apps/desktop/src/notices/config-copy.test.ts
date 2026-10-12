// U-02.1: each notice of the collection and kind commands, the layout restore and the disk-conflict choice has the kind it
// truly is, and the words of one that did not work say what is unchanged (X-21 rulings 2, 5 and 10).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLLECTION_SAYS, CONFLICT_COPY_FAILED, CONFLICT_DISCARDED, conflictCopySaved, KIND_SAYS, layoutLeftOut, said, SMART_SAYS } from './config-copy.ts';
import { NO_FOLDER_YET } from '../document/untitled.ts';
import { CONCEALED_REFUSAL, NOTHING_TO_PASTE } from '../paste/read-clipboard.ts';
import { DISK_CHANGED_CHOOSE, DISK_CHANGED_EDITS_KEPT, FILE_REMOVED_ON_DISK, fileRefusedText } from './disk.ts';
import { KIND_WORDS } from './glyphs.ts';
import type { NoticeKind } from './index.ts';

const boom = new Error('boom');

const table: ReadonlyArray<readonly [string, { kind: NoticeKind; text: string }, NoticeKind]> = [
  ['collection: no config folder (add)', COLLECTION_SAYS.noConfigAdd(), 'refused'],
  ['collection: no config folder (edit)', COLLECTION_SAYS.noConfigEdit(), 'refused'],
  ['collection: whole disk', COLLECTION_SAYS.wholeDisk(), 'refused'],
  ['collection: own folder', COLLECTION_SAYS.ownFolder(), 'refused'],
  ['collection: unreadable', COLLECTION_SAYS.readFailed(boom), 'error'],
  ['collection: unparseable', COLLECTION_SAYS.notChanged(boom), 'error'],
  ['collection: already there', COLLECTION_SAYS.already(), 'info'],
  ['collection: write failed', COLLECTION_SAYS.writeFailed(boom), 'error'],
  ['collection: added', COLLECTION_SAYS.added('a'), 'done'],
  ['collection: edit unreadable', COLLECTION_SAYS.editReadFailed(boom), 'error'],
  ['collection: create failed', COLLECTION_SAYS.createFailed(boom), 'error'],
  ['smart: no config folder', SMART_SAYS.noConfig(), 'refused'],
  ['smart: unreadable', SMART_SAYS.readFailed(boom), 'error'],
  ['smart: no name', SMART_SAYS.noName(), 'refused'],
  ['smart: no terms', SMART_SAYS.noTerms(), 'refused'],
  ['smart: duplicate name', SMART_SAYS.duplicate('Big plans'), 'refused'],
  ['smart: not TOML', SMART_SAYS.notToml(), 'refused'],
  ['smart: not saved', SMART_SAYS.notSaved(new RangeError('query has a name over 80 characters')), 'refused'],
  ['smart: file changed on disk', SMART_SAYS.stale(), 'refused'],
  ['smart: write failed', SMART_SAYS.writeFailed(boom), 'error'],
  ['smart: saved', SMART_SAYS.saved('Big plans'), 'done'],
  ['smart: no config folder (edit)', SMART_SAYS.noConfigEdit(), 'refused'],
  ['smart: edit unreadable', SMART_SAYS.editReadFailed(boom), 'error'],
  ['kind: quarantined', KIND_SAYS.quarantined(), 'error'],
  ['kind: no data folder', KIND_SAYS.noDataFolder(), 'refused'],
  ['kind: newer kinds.json', KIND_SAYS.newerKinds(), 'refused'],
  ['kind: nothing to forget', KIND_SAYS.nothingToForget(), 'refused'],
  ['kind: refused by the cap', KIND_SAYS.refusedShowAs('The cap is reached · nothing was changed'), 'refused'],
  ['kind: update failed', KIND_SAYS.updateFailed(boom), 'error'],
  ['kind: forgotten', KIND_SAYS.forgotten(), 'done'],
  ['kind: shown as', KIND_SAYS.shownAs('code'), 'done'],
  ['kind: reopen failed', KIND_SAYS.reopenFailed('/a.md', boom), 'error'],
  ['kind: no config folder', KIND_SAYS.noConfigFolder(), 'refused'],
  ['kind: config unreadable', KIND_SAYS.configReadFailed(boom), 'error'],
  ['kind: config unparseable', KIND_SAYS.configNotChanged(boom), 'error'],
  ['kind: folder already', KIND_SAYS.folderAlready('code'), 'info'],
  ['kind: config write failed', KIND_SAYS.configWriteFailed(boom), 'error'],
  ['kind: folder rule added', KIND_SAYS.folderRule('code'), 'done'],
  ['conflict: copy saved', conflictCopySaved('a (copy).md', false), 'done'],
  ['conflict: discarded', CONFLICT_DISCARDED, 'done'],
  ['conflict: copy failed', CONFLICT_COPY_FAILED('disk full.'), 'error'],
];

for (const [name, got, want] of table) {
  test(`${name} is ${want}`, () => {
    assert.equal(got.kind, want);
    assert.ok(got.text.length > 0 && got.text.length < 240, 'short');
    // Not done means the reader needs to hear what is as it was; an outcome says only what happened.
    if (want === 'refused' || want === 'error') {
      assert.match(got.text, / · /, 'the template\'s parts are joined with a middle dot');
      assert.match(got.text, /unchanged|nothing was (changed|written)|exactly as you left it|as before|kept beside|left out|still here|as it was|is shown/i, 'says what is unchanged');
    }
    // No notice claims a write that did not happen: none of the refused or failed ones says "saved", "added" or "written to".
    if (want === 'refused') assert.doesNotMatch(got.text, /\b(was|were) (saved|added|written(?! by))\b/);
  });
}

test('the layout notice names what was left out, and that the others are unchanged', () => {
  assert.match(layoutLeftOut('B.md', true), /^B\.md is no longer there · it was left out of the layout; your other documents are unchanged · /);
  assert.match(layoutLeftOut('B.md', false), /^B\.md could not be read · /);
});

test('said joins the parts that have something to say', () => {
  assert.equal(said('a', 'b', 'c'), 'a · b · c');
  assert.equal(said('a', undefined, 'c'), 'a · c');
  assert.equal(said('a'), 'a');
});

test('a copy saved over a vanished file says the text is still open; over a file still there, that it shows the disk', () => {
  assert.match(conflictCopySaved('x.md', true).text, /your text is still open here/);
  assert.match(conflictCopySaved('x.md', false).text, /now shows what is on disk/);
});

test('no notice text starts with its own kind word: the pill already says "Not done", "Done" or "Note"', () => {
  const words = new Set(Object.values(KIND_WORDS).map((w) => w.toLowerCase()));
  const texts = [
    ...table.map(([, got]) => got.text),
    NO_FOLDER_YET,
    CONCEALED_REFUSAL,
    NOTHING_TO_PASTE,
    DISK_CHANGED_CHOOSE,
    DISK_CHANGED_EDITS_KEPT,
    FILE_REMOVED_ON_DISK,
    fileRefusedText('A.md', 'is no longer a regular file'),
    layoutLeftOut('B.md', true),
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, /^(not|done|note|needs you)\b/i, text);
    assert.ok(![...words].some((w) => text.toLowerCase().startsWith(`${w}:`) || text.toLowerCase().startsWith(`${w} `)), text);
  }
});
