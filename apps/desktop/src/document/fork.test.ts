// *Fork this file* (W-14), in Node over a fake filesystem that behaves as the real shell does where it matters: `stat` does not see
// a symlink, `writeFileAtomic` replaces what is at the name and writes *through* a symlink, a link that leads nowhere is refused,
// and a name can differ from an existing one only by its case. Each test says which acceptance line it holds.
// The walk at the end is seeded: MARXY_WALK_SEED=<n> replays one seed alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawers, prng } from '../../test/support/prng.mjs';
import { FORK_SAYS, whyForkFailed } from '../notices/fork.ts';
import { MAX_FORKS, MAX_NAME_BYTES, forkPath, nameIsTaken, writeFork, type ForkIo } from './fork.ts';
import { openDocumentStore } from './store.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const bytes = (...xs: number[]): Uint8Array => Uint8Array.from(xs);
const same = (a: Uint8Array | undefined, b: Uint8Array | undefined): boolean => a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);

/** The shell's behaviour that a fork depends on, and nothing more. */
class Fs implements ForkIo {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['/d']);
  /** name -> target; a target that is not here leads nowhere. */
  readonly links = new Map<string, string>();
  readonly log: string[] = [];
  caseInsensitive = false;
  /** Runs at the start of every call: a test plants a file here, as another program would. */
  before: ((call: string) => void) | null = null;
  failWrite: Error | null = null;

  private fold(path: string): string {
    return this.caseInsensitive ? path.toLowerCase() : path;
  }
  private found(path: string): string | undefined {
    for (const key of this.files.keys()) if (this.fold(key) === this.fold(path)) return key;
    return undefined;
  }
  private foundDir(path: string): string | undefined {
    for (const key of this.dirs) if (this.fold(key) === this.fold(path)) return key;
    return undefined;
  }
  private enter(call: string): void {
    this.log.push(call);
    this.before?.(call);
  }

  async stat(path: string): Promise<unknown | null> {
    this.enter(`stat:${path}`);
    if (this.links.has(path)) return null; // the real stat does not see a link
    if (this.found(path) !== undefined) return { path, isDir: false };
    if (this.foundDir(path) !== undefined) return { path, isDir: true };
    return null;
  }
  async realPath(path: string): Promise<string> {
    this.enter(`realPath:${path}`);
    const link = this.links.get(path);
    if (link !== undefined) {
      if (this.found(link) === undefined && this.foundDir(link) === undefined) throw Object.assign(new Error(`${path}: not found`), { code: 'not-found' });
      return link;
    }
    const file = this.found(path);
    if (file !== undefined) return file;
    const dir = this.foundDir(path);
    if (dir !== undefined) return dir;
    throw Object.assign(new Error(`${path}: not found`), { code: 'not-found' });
  }
  async readHead(path: string, _max: number): Promise<Uint8Array> {
    this.enter(`readHead:${path}`);
    // As the shell does: a link (leading anywhere or nowhere) and a folder are 'not a regular file'; a missing path is not found.
    if (this.links.has(path) || this.foundDir(path) !== undefined) throw Object.assign(new Error(`${path}: not a regular file`), { code: 'invalid' });
    const file = this.found(path);
    if (file === undefined) throw Object.assign(new Error(`${path}: no such file`), { code: 'not-found' });
    return new Uint8Array(0);
  }
  async writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
    this.enter(`write:${path}`);
    if (this.failWrite) throw this.failWrite;
    const link = this.links.get(path);
    if (link !== undefined) {
      // The shell saves *through* a link, and refuses one that leads nowhere.
      if (this.found(link) === undefined) throw Object.assign(new Error(`${path}: is a symlink that does not resolve`), { code: 'io' });
      this.files.set(this.found(link)!, data.slice());
      return;
    }
    if (this.foundDir(path) !== undefined) throw Object.assign(new Error(`${path}: is not a regular file`), { code: 'permission' });
    const existing = this.found(path);
    this.files.set(existing ?? path, data.slice());
  }
  writes(): string[] {
    return this.log.filter((c) => c.startsWith('write:')).map((c) => c.slice('write:'.length));
  }
  snapshot(): Map<string, Uint8Array> {
    return new Map([...this.files].map(([k, v]) => [k, v.slice()]));
  }
}

