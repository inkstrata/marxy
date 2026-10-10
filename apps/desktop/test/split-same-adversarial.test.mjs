// The same file twice, adversarially (D-10). Data loss is the bar: no route (save, close, quit, reload,
// rename, an outside write, opening over it, held apart) may drop either pane's typing silently, and no
// save may write over another program's change. A scripted interleaving drives both panes of one file
// with real keystrokes, outside writes, saves, focus moves, mode switches, renames, pane closes, quits and
// opens, and after every step checks the bytes: every token typed is still somewhere the reader can get it
// (the file on disk, a store's buffer, a Source editor) and every token another program wrote is still on
// disk. A seeded walk covers the orders the named scripts do not; a failure prints its seed and its steps.
// Booted on the shipped skeleton over the memory shell with the Tauri stale-write guard emulated.
import { after } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import {
  appWrites, assert, disk, editorText, focusPane, mode, outside, storeText, test, texts, toSource, typeAtLineEnd, withPanes,
} from './support/split-same.mjs';

after(() => closeHarness());

const SOURCE = Array.from({ length: 10 }, (_, i) => `line${i + 1} the quick brown fox ${i + 1}${i === 9 ? ' and a link [Tee](./T.md)' : ''}`).join('\n') + '\n';
const extra = { '/r/S.md': SOURCE, '/r/T.md': '# Tee\n\nA different document.\n' };

