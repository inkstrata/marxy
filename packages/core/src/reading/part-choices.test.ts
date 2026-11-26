// readings.json: known readings only, a corrupt file kept beside itself and started again, a newer one never written.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PART_CHOICES_CAP,
  PART_CHOICES_FILE_VERSION,
  PartChoicesFile,
  cleanColourChoices,
  cleanEncodingChoices,
  cleanPartChoices,
  parsePartChoicesFile,
  serializePartChoicesFile,
} from './part-choices.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

function memoryIo(files: Record<string, string | Error> = {}) {
  const written = new Map<string, string>();
  return {
    written,
    io: {
      dataDirectory: async () => '/data/',
      readFile: async (path: string) => {
        const f = files[path];
        if (f instanceof Error) throw f;
        if (f === undefined) throw Object.assign(new Error('no such file'), { code: 'not-found' });
        return enc(f);
      },
      writeFileAtomic: async (path: string, bytes: Uint8Array) => {
        written.set(path, dec(bytes));
      },
    },
  };
}

test('what the file says is kept, and a reading it does not know, or a file left without a choice, is dropped', () => {
  const parts = cleanPartChoices({
    '/a.md': { 'name,size\u00000': 'table', '$ ls\u00000': 'session', 'x\u00000': 'chart', 'y\u00000': 3 },
    '/b.md': { 'z\u00000': 'nope' },
    '/c.md': 'table',
    '': { 'k\u00000': 'data' },
  });
  assert.deepEqual(parts, { '/a.md': { 'name,size\u00000': 'table', '$ ls\u00000': 'session' } });
  assert.deepEqual(cleanPartChoices(null), {});
  assert.deepEqual(cleanPartChoices([]), {});
});

test('the file round-trips, its envelope a version and the parts by path and key, each sorted', () => {
  const parts = { '/z.md': { 'b\u00000': 'written', 'a\u00001': 'data' }, '/a.md': { '{\u00000': 'data' } } as const;
  const bytes = serializePartChoicesFile(parts);
  const text = dec(bytes);
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(Object.keys(JSON.parse(text)), ['version', 'parts']);
  assert.equal(JSON.parse(text).version, PART_CHOICES_FILE_VERSION);
  assert.deepEqual(Object.keys(JSON.parse(text).parts), ['/a.md', '/z.md']);
  assert.deepEqual(Object.keys(JSON.parse(text).parts['/z.md']), ['a\u00001', 'b\u00000']);
  const read = parsePartChoicesFile(bytes);
  assert.equal(read.kind, 'ok');
  if (read.kind === 'ok') assert.deepEqual(read.parts, parts);
});

test('bytes that are not a readings file are quarantined, never read as one', () => {
  for (const bad of ['', 'not json', '[]', '{"parts":{}}', '{"version":"1","parts":{}}', '{"version":1,"parts":[]}']) {
    assert.equal(parsePartChoicesFile(enc(bad)).kind, 'quarantined', bad);
  }
  assert.equal(parsePartChoicesFile(new Uint8Array([0x7b, 0xff, 0x7d])).kind, 'quarantined', 'not UTF-8');
  assert.equal(parsePartChoicesFile(enc('{"version":1}')).kind, 'ok', 'no parts yet');
});

test('no file yet is no choices, and the first write makes it', async () => {
  const { io, written } = memoryIo();
  const file = await PartChoicesFile.open(io);
  assert.equal(file.path, '/data/readings.json');
  assert.deepEqual(file.saved(), {});
  assert.equal(file.readOnly, false);
  assert.equal(written.size, 0, 'nothing is written by reading');
  await file.write({ '/a.md': { 'k\u00000': 'written' } });
  assert.deepEqual(JSON.parse(written.get('/data/readings.json')!).parts, { '/a.md': { 'k\u00000': 'written' } });
});

