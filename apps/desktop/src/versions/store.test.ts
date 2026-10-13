// The version store (V-06, ADR-0072) over an in-memory data folder that logs every write and can be made to fail. What a
// reader is promised: a read, a save and a reload keep three versions with their reasons; identical bytes are kept once; the
// limits drop the oldest first; Clear leaves no version's bytes readable through the store; a denied, large, scratch or own
// file is never written; every write is in the data folder; a full disk, an unwritable folder, a damaged manifest and a
// version file removed by hand are each reported, never silently dropped or written over.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  createVersionStore,
  formatManifest,
  manifestPath,
  notKept,
  parseManifest,
  slotPath,
  VERSION_LIMITS,
  versionsKey,
  type NotKept,
  type PolicyInputs,
  type VersionsIo,
} from './store.ts';

const DATA = '/data';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const DAY = 24 * 60 * 60 * 1000;

interface FakeIo extends VersionsIo {
  readonly files: Map<string, Uint8Array>;
  readonly writes: string[];
  /** Each later write whose path matches fails with this error, until cleared. */
  failWrites: { match: (path: string) => boolean; error: Error & { code?: string } } | null;
  clock: number;
}

function fakeIo(seed: Record<string, Uint8Array> = {}): FakeIo {
  const files = new Map(Object.entries(seed));
  const notFound = (path: string) => Object.assign(new Error(`not found: ${path}`), { code: 'not-found' });
  const io: FakeIo = {
    files,
    writes: [],
    failWrites: null,
    clock: Date.UTC(2026, 9, 13, 14, 32),
    dataDir: async () => DATA,
    async readHead(path, max) {
      const b = files.get(path);
      if (!b) throw notFound(path);
      return b.slice(0, max);
    },
    async readFile(path) {
      const b = files.get(path);
      if (!b) throw notFound(path);
      return b.slice();
    },
    async writeFileAtomic(path, bytes) {
      io.writes.push(path);
      if (io.failWrites?.match(path)) throw io.failWrites.error;
      files.set(path, bytes.slice());
    },
    async readDir(dir) {
      const prefix = `${dir}/`;
      return [...files.entries()].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(([path, b]) => ({ path, size: b.length, isDir: false }));
    },
    now: () => io.clock,
  };
  return io;
}

const listOf = async (store: ReturnType<typeof createVersionStore>, path: string) => {
  const l = await store.list(path);
  assert.equal(l.kind, 'ok', JSON.stringify(l));
  return l.kind === 'ok' ? l.versions : [];
};

test('a read, a save and a reload of one file keep three versions with their reasons, newest first, each a byte-exact copy', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  const A = enc('# A\r\n﻿bytes é\n');
  const B = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0d, 0x0a, 0xff, 0x00]); // a BOM, CRLF and bytes that are not text
  const C = enc('# C\n');
  assert.equal((await store.keep('/r/x.md', A, 'read')).result, 'kept');
  io.clock += 60_000;
  assert.equal((await store.keep('/r/x.md', B, 'before save')).result, 'kept');
  io.clock += 60_000;
  assert.equal((await store.keep('/r/x.md', C, 'before reload')).result, 'kept');
  const versions = await listOf(store, '/r/x.md');
  assert.deepEqual(versions.map((v) => [v.reason, v.size, v.bytes]), [['before reload', C.length, 'ok'], ['before save', B.length, 'ok'], ['read', A.length, 'ok']]);
  for (const [v, bytes] of [[versions[0]!, C], [versions[1]!, B], [versions[2]!, A]] as const) {
    const read = await store.read('/r/x.md', v.id);
    assert.equal(read.kind, 'bytes');
    if (read.kind === 'bytes') assert.deepEqual([...read.bytes], [...bytes], `${v.reason} is byte for byte`);
  }
  assert.ok(versions[0]!.time > versions[2]!.time);
});

