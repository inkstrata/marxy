// A standing data-safety walk over the document store (F-33).
//
// One seeded, model-based walk drives the REAL `DocumentStore`, the real `save()` (save.ts), the store
// registry and the real `watchDocument` (live-reload.ts: the rules a `reload` is called under) through the
// memory shell, in random order, and checks an oracle after every step. The model never reads the store to
// decide what should have happened: it keeps its own picture of every file, buffer, baseline, history and
// pending conflict, predicts each step from it, and the invariants compare the picture with the real things.
//
// A failure prints its seed and its step list; `MARXY_WALK_SEED=<n>` replays that seed alone.
//
// WHERE LATER STORIES PLUG IN. `OPS` and `INVARIANTS` are plain objects, keyed by name. A story adds
//   OPS.myOp = { name, weight, applicable(model), run(driver, model, rand) }   // run returns a one-line step label
//   INVARIANTS.Ix = { name, check(model, world) }                              // returns a message to fail, else nothing
// `driver` is the `World` below (real store, registry, shell, helpers); `model` is the walk's own picture
// of the world (see `createModel`). An op that may legitimately lose typed text says so BEFORE it acts:
// `driver.mayDrop(model, tokenIds)`. An op that changes a document's bytes updates the model's picture
// (`doc.buf`, `doc.past`, `doc.future`) from its own arithmetic, not from the store.
//
// What the node layer cannot cover (the panes layer, store-walk-panes.test.mjs, does): real Source editors
// and what a view does with text typed in them (here a view is a few fields that follow the rules written
// in rendered-view.ts: `draft`, `heldApart`), the real notice regions, the Tauri stale-write guard (the node
// layer tests the store's own baseline alone, which is the stricter test).

import { EditorSelection, EditorState } from '@codemirror/state';
import { TRANSFORMS, createBuffer, parseMarkdown } from '@marxy/core';
import { effectForOpenDocument } from '@marxy/core/src/position/watch-events.ts';
import { cmDocText, lineSeparatorFor } from '../../src/source/buffer-commit.ts';
import { runTableTool } from '../../src/source/structure.ts';
import { addStep, applyToStore, createChain, eolOf, openedOf, output, replacesExactly } from '../../src/transform/chain.ts';
import { conflictCopyPath, openDocumentStore } from '../../src/document/store.ts';
import { createStoreRegistry } from '../../src/document/registry.ts';
import { oneWatchPerStore, watchDocument } from '../../src/document/live-reload.ts';
import { save } from '../../src/save.ts';
import { TabList } from '../../src/workspace/tabs.ts';
import { createMemoryShell } from '../../src/shell/memory.ts';
import { clearNotices, notify, SOURCE_HELD_APART } from '../../src/notices/index.ts';
import { DISK_CHANGED_CHOOSE, FILE_REMOVED_ON_DISK } from '../../src/notices/disk.ts';
import { drawers, prng } from './prng.mjs';

export const ROOT = '/w';
const enc = new TextEncoder();
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

export const same = (a, b) =>
  a === b || (a != null && b != null && a.length === b.length && a.every((v, i) => v === b[i]));
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const bomLength = (bytes) => (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0);

// ---- the files the walk starts from: corpus-like, with CRLF, mixed endings, a BOM and a stray byte ----------

const MARKDOWN = [
  '# Field notes',
  '',
  'A paragraph with *emphasis*, **strong**, `code` and a [link](https://example.com).',
  '',
  '## List',
  '',
  '- one',
  '- two',
  '  - nested',
  '- [ ] task',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  // V-02: wide characters, an escaped pipe, a code span, a row with fewer cells, an alignment row with colons.
  '| name | note |',
  '|:-----|-----:|',
  '| 漢字 | a \\| b |',
  '| `x\\|y` | 😀 |',
  '| z |',
  '| B | é |',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '> quote',
  '',
  'End.',
  '',
];

/** The starting files: path to bytes. */
export function fixtures() {
  return {
    [`${ROOT}/a.md`]: enc.encode(MARKDOWN.join('\n')),
    // CRLF throughout, with a byte-order mark.
    [`${ROOT}/b.md`]: cat(new Uint8Array([0xef, 0xbb, 0xbf]), enc.encode(MARKDOWN.join('\r\n'))),
    // Mixed endings, a lone CR, bytes that are not UTF-8 (a lone FF, a lone continuation byte, a cut-off
    // three-byte sequence), and text that needs more than one byte.
    [`${ROOT}/c.md`]: cat(
      enc.encode('# Mixed\r\n\r\nline one\nline two\r\nlone\rcarriage\r\n\r\n- a\n- b\r\n'),
      new Uint8Array([0xff]),
      enc.encode('\nlast é 漢 😀\r\n'),
      new Uint8Array([0x80]),
      enc.encode(' cut '),
      new Uint8Array([0xe2, 0x82]),
      enc.encode('\n'),
    ),
    // Short, and no ending after the last line.
    [`${ROOT}/d.md`]: enc.encode('# Tiny\n\nno trailing newline'),
  };
}

// ---- a DOM just big enough for the notices (notices/index.ts, save.ts) to run in Node ----------------------

