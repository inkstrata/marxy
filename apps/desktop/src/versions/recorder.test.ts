// The version recorder over real document stores and a recorded data folder. When a version is taken: at a
// save (`before save`: what was on disk) and at an outside change (`before reload`: what it replaced); never at an open (the data
// folder is not a record of what was read), and never for a keystroke, an undo or a fold of Source.
// `versions = false`, a deny rule and the large-file limit write nothing. Every write is under the data folder, and none
// touches the reader's file.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeBytes, encodeTextBytes } from '@marxy/core/src/encoding/decode.ts';
import { encodedIo, forgetEncoding, lookForStore, textForStore } from '../document/encoding.ts';
import { openDocumentStore, type DocumentStore, type StoreIo } from '../document/store.ts';
import { LARGE_FILE_BYTES } from '../source/language.ts';
import { flushVersions, installVersionRecorder, VERSIONS_LARGE_FILE_BYTES, type RecorderShell } from './recorder.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

function harness(files: Record<string, string> = {}, hold = false, keepTimeoutMs = 3000) {
  const disk = new Map<string, Uint8Array>(Object.entries(files).map(([p, t]) => [p, enc(t)]));
  const writes: string[] = [];
  const reads: string[] = [];
  let failing: Error | null = null;
  /** While set, a write into the data folder waits for it (a stalled network volume), then goes through. */
  let hung: Promise<void> | null = null;
  const notFound = (p: string) => Object.assign(new Error(`not found: ${p}`), { code: 'not-found' });
  const shell: RecorderShell & { writeFileAtomic(p: string, b: Uint8Array, expected?: Uint8Array): Promise<void> } = {
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
    async writeFileAtomic(p: string, b: Uint8Array, expected?: Uint8Array) {
      // The shell's own check, as Rust makes it: a file that is no longer the caller's baseline is not written.
      const there = disk.get(p);
      if (expected && there && (there.length !== expected.length || there.some((v, i) => v !== expected[i]))) {
        throw Object.assign(new Error(`${p}: changed on disk since it was opened; refusing to overwrite`), { code: 'changed' });
      }
      writes.push(p);
      if (hung && p.startsWith('/data/')) await hung;
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
    keepTimeoutMs,
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
  const io = {
    writeFileAtomic: (p: string, b: Uint8Array, expected?: Uint8Array) => shell.writeFileAtomic(p, b, expected),
    peekFile: async (p: string) => {
      const b = disk.get(p);
      if (!b) throw notFound(p);
      return b.slice();
    },
    beforeOverwrite: (p: string, b: Uint8Array) => recorder.keepBeforeSave(p, b),
  };
  /** `as`: the store's own io and text, for a file read in another encoding (`encodedIo` over this one). */
  const open = (path: string, as?: { readonly io: StoreIo; readonly text: Uint8Array }): DocumentStore => {
    const store = openDocumentStore(as?.io ?? io, path, as?.text ?? disk.get(path)!.slice());
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
  return { disk, writes, reads, shell, io, recorder, open, openSecond, split, release: () => release(), reasons, told, fail: (e: Error | null) => (failing = e),
    /** Hangs data-folder writes until the returned function is called. */
    hang: (): (() => void) => {
      let go: () => void = () => {};
      hung = new Promise<void>((resolve) => (go = resolve));
      return () => {
        hung = null;
        go();
      };
    },
  };
}

test('the large-file limit here is the editor\'s', () => {
  assert.equal(VERSIONS_LARGE_FILE_BYTES, LARGE_FILE_BYTES);
});

test('an open keeps nothing, a save keeps what was on disk before it, an outside change keeps what it replaced and nothing of what came', async () => {
  const h = harness({ '/r/x.md': '# One\n\nfirst\n' });
  const store = h.open('/r/x.md');
  assert.equal(await h.reasons('/r/x.md'), 'none', 'opening a file writes nothing to the data folder');
  assert.deepEqual(h.writes, []);
  await store.apply({ range: { file: '/r/x.md', start: 7, end: 12 }, replacement: 'second', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  assert.deepEqual(await h.reasons('/r/x.md'), ['before save'], 'what was on disk before the save');
  await store.apply({ range: { file: '/r/x.md', start: 7, end: 13 }, replacement: 'third', label: 'edit' });
  await store.save();
  assert.deepEqual(await h.reasons('/r/x.md'), ['before save', 'before save'], 'the second save keeps the first save\'s bytes');
  h.disk.set('/r/x.md', enc('# One\n\nfrom outside\n'));
  assert.equal(await store.reload(h.disk.get('/r/x.md')!), 'reloaded');
  assert.deepEqual(await h.reasons('/r/x.md'), ['before reload', 'before save', 'before save']);
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const bytes = async (i: number) => {
    const r = await h.recorder.store.read('/r/x.md', l.versions[i]!.id);
    return r.kind === 'bytes' ? dec(r.bytes) : r.kind;
  };
  assert.deepEqual([await bytes(0), await bytes(1), await bytes(2)], ['# One\n\nthird\n', '# One\n\nsecond\n', '# One\n\nfirst\n']);
});

test('once a session, after first text, the sweep runs though nothing is kept: a slot a keep cut short is emptied', async () => {
  const orphan = `/data/versions-${'a'.repeat(40)}-01`;
  const h = harness({ '/r/x.md': 'one\n' }, true);
  h.disk.set(orphan, enc('bytes of a copy whose manifest never came\n'));
  h.open('/r/x.md');
  assert.ok(h.disk.get(orphan)!.length > 0, 'nothing runs before the launch is ready');
  h.release();
  await h.recorder.settled();
  assert.equal(h.disk.get(orphan)!.length, 0);
  assert.deepEqual(h.writes, [orphan], 'and nothing else is written');
});

test('opening many files, in both panes, writes nothing to the data folder', async () => {
  const h = harness({ '/r/a.md': 'a\n', '/r/b.md': 'b\n', '/r/c.md': 'c\n' });
  h.open('/r/a.md');
  h.open('/r/b.md');
  h.split();
  h.openSecond('/r/c.md');
  h.openSecond('/r/a.md');
  await h.recorder.settled();
  assert.deepEqual(h.writes, []);
  for (const p of ['/r/a.md', '/r/b.md', '/r/c.md']) assert.equal(await h.reasons(p), 'none', p);
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

test('versions = false, a [deny] glob, the built-in deny list and the large-file limit write nothing, and status says which', async () => {
  const big = 'x'.repeat(VERSIONS_LARGE_FILE_BYTES + 1);
  const h = harness({
    '/config': 'versions = false\n',
    '/collection.toml': '[deny]\nglobs = ["**/drafts/**"]\n',
    '/r/off.md': 'a\n',
  });
  const saveOver = async (p: string, ch = 'z'): Promise<void> => {
    const s = h.open(p);
    await s.apply({ range: { file: p, start: 0, end: 1 }, replacement: ch, label: 'edit' });
    assert.equal((await s.save()).result, 'saved', p);
  };
  const dataWrites = () => h.writes.filter((p) => p.startsWith('/data/')).length;
  await saveOver('/r/off.md');
  await h.recorder.settled();
  assert.equal(dataWrites(), 0);
  assert.deepEqual(await h.recorder.status('/r/off.md', 2), { kind: 'off' });
  h.disk.set('/config', enc('versions = true\n'));
  h.disk.set('/r/drafts/plan.md', enc('draft\n'));
  h.disk.set('/r/node_modules/p/README.md', enc('dep\n'));
  h.disk.set('/r/big.md', enc(big));
  for (const p of ['/r/drafts/plan.md', '/r/node_modules/p/README.md', '/r/big.md']) await saveOver(p);
  await h.recorder.settled();
  assert.equal(dataWrites(), 0, 'nothing kept of a denied or large file');
  assert.deepEqual(await h.recorder.status('/r/drafts/plan.md', 6), { kind: 'denied', rule: '**/drafts/**', builtIn: false });
  assert.deepEqual(await h.recorder.status('/r/node_modules/p/README.md', 4), { kind: 'denied', rule: 'node_modules', builtIn: true });
  assert.deepEqual(await h.recorder.status('/r/big.md', big.length), { kind: 'large', limit: VERSIONS_LARGE_FILE_BYTES });
  // Turned back on, the next save of an ordinary file keeps what it replaced.
  await saveOver('/r/off.md', 'y');
  assert.deepEqual(await h.reasons('/r/off.md'), ['before save']);
});

test('a keep that fails (disk full) is said and held for the tab; an outside change\'s is said once; the reader\'s save is not affected', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  h.fail(Object.assign(new Error('No space left on device'), { code: 'io' }));
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  assert.equal(h.told.length, 0, 'an open keeps nothing, so nothing failed');
  assert.equal(h.recorder.failure('/r/x.md'), null);
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  assert.equal((await store.save()).result, 'saved', 'the save itself went through');
  assert.equal(dec(h.disk.get('/r/x.md')!), 'two\n');
  await h.recorder.settled();
  assert.match(String((h.recorder.failure('/r/x.md')?.error as Error).message), /No space left/);
  assert.equal(h.told.length, 1, 'the failed save is said as its own');
  assert.match(h.told[0]!, /the save went through and replaced those bytes/);
  for (const text of ['outside\n', 'outside again\n']) {
    h.disk.set('/r/x.md', enc(text));
    assert.equal(await store.reload(enc(text)), 'reloaded');
    await h.recorder.settled();
  }
  assert.equal(h.told.length, 2, 'two outside changes not kept: said once');
  assert.match(h.told[1]!, /another program's change is on screen, and the copy of what it replaced was not kept/);
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
  const y = h.openSecond('/r/y.md');
  assert.equal(await h.reasons('/r/x.md'), 'none', 'an open keeps nothing, in either pane');
  h.disk.set('/r/y.md', enc('yes\n'));
  assert.equal(await y.reload(enc('yes\n')), 'reloaded');
  assert.deepEqual(await h.reasons('/r/y.md'), ['before reload'], 'the second pane\'s other file is followed');
  await b.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  assert.equal((await b.save()).result, 'saved');
  await a.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  const stale = await a.save();
  assert.equal(stale.result, 'failed', 'the first pane\'s save over what the second wrote is refused by the store, not by the recorder');
  assert.equal(dec(h.disk.get('/r/x.md')!), 'two\n', 'the second pane\'s bytes are on disk, whole');
  assert.deepEqual(await h.reasons('/r/x.md'), ['before save'], 'what the one save replaced; the refused save wrote nothing, so nothing was replaced');
  assert.deepEqual(h.writes.filter((p) => !p.startsWith('/data/')), ['/r/x.md'], 'only the one save is outside the data folder');
  closeSplit();
  h.disk.set('/r/z.md', enc('zed\n'));
  const z = h.openSecond('/r/z.md');
  const before = h.writes.length;
  h.disk.set('/r/z.md', enc('zed again\n'));
  await z.reload(enc('zed again\n'));
  await h.recorder.settled();
  assert.equal(h.writes.length, before, 'a document opened in the closed pane is not followed: nothing is kept for its outside change');
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
  assert.deepEqual(kept, ['before reload:mine\n'], 'what the reader had, and nothing of what came or of the later disk');
  assert.ok(!h.reads.some((p) => p.startsWith('/r/')));
  assert.equal(dec(h.disk.get('/r/x.md')!), 'theirs again\n', 'the outside program\'s file is as it left it');
});

test('a data folder that fails during a save keeps nothing and the reader\'s own file is written exactly as asked', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  const store = h.open('/r/x.md');
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  await h.recorder.settled();
  h.fail(Object.assign(new Error('read-only volume'), { code: 'io' }));
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  await h.recorder.settled();
  assert.equal(dec(h.disk.get('/r/x.md')!), 'six\n');
  h.disk.set('/r/x.md', enc('outside\n'));
  assert.equal(await store.reload(enc('outside\n')), 'reloaded', 'an outside change still reloads');
  await h.recorder.settled();
  assert.equal(dec(h.disk.get('/r/x.md')!), 'outside\n');
  assert.ok(h.recorder.failure('/r/x.md'));
  h.fail(null);
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok' && l.versions.every((v) => v.bytes === 'ok'), 'what is listed is whole');
  assert.equal(l.kind === 'ok' ? l.versions.length : 0, 1, 'the copy made before the folder failed, and none after');
});

test('a save keeps what it replaced before it resolves: the copy follows the accepted write, and a stop right after the save loses nothing', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  const s = h.open('/r/x.md');
  await h.recorder.settled();
  await s.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'e' });
  assert.equal((await s.save()).result, 'saved');
  await s.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'e' });
  const mark = h.writes.length;
  assert.equal((await s.save()).result, 'saved');
  // No settled(), no wait: the app quits here.
  void h.recorder.stop();
  const during = h.writes.slice(mark);
  // In place, the copy is made once the shell has accepted the write (a refused save keeps nothing), and before the save resolves.
  assert.ok(during.indexOf('/r/x.md') !== -1 && during.findIndex((p) => p.startsWith('/data/versions-')) > during.indexOf('/r/x.md'), 'the copy of "two" is written once x.md is');
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const texts: string[] = [];
  for (const v of l.versions) {
    const r = await h.recorder.store.read('/r/x.md', v.id);
    texts.push(`${v.reason}:${r.kind === 'bytes' ? dec(r.bytes).trim() : r.kind}`);
  }
  assert.deepEqual(texts, ['before save:two', 'before save:one']);
});

test('stop() drains: a copy queued behind the launch still runs after it, and is kept', async () => {
  const h = harness({ '/r/x.md': 'mine\n' }, true);
  const s = h.open('/r/x.md');
  h.disk.set('/r/x.md', enc('theirs\n'));
  assert.equal(await s.reload(enc('theirs\n')), 'reloaded');
  const stopped = h.recorder.stop();
  h.release();
  await stopped;
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok' && l.versions.length === 1 && l.versions[0]!.reason === 'before reload', 'the copy queued before the stop is kept');
});

test('Save As over a file that is there keeps that file\'s bytes first; a name that is free keeps nothing; the original is not saved over', async () => {
  const h = harness({ '/r/x.md': 'mine\n', '/r/other.md': 'PRECIOUS\n' });
  const s = h.open('/r/x.md');
  await h.recorder.settled();
  await s.apply({ range: { file: '/r/x.md', start: 0, end: 4 }, replacement: 'new!', label: 'e' });
  const mark = h.writes.length;
  assert.equal((await s.save({ to: '/r/other.md' })).result, 'saved');
  await h.recorder.settled();
  const during = h.writes.slice(mark);
  assert.ok(during.findIndex((p) => p.startsWith('/data/versions-')) < during.indexOf('/r/other.md'), 'kept before the target is written');
  assert.equal(dec(h.disk.get('/r/other.md')!), 'new!\n');
  assert.equal(dec(h.disk.get('/r/x.md')!), 'mine\n', 'the file Save As came from is untouched');
  const l = await h.recorder.store.list('/r/other.md');
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const r = await h.recorder.store.read('/r/other.md', l.versions[0]!.id);
  assert.equal(l.versions[0]!.reason, 'before save');
  assert.equal(r.kind === 'bytes' ? dec(r.bytes) : r.kind, 'PRECIOUS\n');
  // A Save As to a name nobody has: nothing to replace, nothing kept.
  const t = h.open('/r/x.md');
  await t.apply({ range: { file: '/r/x.md', start: 0, end: 4 }, replacement: 'else', label: 'e' });
  assert.equal((await t.save({ to: '/r/fresh.md' })).result, 'saved');
  await h.recorder.settled();
  assert.equal((await h.recorder.store.list('/r/fresh.md')).kind, 'none');
});

test('a before-save copy that cannot be made says what happened: the save replaced the bytes and they were not kept', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  const s = h.open('/r/x.md');
  await h.recorder.settled();
  h.fail(Object.assign(new Error('No space left on device'), { code: 'io' }));
  await s.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'e' });
  assert.equal((await s.save()).result, 'saved', 'the save goes through');
  assert.equal(dec(h.disk.get('/r/x.md')!), 'two\n');
  assert.equal(h.told.length, 1);
  assert.match(h.told[0]!, /the save went through and replaced those bytes/);
  assert.doesNotMatch(h.told[0]!, /untouched/);
});

