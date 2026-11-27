// `readArchiveHeads` on the memory shell: the twin's heads over the page's own inflate, which stops at
// a head's limit, against the shared table the Rust reader checks too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryShell } from './memory.ts';
import { clipboard } from './clipboard.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../src-tauri/tests/fixtures/archives/${name}`, import.meta.url)));

test('heads of the shared zip and tar.gz through the memory shell, deflated entries cut at the head', async () => {
  const shell = createMemoryShell({ '/r/shared.zip': fixture('shared.zip'), '/r/shared.tar.gz': fixture('shared.tar.gz') });
  const zip = (await shell.listArchive('/r/shared.zip'))!;
  const heads = await shell.readArchiveHeads('/r/shared.zip', zip.entries.map((e) => ({ index: e.index, name: e.path })), 16);
  const readme = heads.find((h) => h.index === 1)!;
  assert.deepEqual([clipboard.textLoose(readme.bytes), readme.whole], ['# Read me\n\nA lin', false]);
  assert.equal(heads.find((h) => h.index === 4)!.refused, 'This entry is encrypted. The app does not ask for archive passwords.');
  assert.deepEqual(shell.calls.at(-1), {
    method: 'readArchiveHeads',
    args: ['/r/shared.zip', zip.entries.map((e) => ({ index: e.index, name: e.path })), 16],
  });
  const [big] = await shell.readArchiveHeads('/r/shared.tar.gz', [{ index: 13, name: 'src/big.txt' }], 19);
  assert.deepEqual([clipboard.textLoose(big!.bytes), big!.whole], ['a big line of text\n', false]);
  await assert.rejects(shell.readArchiveHeads('/r/gone.zip', [], 16), (e: { code?: string }) => e.code === 'not-found');
});