test('the manifest is plain, readable JSON naming the path, the times, the sizes and the reasons; the slots hold the bytes as they were', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  await store.keep('/r/notes.md', enc('hello\n'), 'read');
  const key = await versionsKey('/r/notes.md');
  const text = dec(io.files.get(manifestPath(DATA, key))!);
  const json = JSON.parse(text);
  assert.equal(json.version, 1);
  assert.equal(json.path, '/r/notes.md');
  assert.deepEqual(json.versions, [{ id: 1, slot: 1, time: '2026-10-13T14:32:00.000Z', size: 6, reason: 'read' }]);
  assert.equal(json.saved, null);
  io.clock += 60_000;
  await store.keep('/r/notes.md', enc('hello\n'), 'before save');
  const after = JSON.parse(dec(io.files.get(manifestPath(DATA, key))!));
  assert.equal(after.saved, '2026-10-13T14:33:00.000Z', 'a save over the bytes already kept still notes when Marxy saved: a time, no bytes');
  assert.equal(after.versions.length, 1);
  assert.ok(text.includes('\n  "path": "/r/notes.md"'), 'indented for a person');
  assert.equal(dec(io.files.get(slotPath(DATA, key, 1))!), 'hello\n');
  assert.match(manifestPath(DATA, key), /^\/data\/versions-[0-9a-f]{40}\.json$/);
  assert.match(slotPath(DATA, key, 1), /^\/data\/versions-[0-9a-f]{40}-01$/);
});

test('identical bytes are kept once: the same as the newest adds nothing, the same as an older one shares its slot', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  const A = enc('alpha\n');
  const B = enc('beta\n');
  await store.keep('/r/x.md', A, 'read');
  const writesAfterFirst = io.writes.length;
  const again = await store.keep('/r/x.md', A, 'read');
  assert.equal(again.result, 'same');
  assert.equal(io.writes.length, writesAfterFirst, 'nothing written for the same bytes');
  assert.equal((await store.keep('/r/x.md', A, 'before save')).result, 'same', 'the same bytes for another reason are still the newest version');
  await store.keep('/r/x.md', B, 'before save');
  const key = await versionsKey('/r/x.md');
  const slotWrites = () => io.writes.filter((p) => p.startsWith(`${DATA}/versions-${key}-`));
  assert.equal(slotWrites().length, 2);
  const back = await store.keep('/r/x.md', A, 'before reload');
  assert.equal(back.result, 'kept');
  assert.equal(slotWrites().length, 2, 'A again is not copied a second time');
  const versions = await listOf(store, '/r/x.md');
  assert.deepEqual(versions.map((v) => [v.reason, v.slot]), [['before reload', 1], ['before save', 2], ['read', 1]]);
  const read = await store.read('/r/x.md', versions[0]!.id);
  assert.equal(read.kind === 'bytes' && dec(read.bytes), 'alpha\n');
});

test('20 per file: the 21st drops the oldest first, its slot is reused and nothing else moves', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  let before21 = 0;
  for (let i = 1; i <= 21; i++) {
    io.clock += 1000;
    if (i === 21) before21 = io.writes.length;
    assert.equal((await store.keep('/r/x.md', enc(`v${i}\n`), 'read')).result, 'kept');
  }
  const versions = await listOf(store, '/r/x.md');
  assert.equal(versions.length, VERSION_LIMITS.perFile);
  assert.deepEqual(versions.map((v) => v.id), Array.from({ length: 20 }, (_, i) => 21 - i), 'id 1, the oldest, is gone');
  assert.equal(versions[0]!.slot, 1, 'the slot the oldest held');
  const read = await store.read('/r/x.md', 21);
  assert.equal(read.kind === 'bytes' && dec(read.bytes), 'v21\n');
  assert.equal((await store.read('/r/x.md', 1)).kind, 'gone');
  // The manifest stopped naming slot 1 before slot 1 was written again: no moment where version 1 names v21's bytes.
  const key = await versionsKey('/r/x.md');
  assert.deepEqual(io.writes.slice(before21), [manifestPath(DATA, key), slotPath(DATA, key, 1), manifestPath(DATA, key)]);
});

