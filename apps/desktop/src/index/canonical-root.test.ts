// A folder opened through a symlink (or `/tmp` for `/private/tmp`) is indexed (F-37.1): the real shell's `readDir`
// returns canonical child paths, and the walk keeps every path under the root the reader named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkRoot, loadIndex, type IndexLoadShell } from './walk.ts';

/** `readDir` as the Tauri shell does it: the listing's paths are under the canonical directory, whatever was asked. */
const canonicalShell: IndexLoadShell = {
  async readDir(dir) {
    const real = realpathSync(dir);
    return readdirSync(real).map((name) => {
      const s = statSync(join(real, name));
      return { path: join(real, name), isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs };
    });
  },
  async readFile(path) {
    return new Uint8Array(await import('node:fs/promises').then((fs) => fs.readFile(path)));
  },
};

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'marxy-canon-'));
  const real = join(base, 'real');
  mkdirSync(join(real, 'docs'), { recursive: true });
  writeFileSync(join(real, 'README.md'), '# Home\n');
  writeFileSync(join(real, 'docs', 'guide.md'), '# Guide\n');
  symlinkSync(real, join(base, 'link'));
  return { base, real, link: join(base, 'link') };
}

test('a root named through a symlink indexes its files, under the path the reader named', async () => {
  const { base, link } = fixture();
  try {
    const walk = await walkRoot(canonicalShell, link);
    assert.deepEqual(walk.entries.map((e) => e.path).sort(), [`${link}/README.md`, `${link}/docs/guide.md`]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a root with a .. segment, and a file opened through the link, index the same files', async () => {
  const { base, link } = fixture();
  try {
    const dotted = `${link}/docs/..`;
    const walk = await walkRoot(canonicalShell, dotted);
    assert.equal(walk.entries.length, 2);
    const viaOpened = await loadIndex({ ...canonicalShell, hasGitMarker: (d) => d === link }, `${link}/docs/guide.md`);
    assert.equal(viaOpened.entries.length, 2);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
