// Versions (the eighth panel): the file through time. Now (what is not yet saved, with Read the patch, Save and
// Discard), Earlier copies (each with its time, why it was made and its size: compare with now on the comparison page,
// restore as a staged change, keep for good, open, delete), and Backup (how many copies are kept, where, export all as a
// zip, clear older). Copies are made only before a save or before an outside replacement (versions/recorder.ts), never
// when a file is opened; nothing here says how a copy differs unless the reader asks for the comparison.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { parseConfig } from '@marxy/theme/src/config.ts';
import type { AppHandle } from '../../app-types.ts';
import { discardAll, openChangesPage } from '../../changes/page.ts';
import { saveOrReadChanges } from '../../changes/save-door.ts';
import { changesSummary, onChangesSummary } from '../../changes/state.ts';
import { writeCopy } from '../../commands/copy-write.ts';
import { showVersionChanges } from '../../commands/compare.ts';
import { textOfFileBytes } from '../../document/encoding.ts';
import type { DocumentStore } from '../../document/store.ts';
import { isUntitled } from '../../document/untitled.ts';
import { copyZipPath } from '../../export/model.ts';
import { saveExport } from '../../export/write.ts';
import { zipStore, uniquePaths, ZipTooLarge, type ZipEntry } from '../../export/zip.ts';
import { chordText } from '../../frame/branch-info.ts';
import { anchorBelow, openMenu } from '../../frame/menu.ts';
import { failureWords, listingNote, messageOf, notKeptWords } from '../../frame/model/versions.ts';
import { notify } from '../../notices/index.ts';
import { onHeld, saveHeld, unseenHeld } from '../held.ts';
import { buildAppContext } from '../../selection/bind.ts';
import { resetReaderKey, writeReaderKey } from '../../theme/reader-config.ts';
import { versionRecorder } from '../../versions/recorder.ts';
import { hourMinute, stageCopy } from '../../versions/restore.ts';
import { VERSIONS_PER_FILE, type ListedVersion, type Listing, type NotKept, type VersionEntry } from '../../versions/store.ts';
import type { PanelContext, PanelDef, Verb } from '../types.ts';
import { CLEAR_AGES, copiesWords, inAllWords, sizeWords, skippedWords, whenWords, whyWords } from '../versions-model.ts';
import { btns, empty, h, kv, row, sec, sg } from '../ui.ts';

export interface VersionsState {
  /** Bumped by every change to the copies (a keep, a clear, the panel's own acts): the lists are read again. */
  gen: number;
  list: { readonly key: string; readonly listing: Listing; readonly no: NotKept | null } | null;
  all: { readonly gen: number; readonly files: readonly { readonly path: string; readonly versions: readonly VersionEntry[] }[]; readonly bytes: number } | null;
  copies: number | null;
  data: string | null;
  reading: Set<string>;
  wired?: boolean;
}

type Ctx = PanelContext<VersionsState>;

const ABOUT = 'Copies are made before a save or before a replacement from outside. Never on open.';

function again(ctx: Ctx): void {
  ctx.st.gen++;
  ctx.redraw();
}

function wire(ctx: Ctx): void {
  if (ctx.st.wired) return;
  ctx.st.wired = true;
  versionRecorder()?.onChange(() => again(ctx));
  onChangesSummary(() => ctx.redraw());
  onHeld(() => ctx.redraw());
  void (async () => {
    const shell = ctx.handle.shell;
    if (!shell.configPaths) return;
    const { config, data } = await shell.configPaths();
    ctx.st.data = data;
    try {
      ctx.st.copies = parseConfig(await shell.readFile(config)).config.versionCopies;
    } catch {
      ctx.st.copies = VERSIONS_PER_FILE;
    }
    ctx.redraw();
  })();
}

/** Reads `key`'s listing once, off the draw; the panel draws again when it is in. */
function load(ctx: Ctx, path: string, key: string): void {
  const st = ctx.st;
  if (st.reading.has(key)) return;
  st.reading.add(key);
  const recorder = versionRecorder();
  void (async () => {
    const store = ctx.doc()?.store;
    const size = store?.snapshot().buffer.bytes.length ?? 0;
    const [no, listing] = await Promise.all([
      recorder ? recorder.status(path, size).catch(() => null) : Promise.resolve(null),
      recorder ? recorder.store.list(path).catch((error: unknown): Listing => ({ kind: 'unreadable', error })) : Promise.resolve<Listing>({ kind: 'none' }),
    ]);
    st.reading.delete(key);
    st.list = { key, listing, no };
    ctx.redraw();
  })();
}