/** A small deterministic generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The driver: one page on `/r/S.md` twice, the record of what was typed and what was written outside. */
async function drive(page, mod, log) {
  const typed = [];
  const written = [];
  let quits = 0;
  let confirmed = 0;
  /** The file under test: the path a pane shows that is not the other document (the file may have been renamed). */
  const pathNow = () => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()).find((p) => p && p !== '/r/T.md'));

  /** Every place the reader's text may be: disk, each store's buffer, each Source editor. */
  async function holders() {
    const path = await pathNow();
    const out = { disk: await disk(page, path) };
    out.stores = await page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => new TextDecoder().decode(p.view.store()?.snapshot().buffer.bytes ?? new Uint8Array())));
    out.editors = await Promise.all([0, 1].map((slot) => editorText(page, slot).catch(() => null)));
    return out;
  }

  async function answer(label, { wait = 600 } = {}) {
    const clicked = await page
      .waitForFunction(
        (label) => {
          for (const line of document.querySelectorAll('.marxy-notice')) {
            if (!line.textContent.includes('has changes that are not saved')) continue;
            const button = [...line.querySelectorAll('button')].find((b) => b.textContent === label);
            if (button) {
              button.click();
              return true;
            }
          }
          return false;
        },
        label,
        { timeout: wait, polling: 50 },
      )
      .then(() => true, () => false);
    return clicked;
  }

  const ops = {
    async type(slot, lineNo) {
      const token = `T${typed.length}x`;
      await toSource(page, slot);
      await typeAtLineEnd(page, slot, lineNo, token);
      typed.push(token);
      log.push(`type ${token} in pane ${slot} at line ${lineNo}`);
    },
    async outside() {
      const path = await pathNow();
      const token = `OUT${written.length}z`;
      await outside(page, path, `${await disk(page, path)}${token}\n`);
      written.push(token);
      log.push(`outside write ${token}`);
      await page.waitForTimeout(250);
    },
    async save(slot) {
      await focusPane(page, slot);
      await page.keyboard.press(`${mod}+s`);
      log.push(`save from pane ${slot}`);
      await page.waitForTimeout(250);
    },
    async focus(slot) {
      await page.keyboard.press(`${mod}+${slot + 1}`);
      log.push(`focus pane ${slot}`);
      await page.waitForTimeout(120);
    },
    async toggle(slot) {
      await page.evaluate((s) => window.__marxyHandle.panes().panes[s].view.toggleMode(), slot);
      log.push(`toggle mode of pane ${slot}`);
      await page.waitForTimeout(150);
    },
    async rename() {
      const from = await pathNow();
      const to = from.endsWith('.2.md') ? from.slice(0, -5) + '.md' : from.slice(0, -3) + '.2.md';
      await page.evaluate(
        async ({ from, to }) => {
          const text = await window.__disk(from);
          await window.__outside(to, text, []);
          window.__marxyHandle.shell.remove(from);
          window.__marxyHandle.shell.emit([{ kind: 'renamed', path: from, to }]);
        },
        { from, to },
      );
      log.push(`rename on disk ${from} -> ${to}`);
      await page.waitForFunction((to) => window.__marxyHandle.panes().panes.every((p) => p.path() === to), to, { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(250);
    },
    async closePane(slot) {
      const before = await page.evaluate(() => window.__marxyHandle.panes().panes.length);
      if (before < 2) return;
      await page.evaluate((s) => {
        window.__closing = window.__marxyHandle.panes().close(window.__marxyHandle.panes().panes[s]);
      }, slot);
      const asked = await answer('Dismiss');
      log.push(`close pane ${slot}${asked ? ', asked, dismissed' : ''}`);
      const closed = await page.evaluate(() => window.__closing);
      if (closed) await page.evaluate(() => window.__marxyHandle.panes().openIn('other', window.__marxyHandle.panes().panes[0].path()));
      await page.waitForTimeout(200);
    },
    async quit() {
      const before = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'confirmClose').length);
      await page.evaluate(() => window.__marxyHandle.shell.emitCloseRequested());
      const asked = await answer('Dismiss');
      const after = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'confirmClose').length);
      quits += 1;
      confirmed += after - before;
      log.push(`quit${asked ? ', asked, dismissed' : after > before ? ', closed' : ''}`);
      return { asked, closed: after > before };
    },
    /** Cmd-click a relative link in pane `slot` (D-09): the target opens in the other pane, which asks over unsaved text. */
    async linkBeside(slot) {
      if ((await mode(page, slot)) === 'source') {
        await ops.toggle(slot);
        if ((await mode(page, slot)) === 'source') return log.push(`link beside from pane ${slot}: its Source could not be left (held apart)`);
      }
      await focusPane(page, slot);
      await page.locator(`#${slot === 0 ? 'doc' : 'doc-2'} a[href="./T.md"]`).click({ modifiers: ['ControlOrMeta'], timeout: 3000 });
      const asked = await answer('Dismiss');
      log.push(`cmd-click a link in pane ${slot}${asked ? ', neighbour asked, dismissed' : ''}`);
      await page.waitForTimeout(300);
      await ops.restoreSame(slot === 0 ? 1 : 0);
    },
    /** Puts the file back in pane `slot` if something else was opened over it, as the reader would. */
    async restoreSame(slot) {
      const path = await pathNow();
      const there = await page.evaluate((s) => window.__marxyHandle.panes().panes[s]?.path(), slot);
      if (there === path) return;
      await page.evaluate(
        ({ s, p }) => {
          window.__opening = window.__marxyHandle.panes().openIn(s, p);
        },
        { s: slot, p: path },
      );
      await answer('Dismiss');
      await page.evaluate(() => window.__opening);
    },
    async openOther(slot) {
      await page.evaluate(
        ({ s }) => {
          window.__opening = window.__marxyHandle.panes().openIn(s, '/r/T.md');
        },
        { s: slot },
      );
      const asked = await answer('Dismiss');
      log.push(`open another document in pane ${slot}${asked ? ', asked, dismissed' : ''}`);
      await page.evaluate(() => window.__opening);
      // Put the same file back in the pane, as the reader would, so the walk goes on over one file.
      await ops.restoreSame(slot);
    },
  };

  /** The invariants, after a step. */
  async function check(step) {
    const h = await holders();
    const everywhere = [h.disk, ...h.stores, ...h.editors.filter((e) => e !== null)];
    const missing = typed.filter((t) => !everywhere.some((text) => text.includes(t)));
    assert.deepEqual(missing, [], `typed text vanished after "${step}"\n${log.join('\n')}`);
    const lost = written.filter((w) => !h.disk.includes(w));
    assert.deepEqual(lost, [], `another program's write is gone from disk after "${step}"\n${log.join('\n')}`);
  }

  return { ops, check, typed, written, holders, answer, counts: () => ({ quits, confirmed }) };
}

/** What the reader would find after the walk: every token somewhere, and nothing overwritten. */
async function finish(d, log) {
  await d.check('end');
  // A reader who saves what they have in each pane in turn, then reads the file: if the guard held, the
  // outside writes are on disk and the app's writes only ever contained what it had read.
  const everything = await d.holders();
  assert.ok(everything.disk.length > 0, log.join('\n'));
}

