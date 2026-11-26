// The floor: a file with no reading opens as a card of what is known about it, with every byte beside
// it. Read is the card and the hex view; Source is the hex view alone, as for any file that is not text. Finding no
// reading is not a guess, so the head is quiet. The way out: Open in default app, Show in folder, Copy path.
import { firstBytes } from '@marxy/core/src/viewer/bytes.ts';
import { basename, dirname } from '@marxy/core/src/index-model/paths.ts';
import { sizeWords } from '@marxy/core/src/viewer/bytes.ts';
import type { ImageFacts } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { appHandle } from '../commands/app-handle.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { el, factRow } from '../frame/dom.ts';
import { notify } from '../notices/index.ts';
import { buildAppContext } from '../selection/bind.ts';
import { entryLine, heldEntry, isArchiveEntry } from '../document/entries.ts';
import { byteCard, factsCard, readingCard } from './cards.ts';
import { dateWords, encodingWords, isProgramFile, kindWords, sizeLine, whyLines, type ViewedFile } from './file.ts';
import { asItIs } from './exports.ts';
import { nextViewerId } from './signal.ts';
import { createHexView, type HexView } from './hex.ts';
import type { PaneViewer, ViewerPlace, ViewMode } from './types.ts';

/** One thing a file says of itself, as the card shows it; times and sizes are worded by the card. */
export interface AboutRow {
  readonly label: string;
  readonly value: string;
  /** A quieter line under the value. */
  readonly note?: string;
  readonly time?: number;
  readonly size?: number;
}

/** What a file says of itself, read from its bytes and shown above its own facts: a shortcut's target, a program's claims. */
export interface CardAbout {
  /** "A Windows shortcut", "A Windows program". */
  readonly kicker: string;
  readonly rows: readonly AboutRow[];
  /** The line under the actions: what the app does and never does with it. */
  readonly note: string;
  /** What the Reading card says it is shown as. */
  readonly shownAs: string;
  /** No byte of the file is drawn by Read, its why list, its Facts or Metadata (a file that holds a private key); Source still shows the file. */
  readonly hideBytes?: boolean;
  /** No hex beside the card, for a file whose Source is its own text (a PEM). */
  readonly noHex?: boolean;
  /** Why it is shown as it is, in place of what its head says; for a card whose first bytes are not shown. */
  readonly reasons?: readonly string[];
}

/** The card's rows for what a file says, as text that can be selected and copied. */
export function aboutRows(rows: readonly AboutRow[]): HTMLElement[] {
  return rows.map((r) => {
    const value = r.size !== undefined ? sizeWords(r.size) : r.time !== undefined ? dateWords(r.time) : r.value;
    if (!r.note) return factRow(r.label, value);
    const v = el('span');
    v.append(value, el('br'), el('span', 'marxy-fact-quiet', r.note));
    return factRow(r.label, v);
  });
}

export interface CardOptions {
  readonly shell: AppShell;
  readonly file: ViewedFile;
  /** An image this system cannot draw: its facts say what it is and why (`show: "none"`). */
  readonly facts?: ImageFacts | null;
  /** What the kicker says in place of the image card's own, when the system draws the format but not this file. */
  readonly kicker?: string;
  /** What the file says of itself (a shortcut, a program), shown above the file's own facts. */
  readonly about?: CardAbout;
  /** The card is shown in place of a page the reader turned away from: the way back to it. */
  readonly back?: { readonly words: string; run(): void };
  /** Why the page its row names could not be made (an archive the shell does not list), said under the kicker. */
  readonly why?: { readonly kicker: string; readonly line: string };
  /** Where the reader was in the page this one replaces (the file changed on disk). */
  readonly place?: ViewerPlace;
  /** What the kind row says, when the bytes say more than the row does ("probably an encrypted database"). */
  readonly kind?: string;
  /** Why it is shown as it is, in place of what its head and name say. */
  readonly reasons?: readonly string[];
}

/** The card's actions: hand the file to the system, or say plainly that this build cannot. */
export async function handOver(shell: AppShell, path: string, how: 'open' | 'reveal', pane: HTMLElement | undefined): Promise<void> {
  if (!shell.openInSystem) {
    notify({ kind: 'info', text: 'This build cannot hand a file to another program: the desktop app can.' }, { pane });
    return;
  }
  try {
    await shell.openInSystem(path, how);
  } catch (e) {
    notify({ kind: 'error', text: `${basename(path)} could not be ${how === 'open' ? 'opened' : 'shown in its folder'}: ${e instanceof Error ? e.message : String(e)}` }, { pane });
  }
}

