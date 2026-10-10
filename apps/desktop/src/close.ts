// Close while dirty: one notice, not a modal (docs/design/01-buffer.md, MARXY-49). Opening another
// document while dirty takes the same path (MARXY-337). With two panes (D-08) the guard is per document:
// the notice names the document being left, sits in the pane that shows it and saves that document;
// quitting asks about each unsaved document in turn; closing a pane asks about its document.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { Shell } from '@marxy/shell-api';
import type { DocumentStore } from './document/store.ts';
import { ensureNoticesRegion, notify, SOURCE_HELD_APART } from './notices/index.ts';
import type { SaveResult } from './save.ts';

/** What the guard reads of a pane (pane/index.ts's `Pane<AppPane>`, narrowed). */
export interface GuardPane {
  /** The pane's `section.marxy-pane`: its notices go in its own region. */
  readonly host: HTMLElement;
  /** The pane's view: the open path names it when it asks (`confirmLeaveDocument`). */
  readonly view: { sourceHasUnfoldedEdits(): boolean };
  readonly content: {
    currentPath(): string | null;
    store(): DocumentStore | null;
    /** The store's `dirty`, or Source text typed in this pane and not yet folded into it. */
    hasUnsavedChanges(): boolean;
    /** Source text typed in this pane goes into its store. */
    foldSource(): Promise<void>;
    /** The explicit save (save.ts) through this pane's open path. */
    save(): Promise<SaveResult>;
  };
}

export interface CloseGuardHost {
  readonly shell: Pick<Shell, 'onCloseRequested' | 'confirmClose'>;
  /** The window's panes, left to right. */
  panes(): readonly GuardPane[];
}

/** An unsaved document the guard asks about, and the pane its notice goes in. */
export interface DirtyDocument {
  readonly store: DocumentStore;
  readonly path: string;
  readonly name: string;
  readonly pane: GuardPane;
  /** Still unsaved: its store is dirty, or a pane that shows it holds Source text not yet folded in. */
  isDirty(): boolean;
  /** Every pane's Source text for it goes into its store, so the store's `version` covers what is on screen. */
  fold(): Promise<void>;
  /** Every other pane's Source text for it goes into the store, then it is saved through `pane`. */
  save(): Promise<SaveResult>;
}

interface Prompt {
  readonly kind: 'close' | 'open' | 'pane';
  readonly doc: DirtyDocument;
  readonly saveLabel: string;
  readonly discardLabel: string;
  /** Runs once the reader has chosen to go on: after a save, or without one. */
  readonly proceed: () => void | Promise<void>;
  /** Runs when the reader does not go on: Dismiss, a save that did not happen, or the notice going. */
  readonly stop?: () => void;
  /** Runs on the discard answer, before `proceed`. */
  readonly discarded?: () => void | Promise<void>;
}

let installed: CloseGuardHost | null = null;
// The one notice on screen, if any. "Up" means still attached: something else (opening a document
// clears every notice) may have removed it, and a stale flag would swallow the next close.
let notice: { readonly line: HTMLElement; readonly prompt: Prompt; readonly stop: () => void } | null = null;

const noticeIsUp = (): boolean => notice !== null && notice.line.isConnected;

/** The document `pane` shows, as the guard asks about it, over every pane that shows its store. */
function documentOf(pane: GuardPane, all: readonly GuardPane[]): DirtyDocument | null {
  const store = pane.content.store();
  const path = pane.content.currentPath();
  if (!store || path === null) return null;
  const showing = (): GuardPane[] => all.filter((p) => p.content.store() === store);
  return {
    store,
    path,
    name: basename(path) || 'This document',
    pane,
    isDirty: () => store.snapshot().dirty || showing().some((p) => p.content.hasUnsavedChanges()),
    async fold() {
      for (const p of showing()) await p.content.foldSource();
    },
    async save() {
      for (const p of showing()) await p.content.foldSource();
      // A pane still holding Source text the store lacks (held apart from another pane's fold, D-11) would
      // lose it to whatever is written: the save, and so the prompt's open or close, stops.
      if (showing().some((p) => p.view.sourceHasUnfoldedEdits())) {
        notify({ kind: 'info', text: SOURCE_HELD_APART });
        return 'cancelled';
      }
      return pane.content.save();
    },
  };
}

/**
 * Every unsaved document in the window, once each however many panes show it, left to right. Its pane
 * is the first that holds Source text not yet folded into it, else the first that shows it.
 */
export function dirtyDocuments(panes: readonly GuardPane[]): DirtyDocument[] {
  const out: DirtyDocument[] = [];
  const seen = new Set<DocumentStore>();
  for (const pane of panes) {
    const store = pane.content.store();
    if (!store || seen.has(store)) continue;
    seen.add(store);
    const showing = panes.filter((p) => p.content.store() === store);
    const doc = documentOf(showing.find((p) => p.content.hasUnsavedChanges()) ?? pane, panes);
    if (doc?.isDirty()) out.push(doc);
  }
  return out;
}