test('a corrupt file is kept beside itself and started again empty', async () => {
  const { io, written } = memoryIo({ '/data/readings.json': '{"version":1,"parts":{' });
  const file = await PartChoicesFile.open(io);
  assert.equal(file.quarantined, true);
  assert.deepEqual(file.saved(), {});
  const aside = [...written.keys()].find((p) => p.startsWith('/data/readings.json.bad-'));
  assert.ok(aside, [...written.keys()].join(', '));
  assert.equal(written.get(aside!), '{"version":1,"parts":{');
  assert.deepEqual(JSON.parse(written.get('/data/readings.json')!), { version: PART_CHOICES_FILE_VERSION, parts: {} });
});

test('a newer file is read and never written over', async () => {
  const newer = JSON.stringify({ version: PART_CHOICES_FILE_VERSION + 1, parts: { '/a.md': { 'k\u00000': 'table' } }, more: true });
  const { io, written } = memoryIo({ '/data/readings.json': newer });
  const file = await PartChoicesFile.open(io);
  assert.equal(file.readOnly, true);
  assert.deepEqual(file.saved(), { '/a.md': { 'k\u00000': 'table' } });
  await file.write({});
  assert.equal(written.size, 0);
});

test('a file that is there but cannot be read is not written over', async () => {
  const { io, written } = memoryIo({ '/data/readings.json': Object.assign(new Error('denied'), { code: 'permission' }) });
  const file = await PartChoicesFile.open(io);
  assert.equal(file.readOnly, true);
  await file.write({ '/a.md': { 'k\u00000': 'data' } });
  assert.equal(written.size, 0);
});

test('at most the cap of files is kept', () => {
  const many: Record<string, Record<string, string>> = {};
  for (let i = 0; i <= PART_CHOICES_CAP; i++) many[`/f${i}.md`] = { 'k\u00000': 'data' };
  assert.equal(Object.keys(cleanPartChoices(many)).length, PART_CHOICES_CAP);
});

test('the files coloured anyway are kept beside the parts, and written only when there is one', async () => {
  assert.doesNotMatch(new TextDecoder().decode(serializePartChoicesFile({})), /colour/);
  const bytes = serializePartChoicesFile({}, { colour: ['/b.js', '/a.js', '/a.js', ''] });
  const loaded = parsePartChoicesFile(bytes);
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.kind === 'ok' && loaded.colour, ['/a.js', '/b.js']);
  const { io } = memoryIo({ '/data/readings.json': new TextDecoder().decode(bytes) });
  const file = await PartChoicesFile.open(io);
  assert.deepEqual(file.savedColour(), ['/a.js', '/b.js']);
  // A part's choice written later keeps the colour choices.
  await file.write({ '/c.md': { 'k\u00000': 'data' } });
  assert.deepEqual(file.savedColour(), ['/a.js', '/b.js']);
  assert.deepEqual(cleanColourChoices([1, '/x.js', null]), ['/x.js']);
  assert.deepEqual(cleanColourChoices('/x.js'), []);
});

test('the HTML files read as a page are kept beside the rest, and written only when there is one', async () => {
  assert.doesNotMatch(new TextDecoder().decode(serializePartChoicesFile({}, { colour: ['/a.js'] })), /pages/);
  const bytes = serializePartChoicesFile({}, { pages: ['/site/b.html', '/site/a.html', ''] });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), { version: 1, parts: {}, pages: ['/site/a.html', '/site/b.html'] });
  const { io } = memoryIo({ '/data/readings.json': new TextDecoder().decode(bytes) });
  const file = await PartChoicesFile.open(io);
  assert.deepEqual(file.savedPages(), ['/site/a.html', '/site/b.html']);
  // A colour choice written later keeps the pages, and a write that names none forgets them.
  await file.write({}, { colour: ['/x.js'] });
  assert.deepEqual(file.savedPages(), ['/site/a.html', '/site/b.html']);
  await file.write({}, { colour: ['/x.js'], pages: [] });
  assert.deepEqual(file.savedPages(), []);
});

