// frame.json: how the reader last left the window's frame (rail, drawer, panel, sets). Marxy's own state, beside
// layout.json, with the same envelope, version guard and quarantine: corrupt bytes are kept beside the file and it
// starts again empty; a newer version is read and never overwritten. It holds where things were put, never what
// was read.

import { normalizePath } from '../index-model/paths.ts';
import { isNotFound, quarantinePathFor } from '../position/storage.ts';
import type { LayoutPersistenceIo } from './persistence.ts';

export const FRAME_FILE_VERSION = 1;
export const FRAME_FILE_NAME = 'frame.json';

/** The rail of branches: read from an old frame.json only, each mapped to the panel that took its place. */
export const BRANCHES = ['library', 'find', 'clip', 'transform', 'look', 'versions', 'settings'] as const;
export type BranchId = (typeof BRANCHES)[number];

/** The left section's eight panels, in the rail's order. */
export const LEFT_PANELS = ['places', 'metadata', 'outline', 'links', 'search', 'transforms', 'export', 'versions'] as const;
export type LeftPanelId = (typeof LEFT_PANELS)[number];

/** Open: the rail and the drawer; rail: the rail alone; hidden: neither. */
export const LEFT_MODES = ['open', 'rail', 'hidden'] as const;
export type LeftMode = (typeof LEFT_MODES)[number];

const PANEL_OF_BRANCH: Readonly<Record<BranchId, LeftPanelId>> = {
  library: 'places',
  find: 'search',
  clip: 'places',
  transform: 'transforms',
  look: 'places',
  versions: 'versions',
  settings: 'places',
};

/** The panel's standing cards, in the order they are drawn. */
export const CARDS = ['reading', 'contents', 'section', 'notes', 'links', 'frontmatter', 'facts'] as const;
export type CardId = (typeof CARDS)[number];

// The groups of kinds a viewer's cards and the panels' sections are drawn for.
// `image`, `bytes` and `archive` are the pages of the app's own: the image page, the file card with the
// bytes, and an archive's tree. `notebook` is a notebook's reading: its fourth card Cells, its metadata slot Notebook.
// `pdf` is a PDF's pages: its fourth card Pages, its metadata slot Document. `font` is a font's specimen (Font, Names);
// `media` audio and video (Media, Tags).
// `database` and `sheet` are the table page's: its fourth card Tables or Sheets, its metadata slot Database or
// Workbook.
// `mail` is a message's page (Message, Links, Headers); `page` an HTML file read as a page in the sandbox.
export const CARD_GROUPS = ['prose', 'code', 'data', 'log', 'session', 'patch', 'conversation', 'image', 'bytes', 'notebook', 'archive', 'pdf', 'database', 'sheet', 'mail', 'page', 'font', 'media'] as const;
export type CardGroup = (typeof CARD_GROUPS)[number];

export interface FrameState {
  readonly folded: boolean;
  /** The panel the left section shows (or would, in the rail alone). */
  readonly leftPanel: LeftPanelId;
  readonly leftMode: LeftMode;
  /** Named sets of open tabs (the Sets proposal): the window's row in order, and what each pane showed. */
  readonly sets: readonly TabSet[];
  /** The Library's places in the order the reader set (their roots); a place not named keeps the index's order after them. */
  readonly placeOrder: readonly string[];
}

export interface TabSet {
  readonly name: string;
  /** The window's one row of tabs, left to right. */
  readonly tabs: readonly string[];
  /** What each pane showed, left to right: one path, or two with a split. */
  readonly shown: readonly string[];
}

/** The most sets kept, and the most paths one holds (the window's tab cap). */
export const MAX_SETS = 40;
const MAX_SET_PATHS = 48;

// Normalised: a set kept before the shell spelled Windows paths with slashes holds backslashes.
const pathList = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x !== '').map(normalizePath) : []);

/**
 * A set as kept before the window had one row (each pane's own tabs, `panes`): the rows merged in order, each path
 * once, and each pane showing its last tab, which is where opening the set used to leave it.
 */
function setRow(s: Record<string, unknown>): { tabs: string[]; shown: string[] } {
  if (Array.isArray(s.tabs)) {
    const tabs = [...new Set(pathList(s.tabs))].slice(0, MAX_SET_PATHS);
    const shown = pathList(s.shown).filter((p) => tabs.includes(p)).slice(0, 2);
    return { tabs, shown: shown.length > 0 || tabs.length === 0 ? shown : [tabs[0]!] };
  }
  const panes = Array.isArray(s.panes) ? s.panes.slice(0, 2).map(pathList).filter((p) => p.length > 0) : [];
  const tabs: string[] = [];
  for (const p of panes) for (const path of p) if (!tabs.includes(path)) tabs.push(path);
  return { tabs: tabs.slice(0, MAX_SET_PATHS), shown: panes.map((p) => p[p.length - 1]!) };
}

/**
 * The most frame.json holds, and so how much of it is read: the sets at their caps take about 190 KB with ordinary
 * paths, and the shells' head read stops at 256 KB. A frame that would be larger (paths far longer than most) loses its
 * oldest sets as it is written, as a set past MAX_SETS does, so what is written is always read back.
 */
export const FRAME_MAX_BYTES = 255 * 1024;

