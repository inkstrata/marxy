// One table across every binding (W-19): the registry's `key`/`keys`, the pane chords, the palette's own
// summoning chords and the native menu's accelerators. No chord has two owners. A pane chord or a menu item
// that replays a command's chord is that command's, not a second owner. Source's own keymap bindings (`FOLD_KEYS`)
// are in the table too, on both platforms. CodeMirror's default keymap is checked against the registry in
// source-structure.test.mjs.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PANE_CHORDS } from '../src/pane/keys.ts';
import { commands } from '../src/commands/index.ts';
import { FOLD_KEYS } from '../src/source/depth-fold.ts';
import { registryChord, canonicalCm } from '../src/source/structure.ts';
import { PALETTE_CHORDS } from '../src/palette/chords.ts';
import { setAppHandle } from '../src/commands/app-handle.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MAC = true;
const PLATFORMS = [true, false];

const PHYSICAL = { Backslash: '\\', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright', Slash: '/' };
const physical = (code) => PHYSICAL[code] ?? code.replace(/^(Digit|Key)/, '').toLowerCase();
const paneChord = (c, mac = MAC) => registryChord(['Mod', c.ctrl ? 'Ctrl' : null, c.alt ? 'Alt' : null, c.shift ? 'Shift' : null, physical(c.code)].filter(Boolean).join('+'), mac);

/** Native menu accelerators, from main.rs; an item that replays a command's chord names that owner. */
const MENU_OWNERS = {
  'marxy-open-quickly': 'palette',
  'marxy-toggle-source': 'view.toggle-mode',
  'marxy-go-back': 'nav.back',
  'marxy-go-forward': 'nav.forward',
};

function menuAccelerators(mac = MAC) {
  const rs = readFileSync(join(here, '..', 'src-tauri', 'src', 'main.rs'), 'utf8');
  const ids = Object.fromEntries([...rs.matchAll(/pub const ([A-Z_]+): &str = "(marxy-[a-z-]+)"/g)].map((m) => [m[1], m[2]]));
  const items = [...rs.matchAll(/Own\(\s*([A-Z_]+),\s*"[^"]*",\s*"CmdOrCtrl\+([^"]+)"/g)].map((m) => ({ id: ids[m[1]], accel: m[2] }));
  assert.ok(items.length >= 7, 'the menu table was found');
  return items.map(({ id, accel }) => ({ id, chord: registryChord(`Mod+${accel}`, mac) }));
}

function table(mac = MAC) {
  const owners = new Map();
  const claim = (chord, owner, source) => {
    if (chord === null) return;
    const list = owners.get(chord) ?? [];
    list.push({ owner, source });
    owners.set(chord, list);
  };
  for (const cmd of commands()) for (const spec of [cmd.key, ...(cmd.keys ?? [])].filter(Boolean)) claim(registryChord(spec, mac), cmd.id, 'command');
  for (const chord of PANE_CHORDS) claim(paneChord(chord, mac), chord.command, 'pane');
  for (const { spec } of PALETTE_CHORDS) claim(registryChord(spec, mac), 'palette', 'palette');
  for (const item of menuAccelerators(mac)) claim(item.chord, MENU_OWNERS[item.id] ?? item.id, 'menu');
  // Source's own keymap: a binding's chord is its `mac` name on a Mac, else its `key`.
  for (const b of FOLD_KEYS) claim(canonicalCm((mac ? b.mac : b.key) ?? b.key, mac), `source:${b.key}`, 'source');
  return owners;
}

/**
 * Chords two commands may both spell because their `when`s are never both true (W-03): `Esc` clears a selection,
 * and with none folds the workspace. Each entry is the owners that share it; `shared chords` below proves the `when`s.
 */
const SHARED_CHORDS = new Map([['escape', ['selection.clear', 'view.fold-workspace']]]);

test('no chord has two owners across commands, pane chords, the palette, the native menu and Source\'s own keymap, on both platforms', () => {
  for (const mac of PLATFORMS) for (const [chord, claims] of table(mac)) {
    const distinct = new Set(claims.map((c) => c.owner));
    const shared = SHARED_CHORDS.get(chord);
    if (shared) {
      assert.deepEqual([...distinct].sort(), [...shared].sort(), `${chord} is shared by exactly the declared owners`);
      continue;
    }
    assert.equal(distinct.size, 1, `${mac ? 'mac' : 'other'}: ${chord} is claimed by ${claims.map((c) => `${c.owner} (${c.source})`).join(' and ')}`);
  }
});

test('the rulings: Mod+K, Mod+Shift+P, Mod+/ are the palette; Mod+1..3 are Read, Split, Source', () => {
  const owners = table();
  const ownerOf = (spec) => owners.get(registryChord(spec, MAC))?.[0]?.owner;
  assert.equal(ownerOf('Mod+K'), 'palette');
  assert.equal(ownerOf('Mod+P'), 'palette');
  assert.equal(ownerOf('Mod+Shift+P'), 'palette');
  assert.equal(ownerOf('Mod+/'), 'palette');
  assert.equal(ownerOf('Mod+1'), 'view.mode-read');
  assert.equal(ownerOf('Mod+2'), 'view.mode-split');
  assert.equal(ownerOf('Mod+3'), 'view.mode-source');
  assert.equal(ownerOf('Mod+E'), 'view.toggle-mode');
});

test('pane focus moved off Mod+1/Mod+2 to Mod+Alt+Left/Right', () => {
  assert.ok(!PANE_CHORDS.some((c) => c.code === 'Digit1' || c.code === 'Digit2'));
  const owners = table();
  assert.equal(owners.get(registryChord('Mod+Alt+ArrowLeft', MAC))?.[0].owner, 'view.focus-left');
  assert.equal(owners.get(registryChord('Mod+Alt+ArrowRight', MAC))?.[0].owner, 'view.focus-right');
  const focus = commands().filter((c) => c.id.startsWith('view.focus-'));
  assert.deepEqual(focus.map((c) => c.key), ['Mod+Alt+ArrowLeft', 'Mod+Alt+ArrowRight']);
});

test('W-02 and J-04 chords are in the table, unchanged', () => {
  const owners = table();
  const ownerOf = (spec) => [...new Set(owners.get(registryChord(spec, MAC))?.map((c) => c.owner))];
  assert.deepEqual(ownerOf('Mod+\\'), ['view.toggle-workspace']);
  assert.deepEqual(ownerOf('Mod+Alt+\\'), ['view.open-beside']);
  assert.deepEqual(ownerOf('Mod+Shift+\\'), ['view.close-pane']);
  assert.deepEqual(ownerOf('Mod+Shift+C'), ['copy-as.menu']);
});

test('the native menu accelerators are all in the table', () => {
  const owners = table();
  for (const item of menuAccelerators()) {
    assert.ok(owners.get(item.chord)?.some((c) => c.source === 'menu'), item.id);
  }
});

test('shared chords: the two owners of Esc are never runnable together, in any state', () => {
  const cmds = commands();
  const clear = cmds.find((c) => c.id === 'selection.clear');
  const fold = cmds.find((c) => c.id === 'view.fold-workspace');
  assert.ok(clear && fold);
  assert.equal(fold.global ?? false, false, 'Esc never folds from a Source editor or a text field');
  const kinds = ['none', 'text', 'node', 'section', 'document', 'blocks'];
  let foldable = 0;
  for (const mode of ['folded', 'unfolded']) {
    setAppHandle({ workspace: () => ({ mode }) });
    for (const kind of kinds) {
      const ctx = { selection: { kind } };
      assert.ok(!(clear.when(ctx) && fold.when(ctx)), `${mode} with a ${kind} selection`);
      if (fold.when(ctx)) foldable++;
    }
  }
  assert.equal(foldable, 1, 'Esc folds only an unfolded window with no selection');
  // W-03.1: an open peek is closed by the same Esc, after a selection and not before it.
  setAppHandle({ workspace: () => ({ mode: 'folded', peeked: 'toolbar' }) });
  assert.ok(fold.when({ selection: { kind: 'none' } }), 'a peek is closed by Esc');
  assert.ok(!fold.when({ selection: { kind: 'node' } }), 'a selection goes first');
  assert.ok(clear.when({ selection: { kind: 'node' } }));
  setAppHandle(null);
});

test('W-03 chords are in the table: the panel keys and the fold key', () => {
  const owners = table();
  const ownerOf = (spec) => [...new Set(owners.get(registryChord(spec, MAC))?.map((c) => c.owner))];
  assert.deepEqual(ownerOf('Ctrl+Mod+S'), ['view.toggle-sidebar']);
  assert.deepEqual(ownerOf('Mod+Alt+I'), ['view.toggle-inspector']);
  assert.deepEqual(ownerOf('Escape').sort(), ['selection.clear', 'view.fold-workspace']);
  assert.ok(!ownerOf('Mod+S').includes('view.toggle-sidebar'), 'Control+Command+S is not save');
});

test('Source\'s fold keys are in the table, with the chords CodeMirror reads on each platform', () => {
  assert.ok(FOLD_KEYS.length >= 2);
  const sourceOwners = (mac) => [...table(mac)].filter(([, claims]) => claims.some((c) => c.source === 'source')).map(([chord]) => chord).sort();
  assert.deepEqual(sourceOwners(true), ['alt-meta-[', 'alt-meta-]']);
  assert.deepEqual(sourceOwners(false), ['ctrl-shift-[', 'ctrl-shift-]']);
});