function loadAll(ctx: Ctx): void {
  const st = ctx.st;
  const recorder = versionRecorder();
  const key = `all#${st.gen}`;
  if (!recorder || st.reading.has(key) || st.all?.gen === st.gen) return;
  st.reading.add(key);
  const gen = st.gen;
  void (async () => {
    const [files, bytes] = await Promise.all([recorder.store.listAll().catch(() => []), recorder.store.totalBytes().catch(() => 0)]);
    st.reading.delete(key);
    st.all = { gen, files, bytes };
    ctx.redraw();
  })();
}

async function bytesOf(path: string, v: VersionEntry): Promise<Uint8Array | null> {
  const recorder = versionRecorder();
  if (!recorder) return null;
  const read = await recorder.store.read(path, v.id);
  if (read.kind === 'bytes') return read.bytes;
  const when = hourMinute(v.time);
  const why = read.kind === 'gone' ? 'is no longer kept' : read.kind === 'missing' ? "is missing from Marxy's data folder · it was removed outside Marxy" : read.kind === 'changed' ? 'was changed outside Marxy · it is not shown as that copy' : 'could not be read';
  notify({ kind: 'refused', text: `The copy of ${when} ${why}` });
  return null;
}

/** The copy's bytes staged over the file: one undo step, written only by Save. */
async function restore(ctx: Ctx, store: DocumentStore | null, path: string, v: ListedVersion, bytesOnly: boolean): Promise<void> {
  if (bytesOnly || !store) {
    notify({ kind: 'refused', text: 'This file is shown as bytes, so a copy cannot be staged over it · open the copy instead' });
    return;
  }
  const bytes = await bytesOf(path, v);
  if (!bytes) return;
  await stageCopy(store, bytes, v.time, ctx.handle.shell);
  ctx.redraw();
}

async function exportAll(handle: AppHandle): Promise<void> {
  const recorder = versionRecorder();
  if (!recorder) return;
  const ents: ZipEntry[] = [];
  const skipped: string[] = [];
  let bytes: Uint8Array;
  try {
    const now = Date.now();
    for (const f of await recorder.store.listAll())
      for (const v of f.versions) {
        const read = await recorder.store.read(f.path, v.id);
        if (read.kind === 'bytes') ents.push({ path: copyZipPath(f.path, v.time), bytes: read.bytes });
        else skipped.push(`${basename(f.path)} (${whenWords(v.time, now)})`);
      }
    if (ents.length === 0) {
      notify(skipped.length ? { kind: 'refused', text: `No copy could be read · ${skippedWords(skipped)} · nothing was exported` } : { kind: 'info', text: 'No copies are kept yet', fades: true });
      return;
    }
    bytes = zipStore(uniquePaths(ents));
  } catch (e) {
    notify(e instanceof ZipTooLarge ? { kind: 'refused', text: `Too many copies for one zip · ${e.message} · nothing was exported` } : { kind: 'error', text: `The copies could not be read · ${messageOf(e)} · nothing was exported` });
    return;
  }
  await saveExport(handle, 'marxy-copies.zip', bytes, handle.currentPath(), skipped.length ? skippedWords(skipped) : undefined);
}

function clearOlder(ctx: Ctx, at: Element): void {
  const recorder = versionRecorder();
  if (!recorder) return;
  openMenu(
    anchorBelow(at),
    'Clear copies older than',
    CLEAR_AGES.map(([title, ms]) => ({
      title,
      run: async () => {
        const now = Date.now();
        const r = await recorder.store.dropWhere((v) => ms === null || now - v.time > ms);
        notify(r.errors.length ? { kind: 'refused', text: `Some copies could not be cleared · ${messageOf(r.errors[0])}` } : { kind: 'done', text: r.dropped ? `${copiesWords(r.dropped)} cleared · copies kept for good stay` : 'Nothing to clear', fades: true });
        again(ctx);
      },
    })),
  );
}

async function setCopies(ctx: Ctx, n: number): Promise<void> {
  try {
    if (n === VERSIONS_PER_FILE) await resetReaderKey(ctx.handle.shell, 'version_copies');
    else await writeReaderKey(ctx.handle.shell, 'version_copies', `"${n}"`);
    ctx.st.copies = n;
    notify({ kind: 'done', text: `${n} copies of each file are kept from the next save · config.toml says it`, fades: true });
  } catch (e) {
    notify({ kind: 'error', text: `config.toml could not be written · ${messageOf(e)} · nothing was changed` });
  }
  ctx.redraw();
}

