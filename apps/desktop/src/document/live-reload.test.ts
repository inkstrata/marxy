// Live reload lifted out of app.ts: one watch per store, which follows the store's path and
// closes with it, and a reload that puts every view at its own place in the new bytes. Node only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingPosition } from '@marxy/core/src/contracts/position.ts';
import type { WatchEvent } from '@marxy/shell-api';
import type { RenderedView } from '../view/rendered-view.ts';
import { oneWatchPerStore, watchDocument, type LiveReloadDeps } from './live-reload.ts';
import { openDocumentStore, type DocumentStore } from './store.ts';

const enc = new TextEncoder();
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

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

test('a Save as resolves `moved` only once the new folder\'s watch is registered', async () => {
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

test('a watch shared by two panes survives one of them going: it closes with the store, when the last view lets go', async () => {
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

test('an event that names another file in the folder reads nothing for this store', async () => {
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

test('a reload asks every view at the commit: Source text in any of them keeps the outside change out', async () => {
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

// ---- the watch raises the choice; the store holds it once for every pane ----

test('an outside write over unsaved edits: kept, every pane told once, one pending choice, nothing written', async () => {
  const text = '# One\n\nFirst paragraph.\n';
  const fake = fakeShell(new Map([['/d/a.md', enc.encode(text)]]));
  const writes: string[] = [];
  const store = openDocumentStore(
    {
      // Refused as the shell refuses a write whose baseline (`expected`) is no longer on disk.
      writeFileAtomic: async (p, b, expected) => {
        const there = fake.disk.get(p);
        if (expected && there && !sameBytes(there, expected)) throw Object.assign(new Error(`${p}: changed on disk since it was opened; refusing to overwrite`), { code: 'changed' });
        writes.push(p);
        fake.disk.set(p, b);
      },
      writeFileNew: async (p, b) => { if (fake.disk.has(p)) throw Object.assign(new Error('exists'), { code: 'exists' }); writes.push(p); fake.disk.set(p, b); }, peekFile: async (p) => fake.disk.get(p)! },
    '/d/a.md',
    fake.disk.get('/d/a.md')!,
  );
  await store.apply({ range: { file: '/d/a.md', start: 2, end: 5 }, replacement: 'Mine', label: 'edit' });
  const first = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  const second = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  const told: unknown[] = [];
  const d = Object.assign(deps(fake.shell), { onConflict: (target: unknown) => void told.push(target) });
  await watchDocument(store, () => [first, second], d);
  fake.disk.set('/d/a.md', enc.encode('# Theirs\n'));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  assert.equal(told.length, 2, 'said in each pane that shows the file');
  assert.equal(new TextDecoder().decode(store.conflict()!), '# Theirs\n', 'one pending choice, on the store');
  assert.equal(store.snapshot().dirty, true, 'nothing lost: the title still shows unsaved');
  assert.match(new TextDecoder().decode(store.snapshot().buffer.bytes), /^# Mine/);
  assert.deepEqual(writes, [], 'nothing is written until the reader chooses');
  // Dismissing the notice is not a choice: both versions are still safe, and a save still refuses.
  assert.equal((await store.save()).result, 'failed');
  assert.deepEqual(writes, []);
  // A further change while pending updates the held bytes and says so again.
  fake.disk.set('/d/a.md', enc.encode('# Theirs again\n'));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  assert.equal(new TextDecoder().decode(store.conflict()!), '# Theirs again\n');
  assert.equal(told.length, 4);
});

test('Source text typed and not folded in is an unsaved edit the choice holds for too', async () => {
  const text = '# One\n\nFirst paragraph.\n';
  const fake = fakeShell(new Map([['/d/a.md', enc.encode(text)]]));
  const store = storeFor(fake, '/d/a.md');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'source' });
  (view as unknown as { sourceHasUnfoldedEdits(): boolean }).sourceHasUnfoldedEdits = () => true;
  const told: unknown[] = [];
  const d = Object.assign(deps(fake.shell), { onConflict: (target: unknown) => void told.push(target) });
  await watchDocument(store, () => [view], d);
  fake.disk.set('/d/a.md', enc.encode('# Theirs\n'));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  assert.equal(told.length, 1);
  assert.equal(new TextDecoder().decode(store.conflict()!), '# Theirs\n', 'the store holds it though its own buffer is clean');
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), text, 'nothing adopted over the typing');
});

test('an outside write of exactly the buffer\'s bytes raises no choice', async () => {
  const text = '# One\n';
  const fake = fakeShell(new Map([['/d/a.md', enc.encode(text)]]));
  const store = storeFor(fake, '/d/a.md');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'source' });
  (view as unknown as { sourceHasUnfoldedEdits(): boolean }).sourceHasUnfoldedEdits = () => true;
  const told: unknown[] = [];
  const d = Object.assign(deps(fake.shell), { onConflict: (target: unknown) => void told.push(target) });
  await watchDocument(store, () => [view], d);
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  assert.deepEqual(told, []);
  assert.equal(store.conflict(), null);
});

// `read_file` refuses a file over the ceiling and one that is not a regular file; live reload said "removed".
function refusedReload(refusal: string): Promise<{ said: string[]; bytes: string; writes: number }> {
  return (async () => {
    const fake = fakeShell(new Map([['/d/app.log', enc.encode('# A log\n')]]));
    let writes = 0;
    const store = openDocumentStore(
      { writeFileAtomic: async () => { writes++; } },
      '/d/app.log',
      fake.disk.get('/d/app.log')!,
    );
    const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
    Object.assign(view, { host: null });
    fake.shell.readFile = async () => {
      throw Object.assign(new Error(refusal), { code: 'refused' });
    };
    const said: string[] = [];
    const d = deps(fake.shell);
    Object.assign(d, { onRefused: (text: string) => { said.push(text); } });
    await watchDocument(store, () => [view], d);
    fake.watches[0].emit([{ kind: 'modified', path: '/d/app.log' }]);
    await d.queue;
    return { said, bytes: new TextDecoder().decode(store.snapshot().buffer.bytes), writes };
  })();
}

test('an open file that grows past the ceiling says so, not that it was removed; the buffer stays', async () => {
  const r = await refusedReload('/d/app.log: too large to open (300 MB; the most Marxy opens is 256 MB)');
  assert.deepEqual(r.said, [
    'app.log grew to 300 MB, past the 256 MB Marxy opens · your open copy is unchanged · Make the file smaller on disk to reload it, or Save as to keep this copy.',
  ]);
  assert.equal(r.bytes, '# A log\n');
  assert.equal(r.writes, 0);
});

const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} sits here, long enough to be a paragraph of its own.`);
const lfText = `# Title\n\n${paragraphs.join('\n\n')}\n`;

/** One reload of `before` to `after` with the reader at `at`; the offsets each view was told, and what the reload said. */
async function reloadPlace(before: string, after: string, at: number, opts: { parse?: boolean } = {}): Promise<{ told: number[]; said: number }> {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode(before)]]));
  const store = storeFor(fake, '/d/a.md');
  if (opts.parse) store.snapshot().ast;
  const view = fakeView(store, { byteOffset: at, fraction: 0.25, mode: 'rendered' });
  let said = 0;
  const d = deps(fake.shell);
  Object.assign(d, { onConflict: () => { said++; }, onRefused: () => { said++; } });
  await watchDocument(store, () => [view], d);
  fake.disk.set('/d/a.md', enc.encode(after));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  return { told: view.told.map((p) => p.byteOffset), said };
}

