// One table across every binding: the registry's `key`/`keys`, the pane chords, the palette's own
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
import { MENU_COMMAND_IDS } from '../src/menu/menu-commands.ts';
import { LEFT_PANELS } from '@marxy/core/src/layout/frame-storage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MAC = true;
const PLATFORMS = [true, false];

const PHYSICAL = { Backslash: '\\', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright', Slash: '/', BracketLeft: '[', BracketRight: ']' };
const physical = (code) => PHYSICAL[code] ?? code.replace(/^(Digit|Key)/, '').toLowerCase();
const paneChord = (c, mac = MAC) => registryChord([c.bare ? null : 'Mod', c.ctrl ? 'Ctrl' : null, c.alt ? 'Alt' : null, c.shift ? 'Shift' : null, physical(c.code)].filter(Boolean).join('+'), mac);

/**
 * A menu item that does a command's own act owns its chord as that command, not as a second owner: the palette's door,
 * and Open File…, which is document.open's system picker done by the shell where there is a menu bar (main.rs).
 */
const MENU_OWNERS = { 'marxy-open-quickly': 'palette', 'marxy-open-file': 'document.open' };

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
 * Chords two commands may both spell because they are never both live: Mod+B is Bold while Source's editor or a text
 * field has the keys, and the drawer everywhere else (its pane chord is `notInEditor`; the test below holds that).
 */
const SHARED_CHORDS = new Map([
  ['meta-b', ['source.format-bold', 'view.toggle-drawer']], ['ctrl-b', ['source.format-bold', 'view.toggle-drawer']],
  // Alt+arrows move the part while the verbs are on and select while they are off (each `when` says which);
  // Save reads the patch first on a changes page or with review_changes on, and saves at once otherwise.
  ['alt-arrowdown', ['change.move-down', 'selection.next-block']], ['alt-arrowup', ['change.move-up', 'selection.prev-block']],
  // Cmd+Alt+[ and ] fold in Source on a Mac; the pane chord for the folder's neighbours is `notInEditor`.
  ['alt-meta-[', ['nav.beside-previous', 'source:Ctrl-Shift-[']], ['alt-meta-]', ['nav.beside-next', 'source:Ctrl-Shift-]']],
  ['meta-s', ['changes.save', 'document.save']], ['ctrl-s', ['changes.save', 'document.save']],
]);

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

/** Keyed commands the menu does not carry, and why (the menu is cut to the commands the card names). */
const NOT_IN_MENU = [
  [/^selection\./, 'Rendered selection keys, a mode of the page'],
  [/^source\.(select|expand|delete|join|toggle-(task|quote|comment))/, "Source's own selection and line chords (the mock's Select menu is another story)"],
  [/^document\.(undo|redo)$/, "Undo and Redo are the OS's own Edit items"],
  [/^paste\./, "Paste is the OS's own Edit item"],
  [/^source\.paste-plain$/, 'a paste variant, in the palette'],
  [/^view\.(text-|focus-|close-pane|open-beside)/, 'text size and pane chords: not on the card'],
  [/^nav\.beside-/, "the folder's next and previous file: the page's g ] and g [, and a pane chord"],
  [/^(notices\.focus|edit\.block|document\.open-in-editor)$/, 'not on the card'],
  [/^view\.full-screen$/, "F11, the window's own key; macOS keeps F11 for the system"],
  [/^(branch|tab|left)\./, "the left section's panels and branches (Alt+1 to Alt+8, Look, Clip) and the tab keys: the frame's own, said on the rail's buttons"],
  [/^cursor\./, "the cursor's single keys: the page's own, said on the verb bar; no accelerator is a bare letter"],
  [/^depths\./, "the depths' single keys: x-ray, Reveal, folds, only this; the page's own, as the cursor's are"],
  [/^(changes?|tray|note)\./, "the change, tray and note verbs: the page's own keys and the verb bar; the menu's Save is document.save"],
  [/^read\.as$/, "Read as: the page's own r, said on the verb bar and the pane head's chip"],
  [/^look\./, "the look's single keys: a, A, + - 0, N, B; the page's own, said in the pop-over and the Studio"],
  [/^reading\.toggle-rendered$/, "Show rendered's g r, the page's own as g ] and g [ are, said in its notice and the Metadata panel's Reading line"],
  [/^line\./, "the Line's scope keys: @ / # : ! % ~ & open it in a scope; the page's own, said in the Line's help (?)"],
];

/** Menu items that show no key though their command has one, and why. */
const KEY_SHOWN_ELSEWHERE = new Map([['view.toggle-drawer', 'Mod+B is Bold in the Format menu; the page takes it for the drawer outside Source']]);

test('every keyed registry command is in the menu with its own key, or is named as not there', () => {
  const inMenu = new Map(menuItems().flatMap((i) => (i.command ? [[i.command, i.spec]] : MENU_OWNERS[i.id] ? [[MENU_OWNERS[i.id], i.spec]] : [])));
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
    if (KEY_SHOWN_ELSEWHERE.has(item.command)) {
      assert.equal(item.spec, '', `${item.command} shows no key in the menu`);
      continue;
    }
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
  // Alt+1 and Alt+2 (no Mod) are the left section's Places and Metadata; no Mod+digit is a pane chord.
  assert.ok(!PANE_CHORDS.some((c) => (c.code === 'Digit1' || c.code === 'Digit2') && !c.bare));
  const owners = table();
  assert.equal(owners.get(registryChord('Mod+Alt+ArrowLeft', MAC))?.[0].owner, 'view.focus-left');
  assert.equal(owners.get(registryChord('Mod+Alt+ArrowRight', MAC))?.[0].owner, 'view.focus-right');
  const focus = commands().filter((c) => c.id.startsWith('view.focus-'));
  assert.deepEqual(focus.map((c) => c.key), ['Mod+Alt+ArrowLeft', 'Mod+Alt+ArrowRight']);
});

test('the chords are in the table, unchanged', () => {
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

// The kept chords of the panels that replaced the branches (commands/frame.ts OLD_CHORD), by the panel that took each.
const KEPT_CHORDS = { places: 'Mod+Shift+E', search: 'Mod+Shift+F', transforms: 'Mod+Alt+R', versions: 'Mod+Alt+V' };

test('the chords are the frame\'s: the fold, the left section\'s cycle, an Alt+n and a kept chord per panel, Look, Clip, Settings and the tab keys', () => {
  for (const mac of PLATFORMS) {
    const owners = table(mac);
    const ownerOf = (spec) => [...new Set(owners.get(registryChord(spec, mac))?.map((c) => c.owner))].sort();
    const where = mac ? 'mac' : 'other';
    assert.deepEqual(ownerOf('Mod+\\'), ['view.toggle-workspace'], where);
    // The left section's cycle: Mod+B (Bold in Source) and the page's bare b; Mod+Alt+B is the native menu's Panel item, Metadata's.
    assert.deepEqual(ownerOf('Mod+B'), ['source.format-bold', 'view.toggle-drawer'], where);
    assert.deepEqual(ownerOf('b'), ['view.toggle-drawer'], where);
    assert.deepEqual(ownerOf('Mod+Alt+B'), ['view.toggle-panel'], where);
    // Each panel has Alt+n for its place on the rail, and the chord it kept from its branch, and each opens that panel and nothing else.
    LEFT_PANELS.forEach((id, i) => {
      const cmd = commands().find((c) => c.id === `left.${id}`);
      assert.ok(cmd, `left.${id} is a command`);
      assert.equal(cmd.key, `Alt+${i + 1}`, `${where}: ${id}`);
      assert.deepEqual(ownerOf(`Alt+${i + 1}`), [`left.${id}`], `${where}: Alt+${i + 1}`);
      assert.deepEqual(cmd.keys ?? [], KEPT_CHORDS[id] ? [KEPT_CHORDS[id]] : [], `${where}: ${id}'s kept chord`);
      if (KEPT_CHORDS[id]) assert.deepEqual(ownerOf(KEPT_CHORDS[id]), [`left.${id}`], `${where}: ${KEPT_CHORDS[id]}`);
    });
    // Look, Clip and Settings keep their keys and toggle their branch in the drawer.
    for (const [spec, id] of [['Mod+Alt+T', 'branch.look'], ['Mod+Alt+C', 'branch.clip'], ['Mod+,', 'view.settings']]) {
      assert.deepEqual(ownerOf(spec), [id], `${where}: ${spec}`);
      assert.equal(commands().find((c) => c.id === id)?.key, spec);
    }
    assert.deepEqual(ownerOf('Alt+W'), ['tab.close'], where);
    // Escape clears a selection and nothing else: no peek or workspace fold shares it.
    assert.deepEqual(ownerOf('Escape'), ['selection.clear'], where);
  }
  // Ctrl+Tab is Control on a Mac, a chord of its own there.
  const mac = table(true);
  assert.deepEqual(mac.get(registryChord('Ctrl+Tab', true))?.map((c) => c.owner), ['tab.next']);
  assert.deepEqual(mac.get(registryChord('Ctrl+Shift+Tab', true))?.map((c) => c.owner), ['tab.previous']);
  // The cycle's key leaves a text field and Source's editor alone; the panel and branch keys work from both.
  assert.equal(PANE_CHORDS.find((c) => c.command === 'view.toggle-drawer')?.notInEditor, true);
  for (const [command, spec] of [...LEFT_PANELS.map((id, i) => [`left.${id}`, `Alt+${i + 1}`]), ...Object.entries(KEPT_CHORDS).map(([id, k]) => [`left.${id}`, k]), ['branch.look', 'Mod+Alt+T'], ['branch.clip', 'Mod+Alt+C']]) {
    const chord = PANE_CHORDS.find((c) => c.command === command && paneChord(c, true) === registryChord(spec, true));
    assert.ok(chord && !chord.notInEditor, `${command} answers ${spec} from the physical key`);
    for (const on of PLATFORMS) assert.equal(paneChord(chord, on), registryChord(spec, on), `${command} ${spec}`);
  }
  // Nothing is left of the retired chrome, nor of its rail of branches.
  const ids = new Set(commands().map((c) => c.id));
  for (const gone of ['view.toggle-sidebar', 'view.toggle-inspector', 'view.toggle-toolbar', 'view.toggle-status-bar', 'view.fold-workspace', 'view.metadata', 'branch.library', 'branch.find', 'branch.transform', 'branch.versions']) assert.ok(!ids.has(gone), gone);
});
test('Source\'s fold keys are in the table, with the chords CodeMirror reads on each platform', () => {
  assert.ok(FOLD_KEYS.length >= 2);
  const sourceOwners = (mac) => [...table(mac)].filter(([, claims]) => claims.some((c) => c.source === 'source')).map(([chord]) => chord).sort();
  assert.deepEqual(sourceOwners(true), ['alt-meta-[', 'alt-meta-]']);
  assert.deepEqual(sourceOwners(false), ['ctrl-shift-[', 'ctrl-shift-]']);
});