class El {
  constructor(tag, log) {
    this.tag = tag;
    this.log = log;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.id = '';
    this.attrs = {};
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  detach(node) {
    node.parentElement?.children.splice(node.parentElement.children.indexOf(node), 1);
    node.parentElement = null;
  }
  append(...nodes) {
    for (const node of nodes) {
      this.detach(node);
      node.parentElement = this;
      this.children.push(node);
      // The walk reads what was said from this log: a notice line joining a region.
      if (node.className === 'marxy-notice') this.log.push(node.querySelector('.marxy-notice-text')?.textContent ?? '');
    }
  }
  insertBefore(node, ref) {
    this.detach(node);
    node.parentElement = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
    if (node.className === 'marxy-notice') this.log.push(node.querySelector('.marxy-notice-text')?.textContent ?? '');
  }
  remove() {
    if (this.parentElement) this.detach(this);
  }
  replaceChildren() {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  setAttribute(name, value) {
    this.attrs[name] = value;
  }
  addEventListener() {}
  querySelector(selector) {
    const cls = selector.startsWith('.') ? selector.slice(1) : null;
    for (const child of this.children) {
      if (cls !== null && child.className.split(' ').includes(cls)) return child;
      const deeper = child.querySelector(selector);
      if (deeper) return deeper;
    }
    return null;
  }
  find(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.find(id);
      if (found) return found;
    }
    return null;
  }
}

/** Installs a stub `document` if the process has none; returns what the notices said, in order. */
function installDom() {
  if (globalThis.__marxyWalkDom) return globalThis.__marxyWalkDom;
  const log = [];
  const body = new El('body', log);
  const dom = {
    log,
    body,
    reset() {
      body.replaceChildren();
      log.length = 0;
    },
  };
  globalThis.document = {
    body,
    createElement: (tag) => new El(tag, log),
    getElementById: (id) => body.find(id),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.__marxyWalkDom = dom;
  return dom;
}

// ---- the model: the walk's own picture of the world ----------------------------------------------------------

/**
 * `disk`: path to the bytes the model believes are there (null: no file). `docs`: one per open store, with the
 * model's own `buf` (buffer), `base` (the store's disk baseline), `past`/`future` (history, as byte states),
 * `pending` (the changed-on-disk bytes a reload kept, V-07), `path`. `views`: the two panes, each null or
 * `{ slot, doc, mode, draft, typed, heldApart }`; `draft` is the text typed in Source and not yet folded
 * (null: the editor reads as the store), `typed` the tokens in it. `tokens`: the unique strings the walk types.
 */
export function createModel(seed, rand) {
  const files = fixtures();
  return {
    seed,
    rand,
    d: drawers(rand),
    originals: files,
    disk: new Map(Object.entries(files).map(([path, bytes]) => [path, bytes.slice()])),
    docs: [],
    views: [null, null],
    // W-06: the unfolded window's tab row (the real `TabList`) and the pane the reader is in. A tab is a path and holds no buffer.
    tabs: new TabList(),
    focus: 0,
    tokens: [],
    allowed: new Set(),
    dropped: new Set(),
    nextFresh: 1,
    nextOutside: 1,
    trace: [],
    failure: null,
  };
}

export class WalkFailure extends Error {
  constructor(invariant, message) {
    super(message);
    this.invariant = invariant;
  }
}

const docOf = (model, store) => model.docs.find((doc) => doc.store === store);
const viewsOf = (model, doc) => model.views.filter((v) => v !== null && v.doc === doc);
const unfolded = (view) => view.draft !== null;
const dirty = (doc) => !same(doc.buf, doc.base);
const copy = (bytes) => (bytes === null ? null : bytes.slice());

/** The token strings a document's bytes or text contain. */
const tokensIn = (model, text) => model.tokens.filter((t) => t.live && text.includes(t.text)).map((t) => t.id);

// ---- the world: the real things ---------------------------------------------------------------------------

export class World {
  constructor(model) {
    this.model = model;
    this.dom = installDom();
    this.dom.reset();
    this.shell = createMemoryShell(model.originals);
    this.registry = createStoreRegistry();
    this.writes = [];
    this.checkedWrites = 0;
    this.pick = null; // the path the reader picks in the next Save As dialog
    this.liveWatches = 0;
    this.queues = new Map();
    const watch = this.shell.watch.bind(this.shell);
    this.shell.watch = async (...args) => {
      const inner = await watch(...args);
      this.liveWatches += 1;
      let closed = false;
      return {
        close: () => {
          if (!closed) this.liveWatches -= 1;
          closed = true;
          inner.close();
        },
      };
    };
    const world = this;
    this.watches = oneWatchPerStore((store) =>
      watchDocument(store, () => world.viewsOver(store), {
        shell: world.shell,
        open: async () => {
          throw new Error('the walk does not rename files under a store');
        },
        serially: (fn) => world.queueOf(store)(fn),
        foldSource: async () => {},
        renamed: async () => {},
        changed: () => {},
      }),
    );
  }

  /** The queue a store's watch events run on (the views' queue in the app): never the store's own. */
  queueOf(store) {
    let chain = this.queues.get(store);
    if (!chain) {
      chain = { tail: Promise.resolve() };
      this.queues.set(store, chain);
    }
    return (fn) => {
      const run = chain.tail.then(fn, fn);
      chain.tail = run.catch(() => undefined);
      return run;
    };
  }

  /** What `watchDocument` calls a view: reads the model's view, so a draft typed in Source is "unfolded edits". */
  viewsOver(store) {
    const doc = docOf(this.model, store);
    if (!doc) return [];
    return viewsOf(this.model, doc).map((view) => {
      view.fake ??= {
        document: () => true,
        position: () => ({ path: doc.path, byteOffset: 0, fraction: 0, mode: 'rendered' }),
        expectReloadAt() {},
        settled: async () => {},
        sourceHasUnfoldedEdits: () => unfolded(view),
      };
      return view.fake;
    });
  }

  /** The io a store gets in open.ts, with every write recorded against what was there and what the store believed. */
  ioFor(holder) {
    const { shell } = this;
    return {
      writeFileAtomic: async (path, bytes) => {
        const store = holder.store;
        const doc = store ? docOf(this.model, store) : undefined;
        let before = null;
        try {
          before = await shell.peekFile(path);
        } catch {
          // no file there
        }
        this.writes.push({
          path,
          before,
          storePath: store?.snapshot().path ?? null,
          storeBaseline: store ? copy(store.snapshot().disk) : null,
          modelBaseline: doc ? copy(doc.base) : null,
          picked: this.pick === path,
          step: this.model.trace.length,
        });
        await shell.writeFileAtomic(path, bytes);
      },
      peekFile: (path) => shell.peekFile(path),
      exists: async (path) => (await shell.stat(path)) !== null,
    };
  }

  /** Every document file's bytes, as latin1 text, for the token search: store buffers, drafts, and everything on disk. */
  async everything() {
    const texts = [];
    for (const doc of this.model.docs) texts.push(latin1(doc.store.snapshot().buffer.bytes));
    for (const view of this.model.views) if (view?.draft != null) texts.push(view.draft);
    for (const stat of await this.shell.readDir(ROOT)) texts.push(latin1(await this.shell.peekFile(stat.path)));
    return texts;
  }

  // ---- the operations a pane makes ------------------------------------------------------------------------

  newDoc(store, path, bytes) {
    const doc = { store, path, buf: bytes.slice(), base: bytes.slice(), past: [], future: [], pending: null };
    this.model.docs.push(doc);
    return doc;
  }

  /** Opens `path` in pane `slot` through the registry, as open.ts does. The pane's old store is let go first. */
  async open(slot, path) {
    const { model } = this;
    const held = this.registry.held(path);
    let bytes = null;
    if (!held) bytes = await this.shell.readFile(path);
    if (model.views[slot]) this.detach(slot);
    const holder = { store: null };
    const store = this.registry.acquire(path, () => openDocumentStore(this.ioFor(holder), path, bytes));
    holder.store = store;
    const doc = docOf(model, store) ?? this.newDoc(store, path, bytes);
    await this.watches.watch(store);
    model.views[slot] = { slot, doc, mode: 'rendered', draft: null, typed: [], heldApart: false, fake: null };
    model.focus = slot;
    // A pane that comes to show a document another pane holds unfolded in Source folds the holder first (app.ts).
    if (held) for (const other of viewsOf(model, doc)) if (other.slot !== slot && unfolded(other)) await this.fold(other);
    return doc;
  }

  /**
   * The tab row follows the panes after every step (tabs-view.ts `reconcile`, through the same `TabList.sync`), and
   * the structure a reader would see is checked: a tab for every document a pane shows, none twice, none past the cap.
   */
  syncTabs() {
    const { model } = this;
    if (!model.views[model.focus]) model.focus = [0, 1].find((slot) => model.views[slot]) ?? 0;
    const view = model.views[model.focus];
    model.tabs.sync(
      [0, 1].map((slot) => ({ key: slot, path: model.views[slot]?.doc.path ?? null, store: model.views[slot]?.doc.store ?? null })),
      view?.doc.path ?? null,
    );
    const { tabs, active } = model.tabs.snapshot();
    if (new Set(tabs).size !== tabs.length) this.fail('tabs', `a path has two tabs: ${tabs.join(', ')}`);
    if (tabs.length > 24) this.fail('tabs', `${tabs.length} tabs, past the cap`);
    for (const v of model.views) {
      if (v && !tabs.includes(v.doc.path)) this.fail('tabs', `${v.doc.path} is shown in pane ${v.slot} and has no tab`);
    }
    if (view && active !== view.doc.path) this.fail('tabs', `the focused pane shows ${view.doc.path} and the active tab is ${active}`);
  }

  /** The pane lets its store go; the last holder closes it (and its watch). */
  detach(slot) {
    const view = this.model.views[slot];
    // A clean buffer whose file another program has since replaced or deleted goes with its pane: the loss was
    // the other program's, and said (or the watch missed it); a dirty buffer is never let go of here.
    if (viewsOf(this.model, view.doc).length === 1 && !dirty(view.doc)) {
      this.mayDrop(this.model, tokensIn(this.model, latin1(view.doc.buf)));
    }
    this.model.views[slot] = null;
    const closed = this.registry.release(view.doc.store);
    if (closed) this.model.docs.splice(this.model.docs.indexOf(view.doc), 1);
    return closed;
  }

  /**
   * The view's Source text goes into the store (`foldSource` in rendered-view.ts). Refused, with the text
   * kept, when the view is held apart. The model checks that exactly the typed tokens were inserted and
   * nothing else changed (fidelity), then takes the store's bytes as the new buffer.
   */
  async fold(view) {
    if (view.draft === null || view.mode === 'rendered' || view.heldApart) return false;
    const { doc } = view;
    const before = doc.buf;
    const changed = await doc.store.commitSource(view.draft);
    if (!changed) this.fail('I6', `folding Source text typed in pane ${view.slot} changed nothing (${view.typed.length} token(s) typed)`);
    const after = copy(doc.store.snapshot().buffer.bytes);
    let rest = after;
    for (const typed of view.typed) {
      const inserted = enc.encode(typed.text);
      const at = Buffer.from(rest).indexOf(inserted);
      if (at < 0) this.fail('I6', `the fold lost the typed text ${typed.text}`);
      rest = cat(rest.slice(0, at), rest.slice(at + inserted.length));
    }
    if (!same(rest, before)) {
      let at = 0;
      while (at < before.length && at < rest.length && before[at] === rest[at]) at++;
      const show = (bytes) => JSON.stringify(Buffer.from(bytes.slice(Math.max(0, at - 8), at + 16)).toString('latin1'));
      this.fail('I6', `a fold of ${view.typed.length} typed token(s) changed bytes other than its own in ${doc.path}: first difference at byte ${at}, was ${show(before)}, became ${show(rest)}`);
    }
    doc.past.push(before);
    doc.future = [];
    doc.buf = after;
    view.draft = null;
    view.typed = [];
    this.afterBytesChange(doc, view);
    return true;
  }

  /** Every view of the document folds, in pane order (open.ts `foldSource`). */
  async foldAll(doc) {
    for (const view of viewsOf(this.model, doc)) await this.fold(view);
  }

  /**
   * The store's bytes changed under the other views (rendered-view.ts `followFoldIn`): an editor that reads as
   * the store follows; one holding typing of its own is held apart (its text kept, its folds refused).
   */
  afterBytesChange(doc, origin) {
    for (const view of viewsOf(this.model, doc)) {
      if (view === origin || view.mode !== 'source') continue;
      if (view.draft !== null) view.heldApart = true;
    }
  }

  // ---- a reload as the watch decides it -------------------------------------------------------------------

  /**
   * What the model expects `store.reload(bytes, { holds })` to do to `doc` (store.ts: unchanged, kept, reloaded).
   * Returns the outcome; the model's picture is updated.
   */
  expectReload(doc, bytes, holds) {
    if (same(bytes, doc.buf)) {
      doc.pending = null;
      doc.base = doc.buf.slice();
      return 'unchanged';
    }
    if (same(bytes, doc.base)) {
      doc.pending = null; // the file is what the buffer came from again: nothing to choose
      return 'unchanged';
    }
    if (dirty(doc) || holds) {
      if (doc.pending === null || !same(doc.pending, bytes)) doc.pending = bytes.slice();
      return 'kept';
    }
    doc.buf = bytes.slice();
    doc.base = bytes.slice();
    doc.past = [];
    doc.future = [];
    doc.pending = null;
    return 'reloaded';
  }

  /**
   * Delivers watch batches to every store's watch (the memory shell delivers to all, as a folder's watch fires
   * for every file in it) and waits for each to be handled. The model predicts first, from `model.disk`, by the
   * rules in the ADR-0018 classifier (the real `effectForOpenDocument`) and live-reload.ts: gone: a notice;
   * reload: the file is read and offered to the store, kept when the buffer is dirty or any view holds Source
   * text. Callers keep the file present for a batch that reads it (an unreadable file is retried, with sleeps).
   */
  async deliver(batches) {
    const { model } = this;
    const mark = this.dom.log.length;
    const said = { kept: false, gone: false };
    for (const events of batches) {
      for (const doc of [...model.docs]) {
        const effect = effectForOpenDocument(events, doc.path);
        if (effect.action === 'gone') {
          said.gone = true;
        } else if (effect.action === 'reload') {
          const bytes = model.disk.get(doc.path);
          if (bytes == null) throw new Error(`walk: a reload batch for ${doc.path}, which is not on disk`);
          const holds = viewsOf(model, doc).some(unfolded);
          if (holds && same(bytes, doc.buf)) continue;
          const lost = doc.buf;
          const outcome = this.expectReload(doc, bytes, holds);
          if (outcome === 'kept') said.kept = true;
          if (outcome === 'reloaded') {
            this.mayDrop(model, tokensIn(model, latin1(lost)));
            for (const view of viewsOf(model, doc)) if (view.mode === 'source') view.draft = null;
          }
        }
      }
    }
    for (const events of batches) this.shell.emit(events);
    for (const doc of model.docs) await this.queueOf(doc.store)(async () => {});
    const said_ = this.dom.log.slice(mark);
    if (said.kept && !said_.some((line) => line === DISK_CHANGED_CHOOSE)) {
      this.fail('I4', 'a change on disk was held over unsaved edits and no notice asked the reader to choose');
    }
    if (said.gone && !said_.some((line) => line === FILE_REMOVED_ON_DISK)) {
      this.fail('I4', 'a file was removed from disk under an open document and no notice said so');
    }
  }

  // ---- saving ---------------------------------------------------------------------------------------------

  saveDeps(view) {
    const { model } = this;
    const { doc } = view;
    const world = this;
    return {
      store: doc.store,
      shell: {
        async saveDialog() {
          const picked = world.pick;
          world.pick = null;
          if (!picked) return null;
          // open.ts `pickAround`: a path another pane shows, with unsaved changes there, is refused.
          const other = world.registry.held(picked);
          if (other && other !== doc.store) {
            const otherDoc = docOf(model, other);
            const unsaved = other.snapshot().dirty || viewsOf(model, otherDoc).some(unfolded);
            if (unsaved) {
              const name = picked.slice(picked.lastIndexOf('/') + 1);
              notify({ kind: 'info', text: `${name} is open in the other pane with changes that are not saved. Save or close it there first; nothing was written.` });
              return null;
            }
          }
          world.pick = picked; // the write log marks a write to this path as the reader's pick
          return picked;
        },
        async setTitle() {},
        async allowAssetScope() {},
      },
      foldSource: () => this.foldAll(doc),
      holdsUnfoldedSource: () => viewsOf(model, doc).some(unfolded),
      onSaveAs: async () => {
        await (await this.watches.of(doc.store))?.moved();
        // Another pane showing the path through its own (clean) store now shows this one (D-10.1).
        const path = doc.store.snapshot().path;
        for (const other of [...model.views]) {
          if (other && other.doc !== doc && other.doc.path === path) {
            const slot = other.slot;
            this.detach(slot);
            this.registry.acquire(path, () => {
              throw new Error('the rejoined path has no store');
            });
            model.views[slot] = { slot, doc, mode: 'rendered', draft: null, typed: [], heldApart: false, fake: null };
          }
        }
      },
    };
  }

  // ---- bookkeeping ----------------------------------------------------------------------------------------

  /** Says the step may lose these tokens (an undo, a discard, a file another program replaced). */
  mayDrop(model, ids, { always = false } = {}) {
    for (const id of ids) (always ? model.dropped : model.allowed).add(id);
  }

  fail(invariant, message) {
    throw new WalkFailure(invariant, message);
  }

  newToken() {
    const { tokens } = this.model;
    const id = tokens.length;
    tokens.push({ id, text: `qz${id}zq`, live: true });
    return tokens[id];
  }

  /** Releases everything a seed made: stores, watches, notice lines. */
  async end() {
    for (let slot = 0; slot < 2; slot++) if (this.model.views[slot]) this.detach(slot);
    clearNotices();
    this.dom.reset();
  }
}

// ---- helpers the operations share --------------------------------------------------------------------------------

/** Byte offsets an edit may start or end at: whole characters, not between CR and LF, after the BOM, not inside a live token. */
function safeOffsets(model, bytes) {
  const text = latin1(bytes);
  const spans = [];
  for (const token of model.tokens) {
    if (!token.live) continue;
    for (let at = text.indexOf(token.text); at >= 0; at = text.indexOf(token.text, at + 1)) spans.push([at, at + token.text.length]);
  }
  const out = [];
  for (let i = bomLength(bytes); i <= bytes.length; i++) {
    if (i < bytes.length && (bytes[i] & 0xc0) === 0x80) continue;
    if (i > 0 && i < bytes.length && bytes[i - 1] === 0x0d && bytes[i] === 0x0a) continue;
    if (spans.some(([s, e]) => s < i && i < e)) continue;
    out.push(i);
  }
  return { offsets: out, spans };
}

const RENDERED_PIECES = ['', '', ' ', '\n', '\r\n', '# ', '- [ ] ', '`', '|', 'é', '漢', '😀', '**', '> '];
const SOURCE_PIECES = ['', '', ' ', '# ', '`', 'é', '**'];

const isHigh = (code) => code >= 0xd800 && code < 0xdc00;
const isLow = (code) => code >= 0xdc00 && code < 0xe000;

/** An insertion of a new token into `text` (CodeMirror's text) at a safe place: its new text. */
function insertIntoText(world, text, token, piece, typed) {
  const { model } = world;
  const spans = [];
  // Neither a live token nor anything already typed in this editor is split by a later insertion.
  const guarded = [...model.tokens.filter((t) => t.live).map((t) => t.text), ...typed.map((t) => t.text)];
  for (const guard of guarded) {
    for (let at = text.indexOf(guard); at >= 0; at = text.indexOf(guard, at + 1)) spans.push([at, at + guard.length]);
  }
  const places = [];
  for (let i = 0; i <= text.length; i++) {
    // Not between an astral character's two halves. A lone low surrogate is a byte that is not UTF-8 (F-34.1):
    // typing just before it is fine, and the walk does.
    if (i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i))) continue;
    if (i > 0 && i < text.length && text[i - 1] === '\r' && text[i] === '\n') continue;
    if (spans.some(([s, e]) => s < i && i < e)) continue;
    places.push(i);
  }
  const at = model.d.pick(places);
  return text.slice(0, at) + token.text + piece + text.slice(at);
}

