// The Tauri binding's read errors and its stale-write guard, against a stubbed `invoke` (no window, no Rust). The stub's
// `write_file_atomic` checks `x-marxy-expect` as `atomic_write::write_atomic_unless_changed` does; the Rust tests cover that.
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { shell } from './tauri.ts';
import { clipboard } from './clipboard.ts';
import { createStoreRegistry } from '../document/registry.ts';
import { openDocumentStore, type StoreIo } from '../document/store.ts';

type Handler = (cmd: string, args: unknown, opts?: { headers?: Record<string, string> }) => unknown;
let handler: Handler = () => undefined;
(globalThis as { window?: unknown }).window = {
  __TAURI_INTERNALS__: { invoke: async (cmd: string, args: unknown, opts?: { headers?: Record<string, string> }) => handler(cmd, args, opts) },
};

/** What the binding sends as `x-marxy-expect` for `bytes`: the length (8 bytes, big-endian) then the SHA-256, in hex. */
function expectation(bytes: Uint8Array): string {
  const len = new Uint8Array(8);
  new DataView(len.buffer).setBigUint64(0, BigInt(bytes.byteLength));
  const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return hex(len) + hex(createHash('sha256').update(bytes).digest());
}

/**
 * A disk of files behind `read_file` and `write_file_atomic`; `fail` makes the next reads of a path reject with it, and a
 * write to it too when the write must read it to check it. `reads` counts `read_file` calls.
 */
function disk(files: Record<string, Uint8Array>) {
  const fail = new Map<string, unknown>();
  const writes: string[] = [];
  const expects: (string | undefined)[] = [];
  const counts = { reads: 0 };
  handler = (cmd, args, opts) => {
    if (cmd === 'read_file') {
      counts.reads++;
      const { path } = args as { path: string };
      if (fail.has(path)) throw fail.get(path);
      const bytes = files[path];
      if (!bytes) throw { code: 'not-found', message: `${path}: No such file or directory (os error 2)`, path };
      return bytes.slice().buffer;
    }
    if (cmd === 'write_file_atomic') {
      const path = decodeURIComponent(opts!.headers!['x-marxy-path']!);
      const expect = opts!.headers!['x-marxy-expect'];
      expects.push(expect);
      if (expect !== undefined && files[path]) {
        if (fail.has(path)) throw fail.get(path);
        if (expectation(files[path]) !== expect) throw { code: 'changed', message: `${path}: changed on disk since it was opened; refusing to overwrite`, path };
      }
      files[path] = (args as Uint8Array).slice();
      writes.push(path);
      return null;
    }
    throw new Error(`unexpected ${cmd}`);
  };
  return { files, fail, writes, expects, counts };
}

const enc = (s: string) => clipboard.utf8(s);

test('a read error is classified by its code, never by words in the path', async () => {
  const d = disk({});
  d.fail.set('C:/a/not found/x.md', 'C:/a/not found/x.md: Access is denied. (os error 5)');
  await assert.rejects(shell.readFile('C:/a/not found/x.md'), (e: { code?: string; path?: string }) => e.code === 'io' && e.path === 'C:/a/not found/x.md');
  d.fail.set('/r/too large to open (big)/a.md', { code: 'io', message: '/r/too large to open (big)/a.md: Access is denied. (os error 5)', path: '/r/too large to open (big)/a.md' });
  await assert.rejects(shell.readFile('/r/too large to open (big)/a.md'), (e: { code?: string }) => e.code === 'io');
  d.fail.set('/r/big.log', { code: 'refused', message: '/r/big.log: too large to open (300 MB; the most Marxy opens is 256 MB)', path: '/r/big.log' });
  await assert.rejects(shell.readFile('/r/big.log'), (e: { code?: string }) => e.code === 'refused');
});

test('a save over a file that cannot be read is refused, even under a folder named "not found"', async () => {
  const path = 'C:/notes/not found/todo.md';
  const d = disk({ [path]: enc('one') });
  await shell.readFile(path);
  d.fail.set(path, { code: 'io', message: `${path}: Access is denied. (os error 5)`, path });
  await assert.rejects(shell.writeFileAtomic(path, enc('two')), /Access is denied/);
  assert.deepEqual(d.writes, []);
});

