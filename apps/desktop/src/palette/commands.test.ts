// The palette's command list, chord labels and key dispatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppContext, Command } from '../commands/registry.ts';
import { commandForKey, drillText, isPageKey, keyLabel, PALETTE_GROUPS, paletteCommands, paletteGroupOf, sequenceFor } from './commands.ts';
import { documentCommands } from '../commands/document.ts';
import { setAppHandle } from '../commands/app-handle.ts';
import type { AppHandle } from '../app.ts';
import { DISK_CHANGED_CHOOSE } from '../notices/disk.ts';
import { openDocumentStore, type DocumentStore } from '../document/store.ts';

const ctx = {
  shell: { clipboardWrite: async () => {} },
  selection: { kind: 'none' },
  document: null,
  operationInput: () => null,
  closePalette: () => {},
  showNotice: () => {},
} as AppContext;

function cmd(id: string, title: string, group: Command['group'], extra: Partial<Command> = {}): Command {
  return { id, title, group, when: () => true, run: async () => {}, ...extra };
}

const key = (k: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key: k,
  metaKey: mods.meta === true,
  ctrlKey: mods.ctrl === true,
  shiftKey: mods.shift === true,
  altKey: mods.alt === true,
});

test('paletteCommands keeps only the commands whose when holds', () => {
  const all = [
    cmd('a', 'Save', 'document'),
    cmd('b', 'Undo', 'document', { when: () => false }),
  ];
  assert.deepEqual(paletteCommands(all, ctx, '').map((c) => c.id), ['a']);
});

test('paletteCommands filters by title on the query and ignores case and edge space', () => {
  const all = [cmd('a', 'Save', 'document'), cmd('b', 'Save as', 'document'), cmd('c', 'Toggle line numbers in Source', 'view')];
  assert.deepEqual(paletteCommands(all, ctx, ' SAVE ').map((c) => c.id), ['a', 'b']);
  assert.deepEqual(paletteCommands(all, ctx, 'zzzz').map((c) => c.id), []);
});

test('paletteCommands orders by palette group (Navigate, File, View, Copy, Source, Extract, Transform) then title', () => {
  const all = [
    cmd('transform.open', 'Transform', 'transform'),
    cmd('op.extract-links', 'Copy all links', 'selection'),
    cmd('source.join-lines', 'Join lines', 'selection'),
    cmd('copy-as.menu', 'Copy as…', 'selection'),
    cmd('view.text-larger', 'Larger text', 'view'),
    cmd('document.undo', 'Undo', 'document'),
    cmd('document.save', 'Save', 'document'),
    cmd('nav.back', 'Back', 'view'),
  ];
  assert.deepEqual(paletteCommands(all, ctx, '').map((c) => [paletteGroupOf(c), c.id]), [
    ['Navigate', 'nav.back'],
    ['File', 'document.save'],
    ['File', 'document.undo'],
    ['View', 'view.text-larger'],
    ['Copy', 'copy-as.menu'],
    ['Source', 'source.join-lines'],
    ['Extract', 'op.extract-links'],
    ['Transform', 'transform.open'],
  ]);
});

test('every registered command has a palette group, and there are seven groups', async () => {
  const { commands } = await import('../commands/index.ts');
  const seen = new Set(commands().map((c) => paletteGroupOf(c)));
  assert.deepEqual([...PALETTE_GROUPS].filter((g) => seen.has(g)), [...PALETTE_GROUPS]);
});

test('"Read this file as" collapses to one row that opens its own list', () => {
  const kinds = ['markdown', 'code', 'log'];
  const all = [
    ...kinds.map((k) => cmd(`kind.show-as.${k}`, `Read this file as ${k}`, 'document')),
    cmd('kind.show-as.detected', 'Read this file as Marxy would', 'document'),
    cmd('document.save', 'Save', 'document'),
  ];
  const rows = (q: string) => paletteCommands(all, ctx, q).map((c) => c.title);
  assert.deepEqual(rows(''), ['Read this file as…', 'Save']);
  assert.equal(rows('').filter((t) => t.startsWith('Read this file as')).length, 1);
  assert.deepEqual(rows('read'), ['Read this file as…']);
  assert.deepEqual(rows('as'), ['Read this file as…'], 'only the family\'s own words: still one row');
  assert.equal(rows('Read this file as').length, 4, 'the phrase lists the members');
  assert.equal(drillText('palette.drill.show-as'), 'Read this file as ');
  assert.equal(drillText('palette.drill.show-as', '>read lo'), 'Read this file as lo', 'a typed remainder is kept');
  assert.equal(drillText('document.save'), undefined);
});