/** Leaving this view's document asks (a notice with Save, Discard, Dismiss): its Source text is unfolded, or it is the last holder of a dirty buffer (close.ts `lostByLeaving`). */
const asks = (model, view) => unfolded(view) || (lastHolder(model, view) && dirty(view.doc));
const slotsWith = (model, test = () => true) => [0, 1].filter((slot) => model.views[slot] && test(model.views[slot]));
const lastHolder = (model, view) => viewsOf(model, view.doc).length === 1;
const anyUnsaved = (model, doc) => dirty(doc) || viewsOf(model, doc).some(unfolded);
const paths = (model) => [...model.disk.keys()].sort();
const present = (model) => paths(model).filter((p) => model.disk.get(p) != null);

/** New bytes for a file another program writes. */
function outsideBytes(model, path) {
  const d = model.d;
  const cur = model.disk.get(path);
  const n = model.nextOutside++;
  const doc = model.docs.find((x) => x.path === path);
  const kind = d.weighted([
    ['append', 3],
    ['prepend', 2],
    ['replace', 2],
    ['touch', 1],
    ['original', 2],
    ['base', 2],
  ]);
  if (cur == null) return enc.encode(`# Back ${n}\n`);
  if (kind === 'touch') return cur.slice();
  if (kind === 'original' && model.originals[path]) return model.originals[path].slice();
  if (kind === 'base' && doc) return doc.base.slice();
  if (kind === 'replace') return enc.encode(d.chance(0.5) ? `# Replaced ${n}\r\n\r\ntext\r\n` : `# Replaced ${n}\n\ntext\n`);
  if (kind === 'prepend') return cat(enc.encode(`OUTSIDE ${n}\n`), cur);
  return cat(cur, enc.encode(`\nOUTSIDE ${n}\n`));
}