test('30 days: a version older than that is dropped at the next keep and its slot emptied; the sweep drops it for a file never kept again', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  await store.keep('/r/old.md', enc('old\n'), 'read');
  await store.keep('/r/x.md', enc('one\n'), 'read');
  io.clock += 31 * DAY;
  await store.keep('/r/x.md', enc('two\n'), 'read');
  const versions = await listOf(store, '/r/x.md');
  assert.deepEqual(versions.map((v) => v.id), [2]);
  const xKey = await versionsKey('/r/x.md');
  assert.equal(dec(io.files.get(slotPath(DATA, xKey, 1))!), 'two\n', 'the dropped version\'s slot holds the new one');
  for (const bytes of io.files.values()) assert.notEqual(dec(bytes), 'one\n', 'the expired bytes are nowhere');
  // /r/old.md was not touched by that keep: the sweep (once a session) finds it.
  assert.equal((await listOf(store, '/r/old.md')).length, 1);
  const swept = await store.sweep();
  assert.equal(swept.dropped, 1);
  assert.equal((await store.list('/r/old.md')).kind, 'none');
  const oldKey = await versionsKey('/r/old.md');
  assert.equal(io.files.get(slotPath(DATA, oldKey, 1))!.length, 0);
});

test('200 MB in all: the sweep drops the oldest versions across every file until the total is within the limit', async () => {
  const io = fakeIo();
  const store = createVersionStore(io, { limits: { ...VERSION_LIMITS, totalBytes: 25 } });
  const ten = (c: string) => enc(c.repeat(10));
  await store.keep('/r/a.md', ten('a'), 'read'); // oldest
  io.clock += 1000;
  await store.keep('/r/b.md', ten('b'), 'read');
  io.clock += 1000;
  await store.keep('/r/a.md', ten('A'), 'before save');
  assert.equal(await store.totalBytes(), 30);
  const swept = await store.sweep();
  assert.equal(swept.dropped, 1);
  assert.deepEqual((await listOf(store, '/r/a.md')).map((v) => v.reason), ['before save'], 'a.md\'s read, the oldest of all, went');
  assert.equal((await listOf(store, '/r/b.md')).length, 1);
  assert.equal(await store.totalBytes(), 20);
});

test('Clear leaves no version\'s bytes readable through the store, and every slot of the file holds zero bytes', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  await store.keep('/r/x.md', enc('one\n'), 'read');
  await store.keep('/r/x.md', enc('two\n'), 'before save');
  await store.keep('/r/y.md', enc('why\n'), 'read');
  const ids = (await listOf(store, '/r/x.md')).map((v) => v.id);
  const cleared = await store.clear('/r/x.md');
  assert.deepEqual(cleared, { cleared: 2 });
  assert.equal((await store.list('/r/x.md')).kind, 'none');
  for (const id of ids) assert.equal((await store.read('/r/x.md', id)).kind, 'gone');
  const key = await versionsKey('/r/x.md');
  for (const [path, bytes] of io.files) if (path.startsWith(`${DATA}/versions-${key}-`)) assert.equal(bytes.length, 0, path);
  assert.equal((await listOf(store, '/r/y.md')).length, 1, 'another file\'s versions stay');
  // Clear all: y too, and nothing of either is left to read.
  const all = await store.clearAll();
  assert.deepEqual([all.files, all.cleared, all.errors.length], [1, 1, 0]);
  assert.equal((await store.list('/r/y.md')).kind, 'none');
  for (const [path, bytes] of io.files) if (/versions-[0-9a-f]{40}-\d\d$/.test(path)) assert.equal(bytes.length, 0, path);
  // Keeping again after a clear starts afresh.
  assert.equal((await store.keep('/r/x.md', enc('three\n'), 'read')).result, 'kept');
  assert.deepEqual((await listOf(store, '/r/x.md')).map((v) => v.slot), [1]);
});

const inputs = (over: Partial<PolicyInputs> = {}): PolicyInputs => ({
  enabled: true,
  denyGlobs: [],
  root: '/r',
  dataDir: DATA,
  largeFileBytes: 2 * 1024 * 1024,
  untitled: false,
  ...over,
});