test('the stale-write guard: same bytes write, changed bytes refuse, a gone file is recreated', async () => {
  const d = disk({ '/g/a.md': enc('abc'), '/g/b.md': enc('abc'), '/g/c.md': enc('abc') });
  await shell.readFile('/g/a.md');
  await shell.writeFileAtomic('/g/a.md', enc('abd'));
  // The guard now holds what was written.
  await shell.writeFileAtomic('/g/a.md', enc('abe'));
  assert.deepEqual(d.writes, ['/g/a.md', '/g/a.md']);

  await shell.readFile('/g/b.md');
  d.files['/g/b.md'] = enc('xyz');
  await assert.rejects(shell.writeFileAtomic('/g/b.md', enc('new')), /changed on disk since it was opened; refusing to overwrite/);
  d.files['/g/b.md'] = enc('abcd');
  await assert.rejects(shell.writeFileAtomic('/g/b.md', enc('new')), /changed on disk/);

  await shell.readFile('/g/c.md');
  delete d.files['/g/c.md'];
  await shell.writeFileAtomic('/g/c.md', enc('back'));
  assert.equal(clipboard.textLoose(d.files['/g/c.md']), 'back');

  // recordRead moves the guard to the bytes the app adopted; a peek leaves it where it was.
  d.files['/g/d.md'] = enc('v1');
  await shell.readFile('/g/d.md');
  d.files['/g/d.md'] = enc('v2');
  await shell.peekFile('/g/d.md');
  await assert.rejects(shell.writeFileAtomic('/g/d.md', enc('mine')), /changed on disk/);
  shell.recordRead('/g/d.md', enc('v2'));
  await shell.writeFileAtomic('/g/d.md', enc('mine'));

  // A guard that is forgotten (the document closed) no longer refuses.
  d.files['/g/e.md'] = enc('v1');
  await shell.readFile('/g/e.md');
  d.files['/g/e.md'] = enc('v2');
  shell.forgetRead('/g/e.md')();
  await shell.writeFileAtomic('/g/e.md', enc('mine'));
});

test('a store closed during its save, then the file reopened: the late forget leaves the new record, and the next save is still checked', async () => {
  const path = '/g/reopened.md';
  const d = disk({ [path]: enc('one\n') });
  const stores = createStoreRegistry({ onClosed: (p) => shell.forgetRead(p) });
  let reached: () => void = () => {};
  const waiting = new Promise<void>((r) => (reached = r));
  let go: () => void = () => {};
  const held = new Promise<void>((r) => (go = r));
  // The slow save is held just before it reaches the shell: the store has closed, and the file is read again, meanwhile.
  const io = (slow: boolean): StoreIo => ({
    writeFileAtomic: async (p, b, expected) => {
      if (slow) {
        reached();
        await held;
      }
      return shell.writeFileAtomic(p, b, expected);
    },
    recordRead: (p, b) => shell.recordRead(p, b),
    peekFile: (p) => shell.peekFile(p),
  });
  const a = stores.acquire(path, () => openDocumentStore(io(true), path, d.files[path]!));
  await shell.readFile(path);
  await a.apply({ range: { file: path, start: 0, end: 3 }, replacement: 'two', label: 'edit' });
  const saving = a.save();
  await waiting;
  stores.release(a);
  // The reader opens the file again while the closed store's save is still under way: its read is recorded.
  const b = stores.acquire(path, () => openDocumentStore(io(false), path, d.files[path]!));
  await shell.readFile(path);
  assert.notEqual(b, a);
  go();
  assert.equal((await saving).result, 'saved');
  await new Promise((r) => setTimeout(r, 0));
  // Another program writes the file; a write that was never told so must still be refused.
  d.files[path] = enc('outside\n');
  await assert.rejects(shell.writeFileAtomic(path, enc('from b\n')), /changed on disk/);
  assert.equal(clipboard.textLoose(d.files[path]), 'outside\n');
  b.close();
});

test('a Windows file read under one spelling is guarded when written under another', async () => {
  // The stubbed disk is keyed by spelling, so both spellings are planted; Windows would give one file.
  const read = 'C:\\Guard\\Plan.md';
  const written = 'c:/guard/./PLAN.md';
  const d = disk({ [read]: enc('v1'), [written]: enc('v1') });
  await shell.readFile(read);
  d.files[read] = enc('v2');
  d.files[written] = enc('v2');
  await assert.rejects(shell.writeFileAtomic(written, enc('mine')), /changed on disk/);
  assert.deepEqual(d.writes, []);
});