test('30 distinct saves in a row keep the 20 newest in order, and the slots of the dropped hold zero bytes', async () => {
  const h = harness({ '/r/x.md': 'v00\n' });
  const s = h.open('/r/x.md');
  for (let i = 1; i <= 30; i++) {
    await s.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: `v${String(i).padStart(2, '0')}`, label: 'e' });
    assert.equal((await s.save()).result, 'saved');
  }
  await h.recorder.settled();
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const texts: string[] = [];
  for (const v of l.versions) {
    const r = await h.recorder.store.read('/r/x.md', v.id);
    texts.push(r.kind === 'bytes' ? dec(r.bytes).trim() : r.kind);
  }
  assert.equal(l.versions.length, 20);
  assert.deepEqual(texts, Array.from({ length: 20 }, (_, i) => `v${String(29 - i).padStart(2, '0')}`));
  const nonzero = [...h.disk.entries()].filter(([p, b]) => /^\/data\/versions-[0-9a-f]{40}-\d\d$/.test(p) && b.length > 0).length;
  assert.equal(nonzero, 20);
});

test('bytes that are not text (BOM, CRLF, 0xFF 0xFE 0x00) and an empty file are kept and read back exactly', async () => {
  const raw = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0xff, 0xfe, 0x00, 0x62]);
  const h = harness({});
  h.disk.set('/r/b.md', raw.slice());
  h.disk.set('/r/e.md', new Uint8Array(0));
  // What an outside change replaces is kept: each file is replaced once.
  for (const p of ['/r/b.md', '/r/e.md']) {
    const s = h.open(p);
    h.disk.set(p, enc('replaced\n'));
    assert.equal(await s.reload(enc('replaced\n')), 'reloaded');
    await h.recorder.settled();
  }
  for (const [p, want] of [['/r/b.md', raw], ['/r/e.md', new Uint8Array(0)]] as const) {
    const l = await h.recorder.store.list(p);
    assert.ok(l.kind === 'ok');
    if (l.kind !== 'ok') return;
    const r = await h.recorder.store.read(p, l.versions[0]!.id);
    assert.equal(r.kind, 'bytes');
    if (r.kind === 'bytes') assert.deepEqual([...r.bytes], [...want]);
  }
});

