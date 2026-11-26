// readings.json: how the reader chose to read parts of their files (Read this part another way). Marxy's
// own state beside kinds.json, with frame.json's envelope, version guard and quarantine: corrupt bytes are kept beside the
// file and it starts again empty; a newer version is read and never overwritten. One entry per part chosen, by the file's
// path and the part's key (its first line of content and how many parts before it start the same); a part read as
// guessed has none. It holds choices, never what was read or when. `colour` lists the code files the reader chose to
// colour anyway past the plain-text tier ("Colour it anyway"), written only when there is one; `alone` the
// databases the reader chose to read without their write-ahead log ("Read the file alone"), the same way; `pages` the
// HTML files an earlier Marxy was asked to read as a page (every HTML file is one now, and the app writes none); `source`
// the code files the reader put in Source, which open there again, likewise; `encodings` maps a file to the
// encoding the reader chose to read it in (Read with encoding...), likewise.
//
// Pure: no DOM, no Node built-ins. The shell reads and writes the bytes.

import { normalizePath } from '../index-model/paths.ts';
import type { PositionPersistenceIo } from '../position/persistence.ts';
import { isNotFound, quarantinePathFor } from '../position/storage.ts';
import { PART_WORDS, type PartReading } from './parts.ts';

export const PART_CHOICES_FILE_VERSION = 1;
export const PART_CHOICES_FILE_NAME = 'readings.json';
/** Files kept with a choice. A new file beyond it is not kept (its choice lasts while Marxy is open); none is dropped. */
export const PART_CHOICES_CAP = 5000;

/** path -> part key -> how it is read. */
export type PartChoices = Readonly<Record<string, Readonly<Record<string, PartReading>>>>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isPartReading = (value: unknown): value is PartReading => typeof value === 'string' && Object.hasOwn(PART_WORDS, value);

/** Known readings only, and no file without a choice: anything else is dropped, never an error. */
export function cleanPartChoices(raw: unknown): PartChoices {
  const out: Record<string, Record<string, PartReading>> = {};
  if (!isObject(raw)) return out;
  let files = 0;
  for (const [path, given] of Object.entries(raw)) {
    if (path === '' || !isObject(given)) continue;
    const byKey: Record<string, PartReading> = {};
    for (const [key, reading] of Object.entries(given)) if (isPartReading(reading)) byKey[key] = reading;
    if (Object.keys(byKey).length === 0) continue;
    // Normalised here and in each list: builds before the shell spelled Windows paths with slashes kept backslashes.
    const p = normalizePath(path);
    const had = out[p];
    out[p] = { ...had, ...byKey };
    if (!had && ++files >= PART_CHOICES_CAP) break;
  }
  return out;
}

/** Paths only, no empty one, no repeat, at most the cap; anything else is dropped. */
export function cleanColourChoices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((p): p is string => typeof p === 'string' && p !== '').map(normalizePath))].slice(0, PART_CHOICES_CAP).sort();
}

/** path -> an encoding's label (`macintosh`, `utf-16be`): a short lowercase word, nothing else. */
export type EncodingChoices = Readonly<Record<string, string>>;

/** Labels that look like labels only, no empty path, at most the cap; anything else is dropped. */
export function cleanEncodingChoices(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(raw)) return out;
  let files = 0;
  for (const [path, label] of Object.entries(raw)) {
    if (path === '' || typeof label !== 'string' || !/^[a-z0-9_.:-]{1,40}$/.test(label)) continue;
    const p = normalizePath(path);
    const had = Object.hasOwn(out, p);
    out[p] = label;
    if (!had && ++files >= PART_CHOICES_CAP) break;
  }
  return out;
}

/** The choices kept beside the parts' readings; each is written only when it holds one. */
export interface ChoiceLists {
  readonly colour: readonly string[];
  readonly alone: readonly string[];
  readonly pages: readonly string[];
  readonly encodings: EncodingChoices;
  /** Files the reader chose to read as their bytes (Read as › Bytes). */
  readonly bytes: readonly string[];
  /** Code files the reader switched to Source: they open there again. */
  readonly source: readonly string[];
}

const NO_LISTS: ChoiceLists = { colour: [], alone: [], pages: [], encodings: {}, bytes: [], source: [] };

function cleanLists(raw: { readonly [K in keyof ChoiceLists]?: unknown }): ChoiceLists {
  return { colour: cleanColourChoices(raw.colour), alone: cleanColourChoices(raw.alone), pages: cleanColourChoices(raw.pages), encodings: cleanEncodingChoices(raw.encodings), bytes: cleanColourChoices(raw.bytes), source: cleanColourChoices(raw.source) };
}

export type LoadPartChoicesResult =
  | ({ readonly kind: 'ok'; readonly version: number; readonly parts: PartChoices } & ChoiceLists)
  | { readonly kind: 'quarantined'; readonly quarantineBytes: Uint8Array };