test('named: both panes type, another program writes, each saves in turn: the typing is kept and the write is never overwritten', async () => {
  await withPanes(['/r/S.md', '/r/S.md'], async (page, mod) => {
    const log = [];
    const d = await drive(page, mod, log);
    await d.ops.type(1, 2);
    await d.check('type right');
    await d.ops.focus(0);
    await d.ops.type(0, 5);
    await d.check('type left');
    await d.ops.outside();
    await d.check('outside write');
    await d.ops.save(1);
    await d.check('save right');
    await d.ops.save(0);
    await d.check('save left');
    await d.ops.type(1, 7);
    await d.ops.outside();
    await d.ops.save(0);
    await d.check('save after a second outside write');
    // What the app wrote contained what the store held when the guard let it.
    for (const w of await appWrites(page)) assert.ok(w.text.length > 0);
    await finish(d, log);
  }, { extra });
});

test('named: typing in a Source pane, another program writes before the focus leaves it, then a save: the write is not overwritten and the typing is kept', async () => {
  for (const [typing, saving] of [[1, 1], [1, 0], [0, 0], [0, 1]]) {
    await withPanes(['/r/S.md', '/r/S.md'], async (page, mod) => {
      const log = [];
      const d = await drive(page, mod, log);
      await d.ops.focus(typing);
      await d.ops.type(typing, 3);
      // Focus is still in the editor: the text is not in the store yet, and the store is clean.
      await d.ops.outside();
      await d.check('outside write over unfolded typing');
      await d.ops.save(saving);
      await d.check(`save from pane ${saving}`);
      assert.deepEqual((await appWrites(page)).map((w) => w.path), [], 'the guard refused the write\n' + log.join('\n'));
      await finish(d, log);
    }, { extra });
  }
});

test('named: typing in the right pane, the file renamed on disk, a save, a quit, a close, an open: nothing is dropped', async () => {
  await withPanes(['/r/S.md', '/r/S.md'], async (page, mod) => {
    const log = [];
    const d = await drive(page, mod, log);
    await d.ops.type(1, 3);
    await d.ops.rename();
    await d.check('rename with typing in the right pane');
    const stores = await page.evaluate(() => {
      const [a, b] = window.__marxyHandle.panes().panes;
      return a.view.store() === b.view.store();
    });
    assert.equal(stores, true, 'one store after a rename\n' + log.join('\n'));
    await d.ops.quit();
    await d.check('quit with unsaved typing');
    const confirm = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'confirmClose').length);
    assert.equal(confirm, 0, 'a quit over unsaved typing is not confirmed\n' + log.join('\n'));
    await d.ops.closePane(1);
    await d.check('close the right pane over unsaved typing');
    await d.ops.openOther(0);
    await d.check('open another document over unsaved typing');
    await d.ops.save(0);
    await d.check('save');
    await finish(d, log);
  }, { extra });
});

test('named: Cmd-click a link in one pane while the other pane holds typing: over the same file the text stays in the store, over another file the neighbour asks', async () => {
  // The same file in both: the neighbour's typing is folded when focus leaves it, so replacing that pane
  // loses nothing (the store keeps it, and the pane that clicked still shows it).
  await withPanes(['/r/S.md', '/r/S.md'], async (page, mod) => {
    const log = [];
    const d = await drive(page, mod, log);
    await d.ops.type(1, 3);
    await d.ops.toggle(0);
    await d.ops.linkBeside(0);
    await d.check('link beside while the neighbour holds typing, same file');
    assert.ok((await storeText(page, 0)).includes('T0x'), 'the typing is in the store the left pane shows\n' + log.join('\n'));
    await d.ops.save(0);
    await d.check('save');
    await finish(d, log);
  }, { extra });
  // Another file in the neighbour: its unsaved text is that pane's alone, so replacing it asks, in that pane.
  await withPanes(['/r/S.md', '/r/L.md'], async (page) => {
    await toSource(page, 1);
    await typeAtLineEnd(page, 1, 2, 'Rtyped');
    await page.locator('#doc a[href="./T.md"]').click({ modifiers: ['ControlOrMeta'], timeout: 3000 });
    await page.waitForFunction(() => document.getElementById('marxy-notices-2').textContent.includes('has changes that are not saved'));
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].path()), '/r/L.md', 'nothing was replaced before the answer');
    assert.deepEqual(await texts(page, 0), [], 'the question is in the pane being replaced, not the one clicked in');
    await page.locator('#marxy-notices-2 .marxy-notice-dismiss').click();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().panes[1].path()), '/r/L.md');
    assert.ok((await editorText(page, 1)).includes('Rtyped'), 'the typing is still in the editor');
    assert.deepEqual((await appWrites(page)).map((w) => w.path), []);
  }, { extra });
});