test('outside changes to B and C while the launch holds the jobs: what each replaced, A and B, is kept in order', async () => {
  const h = harness({ '/r/x.md': 'A\n' }, true);
  const s = h.open('/r/x.md');
  h.disk.set('/r/x.md', enc('B\n'));
  await s.reload(enc('B\n'));
  h.disk.set('/r/x.md', enc('C\n'));
  await s.reload(enc('C\n'));
  h.release();
  await h.recorder.settled();
  const l = await h.recorder.store.list('/r/x.md');
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const texts: string[] = [];
  for (const v of l.versions) {
    const r = await h.recorder.store.read('/r/x.md', v.id);
    texts.push(r.kind === 'bytes' ? dec(r.bytes).trim() : r.kind);
  }
  assert.deepEqual([...texts].reverse(), ['A', 'B']);
  assert.ok(l.versions.every((v) => v.reason === 'before reload'));
});

test('a save whose copy hangs goes on after the bound, says the copy was not kept, and the late copy is never written', async () => {
  const h = harness({ '/r/x.md': 'one\n' }, false, 40);
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  const unhang = h.hang();
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  const started = Date.now();
  assert.equal((await store.save()).result, 'saved', 'the reader\'s save is not held by the folder');
  assert.ok(Date.now() - started < 1000);
  assert.equal(dec(h.disk.get('/r/x.md')!), 'two\n');
  assert.match(h.told.at(-1)!, /could not keep a version of x\.md · the save went through and replaced those bytes/);
  assert.match(String((h.recorder.failure('/r/x.md')?.error as Error).message), /did not answer in time/);
  const writesBefore = h.writes.length;
  unhang();
  await h.recorder.settled();
  // The hung write itself may land (it was already under way); nothing after it does, and no version is added.
  assert.equal(h.writes.length - writesBefore, 0, 'nothing is written once the keep was abandoned, not even a clean-up');
  assert.equal(await h.reasons('/r/x.md'), 'none', 'no late "before save" version appears');
});