/** Not UTF-8, not JSON, not an object, or without a numeric version: quarantined. A `parts` that is not an object too. */
export function parsePartChoicesFile(bytes: Uint8Array): LoadPartChoicesResult {
  const bad = (): LoadPartChoicesResult => ({ kind: 'quarantined', quarantineBytes: bytes.slice() });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return bad();
  }
  if (!isObject(parsed) || typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) return bad();
  if (parsed.parts !== undefined && !isObject(parsed.parts)) return bad();
  return { kind: 'ok', version: Math.max(parsed.version, PART_CHOICES_FILE_VERSION), parts: cleanPartChoices(parsed.parts), ...cleanLists(parsed) };
}

/** The bytes of readings.json: a version and path -> key -> reading, each level sorted so one set of choices is one file. */
export function serializePartChoicesFile(parts: PartChoices, lists: Partial<ChoiceLists> = {}): Uint8Array {
  const clean = cleanPartChoices(parts);
  const sorted: Record<string, Record<string, PartReading>> = {};
  for (const path of Object.keys(clean).sort()) {
    const byKey: Record<string, PartReading> = {};
    for (const key of Object.keys(clean[path]!).sort()) byKey[key] = clean[path]![key]!;
    sorted[path] = byKey;
  }
  const { colour, alone, pages, encodings, bytes, source } = cleanLists(lists);
  const read: Record<string, string> = {};
  for (const path of Object.keys(encodings).sort()) read[path] = encodings[path]!;
  const file = {
    version: PART_CHOICES_FILE_VERSION,
    parts: sorted,
    ...(colour.length > 0 ? { colour } : {}),
    ...(alone.length > 0 ? { alone } : {}),
    ...(pages.length > 0 ? { pages } : {}),
    ...(Object.keys(read).length > 0 ? { encodings: read } : {}),
    ...(bytes.length > 0 ? { bytes } : {}),
    ...(source.length > 0 ? { source } : {}),
  };
  return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}
`);
}

/** readings.json's lifecycle: read once at launch, written (debounced by the caller) after each choice. */
export class PartChoicesFile {
  private readonly io: PositionPersistenceIo;
  readonly path: string;
  private current: PartChoices;
  private lists: ChoiceLists;
  /** Written by a newer Marxy, or there and unreadable: read (or not), never written. */
  readonly readOnly: boolean;
  /** The file was found corrupt and set aside. */
  readonly quarantined: boolean;

  private constructor(io: PositionPersistenceIo, path: string, current: PartChoices, readOnly: boolean, quarantined: boolean, lists: ChoiceLists = NO_LISTS) {
    this.io = io;
    this.path = path;
    this.current = current;
    this.lists = lists;
    this.readOnly = readOnly;
    this.quarantined = quarantined;
  }

  static async open(io: PositionPersistenceIo): Promise<PartChoicesFile> {
    const path = `${(await io.dataDirectory()).replace(/[\\/]$/, '')}/${PART_CHOICES_FILE_NAME}`;
    let bytes: Uint8Array;
    try {
      bytes = await io.readFile(path);
    } catch (e) {
      // A file that is there but could not be read is the reader's still: not written over this session.
      return new PartChoicesFile(io, path, {}, !isNotFound(e), false);
    }
    const loaded = parsePartChoicesFile(bytes);
    if (loaded.kind === 'quarantined') {
      await io.writeFileAtomic(quarantinePathFor(path), loaded.quarantineBytes);
      await io.writeFileAtomic(path, serializePartChoicesFile({}));
      return new PartChoicesFile(io, path, {}, false, true);
    }
    return new PartChoicesFile(io, path, loaded.parts, loaded.version > PART_CHOICES_FILE_VERSION, false, cleanLists(loaded));
  }

  saved(): PartChoices {
    return this.current;
  }

  /** The files coloured anyway past the plain-text tier. */
  savedColour(): readonly string[] {
    return this.lists.colour;
  }

  /** The databases read without their write-ahead log. */
  savedAlone(): readonly string[] {
    return this.lists.alone;
  }

  /** The HTML files read as a page, sandboxed. */
  savedPages(): readonly string[] {
    return this.lists.pages;
  }

  /** The encodings the reader chose for files (Read with encoding...). */
  savedEncodings(): EncodingChoices {
    return this.lists.encodings;
  }

  /** The files read as their bytes. */
  savedBytes(): readonly string[] {
    return this.lists.bytes;
  }

  /** The code files the reader put in Source. */
  savedSource(): readonly string[] {
    return this.lists.source;
  }

  /** A list not given keeps what it held. */
  async write(parts: PartChoices, lists: Partial<ChoiceLists> = {}): Promise<void> {
    if (this.readOnly) return;
    this.current = cleanPartChoices(parts);
    this.lists = cleanLists({ ...this.lists, ...lists });
    await this.io.writeFileAtomic(this.path, serializePartChoicesFile(this.current, this.lists));
  }
}
