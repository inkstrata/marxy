// A root is keyed by its canonical path. The real shell lists and watches canonical paths (symlinks resolved,
// `/private/tmp` for `/tmp`), so a folder opened through a link must index its files, take watch events, and be one root
// with the same folder opened by its real path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIndexService } from './service.ts';
import { createMemoryShell } from '../shell/memory.ts';

/**
 * A directory link. Windows refuses symlinks without Developer Mode or the privilege, so it falls back to a junction,
 * which needs neither: `lstat` reports it as a link and `realpath` resolves it, as for a symlink.
 */
function linkDir(target: string, path: string): void {
  try {
    symlinkSync(target, path, 'dir');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
    symlinkSync(target, path, 'junction');
  }
}

const noLinks = ((): string | false => {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-canon-probe-'));
  try {
    linkDir(dir, join(dir, 'l'));
    return false;
  } catch {
    return 'directory links are not permitted here';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

/** The Tauri shell's `read_dir`, `stat_file`, `read_head` and `real_path`, on the real filesystem. */
const fsShell = () => ({
  async readDir(dir: string) {
    const real = realpathSync(dir);
    // Like `read_dir`: a symlink inside the folder is omitted, never followed.
    return readdirSync(real).flatMap((name) => {
      const s = lstatSync(join(real, name));
      if (s.isSymbolicLink()) return [];
      return [{ path: join(real, name), isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs }];
    });
  },
  async readFile(path: string) {
    return new Uint8Array(await readFile(path));
  },
  async readHead(path: string, max: number) {
    return new Uint8Array(await readFile(path)).slice(0, max);
  },
  async stat(path: string) {
    try {
      const s = statSync(path);
      return { path, isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  },
  async realPath(path: string) {
    return realpathSync(path);
  },
  async mark() {},
});

/** The index keys paths with forward slashes on every platform. */
const slashed = (p: string): string => p.replaceAll('\\', '/');

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'marxy-canon-')));
  const real = join(base, 'real');
  mkdirSync(join(real, 'docs'), { recursive: true });
  writeFileSync(join(real, 'README.md'), '# Old\n');
  writeFileSync(join(real, 'docs', 'guide.md'), '# Guide\n');
  linkDir(real, join(base, 'link'));
  return { base, real: slashed(real), link: join(base, 'link') };
}

test('a folder opened through a symlink indexes its files, under their canonical paths', { skip: noLinks }, async () => {
  const { base, real, link } = fixture();
  try {
    const index = createIndexService(fsShell());
    await index.ensureRoot(link, { watch: true });
    await index.settled();
    assert.deepEqual(index.entries().map((e) => e.path).sort(), [`${real}/README.md`, `${real}/docs/guide.md`]);
    assert.deepEqual(index.roots(), [real]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a canonical watch event updates the entry of a folder opened through a symlink', { skip: noLinks }, async () => {
  const { base, real, link } = fixture();
  try {
    const index = createIndexService(fsShell());
    await index.ensureRoot(link, { watch: true });
    await index.settled();
    assert.equal(index.entries().find((e) => e.path === `${real}/README.md`)?.title, 'Old');
    writeFileSync(join(real, 'README.md'), '# New\n');
    index.applyEvents([{ kind: 'modified', path: `${real}/README.md` }]);
    await index.settled();
    assert.equal(index.entries().find((e) => e.path === `${real}/README.md`)?.title, 'New');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the same folder opened by its link and by its real path is one root with one entry per file', { skip: noLinks }, async () => {
  const { base, real, link } = fixture();
  try {
    const index = createIndexService(fsShell());
    await index.ensureRoot(link, { watch: true });
    await index.ensureRoot(real, { watch: true });
    await index.settled();
    assert.deepEqual(index.roots(), [real]);
    assert.equal(index.entries().length, 2);
    // Dropping by either spelling finds the root.
    index.dropRoot(link);
    assert.deepEqual(index.roots(), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a root whose path cannot be resolved keeps the spelling it was given', async () => {
  const shell = createMemoryShell({ '/r/a.md': new TextEncoder().encode('# A\n') });
  const index = createIndexService({ ...shell, realPath: async () => { throw new Error('gone'); } });
  await index.ensureRoot('/r');
  await index.settled();
  assert.deepEqual(index.roots(), ['/r']);
});

test('link/sub/.. resolves as the OS does, not lexically', { skip: noLinks }, async () => {
  const { base, link } = fixture();
  try {
    // sub is a link into docs: the OS takes `..` from docs (the root), not from `link`'s own folder.
    linkDir(join(base, 'real', 'docs'), join(base, 'real', 'sub'));
    const through = `${link}/sub/..`;
    const os = realpathSync(through);
    assert.equal(os, join(base, 'real'));
    assert.equal(await fsShell().realPath(through), os);
    // The memory shell resolves segment by segment the same way.
    const memory = createMemoryShell({});
    memory.link('/b/link', '/b/real');
    memory.link('/b/real/sub', '/b/elsewhere/deep');
    assert.equal(await memory.realPath('/b/link/sub/..'), '/b/elsewhere');
    assert.equal(await memory.realPath('/b/link/./docs/../x'), '/b/real/x');
    assert.equal(await memory.realPath('/../x'), '/x');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a symlink inside the root that points outside it adds nothing', { skip: noLinks }, async () => {
  const { base, real, link } = fixture();
  try {
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'secret.md'), '# Secret\n');
    linkDir(join(base, 'outside'), join(base, 'real', 'out'));
    const index = createIndexService(fsShell());
    await index.ensureRoot(link);
    await index.settled();
    assert.ok(index.entries().every((e) => e.path.startsWith(`${real}/`) && !e.path.includes('secret')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a link retargeted after its root was dropped indexes the new folder', { skip: noLinks }, async () => {
  const { base, real, link } = fixture();
  try {
    const other = slashed(join(base, 'other'));
    mkdirSync(other);
    writeFileSync(join(other, 'b.md'), '# B\n');
    const index = createIndexService(fsShell());
    await index.ensureRoot(link);
    await index.settled();
    index.dropRoot(link);
    rmSync(link);
    linkDir(other, link);
    await index.ensureRoot(link);
    await index.settled();
    assert.deepEqual(index.roots(), [other]);
    assert.deepEqual(index.entries().map((e) => e.path), [`${other}/b.md`]);
    assert.notEqual(real, other);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