const ORIGINAL = '/d/notes.md';
const BODY = enc.encode('# notes\n\ntext\n');

function withOriginal(extra: Record<string, Uint8Array> = {}): Fs {
  const fs = new Fs();
  fs.files.set(ORIGINAL, BODY.slice());
  for (const [path, data] of Object.entries(extra)) fs.files.set(path, data);
  return fs;
}

test('notes.md gives notes (fork).md, then (fork 2) when that exists, and so on', async () => {
  assert.equal(forkPath('/a/notes.md', 1), '/a/notes (fork).md');
  assert.equal(forkPath('/a/notes.md', 2), '/a/notes (fork 2).md');
  assert.equal(forkPath('/a/notes.md', 10), '/a/notes (fork 10).md');
  const fs = withOriginal();
  const first = await writeFork(fs, ORIGINAL, BODY);
  assert.deepEqual(first, { result: 'written', path: '/d/notes (fork).md', n: 1 });
  const second = await writeFork(fs, ORIGINAL, BODY);
  assert.deepEqual(second, { result: 'written', path: '/d/notes (fork 2).md', n: 2 });
  const third = await writeFork(fs, ORIGINAL, BODY);
  assert.deepEqual(third, { result: 'written', path: '/d/notes (fork 3).md', n: 3 });
});

test('a dotfile and a name with no extension take the tag last; a folder with a dot in it is not an extension', () => {
  assert.equal(forkPath('/a/.env', 1), '/a/.env (fork)');
  assert.equal(forkPath('/a/README', 2), '/a/README (fork 2)');
  assert.equal(forkPath('/a/archive.tar.gz', 1), '/a/archive.tar (fork).gz');
  assert.equal(forkPath('/a/.hidden.md', 1), '/a/.hidden (fork).md');
  assert.equal(forkPath('/v1.2/notes', 1), '/v1.2/notes (fork)');
  assert.equal(forkPath('/a/notes.', 1), '/a/notes (fork).');
});

test('a backslash is a character in a macOS or Linux name and a separator only in a Windows path', () => {
  assert.equal(forkPath('/a/we\\ird.md', 1), '/a/we\\ird (fork).md');
  assert.equal(forkPath('C:\\docs\\a.md', 1), 'C:\\docs\\a (fork).md');
  assert.equal(forkPath('C:/docs/a.md', 2), 'C:/docs/a (fork 2).md');
});

test('the fork holds exactly the bytes it was given: a BOM, CRLF, a lone CR, NULs and bytes that are not UTF-8', async () => {
  const awkward = new Map<string, Uint8Array>([
    ['bom', Uint8Array.of(0xef, 0xbb, 0xbf, ...enc.encode('# t\r\n\r\ntext\r\n'))],
    ['crlf', enc.encode('a\r\nb\r\n\r\nc')],
    ['mixed', enc.encode('a\r\nb\nc\rd')],
    ['nul', bytes(0x23, 0x20, 0, 0x0a, 0, 0)],
    ['invalid utf-8', bytes(0xff, 0xfe, 0xc0, 0x80, 0xed, 0xa0, 0x80, 0x0a)],
    ['every byte', Uint8Array.from({ length: 256 }, (_, i) => i)],
    ['empty', new Uint8Array(0)],
  ]);
  for (const [name, data] of awkward) {
    const fs = withOriginal();
    // Through the store, as the command does: what the store holds is what is written.
    const store = openDocumentStore({ writeFileAtomic: (p, b) => fs.writeFileAtomic(p, b) }, ORIGINAL, data);
    const out = await writeFork(fs, ORIGINAL, store.snapshot().buffer.bytes);
    assert.equal(out.result, 'written', name);
    assert.ok(same(fs.files.get('/d/notes (fork).md'), data), `${name}: the fork is the buffer, byte for byte`);
    assert.ok(same(fs.files.get(ORIGINAL), BODY), `${name}: the original on disk is not touched`);
  }
});