test('a copy that is slow but inside the bound is kept, with no notice', async () => {
  const h = harness({ '/r/x.md': 'one\n' }, false, 2000);
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  await store.save();
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  const unhang = h.hang();
  const saving = store.save();
  setTimeout(unhang, 30);
  assert.equal((await saving).result, 'saved');
  assert.deepEqual(await h.reasons('/r/x.md'), ['before save', 'before save']);
  assert.equal(h.told.length, 0);
});

test('closing waits for queued copies at most the bound, and says so when it runs out', async () => {
  const h = harness({ '/r/x.md': 'one\n' }, false, 40);
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  const said: string[] = [];
  assert.equal(await flushVersions(20, (t) => said.push(t)), true, 'nothing pending: no notice');
  assert.equal(said.length, 0);
  const unhang = h.hang();
  h.disk.set('/r/x.md', enc('from outside\n'));
  await store.reload(h.disk.get('/r/x.md')!);
  assert.equal(await flushVersions(20, (t) => said.push(t)), false);
  assert.equal(said.length, 1);
  assert.match(said[0]!, /closed before it finished keeping earlier versions/);
  unhang();
  await h.recorder.settled();
});

test('a keep refused because the manifest is damaged is said, with the reason, and nothing is written over it', async () => {
  const h = harness({ '/r/x.md': 'one\n' });
  const store = h.open('/r/x.md');
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  await h.recorder.settled();
  const manifest = [...h.disk.keys()].find((p) => /^\/data\/versions-[0-9a-f]{40}\.json$/.test(p))!;
  h.disk.set(manifest, enc('not json'));
  const told = h.told.length;
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  assert.equal(h.told.length, told + 1, 'the refusal is said');
  assert.match(h.told.at(-1)!, /could not keep a version of x\.md · the save went through/);
  assert.ok(h.recorder.failure('/r/x.md'), 'the tab can say why');
  assert.equal(dec(h.disk.get(manifest)!), 'not json', 'the damaged record is not replaced by keeping');
});

