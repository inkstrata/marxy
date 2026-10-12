// What Source draws beside the text and never in it (V-08): whitespace marks and the column guide. Display only,
// remembered as `show_whitespace` and `column_guide` in config.toml the way `line_numbers` is (line-numbers.ts). This
// module holds the reader's choice and the per-file default; it imports no editor code, so the config read can set it
// at launch without CodeMirror.

import { fileTypeOf } from '@marxy/core/src/index-model/file-types.ts';
import { isUntitled } from '../document/untitled.ts';

/** The column the guide sits at when nothing says otherwise. */
export const DEFAULT_GUIDE_COLUMN = 80;
/** The longest `max_line_length` the guide follows; beyond this it is not a guide. */
export const MAX_GUIDE_COLUMN = 1000;

/** The reader's choice for this launch, seeded from config.toml; null means the key is absent. */
let whitespaceChoice: boolean | null = null;
let guideChoice: boolean | null = null;

export function setShowWhitespaceChoice(on: boolean | null): void {
  whitespaceChoice = on;
}

export function setColumnGuideChoice(on: boolean | null): void {
  guideChoice = on;
}

/** Show whitespace is off unless the reader turned it on. */
export function resolveShowWhitespace(): boolean {
  return whitespaceChoice === true;
}

/** Code, logs and terminal output (everything that is not prose) get the guide; Markdown and the text family do not. */
export function defaultColumnGuideForPath(path: string): boolean {
  if (isUntitled(path)) return false;
  const kind = fileTypeOf(path)?.kind;
  return kind !== 'markdown' && kind !== 'text';
}

/**
 * The column the guide sits at for `path`, or null for none. The reader's choice wins; absent, the file's kind decides.
 * `maxLineLength` is the file's `.editorconfig` value when it has one, else the guide is at 80.
 */
export function resolveColumnGuide(path: string, maxLineLength?: number | null): number | null {
  const on = guideChoice ?? defaultColumnGuideForPath(path);
  if (!on) return null;
  return maxLineLength !== undefined && maxLineLength !== null && maxLineLength >= 1 && maxLineLength <= MAX_GUIDE_COLUMN ? maxLineLength : DEFAULT_GUIDE_COLUMN;
}
