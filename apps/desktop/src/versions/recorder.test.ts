// The version recorder (V-06, ADR-0072) over real document stores and a recorded data folder. When a version is taken: at an
// open (`read`), at a save (`before save`: what was on disk) and at an outside change (`before reload`, then `read` of what came);
// never for a keystroke, an undo or a fold of Source. What *Changed since you read* compares. `versions = false`, a deny rule
// and the large-file limit write nothing. Every write is under the data folder, and none touches the reader's file.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openDocumentStore, type DocumentStore } from '../document/store.ts';
import { LARGE_FILE_BYTES } from '../source/language.ts';
import { installVersionRecorder, VERSIONS_LARGE_FILE_BYTES, type RecorderShell } from './recorder.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

function harness(files: Record<string, string> = {}, hold = false) {
  const disk = new Map<string, Uint8Array>(Object.entries(files).map(([p, t]) => [p, enc(t)]));
  const writes: string[] = [];
  const reads: string[] = [];
  let failing: Error | null = null;
  const notFound = (p: string) => Object.assign(new Error(`not found: ${p}`), { code: 'not-found' });
  const shell: RecorderShell & { writeFileAtomic(p: string, b: Uint8Array): Promise<void> } = {
    async readHead(p, max) {
      reads.push(p);
      const b = disk.get(p);
      if (!b) throw notFound(p);
      return b.slice(0, max);
    },
    async readFile(p) {
      reads.push(p);
      const b = disk.get(p);
      if (!b) throw notFound(p);
      return b.slice();
    },
    async writeFileAtomic(p, b) {
      writes.push(p);
      if (failing && p.startsWith('/data/')) throw failing;
      disk.set(p, b.slice());
    },
    async readDir(dir) {
      return [...disk.entries()].filter(([p]) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/')).map(([path, b]) => ({ path, size: b.length, isDir: false }));
    },
    configPaths: async () => ({ config: '/config', data: '/data' }),
  };
  // One pane, as the app's first: its store, and the listeners its open path calls on every change.
  let shown: DocumentStore | null = null;
  const listeners = new Set<() => void>();
  const pane = { content: { store: () => shown, onDocumentChange: (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb)) } };
  const told: string[] = [];
  // A second pane, as the split makes it: its own store and listeners, followed once `split` has run the app's onSplit callbacks.
  let shown2: DocumentStore | null = null;
  const listeners2 = new Set<() => void>();
  const pane2 = { content: { store: () => shown2, onDocumentChange: (cb: () => void) => (listeners2.add(cb), () => listeners2.delete(cb)) } };
  const paneList = [pane];
  const splitCallbacks: ((main: HTMLElement) => () => void)[] = [];
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => (release = resolve));
  const recorder = installVersionRecorder({
    shell,
    panes: { panes: paneList, onSplit: (cb) => splitCallbacks.push(cb) },
    ready: hold ? ready : Promise.resolve(),
    notify: (t) => told.push(t),
  })!;
  const split = (): (() => void) => {
    paneList.push(pane2);
    const offs = splitCallbacks.map((cb) => cb({} as HTMLElement));
    return () => {
      paneList.pop();
      for (const off of offs) off();
    };
  };
  const openSecond = (path: string): DocumentStore => {
    const store = openDocumentStore(io, path, disk.get(path)!.slice());
    shown2 = store;
    store.subscribe(() => {
      for (const cb of listeners2) cb();
    });
    for (const cb of listeners2) cb();
    return store;
  };
  const io = { writeFileAtomic: (p: string, b: Uint8Array) => shell.writeFileAtomic(p, b), peekFile: async (p: string) => disk.get(p)!.slice() };
  const open = (path: string): DocumentStore => {
    const store = openDocumentStore(io, path, disk.get(path)!.slice());
    shown = store;
    store.subscribe(() => {
      for (const cb of listeners) cb();
    });
    for (const cb of listeners) cb();
    return store;
  };
  const reasons = async (path: string) => {
    await recorder.settled();
    const l = await recorder.store.list(path);
    return l.kind === 'ok' ? l.versions.map((v) => v.reason) : l.kind;
  };
  return { disk, writes, reads, shell, recorder, open, openSecond, split, release: () => release(), reasons, told, fail: (e: Error | null) => (failing = e) };
}

