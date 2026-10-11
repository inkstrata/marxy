// The data-safety walk through two real panes (F-33, the panes layer). The node layer (store-walk.test.mjs)
// drives the store, the registry, save() and the watch's reload rules; this one drives the same kinds of step
// through the shipped skeleton over the memory shell with the Tauri stale-write guard emulated: real Source
// editors and the keys typed into them, the notice regions, `PaneSet`, the app's own `watchDocument`. It is the
// only place "typed in Source, not yet folded, held apart" and "a link to the open file" are real.
//
// Its oracle reads what the app really holds (stores, editors, notice regions, the files in the memory shell),
// and asks four things after every step, each named for the node layer's invariant:
//   I1  no app write went over bytes the store never loaded or wrote (a Save As the reader picked excepted)
//   I3  every token typed is still in a buffer, an editor or a file (unless a step that says so dropped it)
//   I4  an outside write is announced: a clean store shows it, a dirty one holds it for a choice and says so
//   I5  one store per path, one watch per store
// What only the node layer covers: the exact history/baseline arithmetic (I6, I7) and the weighted mix of
// steps over CRLF, mixed and BOM files. What only this layer covers: the views and the notices.
//
//   MARXY_WALK_PANES_SEEDS=<n>  seeds 1..n (default 6; it does not read MARXY_WALK_SEEDS: a WebKit seed is slow)
//   MARXY_WALK_SEED=<n>         the one seed, as in the node layer
import { after, before } from 'node:test';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';
import { drawers, prng } from './support/prng.mjs';
import { assert, focusPane, skip, test, tickTask, toSource, typeAtLineEnd } from './support/split-same.mjs';

let browser = null;
// One browser for every seed (a WebKit launch is a good part of a seed's second); a page of its own for each.
before(async () => {
  if (!skip) browser = await launchWebkit();
});
after(async () => {
  await browser?.close();
  await closeHarness();
});

const MARKDOWN = (name, eol) =>
  [
    `# ${name}`,
    '',
    `A paragraph with *emphasis*, **strong** and \`code\`, and a link to [itself](./${name}.md).`,
    '',
    '- [ ] first task',
    '- [ ] second task',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    'End.',
    '',
  ].join(eol);
const FILES = {
  '/r/a.md': MARKDOWN('a', '\n'),
  '/r/b.md': `﻿${MARKDOWN('b', '\r\n')}`,
  '/r/c.md': `${MARKDOWN('c', '\n').replace('\n\n- [ ] first', '\r\n\r\n- [ ] first')}`,
  '/r/d.md': MARKDOWN('d', '\n'),
};
const PATHS = Object.keys(FILES);
const name = (path) => path.slice(path.lastIndexOf('/') + 1);

const seeds = (() => {
  if (process.env.MARXY_WALK_SEED) return [Number(process.env.MARXY_WALK_SEED)];
  return Array.from({ length: Number(process.env.MARXY_WALK_PANES_SEEDS ?? 6) }, (_, i) => i + 1);
})();
const STEPS = Number(process.env.MARXY_WALK_PANES_STEPS ?? 10);

/** Waits for every pane's queue and page: the watch events and folds started so far have been handled. */
const settle = (page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 2; i++) {
      const panes = window.__marxyHandle.panes().panes;
      await Promise.all(panes.map((p) => p.view.serially(async () => {})));
      await Promise.all(panes.map((p) => p.view.settled()));
    }
  });

/** The pane's "has changes that are not saved" question answered with `label`, if one is up. */
const answer = (page, label = 'Dismiss', wait = 400) =>
  page
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

/** What the app really holds, read from the page. */
const look = (page) =>
  page.evaluate(async () => {
    const h = window.__marxyHandle;
    const text = (bytes) => new TextDecoder().decode(bytes);
    const panes = h.panes().panes;
    const stores = [];
    for (const p of panes) {
      const store = p.view.store();
      if (store && !stores.some((s) => s.store === store)) stores.push({ store });
    }
    const files = {};
    for (const stat of await h.shell.readDir('/r')) files[stat.path] = await window.__disk(stat.path);
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    return {
      panes: panes.map((p, slot) => {
        const store = p.view.store();
        const snap = store?.snapshot();
        const mount = p.parts.source;
        return {
          slot,
          path: p.path(),
          mode: p.view.mode,
          dirty: snap?.dirty ?? false,
          unfolded: p.view.sourceHasUnfoldedEdits(),
          conflict: store?.conflict() != null,
          buffer: snap ? text(snap.buffer.bytes) : null,
          base: snap?.disk ? text(snap.disk) : null,
          editor: activeSourceEditor(mount)?.docText() ?? null,
          storeIndex: stores.findIndex((s) => s.store === store),
          notices: [...(document.getElementById(slot === 0 ? 'marxy-notices' : 'marxy-notices-2')?.querySelectorAll('.marxy-notice-text') ?? [])].map((n) => n.textContent),
        };
      }),
      stores: stores.length,
      watches: window.__marxyWatches,
      files,
      violations: window.__violations.slice(),
    };
  });