test('LF to CRLF keeps the reader on their paragraph, parsed or not, and says nothing', async () => {
  const crlf = lfText.replace(/\n/g, '\r\n');
  const at = lfText.indexOf('Paragraph 8');
  for (const parse of [false, true]) {
    const r = await reloadPlace(lfText, crlf, at, { parse });
    assert.deepEqual(r.told, [crlf.indexOf('Paragraph 8')], parse ? 'parsed' : 'bytes only');
    assert.equal(r.said, 0);
  }
  const back = await reloadPlace(crlf, lfText, crlf.indexOf('Paragraph 5'));
  assert.deepEqual(back.told, [lfText.indexOf('Paragraph 5')], 'CRLF to LF');
});

test('a reformat over the whole file keeps the line, or the same share of lines when their count changed', async () => {
  const indented = lfText.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n');
  const at = lfText.indexOf('Paragraph 6');
  assert.deepEqual((await reloadPlace(lfText, indented, at)).told, [indented.indexOf('  Paragraph 6')]);
  // Every paragraph rewrapped to two lines: the reader is as far down the file as they were.
  const wrapped = `# Title\n\n${paragraphs.map((p) => `> ${p.replace(', long', ',\n> long')}`).join('\n\n')}\n`;
  const [told] = (await reloadPlace(lfText, wrapped, at)).told;
  const share = told! / wrapped.length;
  assert.ok(Math.abs(share - at / lfText.length) < 0.08, `${share} near ${at / lfText.length}`);
});

