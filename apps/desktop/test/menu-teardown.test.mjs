// A destroyed boot's native menu stops following the page: its watch and signal go with the disposer mountNativeMenu returns.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const FILES = { '/r/plan.md': '# Plan\n\nThe first paragraph.\n\n- one\n- two\n' };

test('after a boot is destroyed its menu no longer sends enabled states; the next boot does', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    const sent = await page.evaluate(async () => {
      const { mountNativeMenu } = await import('/src/menu/menu-boot.ts');
      const h = window.__marxyHandle;
      const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
      const stub = (log) => ({ onMenuCommand: () => () => {}, setMenuEnabled: async (states) => void log.push(JSON.stringify(states)) });
      // Flipping the mode changes what can run; the same flip must be heard while mounted and not once destroyed.
      const flip = async () => {
        for (const mode of ['source', 'read']) {
          document.body.setAttribute('data-marxy-mode', mode);
          document.dispatchEvent(new Event('selectionchange'));
          await wait();
        }
      };
      // A menu that is still watching reads the app (its context) on every change, whether or not the states differ.
      let reads = 0;
      const watched = new Proxy(h, { get: (target, key) => (reads++, Reflect.get(target, key)) });
      const first = [];
      const off = mountNativeMenu(watched, stub(first));
      await wait();
      const sentBefore = first.length;
      const readBefore = reads;
      await flip();
      const heardWhileMounted = reads - readBefore;
      off();
      reads = 0;
      await flip();
      const afterDestroy = reads;
      const second = [];
      const off2 = mountNativeMenu(h, stub(second));
      await wait();
      const next = second.length;
      off2();
      return { sentBefore, heardWhileMounted, afterDestroy, next };
    });
    assert.ok(sent.sentBefore >= 1, 'a mounted menu sends its states');
    assert.ok(sent.heardWhileMounted > 0, 'a mounted menu follows the page');
    assert.equal(sent.afterDestroy, 0, 'a destroyed boot reads nothing more');
    assert.ok(sent.next >= 1, 'the next boot sends its own');
  });
});
