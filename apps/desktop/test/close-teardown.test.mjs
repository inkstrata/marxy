// The close guard's host goes with its disposer, and only if it is still the current one.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

globalThis.window = new EventTarget();
const { installCloseGuard, confirmLeaveDocument } = await import('../src/close.ts');

const host = () => {
  const seen = { panes: 0 };
  return { seen, host: { shell: { onCloseRequested: () => () => {}, confirmClose: async () => {} }, panes: () => (seen.panes++, []) } };
};

test('a destroyed boot leaves no guard, and the boot after it installs its own', () => {
  const a = host();
  const offA = installCloseGuard(a.host);
  offA();
  confirmLeaveDocument({}, () => {});
  assert.equal(a.seen.panes, 0, 'the guard of a destroyed boot is not asked');

  const b = host();
  installCloseGuard(b.host);
  confirmLeaveDocument({}, () => {});
  assert.equal(b.seen.panes, 1, 'the next boot has its guard');
});

test('a replaced boot disposing late does not take down the newer boot guard', () => {
  const a = host();
  const offA = installCloseGuard(a.host);
  const b = host();
  installCloseGuard(b.host);
  offA();
  confirmLeaveDocument({}, () => {});
  assert.equal(b.seen.panes, 1);
});