test('the files read as their bytes (Read as › Bytes) are kept beside the rest, and written only when there is one', async () => {
  assert.doesNotMatch(new TextDecoder().decode(serializePartChoicesFile({}, { pages: ['/a.html'] })), /bytes/);
  const bytes = serializePartChoicesFile({}, { bytes: ['/b.json', '/a.md', ''] });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), { version: 1, parts: {}, bytes: ['/a.md', '/b.json'] });
  const { io } = memoryIo({ '/data/readings.json': new TextDecoder().decode(bytes) });
  const file = await PartChoicesFile.open(io);
  assert.deepEqual(file.savedBytes(), ['/a.md', '/b.json']);
  await file.write({}, { pages: ['/x.html'] });
  assert.deepEqual(file.savedBytes(), ['/a.md', '/b.json']);
  await file.write({}, { bytes: [] });
  assert.deepEqual(file.savedBytes(), []);
});

test('the code files the reader put in Source are kept beside the rest, and written only when there is one', async () => {
  assert.doesNotMatch(new TextDecoder().decode(serializePartChoicesFile({}, { bytes: ['/a.md'] })), /source/);
  const bytes = serializePartChoicesFile({}, { source: ['/r/b.rs', '/r/a.py', ''] });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)), { version: 1, parts: {}, source: ['/r/a.py', '/r/b.rs'] });
  const { io } = memoryIo({ '/data/readings.json': new TextDecoder().decode(bytes) });
  const file = await PartChoicesFile.open(io);
  assert.deepEqual(file.savedSource(), ['/r/a.py', '/r/b.rs']);
  await file.write({}, { bytes: ['/x.md'] });
  assert.deepEqual(file.savedSource(), ['/r/a.py', '/r/b.rs']);
  await file.write({}, { source: [] });
  assert.deepEqual(file.savedSource(), []);
});

test('the encodings files are read in are kept beside the parts, and written only when there is one', async () => {
  assert.doesNotMatch(new TextDecoder().decode(serializePartChoicesFile({})), /encodings/);
  const bytes = serializePartChoicesFile({}, { encodings: { '/b.txt': 'macintosh', '/a.txt': 'utf-16be', '': 'koi8-r', '/c.txt': 'not a <label>' } });
  const loaded = parsePartChoicesFile(bytes);
  assert.equal(loaded.kind, 'ok');
  assert.deepEqual(loaded.kind === 'ok' && Object.entries(loaded.encodings), [['/a.txt', 'utf-16be'], ['/b.txt', 'macintosh']]);
  const { io } = memoryIo({ '/data/readings.json': new TextDecoder().decode(bytes) });
  const file = await PartChoicesFile.open(io);
  assert.deepEqual(file.savedEncodings(), { '/a.txt': 'utf-16be', '/b.txt': 'macintosh' });
  // A part's choice written later keeps the encoding choices.
  await file.write({ '/c.md': { 'k\u00000': 'data' } });
  assert.deepEqual(file.savedEncodings(), { '/a.txt': 'utf-16be', '/b.txt': 'macintosh' });
  assert.deepEqual(cleanEncodingChoices({ '/x.txt': 7, '/y.txt': 'windows-1252' }), { '/y.txt': 'windows-1252' });
});

test('paths kept with backslashes by an earlier build read as slashed paths: parts merge, lists hold each file once', () => {
  const loaded = parsePartChoicesFile(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        parts: { 'C:\\n\\a.md': { one: 'data' }, 'C:/n/a.md': { two: 'table' } },
        colour: ['C:\\n\\a.md', 'C:/n/a.md'],
        encodings: { 'C:\\n\\b.txt': 'macintosh' },
      }),
    ),
  );
  assert.equal(loaded.kind, 'ok');
  if (loaded.kind !== 'ok') return;
  assert.deepEqual(Object.keys(loaded.parts), ['C:/n/a.md']);
  assert.deepEqual(Object.keys(loaded.parts['C:/n/a.md']!).sort(), ['one', 'two']);
  assert.deepEqual(loaded.colour, ['C:/n/a.md']);
  assert.deepEqual(loaded.encodings, { 'C:/n/b.txt': 'macintosh' });
});
