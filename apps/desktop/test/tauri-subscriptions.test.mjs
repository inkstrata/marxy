// The Tauri shell lives as long as the window and every app boot subscribes again: a boot that replaces another leaves
// the file-drop listeners, the open-files, menu and close-requested events heard by the new boot alone.
import { strict as assert } from 'node:assert';
import { register } from 'node:module';
import { test } from 'node:test';

register('./support/tauri-stub-hooks.mjs', import.meta.url);
globalThis.navigator ??= { platform: 'MacIntel' };
const posted = [];
const page = new EventTarget();
page.chrome = { webview: { postMessageWithAdditionalObjects: (message, files) => posted.push([message, files]) } };
globalThis.window = Object.assign(page, { chrome: page.chrome });
globalThis.document = { body: { toggleAttribute() {} } };
const { emit, hold } = await import('./support/tauri-event-stub.mjs');
const { hooks } = await import('./support/tauri-core-stub.mjs');
const { shell } = await import('../src/shell/tauri.ts');

const drop = () => {
  const event = new Event('drop', { cancelable: true });
  event.dataTransfer = { types: ['Files'], files: [{ name: 'a.md' }] };
  window.dispatchEvent(event);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('a file dropped after a second boot is sent to the host once, not once per boot', async () => {
  shell.onOpenFiles(() => {});
  shell.onOpenFiles(() => {});
  await settle();
  posted.length = 0;
  drop();
  assert.equal(posted.length, 1);
});

test('files opened by the system reach the boot that subscribed last, and only it', async () => {
  const heard = [];
  shell.onOpenFiles(() => heard.push('first'));
  shell.onOpenFiles(() => heard.push('second'));
  await settle();
  emit('marxy:open-files', ['/r/a.md']);
  assert.deepEqual(heard, ['second']);
});

test('a menu command and a close request reach the boot that subscribed last, and only it', async () => {
  const heard = [];
  shell.onMenuCommand((id) => heard.push(`first ${id}`));
  shell.onMenuCommand((id) => heard.push(`second ${id}`));
  shell.onCloseRequested(() => heard.push('close first'));
  shell.onCloseRequested(() => heard.push('close second'));
  await settle();
  emit('marxy:menu', 'file.open');
  emit('marxy:close-requested', undefined);
  assert.deepEqual(heard, ['second file.open', 'close second']);
});
test('an event emitted while the second boot is still subscribing reaches the second boot', async () => {
  const heard = [];
  shell.onOpenFiles(() => heard.push('first'));
  shell.onMenuCommand((id) => heard.push(`first ${id}`));
  await settle();
  let release;
  hold.listen = new Promise((resolve) => (release = resolve));
  try {
    shell.onOpenFiles((paths) => heard.push(`second ${paths}`));
    shell.onMenuCommand((id) => heard.push(`second ${id}`));
    emit('marxy:open-files', ['/r/a.md']);
    emit('marxy:menu', 'file.open');
  } finally {
    hold.listen = null;
    release();
  }
  await settle();
  assert.deepEqual(heard, ['second /r/a.md', 'second file.open']);
});

test('opens queued before a reboot, drained after it, reach the new boot', async () => {
  const heard = [];
  let answer;
  let calls = 0;
  hooks.pendingOpens = () => (calls++ === 0 ? new Promise((resolve) => (answer = resolve)) : []);
  try {
    shell.onOpenFiles((paths) => heard.push(`first ${paths}`));
    await settle();
    shell.onOpenFiles((paths) => heard.push(`second ${paths}`));
    await settle();
    answer([['/r/queued.md']]);
    await settle();
  } finally {
    hooks.pendingOpens = null;
  }
  assert.deepEqual(heard, ['second /r/queued.md']);
});

test('after a boot is destroyed no event reaches it, and the next boot still hears, queued opens included', async () => {
  const heard = [];
  const offOpen = shell.onOpenFiles((paths) => heard.push(`dead ${paths}`));
  const offMenu = shell.onMenuCommand((id) => heard.push(`dead ${id}`));
  const offClose = shell.onCloseRequested(() => heard.push('dead close'));
  await settle();
  offOpen();
  offMenu();
  offClose();
  emit('marxy:open-files', ['/r/a.md']);
  emit('marxy:menu', 'file.open');
  emit('marxy:close-requested', undefined);
  assert.deepEqual(heard, []);

  hooks.pendingOpens = () => [['/r/queued.md']];
  try {
    shell.onOpenFiles((paths) => heard.push(`next ${paths}`));
    shell.onMenuCommand((id) => heard.push(`next ${id}`));
    await settle();
  } finally {
    hooks.pendingOpens = null;
  }
  emit('marxy:menu', 'file.open');
  emit('marxy:open-files', ['/r/b.md']);
  assert.deepEqual(heard, ['next /r/queued.md', 'next file.open', 'next /r/b.md']);
});

test('a destroyed boot does not take the place of the boot that replaced it', async () => {
  const heard = [];
  const offFirst = shell.onMenuCommand((id) => heard.push(`first ${id}`));
  shell.onMenuCommand((id) => heard.push(`second ${id}`));
  await settle();
  offFirst();
  emit('marxy:menu', 'file.open');
  assert.deepEqual(heard, ['second file.open']);
});

test('opens taken while no boot is subscribed wait for the next boot', async () => {
  const heard = [];
  let answer;
  hooks.pendingOpens = () => new Promise((resolve) => (answer = resolve));
  try {
    const off = shell.onOpenFiles((paths) => heard.push(`dead ${paths}`));
    await settle();
    off();
    answer([['/r/queued.md']]);
    await settle();
  } finally {
    hooks.pendingOpens = null;
  }
  assert.deepEqual(heard, []);
  shell.onOpenFiles((paths) => heard.push(`next ${paths}`));
  await settle();
  assert.deepEqual(heard, ['next /r/queued.md']);
  shell.onOpenFiles((paths) => heard.push(`third ${paths}`));
  await settle();
  assert.deepEqual(heard, ['next /r/queued.md'], 'held opens are handed over once');
});