// ---- V-02: the table tools ----------------------------------------------------------------------------------------

/** Where each UTF-16 unit of `text` starts, in UTF-8 bytes (a surrogate pair is four bytes, counted at its first unit). */
function unitStarts(text) {
  const starts = [];
  let byte = 0;
  for (let i = 0; i < text.length; i++) {
    starts.push(byte);
    const c = text.charCodeAt(i);
    byte += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? 4 : c >= 0xdc00 && c < 0xe000 ? 0 : 3;
  }
  starts.push(byte);
  return starts;
}

/** The tables of the parse, as `{ from, to }` indexes into `text` (not the tools' own idea of a table). */
function tableSpans(text) {
  const starts = unitStarts(text);
  const at = (byte) => starts.findIndex((s) => s >= byte);
  const out = [];
  const visit = (node) => {
    if (node.type === 'table') out.push({ from: at(node.src.start), to: at(node.src.end) });
    else for (const child of node.children ?? []) visit(child);
  };
  visit(parseMarkdown(text));
  return out;
}

/** The tables of a file's bytes, as byte ranges. */
function tableByteSpans(bytes) {
  const out = [];
  const visit = (node) => {
    if (node.type === 'table') out.push({ start: node.src.start, end: node.src.end });
    else for (const child of node.children ?? []) visit(child);
  };
  visit(parseMarkdown(bytes));
  return out;
}

const endingKinds = (bytes) => new Set(latin1(bytes).match(/\r\n|\r|\n/g) ?? []);
const TABLE_TOOLS = ['alignTable', 'addTableRow', 'addTableColumn', 'sortTableRows'];

/** A pane the table tools may act on: a Markdown file with a table, nothing held apart (stray bytes too: F-34.1). */
const tableToolSlots = (model) =>
  slotsWith(
    model,
    (v) =>
      /\.md$/.test(v.doc.path) &&
      viewsOf(model, v.doc).every((other) => !other.heldApart) &&
      tableByteSpans(v.doc.buf).length > 0,
  );

// ---- operations ----------------------------------------------------------------------------------------------------