function render(ctx: Ctx, body: HTMLElement): void {
  wire(ctx);
  const { st, handle } = ctx;
  const doc = ctx.doc();
  const pane = ctx.pane();
  // A file a viewer shows as bytes has no store: its path is the pane's, and its copies are listed all the same.
  const shown = doc?.path ?? pane?.path() ?? null;
  const path = shown !== null && !shown.startsWith('marxy:') ? shown : null;
  if (path === null) {
    body.append(empty(handle.panes().focused.path() === null ? 'Nothing is open. Open a file to see its earlier copies.' : 'Versions belong to a file, and this page is not one. Open a file to see its earlier copies.'));
    return;
  }
  const store = doc?.store ?? null;
  const bytesOnly = store === null || (!!pane && pane.content.viewer()?.kind === 'card' && pane.content.viewer()!.owns(pane.view.mode));
  const recorder = versionRecorder();

  // ---- Now
  body.append(sec('Now', `not written until ${chordText('Mod+S')}`, true));
  const snap = store?.snapshot() ?? null;
  const c = snap?.dirty ? changesSummary(path) : null;
  if (store && snap?.dirty) {
    const read = (): void => void openChangesPage(handle, store);
    const save = (): void => void saveOrReadChanges();
    const discard = (): void => void discardAll(store);
    const places = c ? `${c.places} ${c.places === 1 ? 'place' : 'places'} not yet saved` : 'Not yet saved';
    body.append(
      row({ k: 'now', tw: '●', nm: h('b', '', places), ...(c ? { as: `+${c.added} −${c.removed}` } : {}), what: places, go: 'read the patch', run: read, verbs: (): Verb[] => [['o', 'read the patch', read], ['s', 'save', save], ['x', 'discard', discard]] }),
      btns({ label: 'Read the patch', run: read }, { label: 'Save', pri: true, run: save }, snap.disk !== null ? { label: 'Discard', run: discard } : null),
    );
  } else body.append(row({ tw: '', nm: 'Nothing unsaved.', cls: 'dim' }));
  // Files a replace staged changes in that no pane shows (left/held.ts): named here, as the tab row and the quit name them.
  for (const s of unseenHeld(handle).filter((x) => x.snapshot().path !== path)) {
    const p = s.snapshot().path;
    const open = (): void => void handle.open(p);
    const readIt = (): void => void openChangesPage(handle, s);
    body.append(
      row({
        k: `held:${p}`,
        tw: '●',
        nm: basename(p),
        small: 'also not saved, in no pane',
        title: p,
        what: basename(p),
        go: 'open it',
        run: open,
        verbs: (): Verb[] => [['o', 'open it', open], ['R', 'read the patch', readIt], ['s', 'save', () => void saveHeld(s)], ['x', 'discard', () => void discardAll(s)]],
      }),
    );
  }

  // ---- Earlier copies
  body.append(sec('Earlier copies', 'never made on open'));
  if (isUntitled(path)) body.append(row({ tw: '', nm: 'This document is not a file yet, so no copies are kept of it.', cls: 'dim' }));
  else if (!recorder) body.append(row({ tw: '', nm: 'Marxy has nowhere to keep copies here: there is no data folder.', cls: 'dim' }));
  else {
    const key = `${path}#${st.gen}#${snap?.disk?.length ?? 0}`;
    if (st.list?.key !== key) load(ctx, path, key);
    const list = st.list && st.list.key.startsWith(`${path}#`) ? st.list : null;
    if (list) {
      if (list.no) body.append(row({ tw: '', nm: notKeptWords(list.no), cls: 'dim' }));
      const failure = recorder.failure(path);
      if (failure) body.append(row({ tw: '', nm: failureWords(failure), cls: 'dim' }));
      if (list.listing.kind === 'ok') {
        const now = Date.now();
        for (const v of list.listing.versions) body.append(copyRow(ctx, store, path, v, now, bytesOnly));
      } else if (list.listing.kind === 'none') {
        const none = 'None yet. A copy is made before a save or before a replacement from outside; never by opening a file.';
        body.append(row({ tw: '', nm: none, cls: 'dim', title: none }));
      } else body.append(row({ tw: '', nm: listingNote(list.listing) ?? '', cls: 'dim' }));
    } else body.append(row({ tw: '', nm: 'Reading the copies kept…', cls: 'dim' }));
  }

  // ---- Backup
  loadAll(ctx);
  const copies = st.copies ?? VERSIONS_PER_FILE;
  const cycle = (): void => void setCopies(ctx, [5, 20, 100][([5, 20, 100].indexOf(copies) + 1) % 3]!);
  const where = st.data ?? "Marxy's data folder";
  const copyWhere = (): void => void writeCopy(buildAppContext(handle), { text: where }, 'Copied where the copies are kept');
  const exportZip = (): void => void exportAll(handle);
  const clear = (e?: Event): void => clearOlder(ctx, (e?.currentTarget instanceof Element ? e.currentTarget : null) ?? body.querySelector('[data-marxy-left-row="b:all"]') ?? body);
  body.append(
    sec('Backup', ''),
    row({ k: 'b:copies', nm: 'Copies kept for each file', post: sg(['5', '20', '100'], String(copies), (v) => void setCopies(ctx, Number(v)), 'Copies kept for each file'), go: 'next', run: cycle }),
    row({ k: 'b:where', nm: 'Kept', pv: 'in Marxy’s data folder', title: where, go: 'copy where', run: copyWhere }),
    kv('In all', st.all ? inAllWords(st.all.files, st.all.bytes) : '…', { k: 'b:all', run: exportZip, go: 'export all as a zip', verbs: (): Verb[] => [['e', 'export all as a zip', exportZip], ['x', 'clear older than…', (e) => clear(e)]] }),
    btns({ label: 'Export all as a zip', run: exportZip }, { label: 'Clear older than…', run: (e) => clear(e) }),
  );
}

