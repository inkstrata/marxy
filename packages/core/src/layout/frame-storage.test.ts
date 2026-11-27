// frame.json: known names and values only, a corrupt file kept beside itself, a newer one never written.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_FRAME, FRAME_MAX_BYTES, FramePersistence, MAX_SETS, cleanFrameState, parseFrameFile, serializeFrameFile } from './frame-storage.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('what the file says is kept, and anything it does not know is dropped', () => {
  const state = cleanFrameState({ folded: true, leftPanel: 'outline', leftMode: 'rail', panel: 'sleeps', cards: { log: { facts: 'off', nope: 'always' }, nope: {} }, sameCards: 'yes' });
  // Card choices kept earlier (cards, sameCards) are dropped with the rest: nothing chooses cards any more.
  assert.deepEqual(state, { folded: true, leftPanel: 'outline', leftMode: 'rail', sets: [], placeOrder: [] });
  assert.deepEqual(cleanFrameState({ leftPanel: 'library', leftMode: 'shut' }), DEFAULT_FRAME);
  assert.deepEqual(cleanFrameState(null), DEFAULT_FRAME);
});

test('migration: a branch kept earlier opens its panel, and a shut drawer is the rail alone', () => {
  const at = (raw: object) => {
    const s = cleanFrameState(raw);
    return [s.leftPanel, s.leftMode];
  };
  assert.deepEqual(at({ branch: 'library', lastBranch: 'library' }), ['places', 'open']);
  assert.deepEqual(at({ branch: 'find', lastBranch: 'find' }), ['search', 'open']);
  assert.deepEqual(at({ branch: 'transform' }), ['transforms', 'open']);
  assert.deepEqual(at({ branch: 'versions' }), ['versions', 'open']);
  assert.deepEqual(at({ branch: null, lastBranch: 'versions' }), ['versions', 'rail']);
  assert.deepEqual(at({ branch: 'look', lastBranch: 'look' }), ['places', 'open']);
  assert.deepEqual(at({ branch: 'settings' }), ['places', 'open']);
  assert.deepEqual(at({ branch: 'clip' }), ['places', 'open']);
  // Written back in the new shape: no branch, no panel mode.
  assert.doesNotMatch(new TextDecoder().decode(serializeFrameFile(cleanFrameState({ branch: 'find', panel: 'pinned' }))), /"branch"|"panel"/);
});

test('a set keeps its name, its row and what each pane showed; one without a name or a path, or named twice, is dropped', () => {
  const sets = cleanFrameState({
    sets: [
      { name: 'The upgrade', tabs: ['/a.md', '/b.md', '/c.md', '/a.md', 3], shown: ['/b.md', '/c.md', '/a.md'] },
      { name: '', tabs: ['/x.md'], shown: ['/x.md'] },
      { name: 'Empty', tabs: [], shown: [] },
      { name: 'The upgrade', tabs: ['/d.md'], shown: ['/d.md'] },
      { name: 'Nothing shown', tabs: ['/1', '/2'], shown: ['/9'] },
    ],
  }).sets;
  assert.deepEqual(sets, [
    { name: 'The upgrade', tabs: ['/a.md', '/b.md', '/c.md'], shown: ['/b.md', '/c.md'] },
    { name: 'Nothing shown', tabs: ['/1', '/2'], shown: ['/1'] },
  ]);
});

test('migration: a set kept as each pane\'s own tabs opens as one row, merged in order, each pane on its last tab', () => {
  const kept = enc(JSON.stringify({
    version: 1,
    frame: { sets: [{ name: 'The upgrade', panes: [['/a.md', '/b.md'], ['/c.md', '/a.md']] }, { name: 'Three panes', panes: [['/1'], ['/2'], ['/3']] }, { name: 'Empty', panes: [[]] }] },
  }));
  const read = parseFrameFile(kept);
  assert.equal(read.kind, 'ok');
  if (read.kind !== 'ok') return;
  assert.deepEqual(read.state.sets, [
    { name: 'The upgrade', tabs: ['/a.md', '/b.md', '/c.md'], shown: ['/b.md', '/a.md'] },
    { name: 'Three panes', tabs: ['/1', '/2'], shown: ['/1', '/2'] },
  ]);
  // Written back in the new shape, and read the same after that.
  const again = parseFrameFile(serializeFrameFile(read.state));
  assert.equal(again.kind, 'ok');
  if (again.kind === 'ok') assert.deepEqual(again.state.sets, read.state.sets);
  assert.doesNotMatch(new TextDecoder().decode(serializeFrameFile(read.state)), /"panes"/);
});

test('the file round-trips', () => {
  const state = { ...DEFAULT_FRAME, leftPanel: 'search' as const, leftMode: 'rail' as const };
  const read = parseFrameFile(serializeFrameFile(state));
  assert.equal(read.kind, 'ok');
  if (read.kind === 'ok') assert.deepEqual(read.state, state);
});

test('bytes that are not a frame file are quarantined, never read as one', () => {
  for (const bad of ['', 'not json', '[]', '{"frame":{}}']) assert.equal(parseFrameFile(enc(bad)).kind, 'quarantined', bad);
});