export const OPS = {
  open: {
    name: 'open',
    weight: 6,
    applicable(model) {
      return [0, 1].some((slot) => {
        const view = model.views[slot];
        return !view || (!unfolded(view) && (!lastHolder(model, view) || !anyUnsaved(model, view.doc)));
      });
    },
    async run(world, model) {
      const d = model.d;
      const slots = [0, 1].filter((slot) => {
        const view = model.views[slot];
        return !view || (!unfolded(view) && (!lastHolder(model, view) || !anyUnsaved(model, view.doc)));
      });
      const slot = d.pick(slots);
      const here = model.views[slot]?.doc.path;
      const held = model.docs.map((doc) => doc.path);
      const choices = [...new Set([...present(model), ...held])].filter((p) => p !== here && p.startsWith(ROOT));
      if (choices.length === 0) return 'open: no other file to open';
      // Open a path the other pane shows about as often as a fresh one: the registry shares the store.
      const other = model.views[1 - slot]?.doc.path;
      const path = other && other !== here && d.chance(0.4) ? other : d.pick(choices);
      await world.open(slot, path);
      return `open ${path} in pane ${slot}${held.includes(path) ? ' (shared store)' : ''}`;
    },
  },

  close: {
    name: 'close',
    weight: 2,
    applicable: (model) => slotsWith(model, (v) => !unfolded(v) && (!lastHolder(model, v) || !dirty(v.doc))).length > 0,
    async run(world, model) {
      const slot = model.d.pick(slotsWith(model, (v) => !unfolded(v) && (!lastHolder(model, v) || !dirty(v.doc))));
      const path = model.views[slot].doc.path;
      world.detach(slot);
      return `close pane ${slot} (${path})`;
    },
  },

  closeDiscard: {
    name: 'closeDiscard',
    weight: 1,
    applicable: (model) => slotsWith(model, (v) => unfolded(v) || (lastHolder(model, v) && dirty(v.doc))).length > 0,
    async run(world, model) {
      const slot = model.d.pick(slotsWith(model, (v) => unfolded(v) || (lastHolder(model, v) && dirty(v.doc))));
      const view = model.views[slot];
      // The reader answers "discard": what only this pane's draft and (as last holder) its buffer held goes.
      world.mayDrop(model, view.typed.map((t) => t.id));
      if (lastHolder(model, view)) world.mayDrop(model, tokensIn(model, latin1(view.doc.buf)));
      const path = view.doc.path;
      world.detach(slot);
      return `close pane ${slot} (${path}), discarding what is unsaved`;
    },
  },

  // W-06: a click on a tab shows its document in the focused pane, asking first over unsaved edits as any open does.
  tabSwitch: {
    name: 'tabSwitch',
    weight: 4,
    applicable: (model) => model.views[model.focus] != null && model.tabs.snapshot().tabs.some((p) => p !== model.views[model.focus].doc.path),
    async run(world, model) {
      const d = model.d;
      const slot = model.focus;
      const view = model.views[slot];
      // A file another program deleted cannot be opened again from its tab: the walk clicks the others.
      const { tabs } = model.tabs.snapshot();
      const choices = tabs.filter((p) => p !== view.doc.path && (model.disk.get(p) != null || model.views.some((v) => v?.doc.path === p)));
      if (choices.length === 0) return 'tab: every other tab is a deleted file';
      const target = d.pick(choices);
      const beside = model.views.findIndex((v, i) => i !== slot && v?.doc.path === target);
      if (beside >= 0) {
        // The other pane already shows it: the click moves focus there and shows nothing twice.
        model.focus = beside;
        world.syncTabs();
        return `click tab ${target}: focus moves to pane ${beside}`;
      }
      const before = JSON.stringify([model.tabs.snapshot(), model.views.map((v) => v?.doc.path ?? null)]);
      let how = '';
      if (asks(model, view)) {
        if (d.chance(0.5)) {
          // Dismiss: the pane, its buffer, its draft and the row are as they were.
          world.syncTabs();
          if (JSON.stringify([model.tabs.snapshot(), model.views.map((v) => v?.doc.path ?? null)]) !== before) world.fail('tabs', 'Dismiss changed the row or a pane');
          return `click tab ${target} over unsaved edits in pane ${slot}: Dismiss`;
        }
        world.mayDrop(model, view.typed.map((t) => t.id));
        if (lastHolder(model, view)) world.mayDrop(model, tokensIn(model, latin1(view.doc.buf)));
        how = ', discarding what is unsaved';
      }
      await world.open(slot, target);
      world.syncTabs();
      if (model.views[slot]?.doc.path !== target) world.fail('tabs', `the click on ${target} left pane ${slot} on ${model.views[slot]?.doc.path}`);
      return `click tab ${target} in pane ${slot}${how}`;
    },
  },

  // W-06: the close button removes a tab; on the document a pane shows it opens the next tab there first (asking the same way).
  tabClose: {
    name: 'tabClose',
    weight: 3,
    applicable: (model) => model.tabs.snapshot().tabs.length >= 2,
    async run(world, model) {
      const d = model.d;
      const { tabs } = model.tabs.snapshot();
      const target = d.pick(tabs);
      const slot = model.views.findIndex((v) => v?.doc.path === target);
      if (slot < 0) {
        model.tabs.close(target);
        world.syncTabs();
        return `close tab ${target}: no pane shows it, nothing else moves`;
      }
      const view = model.views[slot];
      const elsewhere = new Set(model.views.flatMap((v, i) => (v && i !== slot ? [v.doc.path] : [])));
      const next = model.tabs.neighbour(target, elsewhere);
      if (next === null || (model.disk.get(next) == null && !elsewhere.has(next))) return `close tab ${target}: no tab to show instead`;
      const keep = model.focus;
      let how = '';
      if (asks(model, view)) {
        if (d.chance(0.5)) return `close tab ${target} over unsaved edits in pane ${slot}: Dismiss`;
        world.mayDrop(model, view.typed.map((t) => t.id));
        if (lastHolder(model, view)) world.mayDrop(model, tokensIn(model, latin1(view.doc.buf)));
        how = ', discarding what is unsaved';
      }
      await world.open(slot, next);
      model.tabs.close(target);
      model.focus = keep;
      world.syncTabs();
      return `close tab ${target} in pane ${slot}: ${next} shown there${how}`;
    },
  },

  edit: {
    name: 'edit',
    weight: 10,
    applicable: (model) => slotsWith(model, (v) => v.mode === 'rendered').length > 0,
    async run(world, model) {
      const d = model.d;
      const slot = d.pick(slotsWith(model, (v) => v.mode === 'rendered'));
      const { doc } = model.views[slot];
      const { offsets, spans } = safeOffsets(model, doc.buf);
      const a = d.pick(offsets);
      let b = a;
      if (d.chance(0.3)) {
        const later = offsets.filter((o) => o > a && o <= a + 24);
        if (later.length) b = d.pick(later);
        if (spans.some(([s, e]) => s < b && e > a)) b = a; // never delete typed text: an edit only adds
      }
      const token = world.newToken();
      const replacement = d.pick(RENDERED_PIECES) + token.text + d.pick(RENDERED_PIECES);
      const applied = await doc.store.apply({
        range: { file: doc.path, start: a, end: b },
        replacement,
        label: `walk edit ${token.id}`,
        baseVersion: doc.store.snapshot().version,
      });
      if (!applied) world.fail('I6', `an edit adding ${token.text} at ${a}..${b} of ${doc.path} was a no-op`);
      doc.past.push(doc.buf);
      doc.future = [];
      doc.buf = cat(doc.buf.slice(0, a), enc.encode(replacement), doc.buf.slice(b));
      world.afterBytesChange(doc, model.views[slot]);
      return `edit ${doc.path} in pane ${slot}: ${b > a ? `replace ${a}..${b}` : `insert at ${a}`} with ${JSON.stringify(replacement)}`;
    },
  },

  sourceType: {
    name: 'sourceType',
    weight: 6,
    applicable: (model) => slotsWith(model, (v) => !v.heldApart).length > 0,
    async run(world, model) {
      const d = model.d;
      const slot = d.pick(slotsWith(model, (v) => !v.heldApart));
      const view = model.views[slot];
      if (view.mode === 'rendered') view.mode = 'source';
      const token = world.newToken();
      const base = view.draft ?? cmDocText(createBuffer(view.doc.path, view.doc.buf));
      const piece = d.pick(SOURCE_PIECES);
      view.draft = insertIntoText(world, base, token, piece, view.typed);
      view.typed.push({ id: token.id, text: token.text + piece });
      return `type ${token.text} in Source, pane ${slot} (${view.doc.path}), not folded`;
    },
  },

  fold: {
    name: 'fold',
    weight: 5,
    applicable: (model) => slotsWith(model, (v) => unfolded(v) && !v.heldApart).length > 0,
    async run(world, model) {
      const slot = model.d.pick(slotsWith(model, (v) => unfolded(v) && !v.heldApart));
      await world.fold(model.views[slot]);
      return `fold the Source text of pane ${slot}`;
    },
  },

  leaveSource: {
    name: 'leaveSource',
    weight: 2,
    applicable: (model) => slotsWith(model, (v) => v.mode === 'source').length > 0,
    async run(world, model) {
      const slot = model.d.pick(slotsWith(model, (v) => v.mode === 'source'));
      const view = model.views[slot];
      await world.fold(view);
      if (view.draft === null) view.mode = 'rendered'; // a view held apart cannot leave Source: leaving would fold
      return `leave Source in pane ${slot}${view.mode === 'source' ? ' (refused: held apart)' : ''}`;
    },
  },

  revertTyping: {
    name: 'revertTyping',
    weight: 1,
    applicable: (model) => slotsWith(model, (v) => v.heldApart).length > 0,
    async run(world, model) {
      const slot = model.d.pick(slotsWith(model, (v) => v.heldApart));
      const view = model.views[slot];
      world.mayDrop(model, view.typed.map((t) => t.id));
      view.draft = null;
      view.typed = [];
      view.heldApart = false;
      return `the reader undoes the typing in pane ${slot} until it reads as the file again`;
    },
  },

  undo: {
    name: 'undo',
    weight: 4,
    applicable: (model) => model.views.some(Boolean),
    async run(world, model) {
      const slot = model.d.pick(slotsWith(model));
      const { doc } = model.views[slot];
      await world.foldAll(doc); // text typed in Source is part of the history (edits.ts stepHistory)
      const expected = doc.past.length > 0;
      const prev = doc.past.at(-1);
      if (expected) {
        world.mayDrop(model, tokensIn(model, latin1(doc.buf)).filter((id) => !latin1(prev).includes(model.tokens[id].text)), { always: true });
      }
      const done = await doc.store.undo();
      if (done !== expected) world.fail('I7', `undo of ${doc.path} returned ${done}; the model's history has ${doc.past.length} step(s)`);
      if (done) {
        doc.future.push(doc.buf);
        doc.buf = doc.past.pop();
        world.afterBytesChange(doc, null);
      }
      return `undo in pane ${slot} (${doc.path}): ${done}`;
    },
  },

  redo: {
    name: 'redo',
    weight: 2,
    applicable: (model) => model.docs.some((doc) => doc.future.length > 0),
    async run(world, model) {
      const slot = model.d.pick(slotsWith(model, (v) => v.doc.future.length > 0));
      const { doc } = model.views[slot];
      await world.foldAll(doc);
      const expected = doc.future.length > 0;
      const done = await doc.store.redo();
      if (done !== expected) world.fail('I7', `redo of ${doc.path} returned ${done}; the model's history has ${doc.future.length} step(s) ahead`);
      if (done) {
        doc.past.push(doc.buf);
        doc.buf = doc.future.pop();
        world.afterBytesChange(doc, null);
      }
      return `redo in pane ${slot} (${doc.path}): ${done}`;
    },
  },

  /**
   * V-02: a table tool run in Source at a caret in a table, and folded. The walk takes the tool's Source text from
   * the store's bytes (what an editor over the folded buffer holds), runs the real command function over a real
   * CodeMirror state in the file's own line separator, and commits it through the Source fold (`commitSource`).
   * The oracle is the promise, not the tool's arithmetic: the bytes that changed lie inside one table of the
   * parse, no kind of line ending appears that the file did not have, and one undo gives the old bytes back.
   * Not covered here: a tool run over Source text typed and not yet folded (the tool folds it first).
   */
  tableTool: {
    name: 'tableTool',
    weight: 5,
    applicable: (model) => tableToolSlots(model).length > 0,
    async run(world, model) {
      const d = model.d;
      const slot = d.pick(tableToolSlots(model));
      const { doc } = model.views[slot];
      await world.foldAll(doc);
      const before = doc.buf.slice();
      const buffer = createBuffer(doc.path, before);
      let state = EditorState.create({ doc: cmDocText(buffer), extensions: [EditorState.lineSeparator.of(lineSeparatorFor(buffer))] });
      const spans = tableSpans(state.doc.toString());
      if (spans.length === 0) return `tableTool in pane ${slot} (${doc.path}): no table in the folded text`;
      const span = d.pick(spans);
      const caret = span.from + d.int(span.to - span.from + 1);
      const tool = d.pick(TABLE_TOOLS);
      state = state.update({ selection: EditorSelection.single(caret) }).state;
      const ran = runTableTool(tool, { get state() { return state; }, dispatch: (tr) => { state = tr.state; } }, doc.path);
      const at = `${tool} at ${caret} of ${doc.path} in pane ${slot}`;
      if (!ran) return `tableTool ${at}: declined, nothing changed`;
      const changed = await doc.store.commitSource(state.sliceDoc(0, state.doc.length));
      if (!changed) world.fail('I6', `${at} ran and the Source fold changed nothing`);
      const after = copy(doc.store.snapshot().buffer.bytes);
      // Every byte outside one table of the parse is as it was: before it, and after it. (Not "the diff lies in a
      // table": a row added at a table's end differs from the old bytes equally well one newline later.)
      const tables = tableByteSpans(before);
      const outside = (t) =>
        before.subarray(0, t.start).every((byte, i) => after[i] === byte) &&
        before.subarray(t.end).every((byte, i) => after[after.length - (before.length - t.end) + i] === byte);
      if (!tables.some(outside)) {
        world.fail('I6', `${at} changed bytes outside every table (tables: ${tables.map((t) => `${t.start}..${t.end}`).join(', ')}; ${before.length} bytes became ${after.length})`);
      }
      const had = endingKinds(before);
      for (const kind of endingKinds(after)) if (!had.has(kind)) world.fail('I6', `${at} wrote a line ending (${JSON.stringify(kind)}) the file did not have`);
      if (bomLength(before) !== bomLength(after)) world.fail('I6', `${at} changed the byte-order mark`);
      doc.past.push(before);
      doc.future = [];
      doc.buf = after;
      world.afterBytesChange(doc, null);
      // One undo gives the exact old bytes back, and one redo the new ones (half the time: the history is the store's).
      if (d.chance(0.5)) {
        if (!(await doc.store.undo())) world.fail('I7', `${at}: undo returned false right after the fold`);
        if (!same(copy(doc.store.snapshot().buffer.bytes), before)) world.fail('I6', `${at}: one undo did not restore the exact bytes`);
        if (!(await doc.store.redo())) world.fail('I7', `${at}: redo returned false right after the undo`);
        if (!same(copy(doc.store.snapshot().buffer.bytes), after)) world.fail('I6', `${at}: redo did not give the edited bytes back`);
      }
      return `tableTool ${at}: ${before.length} bytes became ${after.length}`;
    },
  },

  /**
   * W-21: Apply on the result sheet. The walk drives the real chain (`createChain`, `addStep`, `output`) and the real
   * store write (`applyToStore`, the function the sheet's Apply calls) over a Rendered pane's range: the whole buffer
   * or a stretch of it, one or two `edit` transforms. The oracle is the promise, not the transform's arithmetic: the
   * bytes outside the range are the ones that were there (a byte diff, before and after), the range holds the output,
   * the byte-order mark and the kinds of line ending are the file's, the history grew by one step and one undo gives
   * the exact bytes back. A range holding a byte that is not UTF-8 is not offered Apply and nothing changes. One run in
   * five changes the document after the sheet opened (a token typed at the top): Apply must then refuse and touch
   * nothing. Source's own Apply is one CodeMirror transaction (test/transform-sheet.test.mjs, source-structure.test.mjs).
   */
  applyTransform: {
    name: 'applyTransform',
    weight: 5,
    applicable: (model) => slotsWith(model, (v) => v.mode === 'rendered').length > 0,
    async run(world, model) {
      const d = model.d;
      const slot = d.pick(slotsWith(model, (v) => v.mode === 'rendered'));
      const view = model.views[slot];
      const { doc } = view;
      // Source text typed in another pane and not yet in the store goes in first (the app folds it on focus-out).
      await world.foldAll(doc);
      const before = doc.buf.slice();
      let start = 0;
      let end = before.length;
      let scope = 'whole document';
      const oneLine = d.chance(0.2);
      if (oneLine || d.chance(0.6)) {
        const { offsets } = safeOffsets(model, before);
        const a = d.pick(offsets);
        start = a;
        end = d.pick(offsets.filter((o) => o >= a && o <= a + 300));
        scope = 'selection';
        if (oneLine) {
          // Text with no line break in it: a transform that adds lines has no ending to follow (`fence`).
          const stop = [...latin1(before.subarray(a)).matchAll(/\r|\n/g)][0]?.index ?? before.length - a;
          end = d.pick(offsets.filter((o) => o >= a && o <= a + stop));
          scope = 'line';
        }
      }
      const loose = new TextDecoder('utf-8', { ignoreBOM: true });
      const text = loose.decode(before.subarray(start, end));
      let chain = createChain(text, [], eolOf(doc.store.snapshot().buffer.eol));
      const edits = TRANSFORMS.filter((t) => t.kind === 'edit').map((t) => t.id);
      if (oneLine && d.chance(0.5)) chain = addStep(chain, 'fence');
      for (let n = 1 + d.int(2) - chain.steps.length; n > 0; n--) chain = addStep(chain, d.pick(edits));
      const out = output(chain);
      const at = `${chain.steps.join(' then ')} on the ${scope} ${start}..${end} of ${doc.path} in pane ${slot}`;
      if (!replacesExactly(text, before.subarray(start, end))) return `applyTransform ${at}: not offered (bytes that are not UTF-8 in the range)`;
      const opened = openedOf(doc.store);
      if (d.chance(0.2)) {
        // The document changes under the open sheet: a token typed at the top, as another view's edit would.
        const token = world.newToken();
        const top = bomLength(before);
        const typed = await doc.store.apply({ range: { file: doc.path, start: top, end: top }, replacement: token.text, label: `walk edit ${token.id}` });
        if (!typed) world.fail('I6', `a token typed at ${top} of ${doc.path} was a no-op`);
        doc.past.push(before);
        doc.future = [];
        doc.buf = cat(before.slice(0, top), enc.encode(token.text), before.slice(top));
        world.afterBytesChange(doc, view);
        const refused = await applyToStore(doc.store, opened, { start, end }, out, 'walk transform');
        if (refused !== 'stale') world.fail('I6', `Apply of ${at} after the document changed gave '${refused}', not 'stale'`);
        return `applyTransform ${at}: the document changed under the sheet, Apply refused and touched nothing`;
      }
      // Tokens inside the range that the output no longer holds were changed by the transform (UPPERCASE): the reader asked for
      // that, and one undo gives them back. A token the output keeps stays owed.
      // `always`: a copy of such a token may still lie on disk or in another pane, and the allowance must not outlive this
      // step (a later Save over that copy is not the loss; the reader asked for the change here).
      world.mayDrop(model, tokensIn(model, latin1(before.subarray(start, end))).filter((id) => !out.includes(model.tokens[id].text)), { always: true });
      const outcome = await applyToStore(doc.store, opened, { start, end }, out, `walk transform: ${chain.steps.join(', then ')}`);
      if (out === text) {
        if (outcome !== 'unchanged') world.fail('I6', `Apply of ${at} changed nothing yet gave '${outcome}'`);
        return `applyTransform ${at}: the result is the text, unchanged`;
      }
      if (outcome !== 'applied') world.fail('I6', `Apply of ${at} gave '${outcome}'; nothing had changed under it`);
      const after = copy(doc.store.snapshot().buffer.bytes);
      const tail = before.length - end;
      if (!same(after.subarray(0, start), before.subarray(0, start))) world.fail('I6', `Apply of ${at} changed bytes before the range`);
      if (!same(after.subarray(after.length - tail), before.subarray(end))) world.fail('I6', `Apply of ${at} changed bytes after the range`);
      if (!same(after.subarray(start, after.length - tail), enc.encode(out))) world.fail('I6', `Apply of ${at}: the range does not hold the output`);
      if (bomLength(before) !== bomLength(after)) world.fail('I6', `Apply of ${at} changed the byte-order mark`);
      // A file with no line ending yet takes LF from a transform that adds lines; any other file keeps the kinds it has.
      const had = endingKinds(before);
      if (had.size > 0) for (const kind of endingKinds(after)) if (!had.has(kind)) world.fail('I6', `Apply of ${at} wrote a line ending (${JSON.stringify(kind)}) the file did not have`);
      doc.past.push(before);
      doc.future = [];
      doc.buf = after;
      world.afterBytesChange(doc, view);
      if (d.chance(0.5)) {
        if (!(await doc.store.undo())) world.fail('I7', `${at}: undo returned false right after Apply`);
        if (!same(copy(doc.store.snapshot().buffer.bytes), before)) world.fail('I6', `${at}: one undo did not restore the exact bytes`);
        if (!(await doc.store.redo())) world.fail('I7', `${at}: redo returned false right after the undo`);
        if (!same(copy(doc.store.snapshot().buffer.bytes), after)) world.fail('I6', `${at}: redo did not give the applied bytes back`);
      }
      return `applyTransform ${at}: ${before.length} bytes became ${after.length}`;
    },
  },

  save: {
    name: 'save',
    weight: 8,
    applicable: (model) => model.views.some(Boolean),
    async run(world, model) {
      const d = model.d;
      const slot = d.pick(slotsWith(model));
      const view = model.views[slot];
      const { doc } = view;
      await world.foldAll(doc);
      const mark = world.dom.log.length;
      let expected;
      let why;
      if (viewsOf(model, doc).some(unfolded)) {
        expected = 'cancelled';
        why = 'Source text held apart';
      } else if (!dirty(doc)) {
        expected = 'unchanged';
        why = 'nothing unsaved';
      } else {
        const onDisk = model.disk.get(doc.path);
        if (onDisk != null && !same(onDisk, doc.base)) {
          expected = 'failed';
          why = 'the file changed on disk since it was opened';
        } else {
          expected = 'saved';
          why = onDisk == null ? 'the file was gone, so it is made again' : 'disk is what the buffer came from';
        }
      }
      const failWrite = expected === 'saved' && d.chance(0.12);
      if (failWrite) {
        world.shell.rejectNextWrite('io');
        expected = 'failed';
        why = 'the write is refused';
      }
      const result = await save(world.saveDeps(view));
      const overwrote = await INVARIANTS.I1.check(model, world);
      if (overwrote) world.fail('I1', overwrote);
      if (result !== expected) world.fail('I1', `save of ${doc.path} gave '${result}'; the model expected '${expected}' (${why})`);
      const said = world.dom.log.slice(mark);
      if (result === 'failed' && !said.some((line) => line.startsWith('Could not save'))) {
        world.fail('I3', `a save of ${doc.path} was refused and no notice said so; the text is only in the buffer`);
      }
      if (result === 'cancelled' && !said.includes(SOURCE_HELD_APART)) world.fail('I3', 'a save was held apart and no notice said so');
      if (result === 'saved') {
        model.disk.set(doc.path, doc.buf.slice());
        doc.base = doc.buf.slice();
        // The pane's own check that nothing but its own bytes were written (I6): the file is the buffer, exactly.
        const written = await world.shell.peekFile(doc.path);
        if (!same(written, doc.buf)) world.fail('I6', `the bytes saved to ${doc.path} are not the buffer's`);
      }
      if (result === 'unchanged') {
        const own = world.writes.filter((w) => w.step === model.trace.length && w.path === doc.path);
        if (own.length) world.fail('I6', `an unchanged buffer wrote ${doc.path}`);
      }
      return `save pane ${slot} (${doc.path}): ${result} (${why})`;
    },
  },

  saveAs: {
    name: 'saveAs',
    weight: 5,
    applicable: (model) => model.views.some(Boolean),
    async run(world, model) {
      const d = model.d;
      const slot = d.pick(slotsWith(model));
      const view = model.views[slot];
      const { doc } = view;
      const otherDocs = model.docs.filter((x) => x !== doc);
      const kind = d.weighted([
        ['fresh', 4],
        ['closed', 2],
        ['otherPane', otherDocs.length ? 4 : 0],
        ['self', 1],
      ]);
      let target;
      if (kind === 'fresh') target = `${ROOT}/s${model.nextFresh++}.md`;
      else if (kind === 'otherPane') target = d.pick(otherDocs).path;
      else if (kind === 'self') target = doc.path;
      else {
        const closed = present(model).filter((p) => p !== doc.path && !model.docs.some((x) => x.path === p));
        target = closed.length ? d.pick(closed) : `${ROOT}/s${model.nextFresh++}.md`;
      }
      await world.foldAll(doc);
      const mark = world.dom.log.length;
      const overwritten = model.disk.get(target) ?? null;
      const other = target === doc.path ? null : model.docs.find((x) => x.path === target) ?? null;
      let expected;
      if (viewsOf(model, doc).some(unfolded)) expected = 'cancelled';
      else if (other && (dirty(other) || viewsOf(model, other).some(unfolded))) expected = 'cancelled-open-elsewhere';
      else if (target === doc.path) {
        const onDisk = model.disk.get(doc.path);
        if (!dirty(doc)) expected = 'unchanged';
        else if (onDisk != null && !same(onDisk, doc.base)) expected = 'failed';
        else expected = 'saved';
      } else expected = 'saved';
      world.pick = target;
      if (expected === 'saved') {
        world.mayDrop(model, overwritten ? tokensIn(model, latin1(overwritten)) : []);
        if (other) world.mayDrop(model, tokensIn(model, latin1(other.buf)));
      }
      const result = await save(world.saveDeps(view), { as: true });
      world.pick = null;
      const overwrote = await INVARIANTS.I1.check(model, world);
      if (overwrote) world.fail('I1', overwrote);
      const want = expected === 'cancelled-open-elsewhere' ? 'cancelled' : expected;
      if (result !== want) world.fail('I1', `Save As ${doc.path} -> ${target} gave '${result}'; the model expected '${want}' (${expected})`);
      const said = world.dom.log.slice(mark);
      if (expected === 'cancelled-open-elsewhere' && !said.some((line) => line.includes('is open in the other pane with changes that are not saved'))) {
        world.fail('I5', `Save As onto ${target}, open and unsaved in the other pane, was refused with no notice`);
      }
      if (expected === 'failed' && !said.some((line) => line.startsWith('Could not save'))) world.fail('I3', 'a refused Save As said nothing');
      if (result === 'saved') {
        model.disk.set(target, doc.buf.slice());
        doc.base = doc.buf.slice();
        if (target !== doc.path) {
          doc.path = target;
          doc.pending = null; // saved under a new name: the old file's pending change is not this document's
          // The other pane's clean store let go and the pane shows this one (D-10.1): onSaveAs moved the model's views.
          if (other && model.docs.includes(other)) world.fail('I5', `${target} still has two stores after a Save As onto it`);
        }
      }
      return `Save As in pane ${slot}: ${kind} ${target} -> ${result}${other ? ' (open in the other pane)' : ''}`;
    },
  },

  outsideWrite: {
    name: 'outsideWrite',
    weight: 7,
    applicable: (model) => paths(model).length > 0,
    async run(world, model) {
      const d = model.d;
      const open = model.docs.map((x) => x.path);
      const path = open.length && d.chance(0.8) ? d.pick(open) : d.pick(paths(model));
      const old = model.disk.get(path);
      const bytes = outsideBytes(model, path);
      if (old) world.mayDrop(model, tokensIn(model, latin1(old)));
      await world.shell.writeFileAtomic(path, bytes); // another program: the same call, not the app's
      model.disk.set(path, bytes.slice());
      const announced = d.chance(0.8);
      const kind = old == null ? 'created' : 'modified';
      if (announced) await world.deliver([[{ kind, path }]]);
      return `another program writes ${path} (${bytes.length} bytes)${announced ? '' : ', and the watch says nothing'}`;
    },
  },

  outsideDelete: {
    name: 'outsideDelete',
    weight: 3,
    applicable: (model) => present(model).length > 0,
    async run(world, model) {
      const d = model.d;
      const open = model.docs.map((x) => x.path).filter((p) => model.disk.get(p) != null);
      const path = open.length && d.chance(0.8) ? d.pick(open) : d.pick(present(model));
      world.mayDrop(model, tokensIn(model, latin1(model.disk.get(path))));
      world.shell.remove(path);
      model.disk.set(path, null);
      const announced = d.chance(0.8);
      if (announced) await world.deliver([[{ kind: 'removed', path }]]);
      return `another program deletes ${path}${announced ? '' : ', and the watch says nothing'}`;
    },
  },

  outsideRestore: {
    name: 'outsideRestore',
    weight: 3,
    applicable: (model) => present(model).length > 0,
    async run(world, model) {
      const d = model.d;
      const open = model.docs.map((x) => x.path).filter((p) => model.disk.get(p) != null);
      const path = open.length && d.chance(0.8) ? d.pick(open) : d.pick(present(model));
      const old = model.disk.get(path);
      world.mayDrop(model, tokensIn(model, latin1(old)));
      // Write, delete, and put a file back: an editor's save-by-replace. The final bytes may be the first ones again.
      const first = outsideBytes(model, path);
      await world.shell.writeFileAtomic(path, first);
      world.shell.remove(path);
      const back = d.chance(0.4) ? old.slice() : outsideBytes(model, path);
      await world.shell.writeFileAtomic(path, back);
      model.disk.set(path, back.slice());
      const how = d.weighted([['one batch', 3], ['three batches', 3], ['silent', 1]]);
      if (how === 'one batch') {
        // A removal in the batch makes it 'gone': the file is not read, the buffer stays, and the notice says so.
        await world.deliver([[{ kind: 'modified', path }, { kind: 'removed', path }, { kind: 'created', path }]]);
      } else if (how === 'three batches') {
        await world.deliver([[{ kind: 'modified', path }], [{ kind: 'removed', path }], [{ kind: 'created', path }]]);
      }
      return `another program writes, deletes and restores ${path} (${how}; ${same(back, old) ? 'the same bytes' : 'new bytes'})`;
    },
  },

  spuriousEvent: {
    name: 'spuriousEvent',
    weight: 3,
    applicable: (model) => model.docs.some((doc) => model.disk.get(doc.path) != null),
    async run(world, model) {
      const doc = model.d.pick(model.docs.filter((x) => model.disk.get(x.path) != null));
      // The echo of our own save, or any event: the file is read and offered to the store, which decides.
      await world.deliver([[{ kind: 'modified', path: doc.path }]]);
      return `the watch reports ${doc.path} modified`;
    },
  },

  resolve: {
    name: 'resolve',
    weight: 4,
    applicable: (model) => slotsWith(model, (v) => v.doc.pending !== null).length > 0,
    async run(world, model) {
      const d = model.d;
      const slot = d.pick(slotsWith(model, (v) => v.doc.pending !== null));
      const { doc } = model.views[slot];
      const choice = d.pick(['mine', 'theirs']);
      await world.foldAll(doc); // commands/document.ts resolveDiskConflict: folds first
      if (viewsOf(model, doc).some(unfolded)) return `${choice}: refused, Source text is held apart (nothing changed)`;
      const theirs = model.disk.get(doc.path);
      let note;
      if (theirs == null) {
        if (choice === 'theirs') {
          const outcome = await doc.store.resolveConflict('theirs');
          if (outcome.result !== 'failed') world.fail('I4', `taking the version on disk of a deleted file gave '${outcome.result}'`);
          note = 'the file is gone: nothing to take';
        } else {
          let n = 1;
          while (model.disk.get(conflictCopyPath(doc.path, n)) != null) n++;
          const copyPath = conflictCopyPath(doc.path, n);
          const outcome = await doc.store.resolveConflict('mine');
          if (outcome.result !== 'resolved' || outcome.copy !== copyPath) {
            world.fail('I4', `keeping mine of a deleted file gave ${JSON.stringify(outcome)}; the model expected a copy at ${copyPath}`);
          }
          model.disk.set(copyPath, doc.buf.slice());
          doc.pending = null;
          note = `copy at ${copyPath}`;
        }
      } else {
        let copyPath;
        if (choice === 'mine' && !same(doc.buf, theirs)) {
          let n = 1;
          while (model.disk.get(conflictCopyPath(doc.path, n)) != null) n++;
          copyPath = conflictCopyPath(doc.path, n);
        }
        if (choice === 'theirs') world.mayDrop(model, tokensIn(model, latin1(doc.buf)));
        const outcome = await doc.store.resolveConflict(choice);
        if (outcome.result !== 'resolved' || outcome.copy !== copyPath) {
          world.fail('I4', `${choice} gave ${JSON.stringify(outcome)}; the model expected a copy at ${copyPath}`);
        }
        if (copyPath) model.disk.set(copyPath, doc.buf.slice());
        doc.pending = null;
        if (same(theirs, doc.buf)) doc.base = doc.buf.slice();
        else {
          doc.buf = theirs.slice();
          doc.base = theirs.slice();
          doc.past = [];
          doc.future = [];
        }
        note = copyPath ? `copy at ${copyPath}` : 'no copy';
      }
      return `resolve in pane ${slot} (${doc.path}) with '${choice}': ${note}`;
    },
  },
};

