// Live reload lifted out of app.ts (B-14): one watch per store, which follows the store's path and
// closes with it, and a reload that puts every view at its own place in the new bytes. Node only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { WatchEvent } from '@marxy/shell-api';
import type { RenderedView } from '../view/rendered-view.ts';
import { oneWatchPerStore, watchDocument, type LiveReloadDeps } from './live-reload.ts';
import { openDocumentStore, type DocumentStore } from './store.ts';

const enc = new TextEncoder();

interface FakeShell {
  readonly shell: LiveReloadDeps['shell'];
  readonly watches: { root: string; closed: boolean; emit(events: readonly WatchEvent[]): void }[];
  readonly disk: Map<string, Uint8Array>;
  readonly marks: string[];
}

function fakeShell(disk: Map<string, Uint8Array>): FakeShell {
  const watches: FakeShell['watches'] = [];
  const marks: string[] = [];
  const shell: LiveReloadDeps['shell'] = {
    async watch(root, onEvents) {
      const entry = { root, closed: false, emit: (events: readonly WatchEvent[]) => onEvents(events) };
      watches.push(entry);
      return { close: () => { entry.closed = true; } };
    },
    async readFile(path) {
      const bytes = disk.get(path);
      if (!bytes) throw new Error(`not found: ${path}`);
      return bytes;
    },
    async mark(name) {
      marks.push(name);
    },
    async allowAssetScope() {},
  } as LiveReloadDeps['shell'];
  return { shell, watches, disk, marks };
}

/** A view as the watch sees one: a place in the store's file, and the reload place it is told. */
function fakeView(store: DocumentStore, place: Omit<ReadingPosition, 'path'>): RenderedView & { readonly told: ReadingPosition[] } {
  const told: ReadingPosition[] = [];
  return {
    told,
    document: () => ({}) as never,
    position: () => ({ ...place, path: store.snapshot().path }),
    expectReloadAt(p: ReadingPosition | null) {
      if (p) told.push(p);
    },
    settled: async () => {},
    sourceHasUnfoldedEdits: () => false,
  } as unknown as RenderedView & { readonly told: ReadingPosition[] };
}

function deps(shell: LiveReloadDeps['shell']): LiveReloadDeps & { queue: Promise<unknown> } {
  const d = {
    shell,
    queue: Promise.resolve() as Promise<unknown>,
    open: async () => {},
    serially<T>(fn: () => Promise<T>): Promise<T> {
      const run = d.queue.then(fn);
      d.queue = run.catch(() => undefined);
      return run;
    },
    foldSource: async () => {},
    renamed: async () => {},
    changed: () => {},
  };
  return d;
}

function storeFor(fake: FakeShell, path: string): DocumentStore {
  return openDocumentStore(
    { writeFileAtomic: async (p, b) => { fake.disk.set(p, b); } },
    path,
    fake.disk.get(path)!,
  );
}

test('a reload tells each view its own place, carried through the change on disk', async () => {
  const text = '# One\n\nFirst paragraph here.\n\n## Two\n\nSecond paragraph here.\n';
  const fake = fakeShell(new Map([['/d/a.md', enc.encode(text)]]));
  const store = storeFor(fake, '/d/a.md');
  const first = fakeView(store, { byteOffset: text.indexOf('First'), fraction: 0, mode: 'rendered' });
  const second = fakeView(store, { byteOffset: text.indexOf('## Two'), fraction: 0.5, mode: 'rendered' });
  const d = deps(fake.shell);
  await watchDocument(store, () => [first, second], d);
  const inserted = '# Above\n\nA section an agent wrote above the reader.\n\n';
  fake.disk.set('/d/a.md', enc.encode(inserted + text));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  const shift = enc.encode(inserted).length;
  assert.deepEqual(first.told.map((p) => p.byteOffset), [text.indexOf('First') + shift]);
  assert.deepEqual(second.told.map((p) => [p.byteOffset, p.fraction]), [[text.indexOf('## Two') + shift, 0.5]]);
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), inserted + text);
  assert.ok(fake.marks.includes('live_reload'));
});

test('a Save as moves the watch to the new folder, and a change there reloads', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')]]));
  const store = storeFor(fake, '/d/a.md');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  const d = deps(fake.shell);
  await watchDocument(store, () => [view], d);
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 3 }, replacement: 'B', label: 'edit' });
  assert.equal((await store.save({ to: '/e/b.md' })).result, 'saved');
  // The store tells its subscribers synchronously; the new watch is set up on the next turn.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(fake.watches.map((w) => [w.root, w.closed]), [['/d', true], ['/e', false]]);
  fake.disk.set('/e/b.md', enc.encode('# C\n'));
  fake.watches[1].emit([{ kind: 'modified', path: '/e/b.md' }]);
  await d.queue;
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), '# C\n');
});

