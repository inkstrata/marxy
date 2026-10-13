// The inspector's Versions tab (V-06, ADR-0072): for the focused file, *Changed since you read* at the top when the bytes on disk
// differ from the copy kept when the reader last read it (the lines added and removed, and a click that opens the diff), then the
// file's earlier versions, newest first, each with its time, its size and why it was kept. Choosing a version opens the diff from
// it to the buffer (E-17's scratch document); *Restore to a copy* writes its bytes beside the file at the first free
// `name (version 14.32).md` and opens that, never touching the original. When no versions are kept the tab says why (off, a deny
// rule, the large-file limit, a scratch document), and a damaged record, a copy removed by hand or a failed keep is said, never
// passed over. Pure parts first (`notKeptWords`, `listingNote`, `sinceCounts`, `versionRowWords`), then `mountVersionsTab`.
//
// Nothing here writes but Restore, and Restore writes one new file beside the original through `restoreToCopy`. Nothing is sent
// anywhere: the versions are read from Marxy's data folder only to draw this tab, a diff, or a restored copy.
import { unifiedDiff } from '@marxy/core';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { AppHandle } from '../app.ts';
import { keptWhen, showSinceRead, showVersionChanges, sinceReadOf, sinceWhen } from '../commands/compare.ts';
import type { DocumentStore } from '../document/store.ts';
import { isUntitled } from '../document/untitled.ts';
import { notify } from '../notices/index.ts';
import { versionRecorder, type SinceRead, type VersionFailure } from '../versions/recorder.ts';
import { hourMinute, restoreToCopy } from '../versions/restore.ts';
import { VERSIONS_MAX_AGE_MS, VERSIONS_PER_FILE, VERSIONS_TOTAL_BYTES, type ListedVersion, type Listing, type NotKept } from '../versions/store.ts';
import type { InspectorContext, InspectorTab } from './inspector.ts';

// ---- the words ---------------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const MB = 1024 * 1024;

/** "312 bytes", "4.1 KB", "1.8 MB". */
export function sizeWords(n: number): string {
  if (n < 1024) return plural(n, 'byte', 'bytes');
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** Why the focused file gets no versions, in words. */
export function notKeptWords(no: NotKept): string {
  switch (no.kind) {
    case 'off':
      return 'Versions are off: config.toml says versions = false, so no new copies are kept.';
    case 'large':
      return `No versions are kept of this file: it is larger than ${sizeWords(no.limit)}, the large-file limit.`;
    case 'denied':
      return no.builtIn
        ? `No versions are kept of this file: it is in a ${no.rule} folder, which Marxy never reads into.`
        : `No versions are kept of this file: the [deny] rule ${no.rule} in collection.toml covers it.`;
    case 'scratch':
      return 'This document is not a file yet, so no versions are kept of it.';
    case 'own':
      return 'This is one of Marxy\'s own files, so no versions are kept of it.';
  }
}

/** What the tab says of a listing that is not a list of versions; null for one that is. */
export function listingNote(listing: Listing): string | null {
  switch (listing.kind) {
    case 'ok':
      return null;
    case 'none':
      return 'No earlier versions are kept yet.';
    case 'damaged':
      return `The record of this file's versions could not be read: ${listing.reason}. Its versions cannot be listed and no new ones are kept; Clear versions of this file starts it again.`;
    case 'newer':
      return 'A newer Marxy keeps this file\'s versions; this one leaves them as they are.';
    case 'unreadable':
      return `The record of this file's versions could not be read (${messageOf(listing.error)}).`;
  }
}

export const messageOf = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? error);

/** What a failed keep says: which copy, and why. The file itself is never touched by a keep. */
export function failureWords(failure: VersionFailure): string {
  return `The last copy (${failure.reason}) could not be kept: ${messageOf(failure.error)}. The file itself is untouched.`;
}

const REASON_WORDS: Record<ListedVersion['reason'], string> = { read: 'read', 'before save': 'before save', 'before reload': 'before reload' };

/** One row's words: when, why and how large, and what is wrong with its copy if anything is. */
export function versionRowWords(v: ListedVersion, now: number): { readonly when: string; readonly what: string; readonly state: string | null; readonly label: string } {
  const when = keptWhen(v.time, now).replace(/^at /, '');
  const what = `${REASON_WORDS[v.reason]} · ${sizeWords(v.size)}`;
  const state = v.bytes === 'missing' ? 'copy missing' : v.bytes === 'changed' ? 'copy changed outside Marxy' : null;
  const label = `Version kept ${when}, ${REASON_WORDS[v.reason]}, ${sizeWords(v.size)}${state === null ? '. Opens what changed since' : `. Its ${state}`}`;
  return { when, what, state, label };
}

const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

/** The lines added and removed from `since` to `onDisk`, or null when the files are too large to compare here. */
export function sinceCounts(since: Uint8Array, onDisk: Uint8Array): { readonly added: number; readonly removed: number } | null {
  const d = unifiedDiff(decoder.decode(since), decoder.decode(onDisk));
  return d === null ? null : { added: d.added, removed: d.removed };
}

