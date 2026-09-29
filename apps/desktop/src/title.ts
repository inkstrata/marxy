// Window title: basename and the dirty dot only (docs/design/09-app-shell.md §Window title, MARXY-49).
import { basename } from '@marxy/core/src/index-model/paths.ts';
import type { Shell } from '@marxy/shell-api';

export function formatWindowTitle(path: string | null, dirty: boolean): string {
  if (!path || path === 'untitled') return dirty ? 'marxy •' : 'marxy';
  const name = basename(path);
  return `${name} — marxy${dirty ? ' •' : ''}`;
}

export async function updateTitle(
  shell: Pick<Shell, 'setTitle'>,
  path: string | null,
  dirty: boolean,
): Promise<void> {
  await shell.setTitle(formatWindowTitle(path, dirty));
}