test('an edit round the reader still lands where the change starts, as before', async () => {
  const at = lfText.indexOf('Paragraph 6');
  const edited = lfText.replace('Paragraph 6 sits here', 'Something else entirely sits here');
  assert.deepEqual((await reloadPlace(lfText, edited, at + 3)).told, [at]);
});

test('a watch read of our first save that lands after our second: the buffer stays the second, undo and the next save work', async () => {
  const path = '/d/a.md';
  const fake = fakeShell(new Map([[path, enc.encode('A\n')]]));
  let copying: Promise<void> = Promise.resolve();
  const store = openDocumentStore(
    {
      writeFileAtomic: async (p, b) => void fake.disk.set(p, b.slice()),
      peekFile: async (p) => fake.disk.get(p)!,
      beforeOverwrite: () => copying,
    },
    path,
    fake.disk.get(path)!,
  );
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  const d = deps(fake.shell);
  await watchDocument(store, () => [view], d);
  const whole = () => ({ file: path, start: 0, end: store.snapshot().buffer.bytes.length });
  await store.apply({ range: whole(), replacement: 'B\n', label: 'type' });
  assert.equal((await store.save()).result, 'saved');
  // The watch reads the first save; meanwhile the reader types and saves again, and that save's copy is slow.
  let saving!: Promise<unknown>;
  let release!: () => void;
  const read = fake.shell.readFile;
  fake.shell.readFile = async (p) => {
    const bytes = await read(p);
    fake.shell.readFile = read;
    await store.apply({ range: whole(), replacement: 'C\n', label: 'type' });
    copying = new Promise((resolve) => (release = resolve));
    saving = store.save();
    return bytes;
  };
  fake.watches[0].emit([{ kind: 'modified', path }]);
  // The read's reload is queued behind the save by now; the copy finishes and the save writes.
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await saving;
  await d.queue;
  const snap = store.snapshot();
  assert.equal(new TextDecoder().decode(snap.buffer.bytes), 'C\n');
  assert.equal(new TextDecoder().decode(snap.disk!), 'C\n');
  assert.equal(snap.canUndo, true);
  await store.apply({ range: { file: path, start: 0, end: 0 }, replacement: 'more ', label: 'type' });
  assert.equal((await store.save()).result, 'saved');
  assert.equal(new TextDecoder().decode(fake.disk.get(path)!), 'more C\n');
});

test('the place is read after the file is: a scroll while the read waits is kept', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode(lfText)]]));
  const store = storeFor(fake, '/d/a.md');
  let at = lfText.indexOf('Paragraph 2');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  Object.assign(view, { position: () => ({ byteOffset: at, fraction: 0, mode: 'rendered', path: '/d/a.md' }) });
  const read = fake.shell.readFile;
  fake.shell.readFile = async (p) => {
    at = lfText.indexOf('Paragraph 9');
    return read(p);
  };
  const d = deps(fake.shell);
  await watchDocument(store, () => [view], d);
  const appended = `${lfText}\nAppended.\n`;
  fake.disk.set('/d/a.md', enc.encode(appended));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  assert.deepEqual(view.told.map((p) => p.byteOffset), [lfText.indexOf('Paragraph 9')]);
});

test('an open file that becomes a pipe or a folder says so, not that it was removed', async () => {
  const r = await refusedReload('/d/app.log: not a regular file (a folder, pipe or device cannot be opened)');
  assert.equal(r.said.length, 1);
  assert.match(r.said[0], /^app\.log is no longer a regular file .* · your open copy is unchanged · /);
  assert.equal(r.bytes, '# A log\n');
  assert.equal(r.writes, 0);
});

