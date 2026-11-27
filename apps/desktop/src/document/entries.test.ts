// An archive's entries held in memory: let go once no pane shows them, and what was made of old bytes goes with them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryAddress, entryWhere, heldEntry, holdEntry, holdPreview, holdTile, isPreviewHeld, onEntryDropped, promotePreview, releaseEntriesNotShown, releasePreviews, releaseTiles, tilesHeld } from './entries.ts';

const dropped: string[] = [];
onEntryDropped((path) => dropped.push(path));
const bytes = (s: string) => new TextEncoder().encode(s);

test('an entry a pane showed and none shows now is let go; one never shown yet is kept for its open', () => {
  dropped.length = 0;
  const a = holdEntry({ archive: '/z/a.zip', name: 'docs/a.md', index: 0, bytes: bytes('# A\n'), mtimeMs: null });
  const b = holdEntry({ archive: '/z/a.zip', name: 'docs/b.md', index: 1, bytes: bytes('# B\n'), mtimeMs: null });
  releaseEntriesNotShown([a.path, null]);
  assert.ok(heldEntry(a.path) && heldEntry(b.path), 'b is on its way to a pane');
  releaseEntriesNotShown([b.path]);
  assert.equal(heldEntry(a.path), null, 'a was shown and no pane shows it now');
  assert.ok(heldEntry(b.path));
  releaseEntriesNotShown(['/r/README.md']);
  assert.equal(heldEntry(b.path), null);
  assert.deepEqual(dropped, [a.path, b.path]);
});

test('the same entry held again keeps its path, and what was made from its old bytes is let go', () => {
  dropped.length = 0;
  const first = holdEntry({ archive: '/z/b.zip', name: 'pic.png', index: 2, bytes: bytes('old'), mtimeMs: 1 });
  const again = holdEntry({ archive: '/z/b.zip', name: 'pic.png', index: 2, bytes: bytes('new'), mtimeMs: 2 });
  assert.equal(again.path, first.path);
  assert.deepEqual(dropped, [first.path], 'its blob URL is revoked, so the new bytes are drawn');
  assert.equal(new TextDecoder().decode(heldEntry(first.path)!.bytes), 'new');
});

test('previews have a pool of their own: six at most, the oldest let go; a tab\'s entries are never pushed out by them', () => {
  dropped.length = 0;
  const tab = holdEntry({ archive: '/z/c.zip', name: 'kept.md', index: 0, bytes: bytes('# Kept\n'), mtimeMs: null });
  const shown = Array.from({ length: 8 }, (_, i) => holdPreview({ archive: '/z/c.zip', name: `p${i}.md`, index: i + 1, bytes: bytes(`# ${i}\n`), mtimeMs: null }));
  assert.ok(heldEntry(tab.path), 'the tab keeps its entry');
  assert.deepEqual(dropped, [shown[0]!.path, shown[1]!.path], 'the two oldest previews went, and what was made of them');
  assert.equal(heldEntry(shown[0]!.path), null);
  assert.ok(isPreviewHeld(shown[7]!.path) && heldEntry(shown[7]!.path));
  releasePreviews({ archive: '/z/c.zip' });
  assert.equal(heldEntry(shown[7]!.path), null, 'the page went: its previews with it');
  assert.ok(heldEntry(tab.path));
});