/**
 * What `pane` would lose by no longer showing its document: the document, when it is unsaved and no other
 * pane shows it, or when this pane holds Source text not yet in the store. Null when nothing would be lost.
 */
function lostByLeaving(pane: GuardPane, panes: readonly GuardPane[]): DirtyDocument | null {
  if (!pane.content.hasUnsavedChanges()) return null;
  const store = pane.content.store();
  const elsewhere = store !== null && panes.some((p) => p !== pane && p.content.store() === store);
  const unfolded = pane.view.sourceHasUnfoldedEdits();
  // Shown in another pane, the store stays, edits and all: only text typed here and not folded would go.
  if (elsewhere && !unfolded) return null;
  return documentOf(pane, panes);
}

/**
 * One quit's walk (`installCloseGuard`): the documents the reader chose to close without saving, each at the
 * store `version` it had when they answered (its panes' Source text folded in first). A document edited
 * after its answer, or unsaved only since the walk began, is not answered and is asked about.
 */
interface Walk {
  readonly discarded: Map<DocumentStore, number>;
}

let walk: Walk | null = null;

const unanswered = (w: Walk, doc: DirtyDocument): boolean => w.discarded.get(doc.store) !== doc.store.snapshot().version;

export function installCloseGuard(host: CloseGuardHost): void {
  if (typeof window === 'undefined' || !host.shell.onCloseRequested) return;
  installed = host;
  walk = null;
  host.shell.onCloseRequested(() => {
    const current = walk;
    if (current) {
      // A walk is under way: never a second one. A second close request while the notice up is the last
      // thing left to ask about quits (the reader asked twice); otherwise the walk stays where it is, and a
      // request while a save is writing waits for it.
      if (!noticeIsUp() || notice?.prompt.kind !== 'close') return;
      const shown = notice.prompt.doc.store;
      const panes = host.panes();
      // Source text typed after an answer is not in the store's version yet: it counts as unanswered, and
      // the walk goes on to ask about it once this notice is answered.
      const unfolded = (d: DirtyDocument): boolean =>
        panes.some((p) => p.content.store() === d.store && p.view.sourceHasUnfoldedEdits());
      const rest = dirtyDocuments(panes).filter((d) => d.store !== shown && (unanswered(current, d) || unfolded(d)));
      if (rest.length > 0) return;
      walk = null;
      notice.line.remove();
      void host.shell.confirmClose();
      return;
    }
    if (dirtyDocuments(host.panes()).length === 0) {
      void host.shell.confirmClose();
      return;
    }
    const started: Walk = { discarded: new Map() };
    walk = started;
    void askNext(host, started);
  });
}

/**
 * The quit's next question, worked out afresh each time from what the panes hold now: the first unsaved
 * document, left to right, that is not answered. None left, the window closes. Saved meanwhile (Mod+S in
 * its pane), a document is not asked about; edited after its answer, it is asked again.
 */
async function askNext(host: CloseGuardHost, current: Walk): Promise<void> {
  // Source text typed in any pane goes into its store, so a store's version covers it.
  for (const pane of host.panes()) await pane.content.foldSource();
  if (walk !== current) return;
  const doc = dirtyDocuments(host.panes()).find((d) => unanswered(current, d));
  if (!doc) {
    walk = null;
    void host.shell.confirmClose();
    return;
  }
  showPrompt({
    kind: 'close',
    doc,
    saveLabel: 'Save and close',
    discardLabel: 'Close without saving',
    async discarded() {
      await doc.fold();
      current.discarded.set(doc.store, doc.store.snapshot().version);
    },
    proceed: () => askNext(host, current),
    stop: () => {
      if (walk === current) walk = null;
    },
  });
}

/**
 * Opening another document in the pane whose view is `view`, while that pane's document has unsaved
 * changes. Returns true when it has taken over — a notice in that pane, naming its document, offers save,
 * discard or dismiss, and `proceed` runs only on save or discard — and false when nothing would be lost
 * (nothing unsaved, or another pane still shows the document) and the caller opens straight away.
 */
export function confirmLeaveDocument(view: object, proceed: () => void | Promise<void>): boolean {
  const host = installed;
  if (!host) return false;
  const panes = host.panes();
  const pane = panes.find((p) => p.view === view);
  const doc = pane ? lostByLeaving(pane, panes) : null;
  if (!doc) return false;
  showPrompt({ kind: 'open', doc, saveLabel: 'Save and open', discardLabel: 'Open without saving', proceed });
  return true;
}

/**
 * Closing `pane` (`PaneSet.close`, D-08). Resolves true when nothing would be lost — the document is clean,
 * or another pane shows it (Source text typed here goes into its store first) — or once the reader has
 * chosen save or discard in the notice in that pane; false when they dismiss it or the save did not happen.
 */