// only "not found" means the file is gone; a file another program holds is there, just not readable now.
test('a file held by another program past the retries is said to be unreadable, not removed; the buffer stays', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')]]));
  const store = storeFor(fake, '/d/a.md');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  Object.assign(view, { host: null });
  let reads = 0;
  fake.shell.readFile = async () => {
    reads++;
    throw Object.assign(new Error('/d/a.md: The process cannot access the file because it is being used by another process. (os error 32)'), { code: 'io' });
  };
  const said: string[] = [];
  const d = deps(fake.shell);
  Object.assign(d, { onRefused: (text: string) => { said.push(text); } });
  await watchDocument(store, () => [view], d);
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  assert.ok(reads > 3, `retried a sharing violation (${reads} reads)`);
  assert.equal(said.length, 1);
  assert.match(said[0]!, /^a\.md could not be read/);
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), '# A\n');
});

test('a file held for a moment is read once it is let go, and reloads', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')]]));
  const store = storeFor(fake, '/d/a.md');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  let held = 4;
  const read = fake.shell.readFile;
  fake.shell.readFile = async (path) => {
    if (held-- > 0) throw Object.assign(new Error(`${path}: Access is denied. (os error 5)`), { code: 'permission' });
    return read(path);
  };
  const d = deps(fake.shell);
  Object.assign(d, { onRefused: () => assert.fail('nothing to say') });
  await watchDocument(store, () => [view], d);
  fake.disk.set('/d/a.md', enc.encode('# B\n'));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  await d.queue;
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), '# B\n');
});

// a file appended to all the time sends a batch per poll; reloads queued behind one another are stale.
test('batches for a growing file coalesce: one reload runs, one waits, the rest are dropped', async () => {
  const fake = fakeShell(new Map([['/d/app.log', enc.encode('line 0\n')]]));
  const store = storeFor(fake, '/d/app.log');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  let reads = 0;
  const read = fake.shell.readFile;
  fake.shell.readFile = async (path) => {
    reads++;
    await new Promise((r) => setTimeout(r, 20));
    return read(path);
  };
  const d = deps(fake.shell);
  await watchDocument(store, () => [view], d);
  let text = 'line 0\n';
  for (let i = 1; i <= 50; i++) {
    text += `line ${i}\n`;
    fake.disk.set('/d/app.log', enc.encode(text));
    fake.watches[0].emit([{ kind: 'modified', path: '/d/app.log' }, { kind: 'modified', path: '/d/other.log' }]);
    // The first reload is under way (its read takes a while); every batch after it arrives during that read.
    if (i === 1) await new Promise((r) => setTimeout(r, 0));
  }
  await d.queue;
  await d.queue;
  assert.equal(reads, 2, `${reads} reads for 50 batches`);
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), text, 'the last bytes are on the page');
});

test('a removal behind a queued reload is not folded into it', async () => {
  const fake = fakeShell(new Map([['/d/a.md', enc.encode('# A\n')]]));
  const store = storeFor(fake, '/d/a.md');
  const view = fakeView(store, { byteOffset: 0, fraction: 0, mode: 'rendered' });
  Object.assign(view, { host: null });
  const d = deps(fake.shell);
  let release!: () => void;
  // Hold the queue so the batches below wait in it.
  void d.serially(() => new Promise<void>((r) => { release = r; }));
  await watchDocument(store, () => [view], d);
  fake.disk.set('/d/a.md', enc.encode('# B\n'));
  fake.watches[0].emit([{ kind: 'modified', path: '/d/a.md' }]);
  fake.watches[0].emit([{ kind: 'removed', path: '/d/a.md' }]);
  fake.watches[0].emit([{ kind: 'created', path: '/d/a.md' }]);
  let reads = 0;
  const read = fake.shell.readFile;
  fake.shell.readFile = async (path) => {
    reads++;
    return read(path);
  };
  release();
  await d.queue;
  await d.queue;
  assert.equal(reads, 2, 'the reload before the removal and the one after it');
  assert.equal(new TextDecoder().decode(store.snapshot().buffer.bytes), '# B\n');
});