test('o on a previewed entry held whole moves it to the tabs\' entries under its path; a beginning alone is not promoted', () => {
  const whole = holdPreview({ archive: '/z/d.zip', name: 'all.md', index: 0, bytes: bytes('# All\n'), mtimeMs: null });
  const part = holdPreview({ archive: '/z/d.zip', name: 'big.log', index: 1, bytes: bytes('tick\n'), mtimeMs: null, size: 20 * 1024 * 1024 });
  const promoted = promotePreview(whole.path);
  assert.equal(promoted?.path, whole.path);
  assert.equal(isPreviewHeld(whole.path), false);
  releasePreviews({ archive: '/z/d.zip' });
  assert.ok(heldEntry(whole.path), 'a tab holds it now');
  assert.equal(promotePreview(part.path), null, 'only its beginning was read');
  // Held for a tab already: the tab's path stands, and the preview's copy goes.
  const tab = holdEntry({ archive: '/z/e.zip', name: 'x.md', index: 0, bytes: bytes('x'), mtimeMs: null });
  const again = holdPreview({ archive: '/z/e.zip', name: 'x.md', index: 0, bytes: bytes('x'), mtimeMs: null });
  assert.equal(promotePreview(again.path)?.path, tab.path);
  assert.equal(heldEntry(again.path), null);
});
test('an entry read from an entry is a level deeper, joins its address, and goes with what it was read from', () => {
  const outer = holdEntry({ archive: '/z/survey.zip', name: 'backups/notes.tar.gz', index: 3, bytes: bytes('packed'), mtimeMs: null });
  const note = holdEntry({ archive: outer.path, name: 'notes/a.md', index: 0, bytes: bytes('# A\n'), mtimeMs: null });
  const look = holdPreview({ archive: outer.path, name: 'notes/b.md', index: 1, bytes: bytes('# B\n'), mtimeMs: null });
  assert.deepEqual([outer.depth, note.depth, look.depth], [1, 2, 2]);
  assert.equal(entryAddress(note.path), 'survey.zip!/backups/notes.tar.gz!/notes/a.md');
  assert.equal(entryWhere(note.path), 'survey.zip › backups/notes.tar.gz › notes/a.md');
  // Shown, the note keeps the archive it was read from, though no pane shows that.
  releaseEntriesNotShown([outer.path]);
  releaseEntriesNotShown([note.path]);
  assert.ok(heldEntry(outer.path), 'kept while an entry read from it is shown');
  releaseEntriesNotShown(['/r/README.md']);
  assert.equal(heldEntry(outer.path), null);
  assert.equal(heldEntry(note.path), null);
  assert.equal(heldEntry(look.path), null, 'its preview went with it');
  // A parent already let go: what is read under it is taken as too deep to list.
  assert.equal(holdPreview({ archive: outer.path, name: 'x.zip', index: 2, bytes: bytes('PK'), mtimeMs: null }).depth, Number.POSITIVE_INFINITY);
  releasePreviews({ archive: outer.path });
});

test('a tile read from an entry is a level deeper and goes with it', () => {
  const outer = holdEntry({ archive: '/z/sheet.zip', name: 'inner.zip', index: 0, bytes: bytes('PK'), mtimeMs: null });
  const tile = holdTile({ archive: outer.path, name: 'a.md', index: 0, bytes: bytes('# A\n'), mtimeMs: null });
  assert.equal(tile.depth, 2);
  releaseEntriesNotShown([outer.path]);
  releaseEntriesNotShown(['/r/README.md']);
  assert.equal(heldEntry(tile.path), null);
});

test('tiles have a pool of their own: a sheet scrolled through pushes out neither a tab\'s entry nor a preview', () => {
  dropped.length = 0;
  const tab = holdEntry({ archive: '/z/f.zip', name: 'kept.md', index: 0, bytes: bytes('# Kept\n'), mtimeMs: null });
  const preview = holdPreview({ archive: '/z/f.zip', name: 'shown.md', index: 1, bytes: bytes('# Shown\n'), mtimeMs: null });
  const tiles = Array.from({ length: 100 }, (_, i) => holdTile({ archive: '/z/f.zip', name: `t${i}.md`, index: i + 2, bytes: bytes(`# ${i}\n`), mtimeMs: null }));
  assert.equal(tilesHeld(), 96);
  assert.deepEqual(dropped, tiles.slice(0, 4).map((t) => t.path), 'past 96 the oldest tiles went');
  assert.ok(heldEntry(tab.path) && heldEntry(preview.path));
  assert.ok(heldEntry(tiles[99]!.path), 'a tile\'s entry is read as any held entry is');
  releaseTiles({ path: tiles[99]!.path });
  assert.equal(heldEntry(tiles[99]!.path), null);
  assert.equal(dropped.at(-1), tiles[99]!.path, 'what was made of it is let go');
  releaseTiles({ archive: '/z/f.zip' });
  assert.equal(tilesHeld(), 0);
  assert.ok(heldEntry(tab.path) && heldEntry(preview.path));
});
