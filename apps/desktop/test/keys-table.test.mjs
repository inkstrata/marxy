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
import { MENU_COMMAND_IDS } from '../src/menu/menu-commands.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MAC = true;
const PLATFORMS = [true, false];

const PHYSICAL = { Backslash: '\\', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright', Slash: '/' };
const physical = (code) => PHYSICAL[code] ?? code.replace(/^(Digit|Key)/, '').toLowerCase();
const paneChord = (c, mac = MAC) => registryChord(['Mod', c.ctrl ? 'Ctrl' : null, c.alt ? 'Alt' : null, c.shift ? 'Shift' : null, physical(c.code)].filter(Boolean).join('+'), mac);

/** The menu item that opens a palette door is the palette's owner of that chord, not a second one. */
const MENU_OWNERS = { 'marxy-open-quickly': 'palette' };

/** The OS's own items and the key each answers (AppKit), with the registry command that owns the same chord, if any. */
const NATIVE_ITEMS = [
  { spec: 'Mod+H' }, { spec: 'Mod+Alt+H' }, { spec: 'Mod+X' }, { spec: 'Mod+C' }, { spec: 'Mod+A' }, { spec: 'Mod+M' },
  { spec: 'Mod+Z', owner: 'document.undo' }, { spec: 'Mod+Shift+Z', owner: 'document.redo' }, { spec: 'Mod+V', owner: 'paste.rendered' },
];

/** macOS shortcuts that belong to the system, whatever the app is doing: a menu item on one would be shadowed or would shadow it. */
const SYSTEM_WIDE = ['Mod+Space', 'Mod+Alt+Space', 'Ctrl+Space', 'Ctrl+Mod+Q', 'Mod+Tab', 'Mod+Shift+Tab', 'Mod+`', 'Mod+Alt+Escape', 'Mod+Shift+3', 'Mod+Shift+4', 'Mod+Shift+5', 'Mod+Shift+Q', 'Mod+Alt+D'];

/** Rust accelerator text (`CmdOrCtrl+Shift+N`) as a registry spec (`Mod+Shift+N`). */
const specOf = (accel) => accel.replace(/CmdOrCtrl|Cmd/g, 'Mod');

/** Every `Own` and `Cmd` item of `MENU` in main.rs: its menu id, the registry command it runs (if one), and its accelerator spec ('' for none). */
export function menuItems() {
  const rs = readFileSync(join(here, '..', 'src-tauri', 'src', 'main.rs'), 'utf8');
  const ids = Object.fromEntries([...rs.matchAll(/pub const ([A-Z_]+): &str = "(marxy-[a-z-]+)"/g)].map((m) => [m[1], m[2]]));
  const items = [];
  for (const m of rs.matchAll(/\bOwn\(\s*([A-Z_]+),\s*"[^"]*",\s*"((?:[^"\\]|\\.)*)"/g)) items.push({ id: ids[m[1]], command: null, spec: specOf(m[2].replace(/\\\\/g, '\\')) });
  for (const m of rs.matchAll(/\bCmd\(\s*"([a-z][a-z.-]*)",\s*"[^"]*",\s*"((?:[^"\\]|\\.)*)"/g)) items.push({ id: `cmd:${m[1]}`, command: m[1], spec: specOf(m[2].replace(/\\\\/g, '\\')) });
  assert.ok(items.length >= 35, 'the menu table was found');
  return items;
}

function menuAccelerators(mac = MAC) {
  return menuItems().filter((i) => i.spec !== '').map(({ id, command, spec }) => ({ id, command, chord: registryChord(spec, mac) }));
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
  for (const item of menuAccelerators(mac)) claim(item.chord, item.command ?? MENU_OWNERS[item.id] ?? item.id, 'menu');
  for (const n of NATIVE_ITEMS) claim(registryChord(n.spec, mac), n.owner ?? `native:${n.spec}`, 'native');
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

/** Keyed commands the menu does not carry, and why (W-20: the menu is cut to the commands the card names; ADR-0073). */
const NOT_IN_MENU = [
  [/^selection\./, 'Rendered selection keys, a mode of the page'],
  [/^source\.(select|expand|delete|join|toggle-(task|quote|comment))/, "Source's own selection and line chords (the mock's Select menu is another story)"],
  [/^document\.(undo|redo)$/, "Undo and Redo are the OS's own Edit items"],
  [/^paste\./, "Paste is the OS's own Edit item"],
  [/^source\.paste-plain$/, 'a paste variant, in the palette'],
  [/^view\.(text-|focus-|close-pane|open-beside|fold-workspace)/, 'text size, pane chords and Esc: not on the card'],
  [/^(notices\.focus|edit\.block|document\.open-in-editor)$/, 'not on the card'],
  [/^view\.metadata$/, 'the margin preview (W-17) is summoned by its key and the palette; the View menu carries the panels'],
];

test('every keyed registry command is in the menu with its own key, or is named as not there', () => {
  const inMenu = new Map(menuItems().filter((i) => i.command).map((i) => [i.command, i.spec]));
  const missing = [];
  for (const cmd of commands()) {
    if (cmd.key === undefined || inMenu.has(cmd.id)) continue;
    if (NOT_IN_MENU.some(([re]) => re.test(cmd.id))) continue;
    missing.push(`${cmd.id} (${cmd.key})`);
  }
  assert.deepEqual(missing, [], 'a command with a key is missing from the menu bar');
});

test('each menu item runs a registry command, shows that command\'s own key, and the shell is told the same ids', () => {
  const byId = new Map(commands().map((c) => [c.id, c]));
  for (const item of menuItems().filter((i) => i.command)) {
    const cmd = byId.get(item.command);
    assert.ok(cmd, `${item.command} is not a registry command`);
    for (const mac of PLATFORMS) {
      const want = cmd.key === undefined ? null : registryChord(cmd.key, mac);
      const got = item.spec === '' ? null : registryChord(item.spec, mac);
      assert.equal(got, want, `${mac ? 'mac' : 'other'}: ${item.command} shows ${item.spec || 'no key'} but the registry gives ${cmd.key ?? 'none'}`);
    }
  }
  assert.deepEqual([...MENU_COMMAND_IDS].sort(), menuItems().filter((i) => i.command).map((i) => i.command).sort());
});

test('no menu item takes a system-wide macOS shortcut', () => {
  const system = new Set(SYSTEM_WIDE.map((s) => registryChord(s, true)));
  for (const item of menuItems().filter((i) => i.spec !== '')) {
    assert.ok(!system.has(registryChord(item.spec, true)), `${item.id} takes ${item.spec}, which the system owns`);
  }
  for (const n of NATIVE_ITEMS) assert.ok(!system.has(registryChord(n.spec, true)), n.spec);
});

test('no two menu items share a key, and Close Window keeps Mod+W', () => {
  const seen = new Map();
  for (const item of menuItems().filter((i) => i.spec !== '')) {
    const chord = registryChord(item.spec, true);
    assert.ok(!seen.has(chord), `${item.id} and ${seen.get(chord)} share ${item.spec}`);
    seen.set(chord, item.id);
  }
  assert.equal(menuItems().find((i) => i.id === 'marxy-close-window')?.spec, 'Mod+W');
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
  // W-17: the metadata chord is owned once, by its command, and is not the inspector's or italic's.
  assert.deepEqual(ownerOf('Ctrl+Mod+I'), ['view.metadata']);
  assert.ok(!ownerOf('Mod+I').includes('view.metadata'), 'Control+Command+I is not italic');
  assert.deepEqual(ownerOf('Escape').sort(), ['selection.clear', 'view.fold-workspace']);
  assert.ok(!ownerOf('Mod+S').includes('view.toggle-sidebar'), 'Control+Command+S is not save');
});

test('Source\'s fold keys are in the table, with the chords CodeMirror reads on each platform', () => {
  assert.ok(FOLD_KEYS.length >= 2);
  const sourceOwners = (mac) => [...table(mac)].filter(([, claims]) => claims.some((c) => c.source === 'source')).map(([chord]) => chord).sort();
  assert.deepEqual(sourceOwners(true), ['alt-meta-[', 'alt-meta-]']);
  assert.deepEqual(sourceOwners(false), ['ctrl-shift-[', 'ctrl-shift-]']);
});