test('unsaved edits are in the fork and not in the original: the buffer is written, the file on disk is not', async () => {
  const fs = withOriginal();
  const store = openDocumentStore({ writeFileAtomic: (p, b) => fs.writeFileAtomic(p, b) }, ORIGINAL, BODY);
  await store.apply({ range: { file: ORIGINAL, start: 2, end: 7 }, replacement: 'EDITED', label: 'edit' });
  assert.equal(store.snapshot().dirty, true);
  const before = fs.log.length;
  const out = await writeFork(fs, ORIGINAL, store.snapshot().buffer.bytes);
  assert.equal(out.result, 'written');
  assert.equal(dec.decode(fs.files.get('/d/notes (fork).md')), '# EDITED\n\ntext\n');
  assert.equal(dec.decode(fs.files.get(ORIGINAL)), '# notes\n\ntext\n', 'the original on disk keeps its bytes');
  assert.deepEqual(fs.writes(), ['/d/notes (fork).md'], 'one write, to the fork');
  assert.equal(fs.log.slice(before).some((c) => c.includes(ORIGINAL)), false, 'no call names the original file');
  assert.equal(store.snapshot().dirty, true, 'the original is still the reader\'s unsaved document');
});

test('a failed write leaves nothing: no file at the name, nothing else changed, and the failure is the shell\'s own', async () => {
  for (const code of ['io', 'permission'] as const) {
    const fs = withOriginal({ '/d/other.md': enc.encode('other') });
    const before = fs.snapshot();
    fs.failWrite = Object.assign(new Error('/d: cannot stage a save'), { code });
    const out = await writeFork(fs, ORIGINAL, BODY);
    assert.equal(out.result, 'failed');
    assert.equal((out as { error: Error }).error, fs.failWrite);
    assert.deepEqual([...fs.snapshot().keys()], [...before.keys()], 'no file appeared');
    for (const [k, v] of before) assert.ok(same(fs.files.get(k), v), `${k} unchanged`);
  }
});

test('a check that fails (the shell cannot say) writes nothing and says so', async () => {
  const fs = withOriginal();
  fs.before = (call) => {
    if (call.startsWith('stat:')) throw Object.assign(new Error('permission denied'), { code: 'permission' });
  };
  const out = await writeFork(fs, ORIGINAL, BODY);
  assert.equal(out.result, 'failed');
  assert.deepEqual(fs.writes(), []);
});

test('ADVERSARIAL: with x (fork).md present, Fork never calls the write on it, and the original and that file keep their bytes', async () => {
  const mine = enc.encode('MY OWN FORK, kept');
  const fs = withOriginal({ '/d/notes (fork).md': mine.slice() });
  const out = await writeFork(fs, ORIGINAL, BODY);
  assert.deepEqual(out, { result: 'written', path: '/d/notes (fork 2).md', n: 2 });
  assert.equal(fs.writes().includes('/d/notes (fork).md'), false, 'the write log has no entry for the existing fork');
  assert.deepEqual(fs.writes(), ['/d/notes (fork 2).md']);
  assert.ok(same(fs.files.get('/d/notes (fork).md'), mine));
  assert.ok(same(fs.files.get(ORIGINAL), BODY));
});

