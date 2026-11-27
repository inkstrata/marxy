// Read as (`R.readings`): the ways a file can be read, in three groups. The reading
// found; "Read it another way", the readings and pages that could apply; the floor, Bytes, always last. Choosing one reads
// the file again that way and keeps the choice where the app keeps it (kinds.json for a kind, readings.json for Bytes, the viewer's own switch for a file read from its bytes). The pane head's menu, `r`, the Metadata panel and the
// Line all ask through `readingsFor` and choose through `readAs`.
import { KINDS, type Kind } from '@marxy/core/src/contracts/kinds.ts';
import { appHandle } from '../commands/app-handle.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { isArchiveEntry } from '../document/entries.ts';
import { notify } from '../notices/index.ts';
import type { PaneViewer } from '../viewers/types.ts';
import { archiveChosen, readsAsArchive, setArchiveChosen } from './archive-choice.ts';
import { bytesChosen, setBytesChosen } from './bytes-choice.ts';
import { markdownPastLines, renderedChosen } from '@marxy/core/src/reading/lines.ts';
import { reopen } from './reopen.ts';
import { showRendered } from './show-rendered.ts';

export type ReadingGroup = 'The reading found' | 'Read it another way' | 'The floor';

export interface ReadingChoice {
  /** '' is the reading found; 'bytes' the floor; a kind's name. */
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly group: ReadingGroup;
  /** The file is read this way now. */
  readonly current: boolean;
}

/** What a page of the app's own is, in words, as a reading is named. */
export const VIEWER_NAMES: Readonly<Record<PaneViewer['kind'], string>> = {
  card: 'No reading',
  image: 'An image',
  archive: 'An archive',
  pdf: 'A PDF',
  sqlite: 'A database',
  sheet: 'A workbook',
  mail: 'A message',
  page: 'A page',
  font: 'A font',
  media: 'A recording',
  office: 'A document',
  book: 'A book',
};

export const KIND_NAMES: Readonly<Record<Kind, string>> = {
  article: 'An article',
  report: 'A report',
  book: 'A book',
  readme: 'A readme',
  docs: 'Documentation',
  code: 'Code',
  transcript: 'A transcript',
  data: 'Data',
  notes: 'Notes',
  changelog: 'A changelog',
  log: 'A log',
  terminal: 'A terminal session',
  diff: 'A patch',
  html: 'HTML',
};

type Handle = NonNullable<ReturnType<typeof appHandle>>;
type Pane = ReturnType<Handle['panes']>['focused'];

function paneFor(handle: Handle, path: string): Pane | null {
  const { focused, panes } = handle.panes();
  return focused.path() === path ? focused : (panes.find((p) => p.path() === path) ?? null);
}

const FLOOR: Omit<ReadingChoice, 'current'> = { id: 'bytes', label: 'Bytes', note: 'always there', group: 'The floor' };