// ---- invariants ----------------------------------------------------------------------------------------------------

export const INVARIANTS = {
  I1: {
    name: 'no silent overwrite',
    check(model, world) {
      for (; world.checkedWrites < world.writes.length; world.checkedWrites++) {
        const w = world.writes[world.checkedWrites];
        if (w.before === null || w.picked) continue; // a new file, or a Save As the reader picked (the dialog asked)
        if (w.path !== w.storePath) return `a write to ${w.path}, which existed, was not the store's own file nor a Save As the reader picked`;
        if (w.storeBaseline !== null && !same(w.before, w.storeBaseline)) {
          return `${w.path} was overwritten while it held bytes the store never loaded or wrote (disk differs from the store's baseline)`;
        }
        if (w.modelBaseline !== null && !same(w.before, w.modelBaseline)) {
          return `${w.path} was overwritten while it held bytes the model says the reader was never shown`;
        }
      }
    },
  },

  I2: {
    name: 'bytes on disk are known',
    async check(model, world) {
      const seen = new Set();
      for (const stat of await world.shell.readDir(ROOT)) {
        seen.add(stat.path);
        const want = model.disk.get(stat.path);
        if (want == null) return `${stat.path} is on disk and the model never put a file there`;
        if (!same(await world.shell.peekFile(stat.path), want)) return `${stat.path} on disk is not the last write the model knows of`;
      }
      for (const [path, bytes] of model.disk) if (bytes != null && !seen.has(path)) return `${path} should be on disk and is not`;
    },
  },

  I3: {
    name: 'no lost byte without a notice',
    async check(model, world) {
      const texts = await world.everything();
      for (const token of model.tokens) {
        if (!token.live) continue;
        if (model.dropped.has(token.id)) {
          token.live = false; // the reader took it back (an undo): wherever else a copy lies, it is no longer owed
          continue;
        }
        if (texts.some((text) => text.includes(token.text))) continue;
        if (model.allowed.has(token.id)) {
          token.live = false;
          continue;
        }
        return `typed text ${token.text} is in no buffer, no Source editor and no file, and no step said it was dropped`;
      }
    },
  },

  I4: {
    name: 'an outside write is announced',
    check(model, world) {
      for (const doc of model.docs) {
        const held = doc.store.conflict();
        if (!same(held, doc.pending)) {
          return `${doc.path}: the store ${held === null ? 'holds no changed-on-disk version' : 'holds a changed-on-disk version'} but the model expects ${doc.pending === null ? 'none' : 'one'}`;
        }
      }
    },
  },

  I5: {
    name: 'one store per path',
    check(model, world) {
      const seenPaths = new Set();
      for (const doc of model.docs) {
        if (seenPaths.has(doc.path)) return `two documents answer to ${doc.path}`;
        seenPaths.add(doc.path);
        if (world.registry.held(doc.path) !== doc.store) return `the registry does not hold the store of ${doc.path}`;
        const holders = viewsOf(model, doc).length;
        if (world.registry.views(doc.store) !== holders) return `${doc.path} is shown by ${holders} pane(s) and the registry counts ${world.registry.views(doc.store)}`;
        if (holders === 0) return `${doc.path} has a store and no pane`;
        if (doc.store.snapshot().path !== doc.path) return `the store's path ${doc.store.snapshot().path} is not the model's ${doc.path}`;
      }
      if (world.liveWatches !== model.docs.length) return `${world.liveWatches} live watch(es) for ${model.docs.length} store(s)`;
    },
  },

  I6: {
    name: 'fidelity',
    check(model) {
      for (const doc of model.docs) {
        const snap = doc.store.snapshot();
        if (!same(snap.buffer.bytes, doc.buf)) {
          return `${doc.path}: the buffer is not the bytes the model's edits add up to (${snap.buffer.bytes.length} bytes against ${doc.buf.length})`;
        }
      }
    },
  },

  I7: {
    name: 'the baseline and the history agree',
    check(model) {
      for (const doc of model.docs) {
        const snap = doc.store.snapshot();
        if (!same(snap.disk, doc.base)) return `${doc.path}: the store's disk baseline is not the model's`;
        if (snap.dirty !== dirty(doc)) return `${doc.path}: dirty is ${snap.dirty}; the model says ${dirty(doc)}`;
        if (snap.canUndo !== doc.past.length > 0 || snap.canRedo !== doc.future.length > 0) {
          return `${doc.path}: undo/redo availability (${snap.canUndo}/${snap.canRedo}) differs from the model's history (${doc.past.length}/${doc.future.length})`;
        }
      }
    },
  },
};

