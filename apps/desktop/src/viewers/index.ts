// Which page of the app's own a file gets (the registry's `viewer`), made from what the shell says of it. Loaded only when
// such a file opens: nothing here is on the road to a document's first text.
import { fileTypeFor, type ContentSignals } from '@marxy/core/src/kind/registry.ts';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { encryptedWhy } from '@marxy/core/src/viewer/tables.ts';
import { imageFactsFromBytes } from '@marxy/core/src/viewer/image-facts.ts';
import type { ImageFacts } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { appHandle } from '../commands/app-handle.ts';
import { heldEntry, isArchiveEntry } from '../document/entries.ts';
import { entryShell, nestedReader } from './archive-entries.ts';
import { createCardViewer } from './card.ts';
import { bytesChosen } from '../read-as/bytes-choice.ts';
import { gatherFile, type ViewedFile } from './file.ts';
import { databaseOf } from './table-cards.ts';
import { intend } from '../frame/intent.ts';
import { createImageViewer, folderSteps } from './image.ts';
import { archiveChosen } from '../read-as/archive-choice.ts';
import type { PaneViewer, ViewerMemory, ViewerPlace } from './types.ts';

export type { PaneViewer, ViewerMemory, ViewerPlace } from './types.ts';

export interface ViewerInputs {
  readonly shell: AppShell;
  readonly path: string;
  /** What the head said, or null where the shell has no detection. */
  readonly signals: ContentSignals | null;
  readonly paneHost: HTMLElement;
  /** A text file's bytes, live (an SVG's store): its viewer draws Read from them, and Source stays the text views'. */
  readonly text?: () => Uint8Array;
  /** Where the reader was in the page this one replaces: the file changed on disk, and the page shows it as it is now. */
  readonly place?: ViewerPlace;
  /** Drawn inside another page (an archive's preview, `embed.ts`): no pane of its own, and a part that opens calls `open`. */
  readonly embed?: { open(): void };
  /** Where the page keeps the reader's place across launches, for a page that keeps one (a book's). */
  readonly remember?: ViewerMemory;
}

/** A SQLite database's write-ahead log or its index, by the name SQLite gives them beside it. */
const DB_LOG = /\.(sqlite3?|db3?)-(wal|shm)$/i;