test('ADVERSARIAL: a folder, a symlink that resolves, and a name differing only by case are all taken, and none is written', async () => {
  const target = enc.encode('THE LINK TARGET');
  const fs = withOriginal({ '/d/precious.md': target.slice(), '/d/Notes (Fork 3).md': enc.encode('cased') });
  fs.caseInsensitive = true;
  fs.dirs.add('/d/notes (fork).md'); // a folder with the first name
  fs.links.set('/d/notes (fork 2).md', '/d/precious.md'); // a link with the second, to a file
  const out = await writeFork(fs, ORIGINAL, BODY);
  assert.deepEqual(out, { result: 'written', path: '/d/notes (fork 4).md', n: 4 });
  assert.deepEqual(fs.writes(), ['/d/notes (fork 4).md']);
  assert.ok(same(fs.files.get('/d/precious.md'), target), 'the file the link points at is not replaced');
  assert.equal(dec.decode(fs.files.get('/d/Notes (Fork 3).md')), 'cased');
});

test('a symlink that leads nowhere is taken, so Fork skips it and writes the next name (it does not fail, run after run)', async () => {
  const fs = withOriginal();
  fs.links.set('/d/notes (fork).md', '/d/missing.md');
  const out = await writeFork(fs, ORIGINAL, BODY);
  assert.deepEqual(out, { result: 'written', path: '/d/notes (fork 2).md', n: 2 });
  assert.deepEqual(fs.writes(), ['/d/notes (fork 2).md'], 'the link is never written to');
  assert.equal(fs.links.get('/d/notes (fork).md'), '/d/missing.md', 'and is still there');
});

test('every one of the 999 names taken: no write at all, a failure that says why', async () => {
  const fs = withOriginal();
  for (let n = 1; n <= MAX_FORKS; n++) fs.files.set(forkPath(ORIGINAL, n), enc.encode(`f${n}`));
  const before = fs.snapshot();
  const out = await writeFork(fs, ORIGINAL, BODY);
  assert.equal(out.result, 'failed');
  assert.match((out as { error: Error }).error.message, /999/);
  assert.deepEqual(fs.writes(), []);
  for (const [k, v] of before) assert.ok(same(fs.files.get(k), v), k);
});

test('RACE: names are looked for one at a time as the write is made, never from a listing taken earlier', async () => {
  // While the first name is being looked at, another program makes the (fork 2) file. A fork that took its name from an earlier
  // listing would choose (fork 2) and replace it; this one looks at (fork 2) after, finds it, and takes (fork 3).
  const fs = withOriginal({ '/d/notes (fork).md': enc.encode('first') });
  const planted = enc.encode('PLANTED while the first name was being checked');
  let done = false;
  fs.before = (call) => {
    if (!done && call === 'stat:/d/notes (fork).md') {
      done = true;
      fs.files.set('/d/notes (fork 2).md', planted.slice());
    }
  };
  const out = await writeFork(fs, ORIGINAL, BODY);
  assert.deepEqual(out, { result: 'written', path: '/d/notes (fork 3).md', n: 3 });
  assert.ok(same(fs.files.get('/d/notes (fork 2).md'), planted), 'the file that appeared mid-way is intact');
  assert.equal(fs.writes().includes('/d/notes (fork 2).md'), false);
});

test('RACE: the look at the name is the last call before the write; nothing else is awaited between them', async () => {
  const fs = withOriginal({ '/d/notes (fork).md': enc.encode('x') });
  await writeFork(fs, ORIGINAL, BODY);
  const at = fs.log.indexOf('write:/d/notes (fork 2).md');
  assert.deepEqual(fs.log.slice(at - 3, at), ['stat:/d/notes (fork 2).md', 'realPath:/d/notes (fork 2).md', 'readHead:/d/notes (fork 2).md'], 'the name\'s own checks come last');
  assert.equal(fs.log.slice(at + 1).length, 0, 'and nothing follows the write');
});

