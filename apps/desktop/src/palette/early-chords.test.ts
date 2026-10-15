// The chords held before the palette mounts, and what they come to (F-111, W-13.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE_CHORDS } from './chords.ts';
import { modalOpenOutsidePalette, replayedOpening } from './early-chords.ts';

const [p, k, shiftP, slash] = PALETTE_CHORDS;

// No DOM library runs under node --test, so the document is a stub: elements carry a tag and attributes (an open dialog
// has `open`, a closed one does not, as the browser sets it), and querySelector matches the compound selectors the
// guard uses (tag, #id, [attr], [attr="v"], :not(...)) against them.
type Stub = { tag: string; attrs: Record<string, string> };
function matchCompound(el: Stub, compound: string): boolean {
  const parts = compound.match(/[a-z]+|#[\w-]+|\[[^\]]+\]|:not\([^)]*\)/g) ?? [];
  return parts.length > 0 && parts.every((part) => {
    if (part.startsWith(':not(')) return !matchCompound(el, part.slice(5, -1));
    if (part.startsWith('#')) return el.attrs.id === part.slice(1);
    if (part.startsWith('[')) {
      const [name, value] = part.slice(1, -1).split('=') as [string, string | undefined];
      return value === undefined ? name in el.attrs : el.attrs[name] === value.replace(/"/g, '');
    }
    return el.tag === part;
  });
}
function stubDocument(elements: Stub[]): Document {
  return {
    querySelector: (selector: string) =>
      selector.split(',').some((compound) => elements.some((el) => matchCompound(el, compound.trim()))) ? {} : null,
  } as unknown as Document;
}

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

test('a closed sheet that keeps aria-modal does not stop a chord held before mount', () => {
  // replace-sheet.ts and transform/sheet.ts set aria-modal on their <dialog> and keep it after close().
  const closedSheet: Stub = { tag: 'dialog', attrs: { id: 'marxy-replace', 'aria-modal': 'true' } };
  assert.equal(modalOpenOutsidePalette(stubDocument([closedSheet])), false);
  assert.deepEqual(replayedOpening([k!], modalOpenOutsidePalette(stubDocument([closedSheet]))), { query: undefined }, 'the palette still opens');
  const openSheet: Stub = { tag: 'dialog', attrs: { id: 'marxy-replace', 'aria-modal': 'true', open: '' } };
  assert.equal(modalOpenOutsidePalette(stubDocument([openSheet])), true, 'an open sheet still holds the screen');
});
