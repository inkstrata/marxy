// Whether a path takes the formatting commands. Its own module because the registry asks it (`when`) for every
// formatting command each time the palette lists them, while the commands' code (format-ops.ts) is read on the
// first use (F-111).
import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { isUntitled } from '../document/untitled.ts';

/** Formatting is Markdown's: a Markdown file or a scratch document (which is Markdown until it is named). */
export function formatsPath(path: string): boolean {
  return isUntitled(path) || fileTypeOf(path)?.kind === 'markdown';
}
