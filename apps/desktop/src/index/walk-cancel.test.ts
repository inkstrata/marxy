// A walk stops when its root is let go, and a root nothing uses is let go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkRoot } from './walk.ts';
import { createIndexService } from './service.ts';
import { createMemoryShell } from '../shell/memory.ts';
import { tabSizeForFile, updateTabWidthResolver } from '../source/tab-width.ts';

const enc = (s: string) => new TextEncoder().encode(s);

/** A tree of `n` folders under /r, each listing slowly, with a record of the listings made. */
function slowTree(n: number) {
  const files: Record<string, Uint8Array> = { '/r/.git/HEAD': enc('ref\n') };
  for (let i = 0; i < n; i++) files[`/r/d${i}/f.md`] = enc(`# ${i}\n`);
  const base = createMemoryShell(files, { scoped: true });
  const listed: string[] = [];
  const shell = Object.assign(Object.create(base) as typeof base, {
    async readDir(dir: string) {
      listed.push(dir);
      await new Promise((r) => setTimeout(r, 2));
      return base.readDir(dir);
    },
  });
  return { shell, base, listed };
}

test('an aborted walk rejects and lists no further folder', async () => {
  const { shell, base, listed } = slowTree(200);
  await base.markOpened('/r', 'root');
  const ac = new AbortController();
  const walking = walkRoot(shell, '/r', undefined, undefined, undefined, [], { signal: ac.signal });
  while (listed.length < 5) await new Promise((r) => setTimeout(r, 1));
  ac.abort();
  await assert.rejects(walking, { name: 'AbortError' });
  const at = listed.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(at < 20, `${at} folders listed before the stop`);
  assert.equal(listed.length, at, 'nothing listed after the abort');
});

test('closing a folder mid-walk stops its walk, drops it from the list and takes it out of the shell scope', async () => {
  const { shell, base, listed } = slowTree(200);
  const index = createIndexService(shell);
  const holding = index.ensureRoot('/r');
  while (listed.length < 5) await new Promise((r) => setTimeout(r, 1));
  assert.deepEqual(index.roots(), ['/r']);
  assert.ok((await base.readFile('/r/d1/f.md')).length > 0);
  index.dropRoot('/r');
  const at = listed.length;
  await holding;
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(at < 30, `${at} folders listed before the drop`);
  assert.ok(listed.length <= at + 1, 'the walk listed nothing more after the drop');
  assert.deepEqual(index.roots(), []);
  await assert.rejects(base.readFile('/r/d1/f.md'), { code: 'outside' });
});

/** Two repositories and a document shown from `shown`: opening /other takes the front off /real, which the sweep then weighs. */
async function leaveRoot(shell: ReturnType<typeof createMemoryShell>, shown: string[]) {
  const index = createIndexService(shell, { inUse: () => shown });
  await index.ensureFor('/real/x.md');
  await index.ensureFor('/other/y.md');
  await index.settled();
  await new Promise((r) => setTimeout(r, 20));
  return index;
}

const repos = () => ({
  '/real/.git/HEAD': enc('ref\n'),
  '/real/x.md': enc('# x\n'),
  '/other/.git/HEAD': enc('ref\n'),
  '/other/y.md': enc('# y\n'),
});

test('a root no tab shows is let go, and the shell stops reading it', async () => {
  const base = createMemoryShell(repos(), { scoped: true });
  const index = await leaveRoot(base, ['/other/y.md']);
  assert.deepEqual(index.roots(), ['/other']);
  await assert.rejects(base.readFile('/real/x.md'), { code: 'outside' });
});

test('a document shown through a link is still under its root: the root stays', async () => {
  const base = createMemoryShell(repos(), { scoped: true });
  base.link('/jn', '/real');
  const index = await leaveRoot(base, ['/jn/x.md', '/other/y.md']);
  assert.deepEqual([...index.roots()].sort(), ['/other', '/real']);
  assert.ok((await base.readFile('/real/x.md')).length > 0);
});

test('a document shown in another case is still under its root: the root stays', async () => {
  const base = createMemoryShell(repos(), { scoped: true });
  const shell = Object.assign(Object.create(base) as typeof base, {
    async realPath(path: string) {
      return path.replace(/^\/REAL(?=\/|$)/i, '/real');
    },
  });
  const index = await leaveRoot(shell, ['/REAL/x.md', '/other/y.md']);
  assert.deepEqual([...index.roots()].sort(), ['/other', '/real']);
});

test('a root the reader chose for something else stays readable when the index lets go of it', async () => {
  const base = createMemoryShell(repos(), { scoped: true });
  await base.markOpened('/real', 'root');
  const index = await leaveRoot(base, ['/other/y.md']);
  assert.deepEqual(index.roots(), ['/other']);
  assert.ok((await base.readFile('/real/x.md')).length > 0);
});

test('a root tab-width marked is let go like any other, and the next read of the file marks it again', async () => {
  const base = createMemoryShell({ ...repos(), '/real/.editorconfig': enc('[*]\nindent_size = 2\n') }, { scoped: true });
  await base.markOpened('/real/x.md');
  await updateTabWidthResolver('/real/x.md', base).catch(() => undefined);
  assert.ok((await base.readFile('/real/.editorconfig')).length > 0);
  const index = await leaveRoot(base, ['/other/y.md']);
  assert.deepEqual(index.roots(), ['/other']);
  await assert.rejects(base.readFile('/real/.editorconfig'), { code: 'outside' });
  await updateTabWidthResolver('/real/x.md', base).catch(() => undefined);
  assert.ok((await base.readFile('/real/.editorconfig')).length > 0, 'marked again by the next call');
  assert.equal(await tabSizeForFile('/real/x.md'), 2);
});