// ---- the runner ----------------------------------------------------------------------------------------------------

/** `MARXY_WALK_SEEDS` (default 40) seeds numbered from 1, or just `MARXY_WALK_SEED`. */
export function seedsFromEnv(env = process.env, fallback = 40) {
  if (env.MARXY_WALK_SEED !== undefined && env.MARXY_WALK_SEED !== '') return [Number(env.MARXY_WALK_SEED)];
  const count = Number(env.MARXY_WALK_SEEDS ?? fallback);
  return Array.from({ length: count }, (_, i) => i + 1);
}

export function describeFailure(seed, failure, trace) {
  return [
    `store walk failed on seed ${seed} in ${failure.invariant ?? 'a step'}: ${failure.message}`,
    `replay: MARXY_WALK_SEED=${seed} node --test --experimental-strip-types apps/desktop/test/store-walk.test.mjs`,
    'steps:',
    ...trace.map((line, i) => `  ${i + 1}. ${line}`),
  ].join('\n');
}

/**
 * One seed. Resolves `{ trace, files }` (the step list and every file's final bytes, hex) or rejects with a
 * message that names the seed and lists the steps.
 */
export async function runWalk(seed, { steps } = {}) {
  const rand = prng(seed);
  const model = createModel(seed, rand);
  const world = new World(model);
  const count = steps ?? 20 + Math.floor(rand() * 41);
  const originalWarn = console.warn;
  console.warn = () => {}; // a subscriber's warning is not this walk's output
  try {
    for (let n = 0; n < count; n++) {
      const ops = Object.values(OPS).filter((op) => op.weight > 0 && op.applicable(model));
      // The first step always opens a document: there is nothing to walk over until one is.
      const op = n === 0 ? OPS.open : model.d.weighted(ops.map((o) => [o, o.weight]));
      let label;
      try {
        label = await op.run(world, model, rand);
        model.trace.push(label);
        world.syncTabs();
      } catch (error) {
        model.trace.push(`${op.name}: threw ${error?.message ?? error}`);
        const failure = error instanceof WalkFailure ? error : { invariant: 'step', message: `${op.name} threw: ${error?.stack ?? error}` };
        throw new Error(describeFailure(seed, failure, model.trace));
      }
      for (const [key, invariant] of Object.entries(INVARIANTS)) {
        let problem;
        try {
          problem = await invariant.check(model, world);
        } catch (error) {
          problem = `the check threw: ${error?.stack ?? error}`;
        }
        if (problem) throw new Error(describeFailure(seed, { invariant: `${key} (${invariant.name})`, message: problem }, model.trace));
      }
      model.allowed.clear();
      model.dropped.clear();
    }
    const files = {};
    for (const stat of await world.shell.readDir(ROOT)) files[stat.path] = Buffer.from(await world.shell.peekFile(stat.path)).toString('hex');
    return { trace: model.trace.slice(), files };
  } finally {
    console.warn = originalWarn;
    await world.end();
  }
}
