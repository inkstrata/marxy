// A scratch document has no file: text the app was handed (the clipboard, a diff) that renders and
// behaves like a document and writes nothing until the reader chooses Save As (E-13). Its path is not a
// path on disk, only a name that keeps two scratch documents apart: `untitled`, `untitled:2`,
// `untitled:3`... Nothing may treat it as a location: it has no folder, no neighbours and nothing to watch.
import { basename } from '@marxy/core/src/index-model/paths.ts';

/** The one shape of a scratch path: `untitled`, then `untitled:2` and up. Strict, so a real file never matches. */
const SHAPE = /^untitled(?::(?:[2-9]|[1-9]\d+))?$/;

export function isUntitled(path: string | null | undefined): boolean {
  return typeof path === 'string' && SHAPE.test(path);
}

/**
 * Hands out scratch paths in order, never one twice: a scratch document closed and another opened must not
 * share an undo history, a position record or a stale selection. One namer per app instance (a closure, not
 * module state: ADR-0037).
 */
export interface UntitledNamer {
  next(): string;
}

export function createUntitledNamer(): UntitledNamer {
  let issued = 0;
  return {
    next() {
      issued += 1;
      return issued === 1 ? 'untitled' : `untitled:${issued}`;
    },
  };
}

/** What the reader is told a document is called: "Untitled" (and "Untitled 2"), else the file's own name. */
export function documentName(path: string): string {
  if (!isUntitled(path)) return basename(path);
  const n = path.split(':')[1];
  return n === undefined ? 'Untitled' : `Untitled ${n}`;
}

/** The notice said wherever a feature needs a folder the document does not have. */
export const NO_FOLDER_YET = 'This document is not saved yet, so it has no folder · nothing was changed · Save it first.';