test('the policy: off, a deny rule (built-in or the reader\'s), the large-file limit, a scratch document and Marxy\'s own data are never kept', () => {
  assert.equal(notKept('/r/notes.md', 10, inputs()), null);
  assert.deepEqual(notKept('/r/notes.md', 10, inputs({ enabled: false })), { kind: 'off' });
  assert.deepEqual(notKept('/r/node_modules/p/README.md', 10, inputs()), { kind: 'denied', rule: 'node_modules', builtIn: true });
  assert.deepEqual(notKept('/r/.git/COMMIT_EDITMSG', 10, inputs()), { kind: 'denied', rule: '.git', builtIn: true });
  assert.deepEqual(notKept('/r/drafts/plan.md', 10, inputs({ denyGlobs: ['**/drafts/**'] })), { kind: 'denied', rule: '**/drafts/**', builtIn: false });
  assert.deepEqual(notKept('/r/a.generated.md', 10, inputs({ denyGlobs: ['**/*.generated.md'] })), { kind: 'denied', rule: '**/*.generated.md', builtIn: false });
  // An anchored glob is the root's; with no root known it is still tried from `/`.
  assert.deepEqual(notKept('/r/private/x.md', 10, inputs({ denyGlobs: ['/private/'] })), { kind: 'denied', rule: '/private/', builtIn: false });
  assert.deepEqual(notKept('/private/x.md', 10, inputs({ root: null, denyGlobs: ['/private/'] })), { kind: 'denied', rule: '/private/', builtIn: false });
  assert.deepEqual(notKept('/r/big.md', 2 * 1024 * 1024 + 1, inputs()), { kind: 'large', limit: 2 * 1024 * 1024 });
  assert.equal(notKept('/r/big.md', 2 * 1024 * 1024, inputs()), null, 'at the limit is not over it');
  assert.deepEqual(notKept('untitled:1', 10, inputs({ untitled: true })), { kind: 'scratch' });
  assert.deepEqual(notKept('/data/versions-0123.json', 10, inputs()), { kind: 'own' });
  assert.deepEqual(notKept('/data/positions.json', 10, inputs()), { kind: 'own' });
});

test('a path under a deny rule is never written, nor a large or switched-off one: the store writes nothing at all', async () => {
  const io = fakeIo();
  const refusals: Record<string, NotKept | null> = {};
  const store = createVersionStore(io, {
    policy: async (path, bytes) => (refusals[path] = notKept(path, bytes.length, inputs({ denyGlobs: ['**/drafts/**'], largeFileBytes: 8, enabled: path !== '/r/off.md' }))),
  });
  for (const path of ['/r/drafts/plan.md', '/r/node_modules/x/a.md', '/r/off.md']) {
    const out = await store.keep(path, enc('tiny'), 'read');
    assert.equal(out.result, 'refused', path);
  }
  assert.equal((await store.keep('/r/big.md', enc('more than eight'), 'read')).result, 'refused');
  assert.deepEqual(io.writes, [], 'not one write');
  assert.equal((await store.keep('/r/fine.md', enc('tiny'), 'read')).result, 'kept');
  assert.ok(io.writes.length > 0);
});

test('every write the store makes is in the data folder, and none is beside the file it copies', async () => {
  const io = fakeIo();
  const store = createVersionStore(io, { limits: { ...VERSION_LIMITS, perFile: 3, totalBytes: 12 } });
  for (let i = 0; i < 6; i++) {
    io.clock += 1000;
    await store.keep('/r/docs/x.md', enc(`version ${i}\n`), i % 2 ? 'before save' : 'read');
  }
  await store.sweep();
  await store.clear('/r/docs/x.md');
  await store.clearAll();
  assert.ok(io.writes.length > 10);
  for (const path of io.writes) assert.match(path, /^\/data\/versions-[0-9a-f]{40}(\.json|-\d\d)$/);
});

const diskFull = () => Object.assign(new Error('No space left on device (os error 28)'), { code: 'io' });