/** The card itself, for Read: the file's facts, why it has no reading, its first bytes, and the ways out. */
export function fileCardElement(o: CardOptions, pane: () => HTMLElement | undefined): HTMLElement {
  const { file, shell } = o;
  const facts = o.facts ?? null;
  const card = el('div', 'marxy-fcard');
  const name = basename(file.path);
  const entry = isArchiveEntry(file.path) ? heldEntry(file.path) : null;
  const kicker = facts ? (o.kicker ?? 'An image this system cannot draw') : o.about ? o.about.kicker : (o.why?.kicker ?? 'No reading for this file');
  const where = entry ? `in ${basename(entry.archive)}, held in memory` : `${dirname(file.path)}/`;
  card.append(el('p', 'marxy-fcard-kicker', kicker), el('h1', 'marxy-fcard-name', name), el('p', 'marxy-fcard-where', where));
  const facts_ = el('div', 'marxy-fcard-facts');
  const why = el('span', 'marxy-fcard-why');
  for (const line of o.reasons ?? o.about?.reasons ?? whyLines(file, facts)) why.append(el('span', '', line));
  if (o.why) why.append(el('span', '', o.why.line));
  const head = firstBytes(file.head);
  const first = el('span');
  first.append(el('code', 'marxy-fact-code', head.hex), el('span', 'marxy-fact-quiet', ` “${head.text}”`));
  if (o.about) facts_.append(...aboutRows(o.about.rows));
  facts_.append(
    factRow('size', sizeLine(file)),
    factRow('kind', o.kind ?? kindWords(file, facts)),
    factRow('why', why),
    factRow('encoding', o.about?.noHex ? 'text: its own lines are Source' : encodingWords(file)),
    ...(o.about?.hideBytes ? [] : [factRow('first bytes', first)]),
    factRow('modified', dateWords(file.mtimeMs)),
    ...(file.createdMs ? [factRow('created', dateWords(file.createdMs))] : []),
  );
  const acts = el('div', 'marxy-fcard-acts');
  const program = isProgramFile(file);
  const open = el('button', 'marxy-btn', 'Open in default app');
  open.type = 'button';
  open.setAttribute('data-marxy-primary', '');
  open.title = program ? 'A program: Marxy does not start programs. Show it in its folder instead.' : 'Opens it in the program the system uses for this kind of file';
  open.disabled = program;
  open.addEventListener('click', () => void handOver(shell, file.path, 'open', pane()));
  const reveal = el('button', 'marxy-btn', 'Show in folder');
  reveal.type = 'button';
  reveal.addEventListener('click', () => void handOver(shell, file.path, 'reveal', pane()));
  const copy = el('button', 'marxy-btn', 'Copy path');
  copy.type = 'button';
  copy.addEventListener('click', () => {
    const handle = appHandle();
    if (handle) void writeCopy(buildAppContext(handle), { text: file.path }, 'Copied the path');
  });
  acts.append(open, reveal, copy);
  // An entry has no place on disk to hand over or show: the line says what it is instead.
  if (entry) {
    card.append(facts_, el('p', 'marxy-fcard-note', entryLine(entry)));
    return card;
  }
  const note =
    o.about
      ? o.about.note
      : facts?.format === 'heic'
        ? 'The app reads it and changes nothing. macOS draws HEIC itself, and Windows does with its HEIF and HEVC extensions; elsewhere this card is the floor.'
        : 'The app reads it and changes nothing. The bytes are beside it, every one, as they are on disk.';
  card.append(facts_, acts, el('p', 'marxy-fcard-note', note));
  if (o.back) {
    const p = el('p', 'marxy-fcard-note');
    const b = el('button', 'marxy-linkish', o.back.words);
    b.type = 'button';
    b.addEventListener('click', () => o.back?.run());
    p.append(b);
    card.append(p);
  }
  return card;
}

export function createCardViewer(o: CardOptions): PaneViewer {
  const { file, shell } = o;
  const facts = o.facts ?? null;
  let hex: HexView | null = null;
  let host: HTMLElement | null = null;
  let page: HTMLElement | null = null;
  let mode: ViewMode = 'rendered';
  const id = nextViewerId();
  const pane = (): HTMLElement | undefined => host?.closest<HTMLElement>('section.marxy-pane') ?? undefined;
  const ensureHex = (): HexView => (hex ??= createHexView(file, (offset, length) => shell.readRange(file.path, offset, length)));
  if (o.place?.hex) ensureHex().restore(o.place.hex);

  function draw(): void {
    if (!host) return;
    const view = ensureHex();
    if (mode === 'source') {
      page = el('div', 'marxy-hexpage');
      page.append(view.el);
    } else {
      page = el('div', 'marxy-fcpage');
      if (o.about?.hideBytes || o.about?.noHex) page.append(fileCardElement(o, pane));
      else {
        const side = el('div', 'marxy-fchex');
        side.append(view.el);
        page.append(fileCardElement(o, pane), side);
      }
    }
    host.replaceChildren(page);
    requestAnimationFrame(() => view.draw());
  }

  const reading = readingCard({
    file,
    facts: () => facts,
    shownAs: () => (o.about ? o.about.shownAs : facts ? 'a file card and the bytes' : 'no reading · a file card and the bytes'),
    other: () => o.back ?? null,
    reasons: o.reasons ?? o.about?.reasons ? () => (o.reasons ?? o.about?.reasons)! : undefined,
  });
  const byte = byteCard({ file, selected: () => hex?.selected() ?? null, bytesAt: (at, n) => hex?.bytesAt(at, n) ?? null });

  return {
    path: file.path,
    kind: 'card',
    group: 'bytes',
    binary: true,
    bytesHidden: !!o.about?.hideBytes,
    owns: () => true,
    show(m, into) {
      mode = m;
      host = into;
      into.setAttribute('data-marxy-viewer', 'card');
      draw();
    },
    hide() {
      host = null;
    },
    cards: () => ({ reading, facts: factsCard(file, !!o.about?.hideBytes) }),
    passing: () => [byte],
    headSay: () => null,
    key(e) {
      return o.about?.hideBytes && mode === 'rendered' ? false : (hex?.key(e) ?? false);
    },
    panelKey: () => `${id}:${mode}:${hex?.selected() ?? ''}`,
    place: () => ({ hex: hex?.place() }),
    land(at) {
      ensureHex().restore({ selected: at, top: null });
      return mode;
    },
    exports: () => [asItIs(shell, file, 'file')],
    parts: (m) => (o.about?.hideBytes && m === 'rendered' ? null : ensureHex().parts()),
    destroy() {
      hex?.destroy();
      hex = null;
      page?.remove();
      host = null;
    },
  };
}