test('keyLabel spells a chord for a Mac and for Linux', () => {
  assert.equal(keyLabel('Mod+Shift+S', true), '⇧⌘S');
  assert.equal(keyLabel('Mod+Shift+S', false), 'Ctrl+Shift+S');
  assert.equal(keyLabel('Mod+Z', true), '⌘Z');
  assert.equal(keyLabel('Mod+Z', false), 'Ctrl+Z');
  assert.equal(keyLabel('Alt+ArrowLeft', true), '⌥←');
  assert.equal(keyLabel('Alt+ArrowLeft', false), 'Alt+ArrowLeft');
});

test('commandForKey runs a global command from an editable and skips a non-global one', () => {
  const plain = cmd('plain', 'Plain', 'document', { key: 'Mod+K' });
  const global = cmd('global', 'Global', 'document', { key: 'Mod+K', global: true });
  const event = key('k', { meta: true });
  assert.equal(commandForKey(event, [plain, global], ctx, { inEditable: true, mac: true }), global);
  assert.equal(commandForKey(event, [plain], ctx, { inEditable: true, mac: true }), undefined);
  assert.equal(commandForKey(event, [plain, global], ctx, { inEditable: false, mac: true }), plain);
});

test('commandForKey matches an alternate chord in keys and checks when', () => {
  const two = cmd('two', 'Two', 'document', { key: 'Mod+[', keys: ['Alt+ArrowLeft'] });
  assert.equal(commandForKey(key('ArrowLeft', { alt: true }), [two], ctx, { inEditable: false, mac: true }), two);
  assert.equal(commandForKey(key('[', { ctrl: true }), [two], ctx, { inEditable: false, mac: false }), two);
  assert.equal(commandForKey(key('ArrowLeft'), [two], ctx, { inEditable: false, mac: true }), undefined);
  const off = cmd('off', 'Off', 'document', { key: 'Mod+O', when: () => false });
  assert.equal(commandForKey(key('o', { meta: true }), [off], ctx, { inEditable: false, mac: true }), undefined);
});

test('isPageKey: one character, Shift at most, or a sequence of them', () => {
  for (const spec of ['j', 'Shift+J', ']', '\\', 'g g']) assert.equal(isPageKey(spec), true, spec);
  for (const spec of ['Escape', 'Enter', 'Mod+K', 'Alt+ArrowDown', 'Ctrl+[', 'Alt+W', 'BrowserBack']) assert.equal(isPageKey(spec), false, spec);
});

test('commandForKey: a page key runs only where the page has the keys; a chord runs either way', () => {
  const next = cmd('next', 'Next part', 'selection', { key: 'j' });
  const grow = cmd('grow', 'Take the next part too', 'selection', { key: 'Shift+J' });
  const chord = cmd('chord', 'Next block', 'selection', { key: 'Alt+ArrowDown' });
  const all = [next, grow, chord];
  assert.equal(commandForKey(key('j'), all, ctx, { inEditable: false, mac: true }), undefined, 'no pageKeys: never');
  assert.equal(commandForKey(key('j'), all, ctx, { inEditable: false, mac: true, pageKeys: true }), next);
  assert.equal(commandForKey(key('J', { shift: true }), all, ctx, { inEditable: false, mac: true, pageKeys: true }), grow);
  assert.equal(commandForKey(key('j', { meta: true }), all, ctx, { inEditable: false, mac: true, pageKeys: true }), undefined, 'Mod+J is not j');
  assert.equal(commandForKey(key('j'), all, ctx, { inEditable: true, mac: true, pageKeys: true }), undefined, 'never in a field');
  assert.equal(commandForKey(key('ArrowDown', { alt: true }), all, ctx, { inEditable: false, mac: true }), chord);
});

test('sequenceFor: the first key is a prefix while its command holds; the second completes it', () => {
  const first = cmd('first', 'The first part', 'selection', { key: 'g g' });
  assert.deepEqual(sequenceFor(key('g'), [first], ctx, null, true), { prefix: 'g' });
  assert.deepEqual(sequenceFor(key('g'), [first], ctx, 'g', true), { command: first });
  assert.equal(sequenceFor(key('j'), [first], ctx, 'g', true), null, 'another key ends the sequence');
  assert.equal(sequenceFor(key('G', { shift: true }), [first], ctx, null, true), null, 'G is not g');
  assert.equal(sequenceFor(key('g'), [cmd('off', 'Off', 'selection', { key: 'g g', when: () => false })], ctx, null, true), null);
  assert.equal(keyLabel('g g', true), 'g g');
});

// ---- the two choices are commands, present only while a changed file waits for one ----

const KEEP = 'document.keep-mine-as-copy';
const TAKE = 'document.take-version-on-disk';
const dec = new TextDecoder();
const enc = new TextEncoder();