export async function createViewer(o: ViewerInputs): Promise<PaneViewer> {
  const { path } = o;
  // An archive's entry is held in memory: its viewer reads it from there, and nothing of it names a place on disk.
  const entry = isArchiveEntry(path);
  // An archive's entry is read by the shell's own readers from the archive; a message's attachment or a database's
  // cell is not.
  const attachment = entry && heldEntry(path)?.of !== 'archive';
  const shell = entry ? entryShell(o.shell) : o.shell;
  const file = await gatherFile(shell, path, o.signals, o.text?.());
  const type = fileTypeFor(path);
  // A book read as the archive it is packed in (Read as) is the archive's page.
  const asArchive = type.viewer === 'book' && archiveChosen(path);
  const viewer = asArchive ? 'archive' : type.viewer;
  if (bytesChosen(path)) return createCardViewer({ shell, file, place: o.place, why: { kicker: 'Bytes, your choice', line: 'You chose to read it as its bytes: r reads it another way.' } });
  // Two levels down, the shell's readers have no archive on disk to read from: the card says so.
  const nested = entry && !attachment ? heldEntry(path) : null;
  if (nested && isArchiveEntry(nested.archive) && (viewer === 'sqlite' || viewer === 'sheet' || viewer === 'font' || viewer === 'media')) {
    return createCardViewer({ shell, file, place: o.place, why: { kicker: 'Inside an archive inside an archive', line: nestedReader(nested) } });
  }
  if (viewer === 'sqlite') {
    // Found by its header, never by its name alone: a .db that is not SQLite is the card, and says why when it seems encrypted.
    const isSqlite = new TextDecoder().decode(file.head.subarray(0, 16)) === 'SQLite format 3\0';
    if (!isSqlite) {
      const why = encryptedWhy(basename(path), file.head);
      return createCardViewer({ shell, file, place: o.place, kind: why ? 'probably an encrypted database' : undefined, reasons: why ?? undefined });
    }
    if (attachment) return createCardViewer({ shell, file, place: o.place, why: { kicker: 'A database held in memory', line: 'A database held in memory is not read here: save it and open it from disk.' } });
    const { createSqliteViewer, openSqliteFor } = await import('./sqlite.ts');
    const setup = await openSqliteFor(shell, path);
    if ('db' in setup) return createSqliteViewer({ shell, file, summary: setup.db, paneHost: o.paneHost, place: o.place });
    return createCardViewer({ shell, file, place: o.place, why: setup });
  }
  if (viewer === 'sheet') {
    if (attachment) return createCardViewer({ shell, file, place: o.place, why: { kicker: 'A workbook held in memory', line: 'A workbook held in memory is not read here: save it and open it from disk.' } });
    const { createSheetViewer, openSheetFor } = await import('./sheet.ts');
    const setup = await openSheetFor(shell, path);
    if ('book' in setup) return createSheetViewer({ shell, file, book: setup.book, place: o.place });
    return createCardViewer({ shell, file, place: o.place, why: setup });
  }
  // An RTF file is text: its page is drawn from the store's bytes, wherever they came from.
  if (viewer === 'office' && o.text && /\.rtf$/i.test(path)) {
    const { createOfficeViewer, openRtfFrom } = await import('./office.ts');
    const setup = await openRtfFrom(o.text, path);
    if ('reading' in setup) return createOfficeViewer({ shell, file, setup, text: o.text, paneHost: o.embed ? undefined : o.paneHost, place: o.place });
    return createCardViewer({ shell, file, place: o.place, why: setup });
  }
  if (viewer === 'office') {
    if (attachment) return createCardViewer({ shell, file, place: o.place, why: { kicker: 'A document held in memory', line: 'A document held from a message or a database cell is not read here: save it and open it from disk.' } });
    const { createOfficeViewer, openOfficeFor } = await import('./office.ts');
    const setup = await openOfficeFor(shell, path, file.size);
    if ('reading' in setup) return createOfficeViewer({ shell, file, setup, paneHost: o.embed ? undefined : o.paneHost, place: o.place });
    return createCardViewer({ shell, file, place: o.place, why: setup });
  }
  let said: string | undefined;
  if (viewer === 'book') {
    if (attachment) return createCardViewer({ shell, file, place: o.place, why: { kicker: 'A book held in memory', line: 'A book held from a message or a database cell is not read here: save it and open it from disk.' } });
    const { createBookViewer, openBookFor } = await import('./book.ts');
    const setup = await openBookFor(shell, path);
    if ('book' in setup) return createBookViewer({ shell, file, setup, paneHost: o.embed ? undefined : o.paneHost, place: o.place, remember: o.remember });
    if ('locked' in setup) return createCardViewer({ shell, file, place: o.place, kind: 'a locked book', why: { kicker: 'A locked book', line: `${setup.locked} Read as lists what it holds as an archive.` } });
    if (!('fallback' in setup)) return createCardViewer({ shell, file, place: o.place, why: setup });
    // Not a book the app can read as one: the archive it is packed in, with the sentence why.
    said = `It is not read as a book: ${setup.fallback}`;
  }
  if (!entry && type.kind === 'binary' && DB_LOG.test(path)) return databaseLogCard(o, shell, file);
  // A message and an HTML file are text: their page is drawn from the store's bytes.
  if (viewer === 'mail' && o.text) {
    const { createMailViewer } = await import('./mail.ts');
    return createMailViewer({ shell, file, text: o.text, paneHost: o.embed ? undefined : o.paneHost, open: o.embed && (() => o.embed!.open()) });
  }
  // An Outlook message is bytes: the shell reads them into the message the mail page draws.
  if (viewer === 'mail' && type.kind === 'binary') {
    const { createOutlookViewer, openOutlookFor } = await import('./outlook.ts');
    const setup = await openOutlookFor(shell, file);
    if ('mime' in setup) return createOutlookViewer({ shell, file, mail: setup, paneHost: o.embed ? undefined : o.paneHost, open: o.embed && (() => o.embed!.open()), place: o.place });
    return createCardViewer({ shell, file, place: o.place, why: setup });
  }
  if (viewer === 'html' && o.text) {
    const { createPageViewer } = await import('./html-page.ts');
    return createPageViewer({ shell, file, text: o.text, paneHost: o.embed ? undefined : o.paneHost });
  }
  if (viewer === 'archive' || said !== undefined) {
    if (asArchive) said = 'You chose to read this book as the archive it is packed in: r reads it as a book again.';
    // An archive inside an archive is listed from the bytes held, three levels at most, so a nested bomb is never
    // walked: the depth and the 16 MB are the entry shell's to refuse; an attachment or a cell is not listed at all.
    if (attachment) return createCardViewer({ shell, file, place: o.place, why: { kicker: 'An archive held in memory', line: 'An archive held from a message or a database cell is not listed: save it and open it from disk.' } });
    let why = 'Its bytes are not an archive the app can list.';
    const listing = await shell.listArchive(path).catch((e: unknown) => {
      why = e instanceof Error ? e.message : String(e);
      return null;
    });
    if (listing) {
      const { createArchiveViewer } = await import('./archive.ts');
      return createArchiveViewer({ shell, file, listing, paneHost: o.paneHost, place: o.place, embed: o.embed, said });
    }
    return createCardViewer({ shell, file, place: o.place, why: { kicker: entry ? 'An archive inside an archive' : 'An archive the app cannot list', line: why } });
  }
  if (viewer === 'pdf') {
    // pdf.js is loaded here, when a PDF opens, and never on the way to a document's first text.
    const { createPdfViewer, openPdfFor } = await import('./pdf.ts');
    const setup = await openPdfFor(shell, file);
    if ('opened' in setup) return createPdfViewer({ shell, file, setup, embedded: o.embed !== undefined });
    return createCardViewer({ shell, file, place: o.place, why: setup });
  }
  if (viewer === 'font') {
    const { createFontViewer, openFontFor } = await import('./font.ts');
    const setup = await openFontFor(shell, file);
    if ('bytes' in setup) return createFontViewer({ shell, file, setup, paneHost: o.paneHost, place: o.place });
    return createCardViewer({ shell, file, place: o.place, why: setup });
  }
  if (viewer === 'media') {
    const { createMediaViewer, mediaFactsFor, mediaPageFor } = await import('./media.ts');
    const facts = await mediaFactsFor(shell, file);
    if (mediaPageFor(file, facts)) return createMediaViewer({ shell, file, facts, place: o.place });
    return createCardViewer({ shell, file, place: o.place, why: { kicker: 'A recording the app cannot read', line: 'Its container is not one the app reads, and no player here knows its kind.' } });
  }
  if (type.id === 'shortcut') {
    const { openShortcutFor } = await import('./shortcut.ts');
    const setup = await openShortcutFor(shell, file);
    return createCardViewer({ shell, file, place: o.place, ...('about' in setup ? { about: setup.about } : { why: setup }) });
  }
  if (type.id === 'program') {
    const { openProgramFor } = await import('./program.ts');
    const setup = await openProgramFor(shell, file);
    return createCardViewer({ shell, file, place: o.place, ...('about' in setup ? { about: setup.about } : 'why' in setup ? { why: setup.why } : {}) });
  }
  if (type.id === 'certificate') {
    const { openCertFor } = await import('./cert.ts');
    const setup = await openCertFor(shell, file, o.text);
    const about = 'about' in setup ? { about: setup.about } : 'why' in setup ? { why: setup.why } : {};
    const card = createCardViewer({ shell, file, place: o.place, ...about });
    if (!o.text) return card;
    // A PEM is text: Source is its own lines in the editor, and the viewer draws Read only.
    return { ...card, binary: false, owns: (m) => m === 'rendered', passing: () => [], land: undefined, parts: undefined, exports: undefined };
  }
  if (viewer !== 'image') return createCardViewer({ shell, file, place: o.place });
  let facts: ImageFacts | null = await shell.imageFacts(path).catch(() => null);
  // An SVG is text the page already holds: its size is read from it when the shell has not said.
  if (!facts && o.text) facts = await imageFactsFromBytes(o.text());
  // An image this system cannot decode (HEIC on Linux, or on a Windows without the codec) is the file card, which says why. It is still one of
  // the folder's images, so ← and → step on from it, as from the image page.
  if (facts?.show === 'none') {
    const card = createCardViewer({ shell, file, facts, place: o.place });
    if (o.embed) return card;
    const steps = folderSteps(shell, path, o.paneHost);
    steps.load();
    const own = card.key.bind(card);
    card.key = (e, mode) => own(e, mode) || (mode === 'rendered' && steps.key(e));
    return card;
  }
  return createImageViewer({ shell, file, facts, paneHost: o.embed ? undefined : o.paneHost, text: o.text, place: o.place, embedded: o.embed !== undefined });
}