/** Every way `path` can be read, as the pane showing it reads it now. Empty when no pane shows it. */
export function readingsFor(path: string): ReadingChoice[] {
  const handle = appHandle();
  const pane = handle ? paneFor(handle, path) : null;
  if (!pane) return [];
  const viewer = pane.view.viewer();
  const chosenBytes = bytesChosen(path);
  // A book is found as one, and can be read as the archive it is packed in, whatever its page is now (a locked book's card).
  if (readsAsArchive(path)) {
    const floorOn = !chosenBytes && viewer?.floor?.on() === true;
    const asArchive = archiveChosen(path) && !chosenBytes;
    return [
      { id: '', label: `As found: ${VIEWER_NAMES.book}`, note: viewer?.kind === 'book' ? (viewer.headSay()?.text ?? '') : '', group: 'The reading found', current: !asArchive && !floorOn && !chosenBytes },
      { id: 'archive', label: VIEWER_NAMES.archive, note: 'its parts as packed', group: 'Read it another way', current: asArchive && !floorOn },
      { ...FLOOR, current: floorOn || chosenBytes },
    ];
  }
  if (viewer && !chosenBytes && viewer.kind === 'card') {
    return [{ ...FLOOR, label: 'Bytes', note: 'no reading found', group: 'The reading found', current: true }];
  }
  const out: ReadingChoice[] = [];
  if (viewer && viewer.binary && !chosenBytes) {
    const floorOn = viewer.floor?.on() === true;
    out.push({ id: '', label: `As found: ${VIEWER_NAMES[viewer.kind]}`, note: viewer.headSay()?.text ?? '', group: 'The reading found', current: !floorOn });
    out.push({ ...FLOOR, current: floorOn });
    return out;
  }
  const detected = pane.content.detected();
  const chose = detected?.reasons.find((r) => r.decisive)?.tier === 1;
  const found = viewer && !chosenBytes ? VIEWER_NAMES[viewer.kind] : detected ? KIND_NAMES[detected.kind] : 'Text';
  // A text file whose type has a page of the app's own (an SVG, a message) is read by it whatever kind is kept.
  const ownPage = !!viewer && !chosenBytes && viewer.kind !== 'page';
  // Markdown past the lines tier is found as lines; its page is drawn when asked for.
  const bytes = pane.content.store?.()?.snapshot().buffer.bytes;
  const onRequest = !chosenBytes && !!bytes && markdownPastLines(path, bytes);
  const rendered = onRequest && renderedChosen(path);
  out.push({ id: '', label: `As found: ${found}`, note: chose && !ownPage ? 'puts your choice back' : onRequest ? 'as lines, by its size' : (detected?.reasons.find((r) => r.decisive)?.signal ?? ''), group: 'The reading found', current: !chosenBytes && !rendered && (ownPage || !chose) });
  if (onRequest) out.push({ id: 'rendered', label: 'Rendered', note: 'the whole page, slow at this size', group: 'Read it another way', current: rendered });
  // A kind of the reader's choosing reads the text by other rules; a file from inside another is only read, and keeps none.
  if (!isArchiveEntry(path) && !ownPage) {
    for (const kind of KINDS) {
      if (!chose && kind === detected?.kind) continue;
      out.push({ id: kind, label: KIND_NAMES[kind], note: '', group: 'Read it another way', current: !chosenBytes && chose && detected?.kind === kind });
    }
  }
  out.push({ ...FLOOR, current: chosenBytes });
  return out;
}

function runCommand(handle: Handle, id: string, ctx: AppContext): Promise<void> | void {
  const cmd = (handle.commands() as readonly Command[]).find((c) => c.id === id);
  return cmd?.run(ctx);
}

/** A kind's Show as, which acts on the focused pane's file: for another pane's file it would keep the kind for the wrong one. */
function showAsKind(handle: Handle, path: string, id: string, ctx: AppContext): Promise<void> | void {
  if (handle.currentPath() !== path) {
    notify({ kind: 'refused', text: `Focus the pane showing ${path.split('/').pop()} to read it as another kind.` });
    return;
  }
  return runCommand(handle, id, ctx);
}

/** Reads `path` as `id` (one of `readingsFor`'s), in every pane that shows it; `ctx` runs a kind's Show as. */
export async function readAs(path: string, id: string, ctx: AppContext): Promise<void> {
  const handle = appHandle();
  const pane = handle ? paneFor(handle, path) : null;
  if (!handle || !pane) return;
  const viewer = pane.view.viewer();
  const detected = pane.content.detected();
  const chose = detected?.reasons.find((r) => r.decisive)?.tier === 1;
  if (readsAsArchive(path) && (id === 'archive' || (id === '' && (archiveChosen(path) || bytesChosen(path))))) {
    setArchiveChosen(path, id === 'archive');
    setBytesChosen(path, false);
    return reopen(handle, path);
  }
  if (id === 'rendered' || (id === '' && renderedChosen(path) && !bytesChosen(path))) return showRendered(path, id === 'rendered');
  if (id === 'bytes') {
    if (viewer?.binary && viewer.floor && !bytesChosen(path)) return viewer.floor.set(true);
    if (isArchiveEntry(path)) {
      notify({ kind: 'refused', text: 'A file from inside another is read as it was found: save it to read it as its bytes.' });
      return;
    }
    setBytesChosen(path, true);
    return reopen(handle, path);
  }
  if (bytesChosen(path)) {
    setBytesChosen(path, false);
    if (id === '') return reopen(handle, path);
    if ((KINDS as readonly string[]).includes(id)) {
      // Show as can refuse before it reopens (a newer kinds.json, a failed write): the pane still shows the bytes, so they stay chosen.
      const before = pane.view.viewer();
      await showAsKind(handle, path, `kind.show-as.${id}`, ctx);
      if (pane.view.viewer() === before) setBytesChosen(path, true);
      return;
    }
  }
  if (id === '') {
    if (viewer?.binary && viewer.floor?.on()) return viewer.floor.set(false);
    if (chose) return showAsKind(handle, path, 'kind.show-as.detected', ctx);
    return reopen(handle, path);
  }
  if ((KINDS as readonly string[]).includes(id)) {
    return showAsKind(handle, path, `kind.show-as.${id}`, ctx);
  }
}