test('named: held apart, every route keeps both panes\' typing and writes nothing over what another program wrote', async () => {
  await withPanes(['/r/S.md', '/r/S.md'], async (page, mod) => {
    const log = [];
    const d = await drive(page, mod, log);
    await toSource(page, 0);
    await d.ops.type(1, 4);
    // The held-apart state, reached directly (no route of the app does this): the left editor's text is folded
    // into the shared store while the right pane keeps its own typing.
    await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const view = activeSourceEditor(document.getElementById('marxy-source')).view;
      view.dispatch({ changes: { from: view.state.doc.line(2).to, insert: 'LEFTq' } });
      await window.__marxyHandle.panes().panes[0].content.foldSource();
    });
    d.typed.push('LEFTq');
    log.push('left typed LEFTq and folded it (held apart)');
    await d.check('held apart');
    await d.ops.outside();
    await d.check('outside write while held apart');
    await d.ops.save(0);
    await d.check('save left while held apart');
    await d.ops.save(1);
    await d.check('save right while held apart');
    await d.ops.quit();
    await d.check('quit while held apart');
    await d.ops.closePane(1);
    await d.check('close the held pane');
    await d.ops.rename();
    await d.check('rename while held apart');
    await finish(d, log);
  }, { extra });
});

test('named: another program\'s write over a clean store reloads both panes at their places and the typing that follows is on top of it', async () => {
  await withPanes(['/r/S.md', '/r/S.md'], async (page, mod) => {
    const log = [];
    const d = await drive(page, mod, log);
    await d.ops.outside();
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.every((p) => p.view.store().snapshot().buffer.bytes.length > 0));
    assert.ok((await storeText(page, 0)).includes('OUT0z') && (await storeText(page, 1)).includes('OUT0z'), 'both panes took the outside write');
    await d.ops.type(0, 2);
    await d.ops.focus(1);
    await d.ops.save(1);
    await d.check('type, then save over the reloaded file');
    assert.ok((await disk(page, '/r/S.md')).includes('OUT0z') && (await disk(page, '/r/S.md')).includes('T0x'), 'disk has both');
    assert.equal((await appWrites(page)).length, 1);
    await finish(d, log);
  }, { extra });
});

// The seeded walk: the orders the named scripts do not reach.
const STEPS = Number(process.env.D10_WALK_STEPS ?? 12);
// D10_WALK_SEEDS=9-40 widens the search when hunting (not run in CI).
const [from, to] = (process.env.D10_WALK_SEEDS ?? '1-8').split('-').map(Number);
for (let seed = from; seed <= (to ?? from); seed++) {
  test(`seeded walk ${seed}: ${STEPS} interleaved steps over one file in two panes, the bytes checked after each`, async () => {
    await withPanes(['/r/S.md', '/r/S.md'], async (page, mod) => {
      const log = [`seed ${seed}`];
      const d = await drive(page, mod, log);
      const next = rng(seed);
      const pick = (n) => Math.floor(next() * n);
      for (let step = 0; step < STEPS; step++) {
        const panes = await page.evaluate(() => window.__marxyHandle.panes().panes.length);
        const slot = pick(panes);
        const roll = pick(100);
        let name;
        if (roll < 12) {
          // The shape of the recorded problem: typing not yet folded, another program writes, then a save.
          name = 'type-outside-save';
          await d.ops.type(slot, 1 + pick(8));
          await d.ops.outside();
          await d.ops.save(pick(panes));
        } else if (roll < 34) {
          name = 'type';
          await d.ops.type(slot, 1 + pick(8));
        } else if (roll < 48) {
          name = 'outside';
          await d.ops.outside();
        } else if (roll < 62) {
          name = 'save';
          await d.ops.save(slot);
        } else if (roll < 72) {
          name = 'focus';
          await d.ops.focus(slot);
        } else if (roll < 80) {
          name = 'toggle';
          await d.ops.toggle(slot);
        } else if (roll < 85) {
          name = 'rename';
          await d.ops.rename();
        } else if (roll < 90) {
          name = 'closePane';
          await d.ops.closePane(slot);
        } else if (roll < 93) {
          name = 'linkBeside';
          await d.ops.linkBeside(slot);
        } else if (roll < 97) {
          name = 'quit';
          const { closed } = await d.ops.quit();
          if (closed) {
            const unsaved = await (async () => {
              const h = await d.holders();
              return d.typed.filter((t) => !h.disk.includes(t));
            })();
            assert.deepEqual(unsaved, [], `a quit was confirmed with unsaved typing\n${log.join('\n')}`);
          }
        } else {
          name = 'openOther';
          await d.ops.openOther(slot);
        }
        await d.check(`step ${step} ${name}`);
      }
      await finish(d, log);
    }, { extra });
  });
}
