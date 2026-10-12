// When the depth lens is on offer (K-10a): a JSON or YAML file in Source that has folding. Read from the file's type and
// size alone, with no CodeMirror in it, so the palette can ask on every keystroke and start-up never loads the editor.
// TOML is left out because its mode (a stream parser) makes no tree of containers; a file over the large-file limit
// gets no folding at all (language.ts). `depth-fold.test.ts` pins this limit to `LARGE_FILE_BYTES`.

import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { isUntitled } from '../document/untitled.ts';

/** `LARGE_FILE_BYTES`, restated where the editor's modules are not loaded. */
export const DEPTH_FOLD_MAX_BYTES = 2 * 1024 * 1024;

export function depthFoldOffered(path: string, byteLength: number): boolean {
  if (isUntitled(path) || byteLength > DEPTH_FOLD_MAX_BYTES) return false;
  const cm = fileTypeOf(path)?.cm;
  return cm === 'json' || cm === 'yaml';
}