test('KNOWN LIMIT: a file that appears after the last look and before the write is replaced, because the shell has no create-only write', async () => {
  // This test states the limit rather than hiding it (fork.ts, THE ONE LIMIT). It passes today; if the shell gains a create-only
  // write and `writeFork` uses it, this is the test that must be turned around: the planted file would then survive.
  const fs = withOriginal();
  const planted = enc.encode('PLANTED between the check and the write');
  fs.before = (call) => {
    if (call === 'write:/d/notes (fork).md') fs.files.set('/d/notes (fork).md', planted.slice());
  };
  const out = await writeFork(fs, ORIGINAL, BODY);
  assert.equal(out.result, 'written');
  assert.ok(same(fs.files.get('/d/notes (fork).md'), BODY), 'the planted file was replaced (the window is the shell\'s own write time)');
});

test('nameIsTaken: a missing name is free, and only a folder\'s real path decides a link\'s place (a symlinked folder is not a link to the name)', async () => {
  const fs = withOriginal();
  assert.equal(await nameIsTaken(fs, '/d/free.md'), false);
  assert.equal(await nameIsTaken(fs, ORIGINAL), true);
  // /tmp is a link to /private/tmp on a Mac: a name in it that does not exist is free, whatever the folder resolves to.
  const mac: ForkIo = {
    stat: async () => null,
    realPath: async (p) => {
      if (p === '/tmp') return '/private/tmp';
      if (p === '/tmp/x.md') throw Object.assign(new Error('nf'), { code: 'not-found' });
      return p;
    },
    readHead: async () => { throw Object.assign(new Error('nf'), { code: 'not-found' }); },
    writeFileAtomic: async () => {},
  };
  assert.equal(await nameIsTaken(mac, '/tmp/x.md'), false);
  const linked: ForkIo = { ...mac, realPath: async (p) => (p === '/tmp' ? '/private/tmp' : p === '/tmp/y.md' ? '/elsewhere/y.md' : p) };
  assert.equal(await nameIsTaken(linked, '/tmp/y.md'), true, 'a name that resolves somewhere else is a link');
  // A name `stat` cannot see (a deny-listed folder name, which a fork name never is) that resolves to itself is not a link: free.
  const plain: ForkIo = { ...mac, realPath: async (p) => (p === '/tmp' ? '/private/tmp' : p === '/tmp/z.md' ? '/private/tmp/z.md' : p) };
  assert.equal(await nameIsTaken(plain, '/tmp/z.md'), false);
  const seen: ForkIo = { ...mac, stat: async () => ({ isDir: false }) };
  assert.equal(await nameIsTaken(seen, '/tmp/z.md'), true, 'a name that `stat` sees is taken, in a linked folder too');
});

// ---------------------------------------------------------------------------------------------------------------
// The walk: random folders of random names, forked over and over, against an oracle that keeps its own picture.

const SEEDS = process.env.MARXY_WALK_SEED ? [Number(process.env.MARXY_WALK_SEED)] : Array.from({ length: 250 }, (_, i) => 1000 + i);

const STEMS = ['notes', 'plan', 'README', '.env', 'a.b', 'x y', 'archive.tar', 'é', '日本語'];
const EXTS = ['.md', '', '.txt', '.gz'];