test('disk full while copying the bytes: the keep fails, says why, and the versions already kept are as they were', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  await store.keep('/r/x.md', enc('one\n'), 'read');
  const key = await versionsKey('/r/x.md');
  const manifestBefore = io.files.get(manifestPath(DATA, key))!;
  io.failWrites = { match: (p) => p === slotPath(DATA, key, 2), error: diskFull() };
  const out = await store.keep('/r/x.md', enc('two\n'), 'before save');
  assert.equal(out.result, 'failed');
  assert.match(String((out as { error: Error }).error.message), /No space left/);
  assert.deepEqual(io.files.get(manifestPath(DATA, key)), manifestBefore, 'the manifest was not touched');
  assert.deepEqual((await listOf(store, '/r/x.md')).map((v) => v.id), [1]);
  io.failWrites = null;
  assert.equal((await store.keep('/r/x.md', enc('two\n'), 'before save')).result, 'kept', 'room again: it is kept');
});

test('disk full at the manifest: the copy no entry names is emptied, and the listing never names bytes that are not whole', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  await store.keep('/r/x.md', enc('one\n'), 'read');
  const key = await versionsKey('/r/x.md');
  io.failWrites = { match: (p) => p === manifestPath(DATA, key), error: diskFull() };
  assert.equal((await store.keep('/r/x.md', enc('two\n'), 'before save')).result, 'failed');
  io.failWrites = null;
  assert.deepEqual((await listOf(store, '/r/x.md')).map((v) => [v.id, v.bytes]), [[1, 'ok']]);
  assert.equal(io.files.get(slotPath(DATA, key, 2))!.length, 0, 'the orphan copy holds nothing');
});

test('an unwritable data folder: every keep fails with the shell\'s reason, nothing is listed, and Clear says it failed', async () => {
  const io = fakeIo();
  io.failWrites = { match: () => true, error: Object.assign(new Error('/data: permission denied'), { code: 'permission' }) };
  const store = createVersionStore(io);
  const out = await store.keep('/r/x.md', enc('one\n'), 'read');
  assert.equal(out.result, 'failed');
  assert.equal((out as { error: { code: string } }).error.code, 'permission');
  assert.equal((await store.list('/r/x.md')).kind, 'none');
  io.failWrites = null;
  await store.keep('/r/x.md', enc('one\n'), 'read');
  io.failWrites = { match: () => true, error: Object.assign(new Error('/data: permission denied'), { code: 'permission' }) };
  const cleared = await store.clear('/r/x.md');
  assert.ok(cleared.error, 'a failed clear is reported, not taken for done');
});

test('a version file removed by hand is listed as missing and reads as missing; the others still read, and keeping goes on', async () => {
  const io = fakeIo();
  const store = createVersionStore(io);
  await store.keep('/r/x.md', enc('one\n'), 'read');
  await store.keep('/r/x.md', enc('two\n'), 'before save');
  const key = await versionsKey('/r/x.md');
  io.files.delete(slotPath(DATA, key, 1));
  const versions = await listOf(store, '/r/x.md');
  assert.deepEqual(versions.map((v) => [v.reason, v.bytes]), [['before save', 'ok'], ['read', 'missing']]);
  assert.equal((await store.read('/r/x.md', 1)).kind, 'missing');
  assert.equal((await store.read('/r/x.md', 2)).kind, 'bytes');
  // A slot whose bytes were changed by hand (another size) is not passed off as the version.
  io.files.set(slotPath(DATA, key, 2), enc('tampered with\n'));
  assert.deepEqual((await listOf(store, '/r/x.md')).map((v) => v.bytes), ['changed', 'missing']);
  assert.equal((await store.read('/r/x.md', 2)).kind, 'changed');
  assert.equal((await store.keep('/r/x.md', enc('three\n'), 'read')).result, 'kept');
});