export async function confirmClosePane(pane: GuardPane): Promise<boolean> {
  const host = installed;
  if (!host) return true;
  await pane.content.foldSource();
  const panes = host.panes();
  const doc = lostByLeaving(pane, panes);
  if (!doc) return true;
  return new Promise<boolean>((resolve) => {
    showPrompt({
      kind: 'pane',
      doc,
      saveLabel: 'Save and close',
      discardLabel: 'Close without saving',
      proceed: () => resolve(true),
      stop: () => resolve(false),
    });
  });
}

/** The pane set as the guard wires it (pane/pane-set.ts's `PaneSet`, narrowed). */
export interface GuardedPaneSet<P extends GuardPane> {
  readonly panes: readonly P[];
  close(pane: P): Promise<boolean>;
  beforeReplace?: (pane: P) => Promise<boolean>;
}

/**
 * Closing a pane asks about its document (`confirmClosePane`) through the set's `beforeReplace`, and a
 * close refused for any reason but the reader's Dismiss says why in that pane. An open into an occupied
 * pane is let through `beforeReplace`: its open path asks in that pane (`confirmLeaveDocument`) and
 * `openIn` resolves at the notice, as D-01 specified.
 */
export function guardPaneClose<P extends GuardPane & { path(): string | null }>(set: GuardedPaneSet<P>): void {
  const close = set.close.bind(set);
  /** The close under way: `PaneSet.close` asks `beforeReplace` before its first await, so this is it. */
  let closing: { readonly pane: P; asked: Promise<boolean> | null } | null = null;
  set.beforeReplace = (pane) => {
    const ask = closing;
    if (ask?.pane !== pane) return Promise.resolve(true);
    ask.asked = confirmClosePane(pane);
    return ask.asked;
  };
  set.close = async (pane) => {
    const ask: { readonly pane: P; asked: Promise<boolean> | null } = { pane, asked: null };
    closing = ask;
    const pending = close(pane);
    closing = null;
    const closed = await pending;
    const dismissed = ask.asked !== null && !(await ask.asked);
    if (!closed && !dismissed && set.panes.length > 1 && set.panes.includes(pane)) {
      const [left, right] = set.panes as readonly [P, P];
      const reason =
        pane === left && right.path() === null
          ? 'the other pane has no document to take its place.'
          : pane === left && right.view.sourceHasUnfoldedEdits()
            ? "the text typed in the other pane's Source could not be kept."
            : "the other pane's document could not be shown in its place.";
      showCloseRefused(pane, reason);
    }
    return closed;
  };
}

/** Why a pane the reader asked to close is still there, said in that pane (the D-01 review). */
export function showCloseRefused(pane: Pick<GuardPane, 'host'>, reason: string): void {
  const line = noticeLine(`This pane stays open: ${reason}`);
  appendButton(line, 'marxy-notice-dismiss', 'Dismiss', () => line.remove());
  ensureNoticesRegion(pane.host).append(line);
}

function noticeLine(text: string): HTMLElement {
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  const span = document.createElement('span');
  span.className = 'marxy-notice-text';
  span.textContent = text;
  line.append(span);
  return line;
}

function appendButton(line: HTMLElement, className: string, label: string, onClick: () => void): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  line.append(b);
}

function showPrompt(prompt: Prompt): void {
  if (noticeIsUp()) {
    notice?.line.remove();
    notice?.stop();
  }
  notice = null;
  const { doc } = prompt;
  const line = noticeLine(`${doc.name} has changes that are not saved.`);
  let settled = false;
  // A close waiting on the notice is refused, not left waiting, if the notice goes without an answer (an
  // open in its pane clears the region, another prompt replaces it).
  const watch = new MutationObserver(() => {
    if (!line.isConnected) stop();
  });
  const answered = (): void => {
    settled = true;
    watch.disconnect();
    line.remove();
  };
  function stop(): void {
    if (settled) return;
    answered();
    prompt.stop?.();
  }

  appendButton(line, 'marxy-notice-action', prompt.saveLabel, () => {
    answered();
    void (async () => {
      const result = await doc.save();
      if (result !== 'saved' && result !== 'unchanged') {
        prompt.stop?.();
        return;
      }
      // The reader kept editing while the save ran: what they see is not what reached disk, and going on
      // would drop it. Ask again.
      if (doc.isDirty()) showPrompt(prompt);
      else await prompt.proceed();
    })();
  });
  appendButton(line, 'marxy-notice-action', prompt.discardLabel, () => {
    answered();
    void (async () => {
      await prompt.discarded?.();
      await prompt.proceed();
    })();
  });
  appendButton(line, 'marxy-notice-dismiss', 'Dismiss', stop);

  ensureNoticesRegion(doc.pane.host).append(line);
  notice = { line, prompt, stop };
  if (prompt.stop) watch.observe(document.documentElement, { childList: true, subtree: true });
}
