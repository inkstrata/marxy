// readings.json kept from the choices: read at launch into the page's choices, written after a choice, an entry gone when
// a part goes back to the guess, and every choice forgotten from Privacy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choosePart, onPartChoice, partChoice, partChoiceCount, restorePartChoices } from './parts.ts';
import { forgetPartReadings, keepPartChoices } from './readings-file.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

function memoryShell(files: Record<string, string> = {}) {
  const disk = new Map(Object.entries(files));
  return {
    disk,
    shell: {
      configPaths: async () => ({ config: '/cfg/config.toml', data: '/data' }),
      readFile: async (path: string) => {
        const f = disk.get(path);
        if (f === undefined) throw Object.assign(new Error('no such file'), { code: 'not-found' });
        return enc(f);
      },
      writeFileAtomic: async (path: string, bytes: Uint8Array) => {
        disk.set(path, dec(bytes));
      },
    } as unknown as Parameters<typeof keepPartChoices>[0],
  };
}

const onDisk = (disk: Map<string, string>): unknown => JSON.parse(disk.get('/data/readings.json')!).parts;

test('the file is read into the choices at launch, and a page already set hears its path', async () => {
  restorePartChoices({});
  const { shell } = memoryShell({ '/data/readings.json': JSON.stringify({ version: 1, parts: { '/a.md': { 'x\u00000': 'written' } } }) });
  const heard: string[] = [];
  const off = onPartChoice((p) => heard.push(p));
  const keeper = keepPartChoices(shell);
  await keeper.loaded;
  off();
  assert.equal(partChoice('/a.md', 'x\u00000'), 'written');
  assert.deepEqual(heard, ['/a.md']);
  keeper.destroy();
});

test('a choice is written; back to the guess deletes its entry, and the file it leaves empty', async () => {
  restorePartChoices({});
  const { shell, disk } = memoryShell();
  const keeper = keepPartChoices(shell);
  await keeper.loaded;
  assert.equal(disk.size, 0, 'nothing is written by reading');
  choosePart('/b.md', 'name,size\u00000', 'written');
  choosePart('/b.md', '$ ls\u00000', 'written');
  await keeper.flush();
  assert.deepEqual(onDisk(disk), { '/b.md': { '$ ls\u00000': 'written', 'name,size\u00000': 'written' } });
  choosePart('/b.md', '$ ls\u00000', null);
  await keeper.flush();
  assert.deepEqual(onDisk(disk), { '/b.md': { 'name,size\u00000': 'written' } });
  choosePart('/b.md', 'name,size\u00000', null);
  await keeper.flush();
  assert.deepEqual(onDisk(disk), {});
  keeper.destroy();
});

test('a choice made before the file is read wins over what the file held for that path', async () => {
  restorePartChoices({});
  const { shell, disk } = memoryShell({
    '/data/readings.json': JSON.stringify({ version: 1, parts: { '/c.md': { 'k\u00000': 'data' }, '/d.md': { 'k\u00000': 'table' } } }),
  });
  const keeper = keepPartChoices(shell);
  choosePart('/c.md', 'k\u00000', 'written');
  await keeper.loaded;
  await keeper.flush();
  assert.equal(partChoice('/c.md', 'k\u00000'), 'written');
  assert.equal(partChoice('/d.md', 'k\u00000'), 'table');
  assert.deepEqual(onDisk(disk), { '/c.md': { 'k\u00000': 'written' }, '/d.md': { 'k\u00000': 'table' } });
  keeper.destroy();
});

test('Forget how parts are read empties the choices and the file; a newer file is left as it is', async () => {
  restorePartChoices({});
  const { shell, disk } = memoryShell({ '/data/readings.json': JSON.stringify({ version: 1, parts: { '/e.md': { 'k\u00000': 'data' } } }) });
  const keeper = keepPartChoices(shell);
  await keeper.loaded;
  assert.deepEqual(partChoiceCount(), { files: 1, parts: 1 });
  assert.equal(await forgetPartReadings(), 'forgotten');
  assert.deepEqual(partChoiceCount(), { files: 0, parts: 0 });
  assert.deepEqual(onDisk(disk), {});
  keeper.destroy();

  const newer = JSON.stringify({ version: 2, parts: { '/f.md': { 'k\u00000': 'data' } } });
  const second = memoryShell({ '/data/readings.json': newer });
  const kept = keepPartChoices(second.shell);
  await kept.loaded;
  assert.equal(partChoice('/f.md', 'k\u00000'), 'data', 'a newer file is read');
  choosePart('/f.md', 'k\u00000', 'written');
  await kept.flush();
  assert.equal(await forgetPartReadings(), 'newer');
  assert.equal(second.disk.get('/data/readings.json'), newer, 'and never written');
  kept.destroy();
});