test('a damaged manifest is reported with how, never written over by keeping; Clear starts it again', async () => {
  const key = await versionsKey('/r/x.md');
  for (const [bad, reason] of [
    ['{ not json', /not valid JSON/],
    ['[]', /not a JSON object/],
    ['{"version":1,"path":"/r/x.md","next":2,"versions":[{"id":1,"slot":99,"time":"2026-10-13T00:00:00Z","size":1,"reason":"read"}]}', /names no slot/],
    ['{"version":1,"path":"/r/x.md","next":2,"versions":[{"id":1,"slot":1,"time":"yesterday","size":1,"reason":"read"}]}', /no time/],
    ['{"version":1,"path":"/r/x.md","next":2,"versions":[{"id":1,"slot":1,"time":"2026-10-13T00:00:00Z","size":1,"reason":"opened"}]}', /no reason/],
  ] as const) {
    const io = fakeIo({ [manifestPath(DATA, key)]: enc(bad), [slotPath(DATA, key, 1)]: enc('x') });
    const store = createVersionStore(io);
    const listing = await store.list('/r/x.md');
    assert.equal(listing.kind, 'damaged', bad);
    if (listing.kind === 'damaged') assert.match(listing.reason, reason);
    const out = await store.keep('/r/x.md', enc('new\n'), 'read');
    assert.equal(out.result, 'refused');
    assert.match((out as { why: string }).why, /could not be read/);
    assert.deepEqual(io.writes, [], 'nothing written over it');
    await store.clear('/r/x.md');
    assert.equal(io.files.get(slotPath(DATA, key, 1))!.length, 0, 'its slot emptied');
    assert.equal((await store.list('/r/x.md')).kind, 'none');
    assert.equal((await store.keep('/r/x.md', enc('new\n'), 'read')).result, 'kept', 'kept again after the reader cleared it');
  }
});

test('a newer Marxy\'s manifest is listed as newer and never written; another file\'s is not taken over', async () => {
  const key = await versionsKey('/r/x.md');
  const io = fakeIo({ [manifestPath(DATA, key)]: enc('{"version":2,"anything":true}') });
  const store = createVersionStore(io);
  assert.deepEqual(await store.list('/r/x.md'), { kind: 'newer' });
  assert.equal((await store.keep('/r/x.md', enc('a'), 'read')).result, 'refused');
  assert.deepEqual(io.writes, []);
  const other = formatManifest({ path: '/elsewhere.md', next: 2, saved: null, versions: [{ id: 1, slot: 1, time: io.clock, size: 1, reason: 'read' }] });
  io.files.set(manifestPath(DATA, key), other);
  const listing = await store.list('/r/x.md');
  assert.equal(listing.kind, 'damaged');
  assert.equal((await store.keep('/r/x.md', enc('a'), 'read')).result, 'refused');
  assert.deepEqual(io.writes, []);
  assert.equal((await store.read('/r/x.md', 1)).kind, 'gone', 'another file\'s bytes are never handed out as this one\'s');
});

test('parseManifest round-trips what formatManifest writes, and refuses two sizes on one slot', () => {
  const m = { path: '/r/x.md', next: 3, saved: Date.UTC(2026, 0, 2, 9), versions: [{ id: 1, slot: 1, time: Date.UTC(2026, 0, 1), size: 3, reason: 'read' as const }, { id: 2, slot: 1, time: Date.UTC(2026, 0, 2), size: 3, reason: 'before save' as const }] };
  const back = parseManifest(formatManifest(m));
  assert.deepEqual(back, { kind: 'ok', manifest: m });
  const bad = { ...m, versions: [m.versions[0]!, { ...m.versions[1]!, size: 4 }] };
  assert.equal(parseManifest(formatManifest(bad)).kind, 'damaged');
});

test('over the whole fixture corpus, a kept version reads back byte for byte (BOM, CRLF, bytes that are not text and all)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
  const io = fakeIo();
  const store = createVersionStore(io);
  let n = 0;
  for (const name of readdirSync(corpus)) {
    const file = new URL(name, corpus);
    if (!statSync(file).isFile()) continue;
    const bytes = new Uint8Array(readFileSync(file));
    const path = `/corpus/${name}`;
    assert.equal((await store.keep(path, bytes, 'read')).result, 'kept', name);
    const [v] = await listOf(store, path);
    const back = await store.read(path, v!.id);
    assert.equal(back.kind, 'bytes', name);
    if (back.kind === 'bytes') assert.ok(Buffer.compare(Buffer.from(back.bytes), Buffer.from(bytes)) === 0, `${name} is byte-exact`);
    n++;
  }
  assert.ok(n >= 30, `${n} files`);
});