function conflictStore(): { store: DocumentStore; files: Map<string, Uint8Array>; writes: string[] } {
  const files = new Map<string, Uint8Array>([['/d/a.md', enc.encode('# One\n')]]);
  const writes: string[] = [];
  const store = openDocumentStore(
    {
      async writeFileAtomic(path, bytes) { writes.push(path); files.set(path, new Uint8Array(bytes)); },
      async peekFile(path) { return files.get(path)!; },
      async writeFileNew(path, bytes) { if (files.has(path)) throw Object.assign(new Error('exists'), { code: 'exists' }); writes.push(path); files.set(path, new Uint8Array(bytes)); },
    },
    '/d/a.md',
    enc.encode('# One\n'),
  );
  return { store, files, writes };
}

test('the choice commands are absent from the palette when no changed file waits', async () => {
  const { store } = conflictStore();
  const withDoc = { ...ctx, document: store } as AppContext;
  const ids = (c: AppContext) => paletteCommands(documentCommands(), c, '').map((x) => x.id);
  assert.ok(!ids(ctx).includes(KEEP) && !ids(ctx).includes(TAKE), 'no document');
  assert.ok(!ids(withDoc).includes(KEEP) && !ids(withDoc).includes(TAKE), 'a document with nothing pending');
  // Dirty alone is not a conflict.
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 5 }, replacement: 'Two', label: 'edit' });
  assert.ok(!ids(withDoc).includes(KEEP) && !ids(withDoc).includes(TAKE), 'unsaved edits alone');
  assert.equal(await store.reload(enc.encode('# Theirs\n')), 'kept');
  assert.ok(ids(withDoc).includes(KEEP) && ids(withDoc).includes(TAKE), 'present while a change waits');
});

function runWith(store: DocumentStore, id: string, app: Partial<AppHandle>, said: string[]): Promise<void> {
  setAppHandle(app as AppHandle);
  const context = { ...ctx, document: store, showNotice: (text: string) => void said.push(text) } as AppContext;
  return documentCommands().find((c) => c.id === id)!.run(context);
}

test('Source text not yet folded in is counted: Keep my version copies it, Take theirs discards it', async () => {
  for (const id of [KEEP, TAKE]) {
    const { store, files, writes } = conflictStore();
    // Nothing in the store yet: the reader's edit is only in Source, which holds it while the file changes.
    assert.equal(await store.reload(enc.encode('# Theirs\n'), { holds: () => true }), 'kept');
    files.set('/d/a.md', enc.encode('# Theirs\n'));
    let unfolded = true;
    const said: string[] = [];
    await runWith(
      store,
      id,
      {
        hasUnfoldedSource: () => unfolded,
        async foldSource() {
          if (!unfolded) return;
          unfolded = false;
          await store.commitSource('# One typed in Source\n');
        },
      },
      said,
    );
    assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Theirs\n');
    assert.equal(store.conflict(), null);
    if (id === KEEP) {
      assert.deepEqual(writes, ['/d/a (mine).md']);
      assert.equal(dec.decode(files.get('/d/a (mine).md')!), '# One typed in Source\n', 'the unfolded text is in the copy');
      assert.match(said.join(' '), /a \(mine\)\.md/);
    } else {
      assert.deepEqual(writes, [], 'discarding writes nothing');
    }
  }
});

test('a pane whose Source text cannot be folded is refused: nothing is written or discarded', async () => {
  const { store, writes } = conflictStore();
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 5 }, replacement: 'Two', label: 'edit' });
  assert.equal(await store.reload(enc.encode('# Theirs\n')), 'kept');
  const said: string[] = [];
  await runWith(store, TAKE, { hasUnfoldedSource: () => true, foldSource: async () => {} }, said);
  assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Two\n');
  assert.ok(store.conflict(), 'still pending');
  assert.deepEqual(writes, []);
  assert.equal(said.length, 1);
});

test('a failed copy says why, and the edits and the pending choice stay', async () => {
  const files = new Map<string, Uint8Array>([['/d/a.md', enc.encode('# One\n')]]);
  const store = openDocumentStore(
    {
      async writeFileAtomic() { throw new Error('the disk is full'); },
      async peekFile(path) { return files.get(path)!; },
      async writeFileNew() { throw new Error('the disk is full'); },
    },
    '/d/a.md',
    enc.encode('# One\n'),
  );
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 5 }, replacement: 'Two', label: 'edit' });
  files.set('/d/a.md', enc.encode('# Theirs\n'));
  assert.equal(await store.reload(enc.encode('# Theirs\n')), 'kept');
  const said: string[] = [];
  await runWith(store, KEEP, { hasUnfoldedSource: () => false, foldSource: async () => {} }, said);
  assert.match(said[0] ?? '', /Could not save a copy: the disk is full · nothing was changed/);
  assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Two\n');
  assert.ok(store.conflict());
});

