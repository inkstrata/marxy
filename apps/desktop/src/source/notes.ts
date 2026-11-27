// Notes in Source: finds what Marxy notices about the file in the editor and hands the frame a list of places. The
// pure rules are in core (`notesOf`: fences and heading levels, Markdown only); here is the file-system half (a path the
// text names that is not there, for every text kind) and the running of both after first text, in slices.
//
// A path is called missing only by `resolveMentioned`'s rule: when Marxy cannot look (a folder that was not listed, a
// symlink, a path that climbs out of the repository) it says nothing. Nothing here writes the buffer or the editor.
import { fileTypeOf, parserOf } from '@marxy/core/src/kind/registry.ts';
import { lineColumnIn, notesOf, type Note } from '@marxy/core/src/notes/notes.ts';
import { Abandoned, parseMarkdownChunked } from '@marxy/core';
import { pathMentions, pathMentionsIn } from '@marxy/core/src/transforms/extract.ts';
import { lineStartsOf } from '@marxy/core/src/util/text.ts';
import { protectedSpans } from '@marxy/core/src/transforms/prose.ts';
import { isUntitled } from '../document/untitled.ts';
import { appHandle } from '../commands/app-handle.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';
import { resolveMentioned, type Mentioned } from '../frame/model/links.ts';

/** The most notes kept, like the marks. */
export const NOTE_CAP = 200;
/** The most paths looked at; a file naming more is checked for the first of them only. */
export const PATH_CHECK_CAP = 200;
/** Past this many characters nothing is parsed for notes: a file this large is read, not annotated. */
export const NOTES_MAX_CHARS = 4 * 1024 * 1024;

/** Whether fences and heading levels are looked for: Markdown, and a scratch document (Markdown until it is named). */
export function notesForMarkdown(path: string): boolean {
  return isUntitled(path) || fileTypeOf(path)?.kind === 'markdown';
}

/** Whether the text is parsed as Markdown for its notes: the registry's parser says so, and a scratch document is Markdown. */
export function notesParseMarkdown(path: string): boolean {
  return isUntitled(path) || parserOf(path) === 'markdown';
}

export type PathChecker = (path: string) => Promise<Mentioned>;

/** The path check for the document at `docPath`, from the running app; null when there is none to ask (a harness, a scratch file). */
export function pathCheckerFor(docPath: string): PathChecker | null {
  const handle = appHandle();
  if (handle === null || isUntitled(docPath)) return null;
  const root = handle.imageRoot(docPath);
  let home: Promise<string | null> | null = null;
  const homeOf = (): Promise<string | null> =>
    (home ??= (handle.shell.configPaths?.() ?? Promise.resolve(null)).then((p) => (p ? inferHomeFromConfig(p.config) : null)).catch(() => null));
  return async (path) => resolveMentioned(path, docPath, root, await homeOf(), (p) => handle.shell.stat(p));
}

export interface FindNotesOptions {
  readonly path: string;
  /** False once the text has moved on: the work stops and nothing is returned. */
  readonly current: () => boolean;
  readonly checkPath: PathChecker | null;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Where a backticked path is written: the first place `` `path` `` stands in the text outside code (a path is only found in
 * prose, so a mention inside a fence is never where its note goes), else the start of the text.
 */
function pathNote(text: string, starts: readonly number[], path: string, code: readonly { start: number; end: number }[]): Note {
  const needle = `\`${path}\``;
  let found = text.indexOf(needle);
  while (found !== -1 && code.some((s) => found >= s.start && found < s.end)) found = text.indexOf(needle, found + 1);
  const at = Math.max(0, found + 1);
  const { line, column } = lineColumnIn(starts, at);
  return { kind: 'path', start: at, end: at + path.length, byteStart: null, byteEnd: null, line, column, words: `Path ${path} at ${line}:${column} is not found` };
}

/**
 * The notes of `text` (the editor's text, lines joined by LF), in document order, at most `NOTE_CAP`. The parse is one
 * step after a yield to the page, and each path is its own step, so the page is never held for the whole file. Only a
 * file the registry parses as Markdown is parsed; any other text is looked through line by line for the paths it names.
 */
export async function findNotes(text: string, opts: FindNotesOptions): Promise<Note[] | null> {
  if (text.length > NOTES_MAX_CHARS) return [];
  const markdown = notesParseMarkdown(opts.path);
  if (!markdown && opts.checkPath === null) return [];
  await tick();
  if (!opts.current()) return null;
  let doc = null;
  if (markdown) {
    // The parse is made in slices, the event loop given back between them, and abandoned when the text moves on.
    try {
      doc = await parseMarkdownChunked(new TextEncoder().encode(text), { file: 'notes', yieldNow: tick, aborted: () => !opts.current() });
    } catch (e) {
      if (e instanceof Abandoned) return null;
      throw e;
    }
    if (!opts.current()) return null;
  }
  const notes: Note[] = doc !== null && notesForMarkdown(opts.path) ? notesOf(text, doc) : [];
  if (opts.checkPath !== null) {
    const code = doc !== null ? protectedSpans(text, doc) : [];
    const mentioned = doc !== null ? pathMentions(text, doc) : pathMentionsIn(text.split('\n'));
    const paths = mentioned.slice(0, PATH_CHECK_CAP);
    let starts: number[] | null = null;
    for (const path of paths) {
      await tick();
      if (!opts.current()) return null;
      const result = await opts.checkPath(path).catch((): Mentioned => 'not-checked');
      if (!opts.current()) return null;
      if (result === 'not-found') notes.push(pathNote(text, (starts ??= lineStartsOf(text)), path, code));
    }
  }
  notes.sort((a, b) => a.start - b.start);
  return notes.slice(0, NOTE_CAP);
}

/** "1 note", "2 notes". */
export const notesLabel = (n: number): string => `${n} ${n === 1 ? 'note' : 'notes'}`;