function cleanSets(raw: unknown): TabSet[] {
  if (!Array.isArray(raw)) return [];
  const out: TabSet[] = [];
  for (const s of raw) {
    if (!isObject(s) || typeof s.name !== 'string' || s.name.trim() === '') continue;
    const { tabs, shown } = setRow(s);
    if (tabs.length > 0 && !out.some((o) => o.name === s.name)) out.push({ name: s.name.trim().slice(0, 80), tabs, shown });
    if (out.length >= MAX_SETS) break;
  }
  return out;
}

export const DEFAULT_FRAME: FrameState = {
  folded: false,
  leftPanel: 'places',
  leftMode: 'open',
  sets: [],
  placeOrder: [],
};

const MAX_PLACES = 200;

function cleanPlaceOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, MAX_PLACES);
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : undefined;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function cleanFrameState(raw: unknown): FrameState {
  if (!isObject(raw)) return DEFAULT_FRAME;
  // A frame kept names a branch (or none, the drawer shut): its panel, and the rail alone when shut.
  const branch = oneOf(BRANCHES, raw.branch) ?? oneOf(BRANCHES, raw.lastBranch);
  const oldMode: LeftMode | undefined = 'branch' in raw && !('leftMode' in raw) ? (raw.branch === null ? 'rail' : 'open') : undefined;
  return {
    folded: typeof raw.folded === 'boolean' ? raw.folded : DEFAULT_FRAME.folded,
    leftPanel: oneOf(LEFT_PANELS, raw.leftPanel) ?? (branch ? PANEL_OF_BRANCH[branch] : DEFAULT_FRAME.leftPanel),
    leftMode: oneOf(LEFT_MODES, raw.leftMode) ?? oldMode ?? DEFAULT_FRAME.leftMode,
    sets: cleanSets(raw.sets),
    placeOrder: cleanPlaceOrder(raw.placeOrder),
  };
}

export type LoadFrameResult =
  | { readonly kind: 'ok'; readonly version: number; readonly state: FrameState }
  | { readonly kind: 'quarantined'; readonly quarantineBytes: Uint8Array };

export function parseFrameFile(bytes: Uint8Array): LoadFrameResult {
  const bad = (): LoadFrameResult => ({ kind: 'quarantined', quarantineBytes: bytes.slice() });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return bad();
  }
  if (!isObject(parsed) || typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) return bad();
  return { kind: 'ok', version: Math.max(parsed.version, FRAME_FILE_VERSION), state: cleanFrameState(parsed.frame) };
}

export function serializeFrameFile(state: FrameState): Uint8Array {
  const encode = (frame: FrameState): Uint8Array =>
    new TextEncoder().encode(`${JSON.stringify({ version: FRAME_FILE_VERSION, frame }, null, 2)}\n`);
  let frame = cleanFrameState(state);
  let bytes = encode(frame);
  while (bytes.length > FRAME_MAX_BYTES && (frame.sets.length > 0 || frame.placeOrder.length > 0)) {
    frame = frame.sets.length > 0 ? { ...frame, sets: frame.sets.slice(0, -1) } : { ...frame, placeOrder: frame.placeOrder.slice(0, -1) };
    bytes = encode(frame);
  }
  return bytes;
}

/** frame.json's lifecycle: read once at launch, written (debounced by the caller) whenever the frame changes. */
export class FramePersistence {
  private readonly io: LayoutPersistenceIo;
  private readonly filePath: string;
  private current: FrameState;
  /** Written by a newer Marxy, or there but not readable: never written this session. */
  readonly readOnly: boolean;
  /** The file was found corrupt and set aside. */
  readonly quarantined: boolean;
  /** There was no file: no frame has been kept, so none is the reader's yet. */
  readonly fresh: boolean;

  private constructor(io: LayoutPersistenceIo, filePath: string, current: FrameState, readOnly: boolean, quarantined: boolean, fresh = false) {
    this.io = io;
    this.filePath = filePath;
    this.current = current;
    this.readOnly = readOnly;
    this.quarantined = quarantined;
    this.fresh = fresh;
  }

  static async open(io: LayoutPersistenceIo): Promise<FramePersistence> {
    const filePath = `${(await io.dataDirectory()).replace(/\/$/, '')}/${FRAME_FILE_NAME}`;
    let bytes: Uint8Array;
    try {
      bytes = io.readHead ? await io.readHead(filePath, FRAME_MAX_BYTES + 1) : await io.readFile(filePath);
    } catch (e) {
      // Only a missing file starts empty: one that is there and could not be read is the reader's still.
      return new FramePersistence(io, filePath, DEFAULT_FRAME, !isNotFound(e), false, isNotFound(e));
    }
    const loaded = bytes.length > FRAME_MAX_BYTES ? null : parseFrameFile(bytes);
    if (loaded === null || loaded.kind === 'quarantined') {
      await io.writeFileAtomic(quarantinePathFor(filePath), bytes.slice(0, FRAME_MAX_BYTES));
      await io.writeFileAtomic(filePath, serializeFrameFile(DEFAULT_FRAME));
      return new FramePersistence(io, filePath, DEFAULT_FRAME, false, true);
    }
    return new FramePersistence(io, filePath, loaded.state, loaded.version > FRAME_FILE_VERSION, false);
  }

  saved(): FrameState {
    return this.current;
  }

  async write(state: FrameState): Promise<void> {
    if (this.readOnly) return;
    this.current = cleanFrameState(state);
    await this.io.writeFileAtomic(this.filePath, serializeFrameFile(this.current));
  }
}