test('a forget that runs after the file was read again leaves that read\'s record', async () => {
  const path = '/g/again.md';
  const d = disk({ [path]: enc('v1') });
  await shell.readFile(path);
  const forget = shell.forgetRead(path);
  d.files[path] = enc('v2');
  await shell.readFile(path);
  forget();
  d.files[path] = enc('v3');
  await assert.rejects(shell.writeFileAtomic(path, enc('mine')), /changed on disk/);
});

test('reading files keeps no copy of their bytes for the guard', async () => {
  setFlagsFromString('--expose_gc');
  const gc = runInNewContext('gc') as () => void;
  const size = 16 * 1024 * 1024;
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < 10; i++) files[`/big/${i}.log`] = new Uint8Array(size).fill(i);
  disk(files);
  gc();
  const before = process.memoryUsage().arrayBuffers;
  for (const path of Object.keys(files)) {
    await shell.readFile(path);
    shell.recordRead(path, files[path]!);
    await shell.writeFileAtomic(path, files[path]!);
  }
  await new Promise((r) => setTimeout(r, 50));
  gc();
  const grown = process.memoryUsage().arrayBuffers - before;
  // The disk itself is rewritten in place (same sizes); a copy per path would add 160 MB.
  assert.ok(grown < 32 * 1024 * 1024, `held ${(grown / 1048576).toFixed(0)} MB after reading ten 16 MB files`);
});

test("a save reads nothing back: the expectation rides with the write, and Rust's refusal comes back typed", async () => {
  const path = '/g/no-read.md';
  const d = disk({ [path]: enc('one') });
  await shell.readFile(path);
  d.counts.reads = 0;
  await shell.writeFileAtomic(path, enc('two'));
  assert.equal(d.counts.reads, 0, 'no read before the write');
  assert.equal(d.expects.at(-1), expectation(enc('one')));
  d.files[path] = enc('outside');
  await assert.rejects(shell.writeFileAtomic(path, enc('three')), (e: { code?: string; message: string }) => e.code === 'changed' && /changed on disk since it was opened/.test(e.message));
  assert.equal(d.counts.reads, 0);
  assert.equal(clipboard.textLoose(d.files[path]!), 'outside');
});

test("a write's own expected bytes are what is checked, over whatever was last read at the path", async () => {
  const path = '/g/baseline.md';
  const d = disk({ [path]: enc('v1') });
  await shell.readFile(path);
  d.files[path] = enc('v2');
  // Something else read the new bytes (the record moves); the caller's own baseline is still v1.
  await shell.readFile(path);
  await assert.rejects(shell.writeFileAtomic(path, enc('mine'), enc('v1')), (e: { code?: string }) => e.code === 'changed');
  assert.equal(d.expects.at(-1), expectation(enc('v1')));
  await shell.writeFileAtomic(path, enc('mine'), enc('v2'));
  assert.equal(clipboard.textLoose(d.files[path]!), 'mine');
});

test('a path never read and given no expected bytes is written with no precondition', async () => {
  const d = disk({ '/g/fresh.json': enc('{}') });
  await shell.writeFileAtomic('/g/fresh.json', enc('{"a":1}'));
  assert.equal(d.expects.at(-1), undefined);
});

test('a Windows path spelled with backslashes is told to the shell as a file opened, as one with slashes is', async () => {
  const sent: unknown[] = [];
  handler = (cmd, args) => {
    if (cmd === 'mark_opened' || cmd === 'forget_root') sent.push([cmd, args]);
    return undefined;
  };
  await shell.markOpened?.('C:\\Users\\a\\scope\\renamed.md');
  await shell.markOpened?.('C:/Users/a/scope/renamed.md', 'root');
  await shell.forgetRoot?.('C:\\Users\\a\\scope');
  await shell.markOpened?.('archive-entry:4/a.md');
  assert.deepEqual(sent, [
    ['mark_opened', { path: 'C:\\Users\\a\\scope\\renamed.md', root: false, indexed: false }],
    ['mark_opened', { path: 'C:/Users/a/scope/renamed.md', root: true, indexed: false }],
    ['forget_root', { path: 'C:\\Users\\a\\scope' }],
  ]);
});