test('a keep the reader\'s policy declines (versions off, a large file) stays silent', async () => {
  const h = harness({ '/r/x.md': 'one\n', '/config': '[reader]\nversions = false\n' });
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  await store.save();
  assert.equal(h.told.length, 0);
});

test('a keep abandoned while its slot is being written leaves no later write behind: no manifest, no clean-up', async () => {
  const h = harness({ '/r/x.md': 'one\n' }, false, 40);
  const store = h.open('/r/x.md');
  await h.recorder.settled();
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  await store.save(); // 'one' is kept
  await store.apply({ range: { file: '/r/x.md', start: 0, end: 3 }, replacement: 'six', label: 'edit' });
  const unhang = h.hang();
  assert.equal((await store.save()).result, 'saved'); // 'two' needs a new slot, which hangs
  const writesBefore = h.writes.length;
  unhang();
  await h.recorder.settled();
  assert.equal(h.writes.length - writesBefore, 0, 'once not kept was said, nothing more is written');
  assert.deepEqual(await h.reasons('/r/x.md'), ['before save'], 'and no version appears afterwards');
});

test('a file in another encoding: the copies before a save and before an outside change both hold the file\'s own bytes', async () => {
  /** UTF-16LE with its byte-order mark. */
  const utf16 = (text: string): Uint8Array => new Uint8Array([0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  const path = '/r/u.txt';
  const h = harness({});
  h.disk.set(path, utf16('héllo\r\n'));
  const shell = { decodeText: async (b: Uint8Array, c?: string | null) => decodeBytes(b, c), encodeText: async (t: Uint8Array, l: string, bom: boolean) => encodeTextBytes(t, l, bom) };
  const store = h.open(path, { io: encodedIo(h.io, shell, path), text: await textForStore(shell, path, h.disk.get(path)!, null) });
  await store.apply({ range: { file: path, start: 0, end: 1 }, replacement: 'H', label: 'edit' });
  assert.equal((await store.save()).result, 'saved');
  // Another program rewrites the file; the watch reads it as the open file is read.
  h.disk.set(path, utf16('outside\r\n'));
  assert.equal(await store.reload(await lookForStore(shell, path, h.disk.get(path)!)), 'reloaded');
  assert.deepEqual(await h.reasons(path), ['before reload', 'before save']);
  const l = await h.recorder.store.list(path);
  assert.ok(l.kind === 'ok');
  if (l.kind !== 'ok') return;
  const copy = async (i: number) => {
    const r = await h.recorder.store.read(path, l.versions[i]!.id);
    return r.kind === 'bytes' ? [...r.bytes] : r.kind;
  };
  assert.deepEqual(await copy(0), [...utf16('Héllo\r\n')], 'what the outside change replaced, as the file held it');
  assert.deepEqual(await copy(1), [...utf16('héllo\r\n')], 'what the save replaced, as the file held it');
  store.close();
  forgetEncoding(path);
});
