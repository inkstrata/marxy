// Where the frame's parts sit for a window's width, and frame.json read late.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_FRAME, serializeFrameFile } from '@marxy/core/src/layout/frame-storage.ts';
import { createFrameStore, firstLeftMode, place, type FrameState } from './state.ts';

const open = DEFAULT_FRAME;

test('wide: the rail and the drawer dock beside one pane', () => {
  assert.deepEqual(place(open, 1440, 1), { rail: 44, drawer: 'docked' });
});

test('two panes need 960 px of centre beside the drawer', () => {
  assert.deepEqual(place(open, 1440, 2), { rail: 44, drawer: 'docked' });
  assert.deepEqual(place(open, 1200, 2), { rail: 44, drawer: 'closed' });
  assert.deepEqual(place(open, 1200, 2, true), { rail: 44, drawer: 'over' });
});

test('under 900 px the drawer gives way to the rail, and lies over the page when a panel is asked for', () => {
  assert.equal(place(open, 899, 1).drawer, 'closed');
  assert.equal(place(open, 899, 1, true).drawer, 'over');
  assert.equal(place(open, 900, 1).drawer, 'docked');
});

test('the rail alone, hidden, and folded', () => {
  assert.deepEqual(place({ ...open, leftMode: 'rail' }, 1440, 1, true), { rail: 44, drawer: 'closed' });
  assert.deepEqual(place({ ...open, leftMode: 'hidden' }, 1440, 1), { rail: 0, drawer: 'closed' });
  assert.deepEqual(place({ ...open, folded: true }, 1440, 1), { rail: 0, drawer: 'closed' });
});

test('frame.json read late: the frame is told, and a change made before it landed is kept over it and written', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const written: string[] = [];
  const saved = serializeFrameFile({ ...DEFAULT_FRAME, folded: true, leftMode: 'rail' });
  const store = createFrameStore({
    configPaths: async () => ({ config: '/c', data: '/d' }) as never,
    readHead: async () => {
      await gate;
      return saved;
    },
    writeFileAtomic: async (_p: string, b: Uint8Array) => { written.push(new TextDecoder().decode(b)); },
  } as never);
  const heard: FrameState[] = [];
  store.onChange((s) => heard.push(s));
  const loading = store.load();
  // Drawn from the defaults while the read waits; the reader opens Find.
  store.update({ leftPanel: 'search' });
  release();
  await loading;
  assert.equal(store.state.leftPanel, 'search', 'the change made meanwhile is not lost');
  assert.equal(store.state.leftMode, 'rail', 'the saved state is in');
  assert.deepEqual(heard.at(-1), store.state, 'the frame heard the saved state');
  await store.flush();
  assert.match(written.at(-1)!, /"leftPanel": "search"/);
  assert.match(written.at(-1)!, /"leftMode": "rail"/);
  store.destroy();
});

test('a first window opens the drawer only where the page keeps its measure beside it', () => {
  // 611 px of measure and two 24 px gutters need 659 px of centre: the rail and drawer take 360.
  assert.equal(firstLeftMode(1019, 611), 'open');
  assert.equal(firstLeftMode(1018, 611), 'rail');
  assert.equal(firstLeftMode(1440, 611), 'open');
  assert.equal(firstLeftMode(1100, 760), 'rail', 'a wider measure needs a wider window');
  assert.equal(firstLeftMode(900, 611), 'rail');
  assert.equal(firstLeftMode(899, 611), 'open', 'under 900 px the drawer starts shut anyway, and a panel asked for lies over the page');
});

const shellWith = (head: () => Promise<Uint8Array>, written: string[] = []) =>
  ({
    configPaths: async () => ({ config: '/c', data: '/d' }) as never,
    readHead: head,
    writeFileAtomic: async (_p: string, b: Uint8Array) => { written.push(new TextDecoder().decode(b)); },
  }) as never;