test('a corrupt file is kept beside itself and the frame starts from the defaults; a newer one is read and never written', async () => {
  const files = new Map<string, Uint8Array>([['/data/frame.json', enc('{oops')]]);
  const io = {
    dataDirectory: async () => '/data',
    readFile: async (p: string) => {
      const b = files.get(p);
      if (!b) throw new Error('not found');
      return b;
    },
    writeFileAtomic: async (p: string, b: Uint8Array) => void files.set(p, b),
  };
  const opened = await FramePersistence.open(io as never);
  assert.equal(opened.quarantined, true);
  assert.deepEqual(opened.saved(), DEFAULT_FRAME);
  assert.ok([...files.keys()].some((k) => k !== '/data/frame.json' && k.startsWith('/data/frame.json')));
  files.set('/data/frame.json', enc(JSON.stringify({ version: 99, frame: { folded: true } })));
  const newer = await FramePersistence.open(io as never);
  assert.equal(newer.readOnly, true);
  assert.equal(newer.saved().folded, true);
  await newer.write(DEFAULT_FRAME);
  assert.match(new TextDecoder().decode(files.get('/data/frame.json')), /"version":99/);
});

test('the places\' order keeps strings, once each, and drops anything else', () => {
  const state = cleanFrameState({ placeOrder: ['/b', '', 3, '/a', '/b', null] });
  assert.deepEqual(state.placeOrder, ['/b', '/a']);
});

test('a frame.json that is there but cannot be read is never written over this session; a missing one is', async () => {
  const kept = serializeFrameFile({ ...DEFAULT_FRAME, sets: [{ name: 'work', tabs: ['/r/a.md'], shown: ['/r/a.md'] }] });
  const files = new Map<string, Uint8Array>([['/data/frame.json', kept]]);
  let failure: string | null = 'permission';
  const io = {
    dataDirectory: async () => '/data',
    readFile: async (p: string) => {
      if (failure) throw Object.assign(new Error(failure), { code: failure });
      return files.get(p)!;
    },
    writeFileAtomic: async (p: string, b: Uint8Array) => void files.set(p, b),
  };
  const locked = await FramePersistence.open(io as never);
  assert.equal(locked.readOnly, true);
  await locked.write({ ...DEFAULT_FRAME, folded: true });
  assert.deepEqual(files.get('/data/frame.json'), kept);
  failure = 'not-found';
  const missing = await FramePersistence.open(io as never);
  assert.equal(missing.readOnly, false);
  await missing.write({ ...DEFAULT_FRAME, folded: true });
  assert.notDeepEqual(files.get('/data/frame.json'), kept);
});

/** frame.json's io as the shells give it: a head read, never more than 256 KB whatever is asked for. */
function shellIo(files: Map<string, Uint8Array>) {
  const read = async (p: string) => {
    const b = files.get(p);
    if (!b) throw Object.assign(new Error('missing'), { code: 'not-found' });
    return b;
  };
  return {
    dataDirectory: async () => '/data',
    readFile: read,
    readHead: async (p: string, max: number) => (await read(p)).slice(0, Math.min(max, 256 * 1024)),
    writeFileAtomic: async (p: string, b: Uint8Array) => void files.set(p, b.slice()),
  };
}

const setsAtCaps = (path: (s: number, p: number, i: number) => string) =>
  Array.from({ length: MAX_SETS }, (_, s) => {
    const tabs = [0, 1].flatMap((p) => Array.from({ length: 24 }, (_, i) => path(s, p, i)));
    return { name: `set ${s}`, tabs, shown: [tabs[0]!, tabs[47]!] };
  });

test('frame.json at the caps (every set, a row of 48 tabs) is read back whole', async () => {
  const files = new Map<string, Uint8Array>();
  const io = shellIo(files);
  const state = { ...DEFAULT_FRAME, sets: setsAtCaps((s, p, i) => `C:/Users/someone/Documents/projects/client-work/notes/set${s}/pane${p}/document-${i}.md`) };
  await (await FramePersistence.open(io as never)).write(state);
  assert.ok(files.get('/data/frame.json')!.length > 64 * 1024, 'past the old 64 KB limit');
  const next = await FramePersistence.open(io as never);
  assert.equal(next.quarantined, false);
  assert.deepEqual(next.saved().sets, state.sets);
});

test('a frame too large to read back keeps its newest sets when written, never one the next launch cannot read', async () => {
  const files = new Map<string, Uint8Array>();
  const io = shellIo(files);
  const long = `C:/${'a-folder-with-a-long-name/'.repeat(12)}`;
  const state = { ...DEFAULT_FRAME, sets: setsAtCaps((s, p, i) => `${long}set${s}/pane${p}/document-${i}.md`) };
  await (await FramePersistence.open(io as never)).write(state);
  assert.ok(files.get('/data/frame.json')!.length <= FRAME_MAX_BYTES);
  const next = await FramePersistence.open(io as never);
  assert.equal(next.quarantined, false);
  const kept = next.saved().sets;
  assert.ok(kept.length > 0 && kept.length < MAX_SETS, `${kept.length} sets`);
  assert.deepEqual(kept, state.sets.slice(0, kept.length), 'the first (newest) sets, whole');
});

test('a set kept with backslashes by an earlier build reads as slashed paths, each once', () => {
  const sets = cleanFrameState({ sets: [{ name: 'Old', tabs: ['C:\\n\\a.md', 'C:/n/a.md', 'C:\\n\\b.md'], shown: ['C:\\n\\b.md'] }] }).sets;
  assert.deepEqual(sets, [{ name: 'Old', tabs: ['C:/n/a.md', 'C:/n/b.md'], shown: ['C:/n/b.md'] }]);
});