async function oneWalk(seed: number): Promise<void> {
  const { int, pick, chance } = drawers(prng(seed));
  const fs = new Fs();
  fs.caseInsensitive = chance(0.5);
  const fold = (p: string): string => (fs.caseInsensitive ? p.toLowerCase() : p);
  const randomBytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => int(256));
  const stem = pick(STEMS);
  const ext = pick(EXTS);
  const original = `/d/${stem}${ext}`;
  const originalBytes = randomBytes(int(40));
  fs.files.set(original, originalBytes.slice());
  // The model: the names present (folded when the filesystem folds), the bytes every regular file must still hold, and the names
  // It never reads the fake to decide what should happen.
  const present = new Set<string>([fold(original)]);
  const expected = new Map<string, Uint8Array>([[original, originalBytes.slice()]]);
  const trace: string[] = [];
  const keep = (path: string, data: Uint8Array): void => {
    fs.files.set(path, data.slice());
    expected.set(path, data.slice());
    present.add(fold(path));
  };
  for (let n = 1, upTo = int(8); n <= upTo; n++) {
    const name = forkPath(original, n);
    const kind = pick(['file', 'file', 'dir', 'link', 'cased', 'dangling', 'free', 'free']);
    if (kind === 'file') keep(name, randomBytes(int(10)));
    else if (kind === 'dir') {
      fs.dirs.add(name);
      present.add(fold(name));
    } else if (kind === 'link') {
      const target = `/d/target-${n}${ext}`;
      keep(target, randomBytes(1 + int(10)));
      fs.links.set(name, target);
      present.add(fold(name));
    } else if (kind === 'cased') keep(name.replace(/fork/, 'Fork'), enc.encode('cased')); // taken only where case is folded
    else if (kind === 'dangling') {
      // A link that leads nowhere is a name that is taken: it is skipped, and never written to.
      fs.links.set(name, `/d/missing-${n}`);
      present.add(fold(name));
    }
  }
  const rounds = 1 + int(4);
  let from = original;
  for (let r = 0; r < rounds; r++) {
    let want = 1;
    while (present.has(fold(forkPath(from, want)))) want += 1;
    const wantPath = forkPath(from, want);
    const data = randomBytes(int(30));
    const writesBefore = fs.writes().length;
    const where = `seed ${seed} (case ${fs.caseInsensitive ? 'folded' : 'kept'}), round ${r}: fork ${from} -> ${wantPath}; ${trace.join('; ')}`;
    const out = await writeFork(fs, from, data);
    assert.equal(out.result, 'written', where);
    assert.equal((out as { path: string }).path, wantPath, `${where}: the first free name`);
    assert.equal(fs.writes().length, writesBefore + 1, `${where}: exactly one write`);
    assert.equal(fold(fs.writes().at(-1)!), fold(wantPath), `${where}: and to that name`);
    keep(wantPath, data);
    trace.push(`${from} -> ${wantPath}`);
    // Nothing that was there has changed: not the original, not an obstacle, not what a link points at.
    for (const [path, bytesOf] of expected) {
      const real = [...fs.files.keys()].find((k) => fold(k) === fold(path));
      assert.ok(real !== undefined && same(fs.files.get(real), bytesOf), `${where}: ${path} keeps its bytes`);
    }
    if (chance(0.5)) from = wantPath; // fork the fork
  }
  assert.ok(same(fs.files.get(original), originalBytes), `seed ${seed}: the original is untouched`);
}

test('WALK: over random folders of files, folders, links and cased names, a fork takes the first free name and touches nothing that was there', async () => {
  for (const seed of SEEDS) await oneWalk(seed);
});

// ---------------------------------------------------------------------------------------------------------------
// Long names, and what the reader is told when a write fails.

const bytesOf = (t: string): number => enc.encode(t).length;
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

test('a name near the 255-byte limit is shortened a whole grapheme at a time so the fork fits; a short name is not touched', () => {
  assert.equal(forkPath('/d/notes.md', 1), '/d/notes (fork).md');
  for (const stem of ['a'.repeat(248), 'é'.repeat(124), '日本語'.repeat(41), '👨\u200d👩\u200d👧'.repeat(11), 'e\u0301'.repeat(120)]) {
    for (const ext of ['.md', '', '.markdown']) {
      for (const n of [1, 2, 99, 999]) {
        const out = nameOf(forkPath(`/d/${stem}${ext}`, n));
        assert.ok(bytesOf(out) <= MAX_NAME_BYTES, `${bytesOf(out)} bytes for ${stem.slice(0, 6)}… n=${n}`);
        assert.ok(out.endsWith(`${n === 1 ? ' (fork)' : ` (fork ${n})`}${ext}`), 'the tag and the extension are kept whole');
        // Cut on a grapheme boundary of the original stem: no half of a character, no combining mark or joiner left behind.
        const kept = out.slice(0, out.length - (n === 1 ? ' (fork)' : ` (fork ${n})`).length - ext.length);
        const cuts = new Set([0, stem.length]);
        for (const { index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem)) cuts.add(index);
        assert.ok(stem.startsWith(kept) && cuts.has(kept.length), `cut at ${kept.length} is a grapheme boundary`);
      }
    }
  }
  assert.ok(nameOf(forkPath(`/d/${'a'.repeat(255)}`, 1)).length <= MAX_NAME_BYTES, 'a name already at the limit');
});