/** Records every app write against what was on disk and what each store believed (the node layer's I1). */
const watchWrites = (page) =>
  page.evaluate(() => {
    const shell = window.__marxyHandle.shell;
    const guarded = shell.writeFileAtomic.bind(shell);
    const text = (bytes) => (bytes ? new TextDecoder().decode(bytes) : null);
    window.__violations = [];
    window.__picked = null;
    shell.writeFileAtomic = async (path, bytes) => {
      const before = await shell.peekFile(path).catch(() => null);
      const baselines = window.__marxyHandle
        .panes()
        .panes.map((p) => p.view.store())
        .filter((s) => s && s.snapshot().path === path)
        .map((s) => text(s.snapshot().disk));
      const ok = !path.startsWith('/r/') || before === null || window.__picked === path || baselines.includes(text(before));
      if (!ok) window.__violations.push(`${path} was overwritten while it held bytes no store had loaded or written`);
      return guarded(path, bytes);
    };
  });

function openSeed(seed) {
  test(`panes walk seed ${seed}`, async () => {
    const rand = prng(seed);
    const d = drawers(rand);
    const log = [`seed ${seed}`];
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    try {
      const first = d.pick(PATHS);
      const second = d.chance(0.5) ? first : d.pick(PATHS);
      await bootTwoPanes(page, { files: FILES, open: [first, second], guard: true });
      await watchWrites(page);
      log.push(`open ${first} and ${second}`);
      const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
      const tokens = [];
      let nextToken = 0;
      let nextFresh = 1;
      let nextOutside = 1;

      const everywhere = (seen) => [...seen.panes.map((p) => p.buffer), ...seen.panes.map((p) => p.editor), ...Object.values(seen.files)].filter((t) => t != null);
      const found = (seen) => {
        const texts = everywhere(seen);
        return tokens.filter((t) => t.live && texts.some((x) => x.includes(t.text)));
      };
      /** After a step: whatever the step says it may drop, and then nothing else is missing. */
      const check = async (step, { mayDrop, announced = null } = {}) => {
        await settle(page);
        const seen = await look(page);
        const drops = typeof mayDrop === 'function' ? mayDrop(seen) : [];
        const dump = seen.panes.map((p) => `  pane ${p.slot}: ${name(p.path)} ${p.mode}, dirty=${p.dirty}, unfolded=${p.unfolded}, held change=${p.conflict}, buffer ${p.buffer?.length} chars, disk baseline ${p.base?.length} chars, said ${JSON.stringify(p.notices)}`).join('\n');
        const fail = (rule, message) => assert.fail(`panes walk failed on seed ${seed} in ${rule}: ${message}\nafter: ${step}\n${dump}\nreplay: MARXY_WALK_SEED=${seed} node --test --experimental-strip-types apps/desktop/test/store-walk-panes.test.mjs\nsteps:\n${log.map((l, i) => `  ${i}. ${l}`).join('\n')}`);
        if (seen.violations.length) fail('I1 (no silent overwrite)', seen.violations.join('; '));
        const there = new Set(found(seen).map((t) => t.id));
        for (const token of tokens) {
          if (!token.live || there.has(token.id)) continue;
          if (drops.includes(token.id)) token.live = false;
          else fail('I3 (no lost byte without a notice)', `typed text ${token.text} is in no buffer, no Source editor and no file`);
        }
        const byStore = new Map();
        for (const p of seen.panes) {
          if (byStore.has(p.storeIndex) && byStore.get(p.storeIndex) !== p.path) fail('I5 (one store per path)', 'two panes share a store and name different paths');
          byStore.set(p.storeIndex, p.path);
        }
        const paths = seen.panes.map((p) => p.path);
        for (const p of seen.panes) {
          const other = seen.panes.find((q) => q.slot !== p.slot && q.path === p.path);
          if (other && other.storeIndex !== p.storeIndex) fail('I5 (one store per path)', `${p.path} is shown through two stores`);
        }
        if (seen.watches !== seen.stores) fail('I5 (one store per path)', `${seen.watches} live watch(es) for ${seen.stores} store(s) on ${paths.join(', ')}`);
        // Unsaved Source text in any pane on the store counts: the store holds the change for a choice then too.
        const unsaved = (p) => seen.panes.some((q) => q.storeIndex === p.storeIndex && q.unfolded);
        if (announced) {
          // I4: the outside write to `announced.path` was delivered: a clean store shows it; a dirty one holds it and says so.
          for (const p of seen.panes) {
            if (p.path !== announced.path) continue;
            if (announced.deleted) {
              if (p.buffer === null) fail('I4 (an outside write is announced)', `${p.path} was deleted and its pane lost the buffer`);
              if (!p.notices.some((n) => n.includes('removed from disk'))) fail('I4 (an outside write is announced)', `${p.path} was deleted and ${p.slot === 0 ? 'the left' : 'the right'} pane did not say so`);
            } else if (p.base !== announced.text && !p.dirty && !unsaved(p)) {
              if (p.buffer !== announced.text) fail('I4 (an outside write is announced)', `a clean pane on ${p.path} does not show what another program wrote`);
            } else if (p.base !== announced.text) {
              if (!p.conflict) fail('I4 (an outside write is announced)', `${p.path} has unsaved edits, another program wrote it, and no change is held for a choice`);
              if (!p.notices.some((n) => n.includes('changed on disk'))) fail('I4 (an outside write is announced)', `${p.path} has unsaved edits, another program wrote it, and the pane did not say so`);
            }
          }
        }
        return seen;
      };

      const state = () => look(page);
      const newToken = () => {
        const token = { id: nextToken++, text: `qz${tokens.length}zq`, live: true };
        tokens.push(token);
        return token;
      };
      const tokensIn = (text) => tokens.filter((t) => t.live && text != null && text.includes(t.text)).map((t) => t.id);

      const OPS = {
        edit: {
          weight: 5,
          applicable: (s) => s.panes.some((p) => p.mode === 'rendered'),
          async run(s) {
            const p = d.pick(s.panes.filter((q) => q.mode === 'rendered'));
            await tickTask(page, p.slot);
            return { label: `tick a task in pane ${p.slot} (${name(p.path)})` };
          },
        },
        sourceType: {
          weight: 6,
          applicable: () => true,
          async run(s) {
            const p = d.pick(s.panes);
            const token = newToken();
            await toSource(page, p.slot);
            await typeAtLineEnd(page, p.slot, 1 + d.int(8), token.text);
            return { label: `type ${token.text} in Source, pane ${p.slot} (${name(p.path)})` };
          },
        },
        fold: {
          weight: 3,
          applicable: (s) => s.panes.some((p) => p.unfolded),
          async run(s) {
            const p = d.pick(s.panes.filter((q) => q.unfolded));
            await page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].content.foldSource(), p.slot);
            return { label: `fold pane ${p.slot}` };
          },
        },
        leaveSource: {
          weight: 2,
          applicable: (s) => s.panes.some((p) => p.mode === 'source'),
          async run(s) {
            const p = d.pick(s.panes.filter((q) => q.mode === 'source'));
            await page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].view.toggleMode(), p.slot);
            return { label: `leave Source in pane ${p.slot}` };
          },
        },
        undo: {
          weight: 3,
          applicable: () => true,
          async run(s) {
            const p = d.pick(s.panes);
            await focusPane(page, p.slot);
            await page.evaluate(async (slot) => {
              const { undoDocumentEdit } = await import('/src/commands/edits.ts');
              await undoDocumentEdit(window.__marxyHandle.panes().panes[slot].view.store());
            }, p.slot);
            // An undo takes back what the reader typed: those tokens are dropped by design.
            return { label: `undo in pane ${p.slot}`, mayDrop: (after) => tokens.filter((t) => t.live && !found(after).some((f) => f.id === t.id)).map((t) => t.id) };
          },
        },
        save: {
          weight: 6,
          applicable: () => true,
          async run(s) {
            const p = d.pick(s.panes);
            await focusPane(page, p.slot);
            const result = await page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].content.save(), p.slot);
            return { label: `save pane ${p.slot} (${name(p.path)}): ${result}` };
          },
        },
        saveAs: {
          weight: 3,
          applicable: () => true,
          async run(s) {
            const p = d.pick(s.panes);
            const other = s.panes[1 - p.slot];
            const target = d.pick([`/r/s${nextFresh++}.md`, other.path, p.path, ...PATHS.filter((x) => !s.panes.some((q) => q.path === x))]);
            const old = s.files[target];
            await focusPane(page, p.slot);
            await page.evaluate((t) => { window.__picked = t; }, target);
            const result = await page.evaluate(
              ([slot, path]) => {
                const h = window.__marxyHandle;
                h.shell.queueSaveDialog(path);
                return h.panes().panes[slot].content.save({ as: true });
              },
              [p.slot, target],
            );
            await page.evaluate(() => { window.__picked = null; });
            return { label: `Save As in pane ${p.slot} to ${name(target)}: ${result}`, mayDrop: () => tokensIn(old) };
          },
        },
        open: {
          weight: 3,
          applicable: (s) => s.panes.some((p) => !p.dirty && !p.unfolded),
          async run(s) {
            const p = d.pick(s.panes.filter((q) => !q.dirty && !q.unfolded));
            const path = d.pick(PATHS.filter((x) => x !== p.path));
            await page.evaluate(({ slot, path }) => { window.__opening = window.__marxyHandle.panes().openIn(slot, path); }, { slot: p.slot, path });
            await answer(page);
            await page.evaluate(() => window.__opening);
            return { label: `open ${name(path)} in pane ${p.slot}`, mayDrop: () => tokensIn(p.buffer) };
          },
        },
        outsideWrite: {
          weight: 6,
          applicable: () => true,
          async run(s) {
            const open = [...new Set(s.panes.map((p) => p.path))];
            const path = d.chance(0.85) ? d.pick(open) : d.pick(PATHS);
            const old = s.files[path] ?? '';
            const announced = d.chance(0.85);
            const text = `${old}\nOUTSIDE ${nextOutside++}\n`;
            await page.evaluate(({ path, text, announced }) => window.__outside(path, text, announced ? undefined : []), { path, text, announced });
            return { label: `another program writes ${name(path)}${announced ? '' : ' (no watch event)'}`, mayDrop: () => tokensIn(old), announced: announced ? { path, text } : null };
          },
        },
        outsideDelete: {
          weight: 1,
          applicable: (s) => s.panes.some((p) => s.files[p.path] != null),
          async run(s) {
            const path = d.pick(s.panes.filter((p) => s.files[p.path] != null)).path;
            const old = s.files[path];
            await page.evaluate((path) => {
              window.__marxyHandle.shell.remove(path);
              window.__marxyHandle.shell.emit([{ kind: 'removed', path }]);
            }, path);
            return { label: `another program deletes ${name(path)}`, mayDrop: () => tokensIn(old), announced: { path, deleted: true } };
          },
        },
        resolve: {
          weight: 3,
          applicable: (s) => s.panes.some((p) => p.conflict),
          async run(s) {
            const p = d.pick(s.panes.filter((q) => q.conflict));
            const choice = d.pick(['mine', 'theirs']);
            await focusPane(page, p.slot);
            await page.evaluate(
              async ({ slot, id }) => {
                const { commands } = await import('/src/commands/index.ts');
                const { notify } = await import('/src/notices/index.ts');
                const store = window.__marxyHandle.panes().panes[slot].view.store();
                await commands().find((c) => c.id === id).run({ document: store, showNotice: (text) => notify({ kind: 'info', text }) });
              },
              { slot: p.slot, id: choice === 'mine' ? 'document.keep-mine-as-copy' : 'document.take-version-on-disk' },
            );
            return { label: `${choice === 'mine' ? 'keep mine as a copy' : 'take the version on disk'} in pane ${p.slot}`, mayDrop: choice === 'theirs' ? () => tokensIn(p.buffer) : undefined };
          },
        },
        // The shape D-10 fixed: unsaved edits, another program writes, a Cmd-click on a link to the open file, a save.
        outsideLinkSave: {
          weight: 4,
          applicable: () => true,
          async run(s) {
            const p = d.pick(s.panes);
            await focusPane(page, p.slot);
            const rendered = s.panes[p.slot].mode === 'rendered';
            if (!rendered) await page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].view.toggleMode(), p.slot);
            await settle(page);
            await tickTask(page, p.slot).catch(() => {});
            await settle(page);
            const old = (await look(page)).files[p.path] ?? '';
            await page.evaluate(({ path, text }) => window.__outside(path, text), { path: p.path, text: `${old}\nOUTSIDE ${nextOutside++}\n` });
            await settle(page);
            await focusPane(page, p.slot);
            await page
              .locator(`#${p.slot === 0 ? 'doc' : 'doc-2'} a[href="./${name(p.path)}"]`)
              .click({ modifiers: ['ControlOrMeta'], timeout: 2000 })
              .catch(() => {});
            await answer(page);
            await settle(page);
            await focusPane(page, p.slot);
            const result = await page.evaluate((slot) => window.__marxyHandle.panes().panes[slot].content.save(), p.slot);
            return { label: `edit, another program writes, Cmd-click a link to the open file, save pane ${p.slot} (${name(p.path)}): ${result}`, mayDrop: () => tokensIn(old) };
          },
        },
      };

      for (let n = 0; n < STEPS; n++) {
        const s = await state();
        const ops = Object.values(OPS).filter((o) => o.applicable(s));
        const op = d.weighted(ops.map((o) => [o, o.weight]));
        const done = await op.run(s);
        log.push(done.label);
        await check(done.label, { mayDrop: done.mayDrop, announced: done.announced ?? null });
      }
    } finally {
      await page.close();
    }
  });
}

for (const seed of seeds) openSeed(seed);

void assert;