test('no frame.json: the store says fresh, and a start it assumes is heard but not written', async () => {
  const written: string[] = [];
  const store = createFrameStore(shellWith(async () => { throw Object.assign(new Error('not found'), { code: 'not-found' }); }, written));
  assert.equal(store.fresh, null, 'unknown before the read');
  await store.load();
  assert.equal(store.fresh, true);
  const heard: FrameState[] = [];
  store.onChange((s) => heard.push(s));
  store.assume({ leftMode: 'rail' });
  assert.equal(store.state.leftMode, 'rail');
  assert.equal(heard.length, 1);
  await store.flush();
  assert.deepEqual(written, [], 'the start is not a choice the reader made');
  store.destroy();
});

test('a kept frame.json is not fresh', async () => {
  const store = createFrameStore(shellWith(async () => serializeFrameFile(DEFAULT_FRAME)));
  await store.load();
  assert.equal(store.fresh, false);
  store.destroy();
});

test('an unrelated change after an assumed start does not write the assumption', async () => {
  const written: string[] = [];
  const store = createFrameStore(shellWith(async () => { throw Object.assign(new Error('not found'), { code: 'not-found' }); }, written));
  await store.load();
  store.assume({ leftMode: 'rail' });
  store.update({ folded: true });
  assert.equal(store.state.leftMode, 'rail', 'still shown');
  assert.equal(store.state.folded, true);
  await store.flush();
  assert.equal(written.length, 1);
  assert.match(written[0]!, /"folded": true/);
  assert.doesNotMatch(written[0]!, /"leftMode": "rail"/, 'the kept frame keeps the default');
  store.destroy();
});

test('the reader choosing what was assumed makes it theirs, written even when it equals the kept value', async () => {
  const written: string[] = [];
  const store = createFrameStore(shellWith(async () => { throw Object.assign(new Error('not found'), { code: 'not-found' }); }, written));
  await store.load();
  store.assume({ leftMode: 'rail' });
  store.update({ leftMode: DEFAULT_FRAME.leftMode });
  assert.equal(store.state.leftMode, DEFAULT_FRAME.leftMode);
  await store.flush();
  assert.equal(written.length, 1, 'the choice is kept');
  store.update({ folded: true });
  assert.equal(store.state.leftMode, DEFAULT_FRAME.leftMode, 'and the assumption does not come back');
  store.destroy();
});

test('assumed again (the window resized), the start moves while it is assumed and never over the reader\'s choice', async () => {
  const written: string[] = [];
  const store = createFrameStore(shellWith(async () => { throw Object.assign(new Error('not found'), { code: 'not-found' }); }, written));
  await store.load();
  const heard: FrameState[] = [];
  store.onChange((s) => heard.push(s));
  store.assume({ leftMode: 'open' });
  store.assume({ leftMode: 'rail' });
  assert.equal(store.state.leftMode, 'rail', 'a window widened from 800 to 1,000 px starts as one opened at 1,000');
  store.assume({ leftMode: 'rail' });
  assert.equal(heard.length, 2, 'the same start again is not heard');
  store.update({ leftMode: 'open' });
  store.assume({ leftMode: 'rail' });
  assert.equal(store.state.leftMode, 'open', 'the reader chose');
  await store.flush();
  assert.equal(written.length, 1, 'only the choice is written');
  store.destroy();
});

test('an assumption made before a slow read lands is applied when the read lands, and still not written', async () => {
  const written: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const store = createFrameStore(shellWith(async () => { await gate; throw Object.assign(new Error('not found'), { code: 'not-found' }); }, written));
  const loading = store.load();
  store.assume({ leftMode: 'rail' });
  assert.equal(store.state.leftMode, DEFAULT_FRAME.leftMode, 'not applied while the read is out');
  const heard: FrameState[] = [];
  store.onChange((s) => heard.push(s));
  release();
  await loading;
  assert.equal(store.state.leftMode, 'rail');
  assert.equal(heard.at(-1)?.leftMode, 'rail', 'the frame is told');
  await store.flush();
  assert.deepEqual(written, []);
  store.destroy();
});

test('an assumption is dropped when a frame.json was kept', async () => {
  const store = createFrameStore(shellWith(async () => serializeFrameFile(DEFAULT_FRAME)));
  store.assume({ leftMode: 'rail' });
  await store.load();
  assert.equal(store.state.leftMode, DEFAULT_FRAME.leftMode);
  store.destroy();
});