test('forking a 250-byte name writes a name that fits, and a second fork of it takes (fork 2) of the same cut', async () => {
  const long = `/d/${'x'.repeat(247)}.md`;
  const fs = new Fs();
  fs.files.set(long, BODY.slice());
  const first = await writeFork(fs, long, BODY);
  const second = await writeFork(fs, long, BODY);
  assert.equal(first.result, 'written');
  assert.equal(second.result, 'written');
  for (const out of [first, second]) assert.ok(bytesOf(nameOf((out as { path: string }).path)) <= MAX_NAME_BYTES);
  assert.notEqual((first as { path: string }).path, (second as { path: string }).path);
  assert.ok(same(fs.files.get(long), BODY));
});

test('the failure notice names the file that was to be written and says why in words, never the temporary file or an OS number', () => {
  const tmp = '/d/.notes (fork).md.marxy-tmp-123-0-456';
  const cases: [unknown, RegExp][] = [
    [Object.assign(new Error(`${tmp}: cannot stage a save beside the destination: Permission denied (os error 13)`), { code: 'io' }), /the folder can't be written to/],
    [Object.assign(new Error('x'), { code: 'permission' }), /the folder can't be written to/],
    [Object.assign(new Error(`${tmp}: cannot stage a save beside the destination: File name too long (os error 63)`), { code: 'io' }), /the name is too long for this folder/],
    [Object.assign(new Error(`${tmp}: cannot be written: No space left on device (os error 28)`), { code: 'io' }), /the disk is full/],
    [Object.assign(new Error('all 999 fork names beside this file are taken'), { code: 'exhausted' }), /every fork name beside it is taken/],
    [new Error('something nobody expected (os error 99)'), /the write was refused/],
  ];
  for (const [error, why] of cases) {
    const said = FORK_SAYS.failed('/d/notes.md', error, '/d/notes (fork).md');
    assert.equal(said.kind, 'error');
    assert.match(said.text, why);
    assert.match(said.text, /^Not forked: notes \(fork\)\.md could not be written, because /);
    assert.match(said.text, / · nothing was written and notes\.md is unchanged · Check the folder, then try again\.$/);
    assert.doesNotMatch(said.text, /marxy-tmp|os error|\/d\/|\.notes/, said.text);
  }
  assert.match(FORK_SAYS.failed('/d/notes.md', new Error('x')).text, /^Not forked: a fork of notes\.md could not be written/, 'with no name chosen yet, the original is named');
  assert.equal(whyForkFailed('plain string'), 'the write was refused');
});

test('a failed write reports the name it was writing, and a failure before any name does not', async () => {
  const fs = withOriginal();
  fs.failWrite = Object.assign(new Error('x'), { code: 'permission' });
  assert.deepEqual(await writeFork(fs, ORIGINAL, BODY), { result: 'failed', error: fs.failWrite, path: '/d/notes (fork).md' });
  const gone = withOriginal();
  gone.before = (call) => {
    if (call.startsWith('realPath:')) throw Object.assign(new Error('nf'), { code: 'not-found' });
  };
  const out = await writeFork(gone, ORIGINAL, BODY);
  assert.equal(out.result, 'failed');
  assert.equal('path' in out, false);
});