test('the large-file limit here is the editor\'s', () => {
  assert.equal(VERSIONS_LARGE_FILE_BYTES, LARGE_FILE_BYTES);
});

test('an open keeps a read, a save keeps what was on disk before it, an outside change keeps what it replaced and then what came', async () => {
  const h = harness({ '/r/x.md': '# One\n\nfirst\n' });
  const store = h.open('/r/x.md');
  assert.deepEqual(await h.reasons('/r/x.md'), ['read']);
  await store.apply({ range: { file: '/r/x.md', start: 7, end: 12 }, replacement: 'second', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  assert.deepEqual(await h.reasons('/r/x.md'), ['read'], 'what was on disk before the save is the read: kept once');
  await store.apply({ range: { file: '/r/x.md', start: 7, end: 13 }, replacement: 'third', label: 'edit' });
  await store.save();
  assert.deepEqual(await h.reasons('/r/x.md'), ['before save', 'read'], 'the second save keeps the first save\'s bytes');
  h.disk.set('/r/x.md', enc('# One\n\nfrom outside\n'));
  assert.equal(await store.reload(h.disk.get('/r/x.md')!), 'reloaded');
  assert.deepEqual(await h.reasons('/r/x.md'), ['read', 'before reload', 'before save', 'read']);
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const bytes = async (i: number) => {
    const r = await h.recorder.store.read('/r/x.md', l.versions[i]!.id);
    return r.kind === 'bytes' ? dec(r.bytes) : r.kind;
  };
  assert.deepEqual([await bytes(0), await bytes(1), await bytes(2), await bytes(3)], ['# One\n\nfrom outside\n', '# One\n\nthird\n', '# One\n\nsecond\n', '# One\n\nfirst\n']);
});

test('nothing is kept for a keystroke, an undo, a redo or a fold of Source; nothing on a timer', async () => {
  const h = harness({ '/r/x.md': 'abc\n' });
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  const before = h.writes.length;
  for (let i = 0; i < 5; i++) await store.apply({ range: { file: '/r/x.md', start: 0, end: 0 }, replacement: `${i}`, label: 'type' });
  await store.undo();
  await store.redo();
  await store.commitSource('zzz\n');
  await new Promise((r) => setTimeout(r, 30));
  await h.recorder.settled();
  assert.equal(h.writes.length, before);
});

test('every write the recorder makes is under the data folder, and the reader\'s file is written only by its own save', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  const store = h.open('/r/x.md');
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  await store.save();
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  await store.save();
  h.disk.set('/r/x.md', enc('outside\n'));
  await store.reload(enc('outside\n'));
  await h.recorder.settled();
  await h.recorder.clear('/r/x.md');
  await h.recorder.clearAll();
  const outside = h.writes.filter((p) => !p.startsWith('/data/'));
  assert.deepEqual(outside, ['/r/x.md', '/r/x.md'], 'the two saves, and nothing else');
  assert.ok(h.writes.filter((p) => p.startsWith('/data/versions-')).length >= 6);
  assert.ok(!h.reads.some((p) => p.startsWith('/r/')), 'the recorder reads none of the reader\'s files: it keeps the store\'s own bytes');
});

test('Changed since you read: at an open, the read before it (or this one); after an outside change, what was replaced; after a save, what you saved', async () => {
  const h = harness({ '/r/x.md': 'yesterday\n' });
  const first = h.open('/r/x.md');
  await h.recorder.settled();
  assert.equal(dec(h.recorder.since(first)!.bytes), 'yesterday\n', 'a first read is its own baseline: nothing has changed since');
  first.close();
  // Changed while Marxy was not looking (the regenerated agent file), then opened again.
  h.disk.set('/r/x.md', enc('today\n'));
  const again = h.open('/r/x.md');
  await h.recorder.settled();
  const since = h.recorder.since(again);
  assert.equal(since && dec(since.bytes), 'yesterday\n');
  assert.equal(since?.how, 'read');
  assert.equal(since?.savedSince, false);
  // An outside change while open: what it replaced.
  h.disk.set('/r/x.md', enc('later\n'));
  await again.reload(enc('later\n'));
  assert.equal(dec(h.recorder.since(again)!.bytes), 'today\n');
  assert.equal(h.recorder.since(again)!.how, 'changed on disk');
  // A save of the reader's own: the file holds what they wrote.
  await again.apply({ range: { file: '/r/x.md', start: 0, end: 5 }, replacement: 'mine!', label: 'edit' });
  assert.equal((await again.save()).result, 'saved');
  assert.deepEqual([dec(h.recorder.since(again)!.bytes), h.recorder.since(again)!.how], ['mine!\n', 'saved'], 'what they wrote: nothing changed since');
  again.close();
  // Opened again: the last read was "later"; they saved since, and the tab says so.
  const third = h.open('/r/x.md');
  await h.recorder.settled();
  const s3 = h.recorder.since(third)!;
  assert.equal(dec(s3.bytes), 'later\n');
  assert.equal(s3.savedSince, true);
  // A change held back over unsaved edits (no reload) still differs from the baseline: the tab can say so.
  await third.apply({ range: { file: '/r/x.md', start: 0, end: 0 }, replacement: '> ', label: 'edit' });
  assert.equal(await third.reload(enc('someone else\n')), 'kept');
  assert.equal(dec(h.recorder.since(third)!.bytes), 'later\n');
  // Clear forgets it too.
  await h.recorder.clear('/r/x.md');
  assert.equal(h.recorder.since(third), null);
});

test('versions = false, a [deny] glob, the built-in deny list and the large-file limit write nothing, and status says which', async () => {
  const big = 'x'.repeat(VERSIONS_LARGE_FILE_BYTES + 1);
  const h = harness({
    '/config': 'versions = false\n',
    '/collection.toml': '[deny]\nglobs = ["**/drafts/**"]\n',
    '/r/off.md': 'a\n',
  });
  h.open('/r/off.md');
  await h.recorder.settled();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(await h.recorder.status('/r/off.md', 2), { kind: 'off' });
  h.disk.set('/config', enc('versions = true\n'));
  h.disk.set('/r/drafts/plan.md', enc('draft\n'));
  h.disk.set('/r/node_modules/p/README.md', enc('dep\n'));
  h.disk.set('/r/big.md', enc(big));
  for (const p of ['/r/drafts/plan.md', '/r/node_modules/p/README.md', '/r/big.md']) h.open(p);
  await h.recorder.settled();
  assert.equal(h.writes.length, 0, 'nothing kept of a denied or large file');
  assert.deepEqual(await h.recorder.status('/r/drafts/plan.md', 6), { kind: 'denied', rule: '**/drafts/**', builtIn: false });
  assert.deepEqual(await h.recorder.status('/r/node_modules/p/README.md', 4), { kind: 'denied', rule: 'node_modules', builtIn: true });
  assert.deepEqual(await h.recorder.status('/r/big.md', big.length), { kind: 'large', limit: VERSIONS_LARGE_FILE_BYTES });
  // Turned back on, the next open of an ordinary file is kept.
  h.open('/r/off.md');
  assert.deepEqual(await h.reasons('/r/off.md'), ['read']);
});

test('a keep that fails (disk full) is reported once as a notice and held for the tab; the reader\'s save is not affected', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  h.fail(Object.assign(new Error('No space left on device'), { code: 'io' }));
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  assert.match(String((h.recorder.failure('/r/x.md')?.error as Error).message), /No space left/);
  assert.equal(h.told.length, 1);
  assert.match(h.told[0]!, /could not keep a version of x\.md · the file itself is untouched/);
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  assert.equal((await store.save()).result, 'saved', 'the save itself went through');
  assert.equal(dec(h.disk.get('/r/x.md')!), 'two\n');
  await h.recorder.settled();
  assert.equal(h.told.length, 1, 'said once a session');
  h.fail(null);
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  await store.save();
  await h.recorder.settled();
  assert.equal(h.recorder.failure('/r/x.md'), null, 'a keep that works clears it');
});

