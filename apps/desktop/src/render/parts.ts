// A Markdown page's fenced parts, each read as its own kind (core `reading/parts.ts` decides). A data fence
// becomes its format's reading, its byte ranges the file's; a session, a patch or a log keeps its `pre` and is given the
// language the highlighter colours that reading by. Runs on a parsed page before it is mounted (`prepareParsed`), so the
// grid, the block list and a splice see each part as it is drawn.
import type { Document } from '@marxy/core';
import {
  PART_LANGUAGE,
  PART_WORDS,
  isReadingLanguage,
  partReading,
  partsOf,
  readingOfPart,
  type Part,
  type PartReading,
} from '@marxy/core/src/reading/parts.ts';
import type { PartChoices } from '@marxy/core/src/reading/part-choices.ts';
import { langOfFence } from '@marxy/core';

// ---- the reader's choices --------------------------------------------------------------------------------------------

// Read this part another way. Kept in readings.json beside kinds.json (`render/readings-file.ts`), which fills this
// at launch and writes it a moment after each choice; going back to the guess deletes the entry.
const chosen = new Map<string, Map<string, PartReading>>();
const listeners = new Set<(path: string) => void>();

export function partChoice(path: string, key: string): PartReading | undefined {
  return chosen.get(path)?.get(key);
}

/** Every choice made, path -> key -> reading, as readings.json holds them. */
export function partChoicesNow(): PartChoices {
  const out: Record<string, Record<string, PartReading>> = {};
  for (const [path, byKey] of chosen) out[path] = Object.fromEntries(byKey);
  return out;
}

/** How many parts of how many files have a choice. */
export function partChoiceCount(): { readonly files: number; readonly parts: number } {
  let parts = 0;
  for (const byKey of chosen.values()) parts += byKey.size;
  return { files: chosen.size, parts };
}

const sameChoices = (a: Map<string, PartReading> | undefined, b: Map<string, PartReading> | undefined): boolean =>
  (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every(([k, r]) => b?.get(k) === r);

/**
 * Replaces every choice with `saved` (readings.json as read at launch), but for the paths in `keep`, chosen since; listeners
 * hear each path whose choices changed, so a page already set is set again.
 */
export function restorePartChoices(saved: PartChoices, keep: ReadonlySet<string> = new Set()): void {
  const next = new Map<string, Map<string, PartReading>>();
  for (const [path, byKey] of Object.entries(saved)) {
    const map = new Map(Object.entries(byKey));
    if (!keep.has(path) && map.size > 0) next.set(path, map);
  }
  for (const path of keep) if (chosen.has(path)) next.set(path, chosen.get(path)!);
  const changed = [...new Set([...chosen.keys(), ...next.keys()])].filter((p) => !sameChoices(chosen.get(p), next.get(p)));
  chosen.clear();
  for (const [path, map] of next) chosen.set(path, map);
  for (const path of changed) for (const cb of [...listeners]) cb(path);
}

/** Forgets every choice: each part is read as guessed again. */
export function clearPartChoices(): void {
  restorePartChoices({});
}

/** Sets how part `key` of `path` is read, or with null goes back to the guess; listeners hear the path. */
export function choosePart(path: string, key: string, reading: PartReading | null): void {
  let byKey = chosen.get(path);
  if (reading === null) {
    if (!byKey?.delete(key)) return;
    if (byKey.size === 0) chosen.delete(path);
  } else {
    if (byKey?.get(key) === reading) return;
    if (!byKey) chosen.set(path, (byKey = new Map()));
    byKey.set(key, reading);
  }
  for (const cb of [...listeners]) cb(path);
}

export function onPartChoice(cb: (path: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export interface PartNow {
  readonly part: Part;
  /** What it is read as now: the reader's choice, else the guess. */
  readonly reading: PartReading;
  readonly chosen: boolean;
}

/** The parts of the page `ast` is the parse of, each with how it is read now. */
export function partsNow(path: string, ast: Document, bytes: Uint8Array): PartNow[] {
  return partsOf(ast, bytes).map((part) => {
    const reading = readingOfPart(part, partChoice(path, part.key));
    return { part, reading, chosen: reading !== part.guess };
  });
}

/** How a part's reading is said in a menu: a data part by its own reading's name ("a table of records"). */
export function partLongName(part: Part, reading: PartReading, bytes: Uint8Array): string {
  if (reading === 'data' || reading === 'table') return partReading(part, bytes)?.name ?? PART_WORDS[reading].long;
  return PART_WORDS[reading].long;
}

// ---- the page --------------------------------------------------------------------------------------------------------

export interface PartsPage {
  readonly path: string;
  readonly ast: Document;
  readonly bytes: Uint8Array;
}

function setLanguage(pre: HTMLElement, code: HTMLElement, lang: string | null): void {
  for (const el of [pre, code]) for (const c of [...el.classList]) if (c.startsWith('language-')) el.classList.remove(c);
  if (lang === null) {
    delete pre.dataset.marxyLang;
    return;
  }
  pre.dataset.marxyLang = langOfFence(lang);
  pre.classList.add(`language-${lang}`);
  code.classList.add(`language-${lang}`);
}

/** The element a data part is drawn as: its reading, carrying the fence's range, so it is the code block's to a click. */
function partElement(pre: HTMLElement, reading: PartReading, html: string): HTMLElement {
  const doc = pre.ownerDocument;
  const part = doc.createElement('div');
  part.className = 'marxy-part';
  part.dataset.marxyPart = reading;
  part.setAttribute('data-marxy-s', pre.getAttribute('data-marxy-s')!);
  part.setAttribute('data-marxy-e', pre.getAttribute('data-marxy-e')!);
  // Made by core from escaped text alone (reading/index.ts), as a data file's page is.
  const t = doc.createElement('template');
  t.innerHTML = html;
  part.append(t.content);
  return part;
}

/** Reads every fenced part under `root` as it is read now. A `pre` that is no part of `page` is left as it is. */
export function readParts(root: ParentNode, page: PartsPage): void {
  const parts = partsOf(page.ast, page.bytes);
  if (parts.length === 0) return;
  const byRange = new Map<string, Part>(parts.map((p) => [`${p.start}-${p.end}`, p]));
  for (const pre of root.querySelectorAll<HTMLElement>('pre[data-marxy-s]')) {
    const part = byRange.get(`${pre.getAttribute('data-marxy-s')}-${pre.getAttribute('data-marxy-e')}`);
    const code = pre.firstElementChild;
    if (!part || !(code instanceof HTMLElement) || code.localName !== 'code') continue;
    const reading = readingOfPart(part, partChoice(page.path, part.key));
    if (reading === 'data' || reading === 'table') {
      const set = partReading(part, page.bytes);
      if (set && set.id !== 'written') {
        pre.replaceWith(partElement(pre, reading, set.html));
        continue;
      }
    }
    pre.dataset.marxyPart = reading;
    if (reading === 'written') {
      // Set as written, a `console` or `diff` fence is its text: not coloured as the reading its fence names.
      if (isReadingLanguage(part.lang)) setLanguage(pre, code, null);
    } else {
      const lang = PART_LANGUAGE[reading];
      if (lang) setLanguage(pre, code, lang);
    }
  }
}
