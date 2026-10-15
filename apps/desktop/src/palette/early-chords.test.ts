// The chords held before the palette mounts, and what they come to (F-111, W-13.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_CHORDS } from './chords.ts';
import { replayedOpening } from './early-chords.ts';

const [p, k, shiftP, slash] = PALETTE_CHORDS;

test('no chord replays nothing; one opens what it opens', () => {
  assert.equal(replayedOpening([], false), null);
  assert.deepEqual(replayedOpening([k!], false), { query: undefined });
  assert.deepEqual(replayedOpening([shiftP!], false), { query: '>' });
  assert.deepEqual(replayedOpening([slash!], false), { query: '>Transform' });
});

test('presses toggle as they would with the palette there: two of Mod+K leave it shut, three open it', () => {
  assert.equal(replayedOpening([k!, k!], false), null);
  assert.deepEqual(replayedOpening([k!, k!, k!], false), { query: undefined });
  assert.equal(replayedOpening([p!, k!], false), null, 'Mod+P then Mod+K are both the document list');
  assert.equal(replayedOpening([shiftP!, shiftP!], false), null);
  assert.deepEqual(replayedOpening([shiftP!, slash!], false), { query: '>Transform' }, 'a different commands chord re-opens on its own query');
  assert.deepEqual(replayedOpening([k!, shiftP!], false), { query: '>' }, 'a commands chord on the open document list switches to commands');
});

test('a dialog or modal open at mount time cancels the replay', () => {
  assert.equal(replayedOpening([k!], true), null);
  assert.equal(replayedOpening([k!, k!, k!], true), null);
});
