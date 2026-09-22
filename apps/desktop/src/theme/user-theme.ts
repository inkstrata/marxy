// User theme load, apply, watch, and config resolution (docs/design/05-theme.md §App side). MARXY-177.
import { joinPath, normalizePath, dirname } from '@marxy/core/src/index-model/paths.ts';
import { applyTheme, loadTheme, parseConfig } from '@marxy/theme';
import type { TypesetController } from '@marxy/typeset';
import type { WatchEvent } from '@marxy/shell-api';
import { notify } from '../notices/index.ts';
import type { BlockList } from '../render/post.ts';
import { currentPosition, restoreScrollToPosition } from '../position/index.ts';

export interface UserThemeShell {
  readFile(path: string): Promise<Uint8Array>;
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  watch(root: string, onEvents: (events: readonly WatchEvent[]) => void): Promise<{ close(): void }>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
  mark(name: string, t: number, data?: string): Promise<void>;
  configPaths?(): Promise<{ config: string; data: string }>;
}

const DEBOUNCE_MS = 100;
const WARNINGS_SHOWN = 3;

export interface UserThemeContext {
  readonly shell: UserThemeShell;
  readonly article: HTMLElement;
  getTypeset(): TypesetController | null;
  readingScroller(): HTMLElement;
  getOpenPath(): string | null;
  getBlocks(): BlockList | null;
}

/** Expands `~` and resolves relative theme paths against the config file's directory. */
export function resolveThemeDir(raw: string | null, configPath: string): string | null {
  if (raw === null || raw.trim() === '') return null;
  let path = raw.trim();
  const configDir = dirname(configPath);
  const home = inferHomeFromConfig(configPath);
  if (path.startsWith('~/')) path = joinPath(home, path.slice(2));
  else if (path === '~') path = home;
  else if (path.startsWith('~')) path = joinPath(home, path.slice(1));
  else if (!path.startsWith('/') && !/^[A-Za-z]:\//.test(path)) path = joinPath(configDir, path);
  return normalizePath(path);
}

function inferHomeFromConfig(configPath: string): string {
  const configDir = dirname(configPath);
  const name = configDir.split('/').pop() ?? '';
  if (name === 'marxy' || name === '.config') return dirname(configDir);
  return '/';
}

function themeNoticeText(warnings: readonly string[]): string | null {
  if (warnings.length === 0) return null;
  const head = warnings.slice(0, WARNINGS_SHOWN);
  const tail = warnings.length - head.length;
  const body = head.join(' ');
  if (tail > 0) return `${body} and ${tail} more.`;
  return body;
}

function displayPath(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

async function relayoutKeepingPosition(ctx: UserThemeContext): Promise<void> {
  const typeset = ctx.getTypeset();
  const openPath = ctx.getOpenPath();
  const blocks = ctx.getBlocks();
  const scroller = ctx.readingScroller();
  if (!typeset || !openPath || !blocks) {
    return;
  }
  const pos = currentPosition(scroller, blocks, openPath, 'rendered');
  typeset.relayout('theme');
  await typeset.ready;
  restoreScrollToPosition(scroller, blocks, { ...pos, path: openPath, mode: 'rendered' });
}

async function applyLoadedTheme(ctx: UserThemeContext, dir: string): Promise<void> {
  await ctx.shell.allowAssetScope(dir);
  const { css, warnings } = await loadTheme(
    dir,
    async (rel) => ctx.shell.readFile(joinPath(dir, rel)),
    (abs) => ctx.shell.assetUrl(abs),
  );
  applyTheme(css);
  const notice = themeNoticeText(warnings);
  if (notice !== null) notify({ kind: 'info', text: notice });
  await relayoutKeepingPosition(ctx);
  await ctx.shell.mark('user_theme', Date.now(), `dir=${dir}`);
}

/** Loads `dir`, applies `#marxy-theme`, watches for changes, and relayouts with position kept. */
export async function startUserTheme(ctx: UserThemeContext, dir: string | null): Promise<{ stop(): void }> {
  let watchClose: (() => void) | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const stop = (): void => {
    generation += 1;
    watchClose?.();
    watchClose = undefined;
    if (debounce !== undefined) clearTimeout(debounce);
  };

  if (dir === null) return { stop };

  const gen = generation;
  try {
    await applyLoadedTheme(ctx, dir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const where = displayPath(dir);
    notify({
      kind: 'info',
      text: msg.includes('theme.css') ? `Theme at ${where} could not be read: theme.css not found.` : `Theme at ${where} could not be read: ${msg}.`,
    });
    return { stop };
  }

  if (gen !== generation) return { stop };

  const handle = await ctx.shell.watch(dir, () => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void (async () => {
        try {
          await applyLoadedTheme(ctx, dir);
        } catch {
          /* keep the previous theme on reload failure */
        }
      })();
    }, DEBOUNCE_MS);
  });
  watchClose = () => handle.close();

  return { stop };
}

/** Reads `theme` from config.toml when the shell exposes `configPaths`. */
export async function themeDirFromConfig(shell: UserThemeShell): Promise<string | null> {
  if (shell.configPaths === undefined) return null;
  const { config } = await shell.configPaths();
  let bytes: Uint8Array;
  try {
    bytes = await shell.readFile(config);
  } catch {
    return null;
  }
  const { config: parsed } = parseConfig(bytes);
  return resolveThemeDir(parsed.theme, config);
}
