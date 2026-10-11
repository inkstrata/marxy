// Window title: basename and the dirty dot only (docs/design/09-app-shell.md §Window title, MARXY-49).
// A scratch document (E-13) is "Untitled", or the label it was opened with, until Save As gives it a file.
import type { Shell } from '@marxy/shell-api';
import { documentName, isUntitled } from './document/untitled.ts';

export function formatWindowTitle(path: string | null, dirty: boolean, label?: string): string {
  if (!path) return dirty ? 'marxy •' : 'marxy';
  const name = isUntitled(path) && label ? label : documentName(path);
  return `${name} — marxy${dirty ? ' •' : ''}`;
}

export async function updateTitle(
  shell: Pick<Shell, 'setTitle'>,
  path: string | null,
  dirty: boolean,
  label?: string,
): Promise<void> {
  await shell.setTitle(formatWindowTitle(path, dirty, label));
}