function copyRow(ctx: Ctx, store: DocumentStore | null, path: string, v: ListedVersion, now: number, bytesOnly: boolean): HTMLElement {
  const { handle } = ctx;
  const when = whenWords(v.time, now);
  const state = v.bytes === 'missing' ? 'copy missing' : v.bytes === 'changed' ? 'copy changed outside Marxy' : null;
  const compare = async (): Promise<void> => {
    const bytes = await bytesOf(path, v);
    if (!store) {
      notify({ kind: 'refused', text: 'This file is shown as bytes, so there is no text to compare the copy with · open the copy instead' });
      return;
    }
    if (bytes) await showVersionChanges(store.snapshot(), bytes, v.time);
  };
  const open = async (): Promise<void> => {
    const bytes = await bytesOf(path, v);
    // Read as the open file is: a copy of a file in another encoding opens as its text.
    if (bytes) await handle.panes().openScratch(await textOfFileBytes(handle.shell, path, bytes), { label: `${basename(path)}, the copy of ${hourMinute(v.time)}`, beside: true });
  };
  const keep = async (): Promise<void> => {
    await versionRecorder()?.store.setKept(path, v.id, !v.kept);
    again(ctx);
  };
  const del = async (): Promise<void> => {
    if (await versionRecorder()?.store.drop(path, v.id)) notify({ kind: 'done', text: `The copy of ${hourMinute(v.time)} is gone · the file is untouched`, fades: true });
    again(ctx);
  };
  return row({
    k: `c:${v.id}`,
    tw: v.kept ? '◆' : '',
    nm: when,
    small: `· ${sizeWords(v.size)}`,
    ...(state ? { as: state, red: true } : v.kept ? { as: 'kept for good' } : {}),
    lines: [[whyWords(v.reason)]],
    what: when,
    go: 'open',
    run: () => void open(),
    verbs: (): Verb[] => [
      ['~', 'compare', () => void compare()],
      ['Enter', 'restore', () => void restore(ctx, store, path, v, bytesOnly)],
      ['m', v.kept ? 'stop keeping' : 'keep', () => void keep()],
      ['o', 'open', () => void open()],
      ['d', 'delete', () => void del()],
    ],
  });
}

const panel: PanelDef<VersionsState> = {
  id: 'versions',
  name: 'Versions',
  rest: ABOUT,
  init: () => ({ gen: 0, list: null, all: null, copies: null, data: null, reading: new Set() }),
  subject: (ctx) => {
    const path = ctx.doc()?.path;
    return path ? basename(path) : '';
  },
  badge: (ctx) => (ctx.doc()?.store.snapshot().dirty ? { tone: 'accent', say: 'unsaved changes' } : null),
  render,
};

export default panel;
