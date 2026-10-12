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
//   I8  a Mod+Z in a Source editor lands on text some editor, buffer or file held before (it adds no byte nobody
//       typed: F-40; the editor's history does not outlive a change made outside it)
// W-06 adds the tab row: the walk unfolds the window and clicks real tabs and close buttons (tabSwitch, tabClose),
// and every step also asks the page the row's own questions (a tab for each document a pane shows, none twice).
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
/** Whether `b` is `a` with one character, or one CRLF, taken out. */
function removedOne(a, b) {
  if (a == null || b == null) return false;
  const gone = a.length - b.length;
  if (gone < 1 || gone > 2) return false;
  let i = 0;
  while (i < b.length && a[i] === b[i]) i++;
  return a.slice(i + gone) === b.slice(i) && (gone === 1 || a.slice(i, i + gone) === '\r\n' || (a.charCodeAt(i) >= 0xd800 && a.charCodeAt(i) < 0xdc00));
}
/** The "Source in the other pane changed this file" notices up now, in every pane (SOURCE_HELD_APART, notices/index.ts). */
const heldApartNotices = (seen) => seen.panes.flatMap((p) => p.notices).filter((n) => n.startsWith('Source in the other pane')).length;

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
    // Every buffer a store holds from the first time it is looked at, for "an undo lands on a state the store held".
    window.__states ??= new WeakMap();
    for (const p of panes) {
      const store = p.view.store();
      if (store && !stores.some((s) => s.store === store)) stores.push({ store });
      if (store && !window.__states.has(store)) {
        const states = new Set([text(store.snapshot().buffer.bytes)]);
        window.__states.set(store, states);
        store.subscribe((snap) => states.add(text(snap.buffer.bytes)));
      }
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
      tabs: [...document.querySelectorAll('.marxy-tab')].map((t) => t.getAttribute('data-marxy-tab')),
      activeTab: document.querySelector('.marxy-tab[data-marxy-tab-active]')?.getAttribute('data-marxy-tab') ?? null,
      bandHidden: document.querySelector('[data-marxy-workspace-region="tabs"]')?.hidden ?? null,
      focused: h.panes().panes.indexOf(h.panes().focused),
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
      await page.evaluate(() => window.__marxyHandle.workspace().unfold());
      log.push(`open ${first} and ${second}, window unfolded`);
      const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
      const tokens = [];
      /** Paths another program deleted and the store has not settled since (F-47): the buffer is the only copy, so a version that comes back is offered. */
      const gone = new Set();
      let nextToken = 0;
      let nextFresh = 1;
      let nextOutside = 1;

      /** Every text an editor, a buffer or a file held after a step (I8's states the reader had). */
      const had = new Set();
      const remember = (seen) => {
        for (const t of everywhere(seen)) had.add(t);
      };
      const everywhere = (seen) => [...seen.panes.map((p) => p.buffer), ...seen.panes.map((p) => p.editor), ...Object.values(seen.files)].filter((t) => t != null);
      const found = (seen) => {
        const texts = everywhere(seen);
        return tokens.filter((t) => t.live && texts.some((x) => x.includes(t.text)));
      };
      /** After a step: whatever the step says it may drop, and then nothing else is missing. */
      const check = async (step, { mayDrop, announced = null, sourceUndone = null, noHeldApart = false, undoLanded = null } = {}) => {
        await settle(page);
        const seen = await look(page);
        const drops = typeof mayDrop === 'function' ? mayDrop(seen) : [];
        const dump = seen.panes.map((p) => `  pane ${p.slot}: ${name(p.path)} ${p.mode}, dirty=${p.dirty}, unfolded=${p.unfolded}, held change=${p.conflict}, buffer ${p.buffer?.length} chars, disk baseline ${p.base?.length} chars, said ${JSON.stringify(p.notices)}`).join('\n');
        const fail = (rule, message) => assert.fail(`panes walk failed on seed ${seed} in ${rule}: ${message}\nafter: ${step}\n${dump}\nreplay: MARXY_WALK_SEED=${seed} node --test --experimental-strip-types apps/desktop/test/store-walk-panes.test.mjs\nsteps:\n${log.map((l, i) => `  ${i}. ${l}`).join('\n')}`);
        if (seen.violations.length) fail('I1 (no silent overwrite)', seen.violations.join('; '));
        // F-42.1: a key the reader types is their own text, never "another pane's change". Held apart is for two panes with
        // unfolded text; with none beside it, a held-apart notice means the pane read its own key as someone else's.
        if (noHeldApart && heldApartNotices(seen) > 0) {
          fail('F-42 (a key typed during a save is the reader\'s own)', 'the pane said its Source was held apart from another pane\'s, with no other pane typing');
        }
        if (undoLanded && !undoLanded.held) {
          fail('I8 (a store undo lands on a state the store held)', `the undo in pane ${undoLanded.slot} left a buffer the store never held`);
        }
        if (sourceUndone && !had.has(sourceUndone.text)) {
          fail('I8 (Source undo adds no byte)', `Mod+Z in pane ${sourceUndone.slot} left text no editor, buffer or file ever held: ${JSON.stringify(sourceUndone.text)}`);
        }
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
        // W-06: the row shows a tab for every document a pane shows, none twice, the focused pane's active, hidden below two.
        for (const p of seen.panes) if (!seen.tabs.includes(p.path)) fail('tabs', `${p.path} is shown in pane ${p.slot} and has no tab (${seen.tabs.join(', ')})`);
        if (new Set(seen.tabs).size !== seen.tabs.length) fail('tabs', `a path has two tabs: ${seen.tabs.join(', ')}`);
        if (seen.activeTab !== seen.panes[seen.focused]?.path) fail('tabs', `the focused pane shows ${seen.panes[seen.focused]?.path} and the active tab is ${seen.activeTab}`);
        if (seen.bandHidden !== (seen.tabs.length < 2)) fail('tabs', `${seen.tabs.length} tab(s) and the band is ${seen.bandHidden ? 'hidden' : 'shown'}`);
        for (const p of seen.panes) {
          const other = seen.panes.find((q) => q.slot !== p.slot && q.path === p.path);
          if (other && other.storeIndex !== p.storeIndex) fail('I5 (one store per path)', `${p.path} is shown through two stores`);
        }
        if (seen.watches !== seen.stores) fail('I5 (one store per path)', `${seen.watches} live watch(es) for ${seen.stores} store(s) on ${paths.join(', ')}`);
        // Unsaved Source text in any pane on the store counts: the store holds the change for a choice then too.
        const wasGone = new Set(gone);
        const unsaved = (p) => seen.panes.some((q) => q.storeIndex === p.storeIndex && q.unfolded);
        if (announced) {
          // I4: the outside write to `announced.path` was delivered: a clean store shows it; a dirty one holds it and says so.
          for (const p of seen.panes) {
            if (p.path !== announced.path) continue;
            if (announced.deleted) {
              if (p.buffer === null) fail('I4 (an outside write is announced)', `${p.path} was deleted and its pane lost the buffer`);
              if (!p.notices.some((n) => n.includes('removed from disk'))) fail('I4 (an outside write is announced)', `${p.path} was deleted and ${p.slot === 0 ? 'the left' : 'the right'} pane did not say so`);
            } else if (p.base !== announced.text && !p.dirty && !unsaved(p) && !wasGone.has(p.path)) {
              if (p.buffer !== announced.text) fail('I4 (an outside write is announced)', `a clean pane on ${p.path} does not show what another program wrote`);
            } else if (p.base !== announced.text) {
              if (!p.conflict) fail('I4 (an outside write is announced)', `${p.path} has unsaved edits, another program wrote it, and no change is held for a choice`);
              if (!p.notices.some((n) => n.includes('changed on disk'))) fail('I4 (an outside write is announced)', `${p.path} has unsaved edits, another program wrote it, and the pane did not say so`);
            }
          }
        }
        // A deleted file is settled once the store's baseline is the file again (a save, a choice, the same bytes back).
        if (announced?.deleted) gone.add(announced.path);
        for (const p of seen.panes) if (gone.has(p.path) && !(announced?.deleted && p.path === announced.path) && p.base === seen.files[p.path]) gone.delete(p.path);
        remember(seen);
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
          // A task to tick: a delete in Source (F-40) may have taken the last one out of the file.
          applicable: (s) => s.panes.some((p) => p.mode === 'rendered' && /\[[ x]\]/.test(p.buffer ?? '')),
          async run(s) {
            const p = d.pick(s.panes.filter((q) => q.mode === 'rendered' && /\[[ x]\]/.test(q.buffer ?? '')));
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
        // F-42: Mod+S and a key in the same task. The save's fold has not settled when the key lands, and the editor
        // taking the store's bytes back must not delete it (I3 finds the token in the editor, a buffer or a file after).
        saveAndType: {
          weight: 4,
          applicable: () => true,
          async run(s) {
            const p = d.pick(s.panes);
            const token = newToken();
            await toSource(page, p.slot);
            await typeAtLineEnd(page, p.slot, 1 + d.int(8), d.chance(0.5) ? 'x' : '');
            // Nothing is held apart yet and no other pane over this store has unfolded text: from here a held-apart
            // notice can only be this pane misreading its own key (F-42.1).
            const seen = await look(page);
            const mine = seen.panes[p.slot];
            const alone = heldApartNotices(seen) === 0 && !seen.panes.some((q) => q.slot !== p.slot && q.storeIndex === mine.storeIndex && q.unfolded);
            await page.evaluate(
              async ({ slot, text, mod }) => {
                const { activeSourceEditor } = await import('/src/source/editor.ts');
                const view = activeSourceEditor(window.__marxyHandle.panes().panes[slot].parts.source).view;
                view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: mod === 'Meta', ctrlKey: mod === 'Control', bubbles: true, cancelable: true }));
                const at = view.state.selection.main.head;
                view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type' });
              },
              { slot: p.slot, text: token.text, mod },
            );
            return { label: `Mod+S and ${token.text} in one task, Source pane ${p.slot} (${name(p.path)})`, noHeldApart: alone };
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
            // The store's undo steps back one history entry, to a buffer the store held before. What was typed in a
            // Source editor over the store is folded first, so that fold is the entry stepped back over.
            const held = await page.evaluate(async (slot) => {
              const { undoDocumentEdit } = await import('/src/commands/edits.ts');
              const store = window.__marxyHandle.panes().panes[slot].view.store();
              const prior = new Set(window.__states.get(store));
              await undoDocumentEdit(store);
              return prior.has(new TextDecoder().decode(store.snapshot().buffer.bytes));
            }, p.slot);
            await settle(page);
            const after = (await look(page)).panes[p.slot].buffer;
            // A token the undo took out of the store's buffer is withdrawn, though a file may still hold it (a save wrote
            // it first): the next save writes the undo over it. Only the store's text counts, the buffer and the editors
            // over it as they were; every other token stays, and I3 finds it.
            const before = s.panes.filter((q) => q.storeIndex === p.storeIndex).flatMap((q) => [q.buffer, q.editor]);
            for (const t of tokens) if (t.live && before.some((x) => x?.includes(t.text)) && !after?.includes(t.text)) t.live = false;
            return { label: `undo in pane ${p.slot}`, undoLanded: { slot: p.slot, held } };
          },
        },
        // F-40: a key in the Source editor takes back what its own history holds, and nothing a change from outside
        // (a Rendered undo, a task ticked, a write by another program) put in the text since.
        sourceDelete: {
          weight: 4,
          applicable: () => true,
          async run(s) {
            const p = d.pick(s.panes);
            await toSource(page, p.slot);
            await typeAtLineEnd(page, p.slot, 1 + d.int(12), '');
            const held = (await look(page)).panes[p.slot].editor;
            await page.keyboard.press(d.pick(['Delete', 'Backspace']));
            const kept = (await look(page)).panes[p.slot].editor;
            // The key takes out one character, or one CRLF. A token it cuts into is withdrawn, though another pane's editor
            // or the store still holds it: this editor's text folds in later and the token goes then (the reader deleted
            // it). Any other change to the text withdraws nothing, and I3 finds what went missing.
            if (removedOne(held, kept)) for (const t of tokens) if (t.live && held.includes(t.text) && !kept.includes(t.text)) t.live = false;
            return { label: `delete a character or a line break in Source, pane ${p.slot} (${name(p.path)})` };
          },
        },
        sourceUndo: {
          weight: 6,
          applicable: (s) => s.panes.some((p) => p.mode === 'source'),
          async run(s) {
            const p = d.pick(s.panes.filter((q) => q.mode === 'source'));
            await focusPane(page, p.slot);
            await page.focus(`${p.slot === 0 ? '#marxy-source' : '#marxy-source-2'} .cm-content`);
            const times = 1 + d.int(3);
            for (let i = 0; i < times; i++) await page.keyboard.press(`${mod}+z`);
            const text = (await look(page)).panes[p.slot].editor;
            // What the reader took back with their own history is not lost: those tokens are withdrawn.
            for (const t of tokens) if (t.live && p.editor?.includes(t.text) && !text?.includes(t.text)) t.live = false;
            return { label: `Mod+Z x${times} in Source, pane ${p.slot} (${name(p.path)})`, sourceUndone: { slot: p.slot, text } };
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
        // W-06: a click on a tab shows its document in the focused pane, asking first over unsaved edits as any open does.
        tabSwitch: {
          weight: 5,
          applicable: (s) => s.tabs.length >= 2,
          async run(s) {
            const slot = d.pick(s.panes).slot;
            await focusPane(page, slot);
            const here = s.panes[slot];
            const target = d.pick(s.tabs.filter((t) => t !== here.path));
            if (!target) return { label: 'every tab is the focused pane\'s document' };
            const beside = s.panes.some((q) => q.slot !== slot && q.path === target);
            await page.click(`[data-marxy-tab="${target}"] [role=tab]`);
            // Over unsaved edits the click asks: Dismiss (nothing changes) or discard (what is unsaved goes).
            const discard = d.chance(0.5);
            const asked = await answer(page, discard ? 'Open without saving' : 'Dismiss');
            const label = `click tab ${name(target)} in pane ${slot}${beside ? ' (shown beside: focus moves)' : ''}${asked ? (discard ? ': discard' : ': Dismiss') : ''}`;
            return { label, mayDrop: asked && discard ? () => [...tokensIn(here.buffer), ...tokensIn(here.editor)] : undefined };
          },
        },
        // W-06: the close button removes a tab; on the document a pane shows it opens the next tab there first.
        tabClose: {
          weight: 3,
          applicable: (s) => s.tabs.length >= 2,
          async run(s) {
            const target = d.pick(s.tabs);
            const owner = s.panes.find((q) => q.path === target);
            const closable = await page.evaluate((t) => !document.querySelector(`[data-marxy-tab="${t}"] .marxy-tab-close`).hidden, target);
            if (!closable) return { label: `tab ${name(target)} has no close button` };
            await page.click(`[data-marxy-tab="${target}"] .marxy-tab-close`);
            const discard = d.chance(0.5);
            const asked = await answer(page, discard ? 'Open without saving' : 'Dismiss');
            const label = `close tab ${name(target)}${owner ? ` in pane ${owner.slot}` : ''}${asked ? (discard ? ': discard' : ': Dismiss') : ''}`;
            return { label, mayDrop: owner && asked && discard ? () => [...tokensIn(owner.buffer), ...tokensIn(owner.editor)] : undefined };
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
            // The file's text goes with it, but not an open buffer's copy: that stays (F-47), and a version that comes back is offered.
            const held = s.panes.flatMap((q) => [q.buffer, q.editor]).filter((t) => t != null);
            return { label: `another program deletes ${name(path)}`, mayDrop: () => tokensIn(old).filter((id) => !held.some((t) => t.includes(tokens[id].text))), announced: { path, deleted: true } };
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
            return { label: `${choice === 'mine' ? 'keep mine as a copy' : 'take the version on disk'} in pane ${p.slot}`, mayDrop: choice === 'theirs' ? () => tokensIn(s.panes.filter((q) => q.path === p.path).flatMap((q) => [q.buffer, q.editor]).join('\n')) : undefined };
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

      remember(await state());
      for (let n = 0; n < STEPS; n++) {
        const s = await state();
        const ops = Object.values(OPS).filter((o) => o.applicable(s));
        const op = d.weighted(ops.map((o) => [o, o.weight]));
        const done = await op.run(s);
        log.push(done.label);
        await check(done.label, { mayDrop: done.mayDrop, announced: done.announced ?? null, sourceUndone: done.sourceUndone ?? null, noHeldApart: done.noHeldApart ?? false, undoLanded: done.undoLanded ?? null });
      }
    } finally {
      await page.close();
    }
  });
}

for (const seed of seeds) openSeed(seed);

void assert;
