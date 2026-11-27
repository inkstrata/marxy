// The Tauri binding never sends a path that names no place on disk: Rust would read it against its working folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shell } from './tauri.ts';

const refused = (e: Error & { code?: string }): boolean => e.code === 'invalid' && /not a path on disk/.test(e.message);

test('an archive entry, its folder or any relative path is refused before it reaches the shell', async () => {
  for (const p of ['archive-entry:4/notes', 'archive-entry:4', '.', '', 'src/a.md', '../x']) {
    await assert.rejects(() => shell.readDir(p), refused, p);
  }
  // Each call that names a place on disk refuses before invoking anything.
  for (const call of [
    () => shell.realPath('archive-entry:4/notes'),
    () => shell.stat('archive-entry:4/notes/a.md'),
    () => shell.readHead('archive-entry:4/a.md', 16),
    () => shell.readFile('archive-entry:4/a.md'),
    () => shell.allowAssetScope('archive-entry:4'),
    () => shell.imageSize('archive-entry:4/a.png'),
    () => shell.watch('archive-entry:4', () => {}),
  ]) {
    await assert.rejects(call, refused);
  }
});