test('the notice for a changed file names both commands by their palette titles, after what it always said', () => {
  for (const id of [KEEP, TAKE]) {
    const title = documentCommands().find((c) => c.id === id)!.title;
    assert.ok(DISK_CHANGED_CHOOSE.includes(`"${title}"`), title);
  }
  assert.ok(DISK_CHANGED_CHOOSE.startsWith('The file changed on disk · your edits were kept'));
});

test('Take theirs also counts Source text unfolded in the OTHER pane: the fold reaches every view, and Undo is not promised', async () => {
  const { store, files } = conflictStore();
  assert.equal(await store.reload(enc.encode('# Theirs\n'), { holds: () => true }), 'kept');
  files.set('/d/a.md', enc.encode('# Theirs\n'));
  let otherPaneText = true;
  const said: string[] = [];
  await runWith(
    store,
    TAKE,
    {
      // The focused pane holds nothing; the other pane's text is folded by the app's all-views fold.
      hasUnfoldedSource: () => false,
      async foldSource() {
        if (otherPaneText) await store.commitSource('# Typed in the other pane\n');
        otherPaneText = false;
      },
    },
    said,
  );
  assert.equal(dec.decode(store.snapshot().buffer.bytes), '# Theirs\n');
  assert.equal(store.snapshot().canUndo, false);
  assert.match(said.join(' '), /discarded and Undo cannot bring them back/);
});

test('a typed kind name lists the members directly, as before the collapse', () => {
  const all = [
    ...['log', 'changelog', 'code'].flatMap((k) => [
      cmd(`kind.show-as.${k}`, `Read this file as ${k}`, 'document'),
      cmd(`kind.folder.${k}`, `Always open this folder as ${k}`, 'app'),
    ]),
  ];
  const rows = (q: string) => paletteCommands(all, ctx, q).map((c) => c.title);
  assert.deepEqual(rows('log').sort(), ['Always open this folder as changelog', 'Always open this folder as log', 'Read this file as changelog', 'Read this file as log']);
  assert.deepEqual(rows('read as log').filter((t) => t.startsWith('Read')).sort(), ['Read this file as changelog', 'Read this file as log']);
  assert.ok(!rows('as log').some((t) => t.endsWith('\u2026')), 'no drill row once a kind is named');
});

test('a letter on a Cyrillic or Greek layout runs by where it sits; Option and other places do not', () => {
  const next = cmd('next', 'Next part', 'selection', { key: 'j' });
  const grow = cmd('grow', 'Take the next part too', 'selection', { key: 'Shift+J' });
  const on = { inEditable: false, mac: false, pageKeys: true };
  assert.equal(commandForKey({ ...key('о'), code: 'KeyJ' }, [next, grow], ctx, on), next);
  assert.equal(commandForKey({ ...key('О', { shift: true }), code: 'KeyJ' }, [next, grow], ctx, on), grow);
  assert.equal(commandForKey({ ...key('ξ'), code: 'KeyJ' }, [next], ctx, on), next);
  assert.equal(commandForKey({ ...key('о'), code: 'KeyO' }, [next], ctx, on), undefined);
  assert.equal(commandForKey({ ...key('∆', { alt: true }), code: 'KeyJ' }, [next], ctx, { ...on, mac: true }), undefined, 'Mac Option+J');
  assert.equal(commandForKey({ ...key(';'), code: 'KeyJ' }, [next], ctx, on), undefined, 'ASCII is matched as typed');
});

test('the Line openers answer `/` and `@` typed with Shift, AltGr or Option', async () => {
  const { lineCommands } = await import('../line/commands.ts');
  const { typedCharacter } = await import('../selection/bind.ts');
  const openers = lineCommands().map((c) => ({ ...c, when: () => true }));
  const on = { inEditable: false, mac: false, pageKeys: true };
  const id = (e: Parameters<typeof commandForKey>[0], mac = false) => commandForKey(e, openers, ctx, { ...on, mac })?.id;
  assert.equal(id(key('/', { shift: true })), 'line.find', 'German Shift+7');
  assert.equal(id(key('/')), 'line.find');
  const altGr = typedCharacter({ ...key('@', { ctrl: true, alt: true }), code: 'KeyQ' }, false);
  assert.ok(altGr);
  assert.equal(id(altGr), 'line.outline', 'German AltGr+Q');
  const option = typedCharacter({ ...key('~', { alt: true }), code: 'KeyN' }, true);
  assert.ok(option);
  assert.equal(id(option, true), 'line.pair', 'German Mac Option+N');
  assert.equal(typedCharacter({ ...key('k', { ctrl: true, alt: true }), code: 'KeyK' }, false), null, 'Ctrl+Alt+K is a chord');
  assert.equal(typedCharacter({ ...key('/'), code: 'Slash' }, false), null);
});