test('the watch closes with its store', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')]]));
  const store = storeFor(fake, '/d/a.md');
  await watchDocument(store, () => [], deps(fake.shell));
  assert.equal(fake.watches[0].closed, false);
  store.close();
  assert.equal(fake.watches[0].closed, true);
});

test('a Save as resolves `moved` only once the new folder\'s watch is registered (the B-14 review)', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')]]));
  // On Tauri a watch is two round trips (watch_root, listen): registration resolves later than the save.
  const register = fake.shell.watch;
  let release!: () => void;
  const late = new Promise<void>((resolve) => { release = resolve; });
  fake.shell.watch = async (root, onEvents) => {
    if (root === '/e') await late;
    return register(root, onEvents);
  };
  const store = storeFor(fake, '/d/a.md');
  const watch = await watchDocument(store, () => [], deps(fake.shell));
  assert.equal((await store.save({ to: '/e/b.md' })).result, 'saved');
  let moved = false;
  const moving = watch.moved().then(() => { moved = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(moved, false, 'moved before the new watch exists');
  release();
  await moving;
  assert.deepEqual(fake.watches.map((w) => [w.root, w.closed]), [['/d', true], ['/e', false]]);
});

test('one watch per store, however often it is asked for; another store gets its own', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')], ['/d/b.md', enc.encode('# B\n')]]));
  const watches = oneWatchPerStore((store) => watchDocument(store, () => [], deps(fake.shell)));
  const a = storeFor(fake, '/d/a.md');
  assert.equal(watches.of(a), null);
  const first = await watches.watch(a);
  assert.equal(await watches.watch(a), first);
  assert.equal(await watches.of(a), first);
  assert.equal(fake.watches.length, 1, 'a second finishDocumentOpen for one store starts no second watch');
  a.close();
  const b = storeFor(fake, '/d/b.md');
  assert.notEqual(await watches.watch(b), first);
  assert.equal(watches.of(a), null);
  assert.deepEqual(fake.watches.map((w) => w.closed), [true, false]);
});

test('a watch shared by two panes survives one of them going: it closes with the store, when the last view lets go (D-10)', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')]]));
  const watches = oneWatchPerStore((store) => watchDocument(store, () => [], deps(fake.shell)));
  const a = storeFor(fake, '/d/a.md');
  const first = await watches.watch(a);
  // The second pane to show the store asks for its watch and gets the same one: no second `shell.watch`.
  assert.equal(await watches.watch(a), first);
  assert.equal(fake.watches.length, 1);
  assert.deepEqual(fake.watches.map((w) => w.closed), [false]);
  a.close();
  assert.deepEqual(fake.watches.map((w) => w.closed), [true]);
  assert.equal(watches.of(a), null);
});

test('an event that names another file in the folder reads nothing for this store (D-10)', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')], ['/d/b.md', enc.encode('# B\n')]]));
  const reads: string[] = [];
  const read = fake.shell.readFile.bind(fake.shell);
  fake.shell.readFile = async (path) => {
    reads.push(path);
    return read(path);
  };
  const a = storeFor(fake, '/d/a.md');
  const view = fakeView(a, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  const d = deps(fake.shell);
  await watchDocument(a, () => [view], d);
  fake.disk.set('/d/b.md', enc.encode('# B changed\n'));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/b.md' }]);
  await d.queue;
  assert.deepEqual(reads, [], 'a.md is not read for an event on b.md');
  assert.equal(new TextDecoder().decode(a.snapshot().buffer.bytes), '# A\n');
});

test('a reload asks every view at the commit: Source text in any of them keeps the outside change out (D-10)', async () => {
  const text = '# One\n\nFirst paragraph here.\n';
  const fake = fakeShell(new Map([['/d/a.md', enc.encode(text)]]));
  const store = storeFor(fake, '/d/a.md');
  const quiet = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  const typing = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'source' });
  let holding = false;
  (typing as unknown as { sourceHasUnfoldedEdits(): boolean }).sourceHasUnfoldedEdits = () => holding;
  // The reader's key lands after the watch looked and before the store's turn: only `holds` sees it.
  const outcome = await store.reload(enc.encode('# Outside\n'), { holds: () => (holding = true) });
  assert.equal(outcome, 'kept');
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), text, 'nothing was adopted');
  assert.equal(quiet.told.length, 0);
});