/**
 * A database's write-ahead log or its index, beside it: a file card that names the database it belongs to, with a way to
 * open it. The log is read with its database, never alone; the index holds nothing to read.
 */
async function databaseLogCard(o: ViewerInputs, shell: AppShell, file: ViewedFile): Promise<PaneViewer> {
  const db = databaseOf(o.path);
  const name = db ? basename(db) : 'its database';
  const exists = db ? await shell.stat(db).then((s) => s !== null && !s.isDir, () => false) : false;
  const wal = /-wal$/i.test(o.path);
  const magic = file.head.length >= 4 ? ((file.head[0]! << 24) | (file.head[1]! << 16) | (file.head[2]! << 8) | file.head[3]!) >>> 0 : 0;
  const reasons = wal
    ? [
        magic === 0x377f0682 || magic === 0x377f0683
          ? `Its first bytes, ${[...file.head.subarray(0, 4)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}, are a SQLite write-ahead log's magic number, and its name is ${name} with -wal after it.`
          : `Its name is ${name} with -wal after it: a SQLite write-ahead log, empty or reset.`,
        `It belongs to ${name}${exists ? ' beside it, and is read with it' : ', which is not beside it'}.`,
      ]
    : [`Its name is ${name} with -shm after it: the index SQLite keeps beside a write-ahead log, rebuilt whenever a database opens. It holds nothing to read.`];
  const open = (): void => {
    const handle = appHandle();
    const at = handle?.panes().panes.find((p) => p.host === o.paneHost);
    if (!handle || !at || !db) return;
    intend(o.paneHost, db, 'new');
    void handle.panes().openIn(at.slot, db);
  };
  return createCardViewer({
    shell,
    file,
    place: o.place,
    kind: wal ? 'a SQLite write-ahead log' : 'SQLite’s shared-memory index for a WAL',
    reasons,
    back: exists ? { words: `Open ${name}`, run: open } : undefined,
  });
}
