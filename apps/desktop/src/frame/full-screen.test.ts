// Full screen's state: entering draws the page alone without ever storing a fold, leaving undoes it, Esc leaves only
// when nothing took it, and a window that refuses is not left half in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFullScreen } from './full-screen.ts';

function rig(native = false) {
  const log: string[] = [];
  const world = { native, refuse: false, redraws: 0 };
  const fullScreen = createFullScreen({
    shell: {
      async setFullscreen(on) {
        if (world.refuse) throw new Error('refused');
        world.native = on;
        log.push(`window:${on}`);
      },
      async isFullscreen() {
        return world.native;
      },
    },
    changed: () => void world.redraws++,
    entered: () => void log.push('said'),
  });
  return { fullScreen, world, log };
}

test('entering takes the window full screen, says how to leave, and draws again', async () => {
  const { fullScreen, world, log } = rig();
  await fullScreen.enter();
  assert.equal(fullScreen.on, true);
  assert.equal(world.native, true);
  assert.equal(world.redraws, 1);
  assert.deepEqual(log, ['window:true', 'said']);
});

test('it touches no fold: the only things it can reach are the shell and the redraw', async () => {
  const { fullScreen } = rig();
  // The deps have no store and no fold to set; a stored fold would need one.
  await fullScreen.enter();
  await fullScreen.leave();
  assert.equal(fullScreen.on, false);
});

test('enter twice and leave twice do each once', async () => {
  const { fullScreen, log } = rig();
  await fullScreen.enter();
  await fullScreen.enter();
  await fullScreen.leave();
  await fullScreen.leave();
  assert.deepEqual(log, ['window:true', 'said', 'window:false']);
});

test('toggle goes in, then out', async () => {
  const { fullScreen } = rig();
  await fullScreen.toggle();
  assert.equal(fullScreen.on, true);
  await fullScreen.toggle();
  assert.equal(fullScreen.on, false);
});

test('Esc leaves only in full screen and only when nothing else took it', async () => {
  const { fullScreen, world } = rig();
  assert.equal(await fullScreen.escape(false), false, 'not in full screen: nothing to leave');
  await fullScreen.enter();
  assert.equal(await fullScreen.escape(true), false, 'a Line, menu, find field or editor has it');
  assert.equal(fullScreen.on, true);
  assert.equal(world.native, true);
  assert.equal(await fullScreen.escape(false), true);
  assert.equal(fullScreen.on, false);
});

test('a window refusing to enter leaves the state as it was, and the refusal is passed on', async () => {
  const { fullScreen, world, log } = rig();
  world.refuse = true;
  await assert.rejects(fullScreen.enter(), /refused/);
  assert.equal(fullScreen.on, false);
  assert.ok(!log.includes('said'));
  world.refuse = false;
  await fullScreen.enter();
  world.refuse = true;
  await assert.rejects(fullScreen.leave(), /refused/);
  assert.equal(fullScreen.on, true, 'still full screen: the window said so');
});

test('a window taken out of full screen by the system is followed, and put back in', async () => {
  const { fullScreen, world, log } = rig();
  await fullScreen.enter();
  world.native = false;
  await fullScreen.sync();
  assert.equal(fullScreen.on, false);
  world.native = true;
  await fullScreen.sync();
  assert.equal(fullScreen.on, true);
  assert.deepEqual(
    log.filter((l) => l.startsWith('window')),
    ['window:true'],
    'the window was never asked again',
  );
});

test('an answer to a look taken before an enter or leave is dropped', async () => {
  let release: (v: boolean) => void = () => {};
  const fullScreen = createFullScreen({
    shell: { isFullscreen: () => new Promise<boolean>((r) => (release = r)), setFullscreen: async () => {} },
    changed: () => {},
  });
  const looking = fullScreen.sync();
  await fullScreen.enter();
  release(false);
  await looking;
  assert.equal(fullScreen.on, true, 'the late "not full screen" did not undo the enter');
});

test('a shell with no full screen leaves the state alone', async () => {
  const fullScreen = createFullScreen({ shell: {}, changed: () => {} });
  await fullScreen.sync();
  assert.equal(fullScreen.on, false);
});
