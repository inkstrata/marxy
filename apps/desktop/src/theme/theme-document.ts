// Notice and config write when a theme file is opened as a document (docs/design/05-theme.md §App side). MARXY-177.
import { basename, dirname, joinPath } from '@marxy/core/src/index-model/paths.ts';
import { setTopLevelKey } from '@marxy/theme';
import { ensureNoticesRegion } from '../notices/index.ts';
import { startUserTheme, type UserThemeContext, type UserThemeShell } from './user-theme.ts';

function isThemeFileName(path: string): boolean {
  const base = basename(path);
  return base === 'theme.css' || base === 'theme.toml';
}

async function themePairExists(shell: UserThemeShell, dir: string): Promise<boolean> {
  try {
    await shell.readFile(joinPath(dir, 'theme.toml'));
    await shell.readFile(joinPath(dir, 'theme.css'));
    return true;
  } catch {
    return false;
  }
}

/** When `openPath` is a theme file beside its pair, offer to adopt the directory as the user theme. */
export async function maybeThemeDocumentNotice(
  ctx: UserThemeContext,
  openPath: string,
  onAdopt: (dir: string) => Promise<void>,
): Promise<void> {
  if (!isThemeFileName(openPath)) return;
  const dir = dirname(openPath);
  if (!(await themePairExists(ctx.shell, dir))) return;

  const region = ensureNoticesRegion();
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  line.dataset.noticeKind = 'info';

  const text = document.createElement('span');
  text.className = 'marxy-notice-text';
  text.textContent = 'This is a marxy theme.';
  line.append(text);

  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'marxy-notice-action';
  use.textContent = 'Use this theme';
  use.addEventListener('click', () => {
    line.remove();
    void onAdopt(dir);
  });
  line.append(use);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'marxy-notice-dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => line.remove());
  line.append(dismiss);

  region.append(line);
}

export async function writeThemeToConfig(shell: UserThemeShell, dir: string): Promise<void> {
  if (shell.configPaths === undefined) return;
  const { config } = await shell.configPaths();
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(config);
  } catch {
    bytes = new Uint8Array();
  }
  const quoted = `"${dir.replace(/\\/g, '/')}"`;
  const next = setTopLevelKey(bytes, 'theme', quoted);
  await shell.writeFileAtomic(config, next);
}

export async function adoptThemeDirectory(
  ctx: UserThemeContext,
  dir: string,
  current: { stop(): void } | null,
): Promise<{ stop(): void }> {
  await writeThemeToConfig(ctx.shell, dir);
  current?.stop();
  return startUserTheme(ctx, dir);
}