export const ABOUT_VERSIONS =
  `Marxy keeps a copy when you open a file, before it saves over it, and before an outside change replaces it: ` +
  `${VERSIONS_PER_FILE} per file, ${Math.round(VERSIONS_MAX_AGE_MS / (24 * 60 * 60 * 1000))} days, ${VERSIONS_TOTAL_BYTES / MB} MB in all, ` +
  'in its own data folder. Nothing leaves this machine.';

// ---- the panel ---------------------------------------------------------------------------------------------------------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A stable number for a byte array, so a draw can tell that the disk bytes it drew are the ones held now. */
const ids = new WeakMap<Uint8Array, number>();
let nextId = 1;
const idOf = (bytes: Uint8Array | null): number => {
  if (bytes === null) return 0;
  let id = ids.get(bytes);
  if (id === undefined) ids.set(bytes, (id = nextId++));
  return id;
};

function mountVersionsTab(host: HTMLElement, ctx: InspectorContext): () => void {
  const handle: AppHandle = ctx.handle;
  const body = el('div', 'marxy-versions');
  host.append(body);
  let drawnKey = '';
  let token = 0;
  let generation = 0;
  let gone = false;
  let unsubscribeStore: (() => void) | null = null;
  let watched: DocumentStore | null = null;
  /** The counts of the last *Changed since you read* drawn, for the same two arrays. */
  let counted: { readonly since: Uint8Array; readonly onDisk: Uint8Array; readonly counts: ReturnType<typeof sinceCounts> } | null = null;

  const message = (text: string, kind: 'note' | 'warn' = 'note'): HTMLElement => {
    const p = el('p', 'marxy-versions-note', text);
    if (kind === 'warn') p.setAttribute('data-marxy-versions-warn', '');
    return p;
  };

  const sinceRow = (store: DocumentStore, since: SinceRead, onDisk: Uint8Array): HTMLElement => {
    if (counted === null || counted.since !== since.bytes || counted.onDisk !== onDisk) counted = { since: since.bytes, onDisk, counts: sinceCounts(since.bytes, onDisk) };
    const counts = counted.counts;
    const row = el('button', 'marxy-versions-since');
    row.type = 'button';
    row.tabIndex = -1;
    row.setAttribute('data-marxy-versions-since', '');
    const countWords = counts === null ? 'too large to count here' : `${plural(counts.added, 'line', 'lines')} added, ${counts.removed} removed`;
    const when = sinceWhen(since);
    row.append(
      el('span', 'marxy-versions-since-title', 'Changed since you read'),
      el('span', 'marxy-versions-since-counts', countWords),
      el('span', 'marxy-versions-since-when', since.savedSince ? `${when}; you saved it since` : when),
    );
    row.setAttribute('aria-label', `Changed since you read: ${countWords}, ${when}${since.savedSince ? '; you saved it since' : ''}. Opens the changes`);
    row.addEventListener('mousedown', (event) => event.preventDefault());
    row.addEventListener('click', () => void showSinceRead(store));
    return row;
  };

  const openDiff = async (store: DocumentStore, path: string, v: ListedVersion): Promise<void> => {
    const recorder = versionRecorder();
    if (!recorder) return;
    const read = await recorder.store.read(path, v.id);
    if (read.kind !== 'bytes') return void notify({ kind: 'refused', text: readRefusal(read.kind, v) });
    await showVersionChanges(store.snapshot(), read.bytes, `since the version kept ${keptWhen(v.time)} (${REASON_WORDS[v.reason]})`);
  };

  const restore = async (path: string, v: ListedVersion): Promise<void> => {
    const recorder = versionRecorder();
    if (!recorder) return;
    const read = await recorder.store.read(path, v.id);
    if (read.kind !== 'bytes') return void notify({ kind: 'refused', text: readRefusal(read.kind, v) });
    const out = await restoreToCopy(handle.shell, path, read.bytes, v.time);
    if (out.result === 'failed') {
      return void notify({ kind: 'refused', text: `The version of ${hourMinute(v.time)} was not restored · ${messageOf(out.error)} · ${basename(path)} is unchanged` });
    }
    // Said once the copy is on screen (an open clears the pane's notices), and at once if the open waits on the reader.
    const said = (): void => void notify({ kind: 'done', text: `Restored the version of ${hourMinute(v.time)} as ${basename(out.path)} · ${basename(path)} is unchanged` });
    let landed = false;
    await handle.open(out.path, {
      onLanded() {
        landed = true;
        said();
      },
    });
    if (!landed) said();
  };

  const versionItem = (store: DocumentStore, path: string, v: ListedVersion, now: number): HTMLElement => {
    const words = versionRowWords(v, now);
    const item = el('li', 'marxy-versions-item');
    const row = el('button', 'marxy-versions-row');
    row.type = 'button';
    row.tabIndex = -1;
    row.setAttribute('data-marxy-version-id', String(v.id));
    row.setAttribute('data-marxy-version-reason', v.reason);
    row.setAttribute('aria-label', words.label);
    row.append(el('span', 'marxy-versions-rail'), el('span', 'marxy-versions-when', words.when), el('span', 'marxy-versions-what', words.what));
    if (words.state !== null) {
      row.append(el('span', 'marxy-versions-state', words.state));
      row.setAttribute('data-marxy-version-state', v.bytes);
    }
    row.addEventListener('mousedown', (event) => event.preventDefault());
    row.addEventListener('click', () => void openDiff(store, path, v));
    const restoreButton = el('button', 'marxy-versions-restore', 'Restore to a copy');
    restoreButton.type = 'button';
    restoreButton.tabIndex = -1;
    restoreButton.setAttribute('data-marxy-version-restore', String(v.id));
    restoreButton.setAttribute('aria-label', `Restore the version kept ${words.when} to a copy beside the file`);
    restoreButton.addEventListener('mousedown', (event) => event.preventDefault());
    restoreButton.addEventListener('click', () => void restore(path, v));
    item.append(row, restoreButton);
    return item;
  };

  const draw = (): void => {
    if (gone || !ctx.visible()) return;
    const pane = handle.panes().focused;
    const store = pane.content.store();
    const path = pane.path();
    if (watched !== store) {
      unsubscribeStore?.();
      watched = store;
      unsubscribeStore = store ? store.subscribe(() => draw()) : null;
    }
    const recorder = versionRecorder();
    if (!store || path === null) {
      drawnKey = '';
      token++;
      body.replaceChildren(message('No document is open.'));
      return;
    }
    if (!recorder) {
      drawnKey = '';
      token++;
      body.replaceChildren(message('Marxy has nowhere to keep versions here: there is no data folder.'));
      return;
    }
    const snap = store.snapshot();
    const onDisk = store.conflict() ?? snap.disk;
    // The list depends on the path, the bytes on disk and what the recorder did; not on the buffer, so typing redraws nothing.
    const key = `${path}\0${idOf(onDisk)}\0${idOf(store.conflict())}\0${generation}`;
    if (key === drawnKey) return;
    drawnKey = key;
    const mine = ++token;
    void (async () => {
      const size = (onDisk ?? snap.buffer.bytes).length;
      const [no, listing] = await Promise.all([
        isUntitled(path) ? Promise.resolve<NotKept>({ kind: 'scratch' }) : recorder.status(path, size).catch(() => null),
        isUntitled(path) ? Promise.resolve<Listing>({ kind: 'none' }) : recorder.store.list(path).catch((error: unknown): Listing => ({ kind: 'unreadable', error })),
      ]);
      if (mine !== token || gone) return;
      const parts: HTMLElement[] = [];
      const found = sinceReadOf(store);
      if (found) parts.push(sinceRow(store, found.since, found.onDisk));
      if (no !== null) parts.push(message(notKeptWords(no)));
      const failure = recorder.failure(path);
      if (failure) parts.push(message(failureWords(failure), 'warn'));
      const head = el('h3', 'marxy-versions-heading', listing.kind === 'ok' ? `Earlier versions (${listing.versions.length})` : 'Earlier versions');
      head.id = `marxy-versions-heading-${mine}`;
      parts.push(head);
      const note = listingNote(listing);
      // Nothing kept and nothing to say beyond why: the reason above is the whole story.
      if (note !== null && !(listing.kind === 'none' && no !== null)) parts.push(message(note, listing.kind === 'none' ? 'note' : 'warn'));
      if (listing.kind === 'ok') {
        const list = el('ul', 'marxy-versions-list');
        list.setAttribute('aria-labelledby', head.id);
        const now = Date.now();
        for (const v of listing.versions) list.append(versionItem(store, path, v, now));
        parts.push(list);
      }
      if (no?.kind !== 'scratch') parts.push(el('p', 'marxy-versions-about', ABOUT_VERSIONS));
      body.replaceChildren(...parts);
    })();
  };

  const offSignal = ctx.signal.onChange(draw);
  const offShown = ctx.onShown(() => {
    drawnKey = '';
    draw();
  });
  const offRecorder = versionRecorder()?.onChange(() => {
    generation++;
    draw();
  });
  draw();
  return () => {
    gone = true;
    token++;
    offSignal();
    offShown();
    offRecorder?.();
    unsubscribeStore?.();
    body.remove();
  };
}

function readRefusal(kind: 'gone' | 'missing' | 'changed' | 'unreadable', v: ListedVersion): string {
  const when = hourMinute(v.time);
  switch (kind) {
    case 'gone':
      return `The version of ${when} is no longer kept`;
    case 'missing':
      return `The copy of the version of ${when} is missing from Marxy's data folder · it was removed outside Marxy`;
    case 'changed':
      return `The copy of the version of ${when} was changed outside Marxy · it is not shown as that version`;
    case 'unreadable':
      return `The copy of the version of ${when} could not be read`;
  }
}

export const VERSIONS_TAB: InspectorTab = { id: 'versions', title: 'Versions', mount: mountVersionsTab };