test('two panes: each pane\'s document is followed, the same file in both is kept once, and a pane closed stops being followed', async () => {
  const h = harness({ '/r/x.md': 'one\n', '/r/y.md': 'why\n' });
  const a = h.open('/r/x.md');
  const closeSplit = h.split();
  const b = h.openSecond('/r/x.md');
  h.openSecond('/r/y.md');
  assert.deepEqual(await h.reasons('/r/x.md'), ['read'], 'the same bytes opened in two panes are one version');
  assert.deepEqual(await h.reasons('/r/y.md'), ['read'], 'the second pane\'s other file is followed');
  await b.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  assert.equal((await b.save()).result, 'saved');
  await a.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  const stale = await a.save();
  assert.equal(stale.result, 'failed', 'the first pane\'s save over what the second wrote is refused by the store, not by the recorder');
  assert.equal(dec(h.disk.get('/r/x.md')!), 'two\n', 'the second pane\'s bytes are on disk, whole');
  assert.deepEqual(await h.reasons('/r/x.md'), ['read'], 'the open\'s bytes are kept once; the first save wrote nothing, so nothing was replaced');
  assert.deepEqual(h.writes.filter((p) => !p.startsWith('/data/')), ['/r/x.md'], 'only the one save is outside the data folder');
  closeSplit();
  h.disk.set('/r/z.md', enc('zed\n'));
  const before = h.writes.length;
  h.openSecond('/r/z.md');
  await h.recorder.settled();
  assert.equal(h.writes.length, before, 'a document opened in the closed pane is not followed: nothing is kept for it');
});

test('an outside write while a keep is waiting: the version holds the bytes the reader had, never what is on disk now, and no reader file is read', async () => {
  const h = harness({ '/r/x.md': 'mine\n' }, true);
  const store = h.open('/r/x.md');
  h.disk.set('/r/x.md', enc('theirs\n'));
  assert.equal(await store.reload(enc('theirs\n')), 'reloaded');
  h.disk.set('/r/x.md', enc('theirs again\n'));
  h.release();
  await h.recorder.settled();
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const kept: string[] = [];
  for (const v of l.versions) {
    const r = await h.recorder.store.read('/r/x.md', v.id);
    kept.push(`${v.reason}:${r.kind === 'bytes' ? dec(r.bytes) : r.kind}`);
  }
  assert.deepEqual(kept.sort(), ['read:mine\n', 'read:theirs\n'], 'what the reader had (kept once: the read and the before reload are the same bytes) and what came; none of the later disk');
  assert.ok(!h.reads.some((p) => p.startsWith('/r/')));
  assert.equal(dec(h.disk.get('/r/x.md')!), 'theirs again\n', 'the outside program\'s file is as it left it');
});

test('a data folder that fails during a save keeps nothing and the reader\'s own file is written exactly as asked', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  h.fail(Object.assign(new Error('read-only volume'), { code: 'io' }));
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  await h.recorder.settled();
  assert.equal(dec(h.disk.get('/r/x.md')!), 'two\n');
  h.disk.set('/r/x.md', enc('outside\n'));
  assert.equal(await store.reload(enc('outside\n')), 'reloaded', 'an outside change still reloads');
  await h.recorder.settled();
  assert.equal(dec(h.disk.get('/r/x.md')!), 'outside\n');
  assert.ok(h.recorder.failure('/r/x.md'));
  h.fail(null);
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok' && l.versions.every((v) => v.bytes === 'ok'), 'what is listed is whole');
});
