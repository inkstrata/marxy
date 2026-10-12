// User theme load, apply, watch, and config resolution (docs/design/05-theme.md §App side). MARXY-177.
import { joinPath, normalizePath, dirname } from '@marxy/core/src/index-model/paths.ts';
import { applyTheme, avgCharWarnings, loadTheme } from '@marxy/theme';
import type { WatchEvent } from '@marxy/shell-api';
import { notify } from '../notices/index.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { bundledThemeCss, bundledThemeName, type BundledThemeName } from './bundled-themes.ts';
import { afterFirstPaint, measureAverageAdvance } from './measure-face.ts';

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
  /** Every view the app shows: each is set again, with its reader kept in place, when a theme applies (B-13). */
  views(): readonly RenderedView[];
}

/** The theme in force, for the palette: a bundled name, 'folder' for a theme directory, null for Night and Paper. */
let current: BundledThemeName | 'folder' | null = null;
let running: { stop(): void } | null = null;

export function currentThemeName(): BundledThemeName | 'folder' | null {
  return current;
}

/**
 * H-05: applies a bundled theme now, or Night and Paper for null, and stops following any theme folder. The
 * default theme's own stylesheet is in index.html, so Night and Paper is the theme sheet emptied.
 */
export async function applyBundledTheme(name: BundledThemeName | null, doc: Document = document): Promise<void> {
  const css = name === null ? '' : await bundledThemeCss(name);
  running?.stop();
  running = null;
  applyTheme(css, doc);
  current = name;
}

export type ThemeChoice =
  | { readonly kind: 'bundled'; readonly name: BundledThemeName }
  | { readonly kind: 'dir'; readonly dir: string; readonly shadows: BundledThemeName | null };

/**
 * What `theme` in config.toml names. A bare name with no `/` that matches a bundled directory is the bundled theme,
 * unless a directory of that name sits beside config.toml, which still wins (and `shadows` says which it hid).
 */
export async function resolveThemeChoice(
  shell: Pick<UserThemeShell, 'readFile'>,
  raw: string | null,
  configPath: string,
): Promise<ThemeChoice | null> {
  const bundled = bundledThemeName(raw);
  const dir = resolveThemeDir(raw, configPath);
  if (bundled === null) return dir === null ? null : { kind: 'dir', dir, shadows: null };
  if (dir !== null) {
    try {
      await shell.readFile(joinPath(dir, 'theme.css'));
      return { kind: 'dir', dir, shadows: bundled };
    } catch {
      /* no folder of that name: the bundled theme */
    }
  }
  return { kind: 'bundled', name: bundled };
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

/**
 * The home directory a config file lives under, for expanding `~`. The config dir is one of
 * `<home>/Library/Application Support/<id>` (macOS), `<home>/.config/<name>` or `<home>/.config`
 * (XDG), or `<home>/AppData/Roaming/<id>` (Windows); anything else has no recoverable home.
 */
export function inferHomeFromConfig(configPath: string): string {
  const configDir = dirname(configPath);
  const layouts = [
    /^(.*)\/Library\/Application Support(?:\/[^/]+)?$/,
    /^(.*)\/\.config(?:\/[^/]+)?$/,
    /^(.*)\/AppData\/Roaming(?:\/[^/]+)?$/,
  ];
  for (const layout of layouts) {
    const match = layout.exec(configDir);
    if (match?.[1] !== undefined && match[1] !== '') return match[1];
  }
  return '/';
}

/** The theme was applied; these are the places it was adjusted or does not match (a Note, not a refusal). */
function themeNoticeText(themeName: string, warnings: readonly string[]): string | null {
  if (warnings.length === 0) return null;
  const head = warnings.slice(0, WARNINGS_SHOWN);
  const tail = warnings.length - head.length;
  const body = head.join(' ');
  return `Applied ${themeName} · ${tail > 0 ? `${body} and ${tail} more.` : body}`;
}

function displayPath(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

async function relayoutKeepingPosition(ctx: UserThemeContext): Promise<void> {
  for (const view of ctx.views()) await view.relayoutForTheme();
}

/**
 * H-06: tells the reader when the theme's `--marxy-avg-char` is far from what its text face measures. Runs
 * after first paint (commitment 5): measuring waits for the face to load, and nothing here is on the way to text.
 */
function checkAvgCharAfterPaint(css: string, themeName: string): void {
  afterFirstPaint(() => {
    const bodyPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--marxy-size-body'));
    void avgCharWarnings(css, themeName, (family) =>
      measureAverageAdvance({ family, sizePx: Number.isFinite(bodyPx) && bodyPx > 0 ? bodyPx : undefined }),
    ).then((found) => {
      const text = themeNoticeText(themeName, found);
      if (text !== null) notify({ kind: 'info', text });
    });
  });
}

async function applyLoadedTheme(ctx: UserThemeContext, dir: string): Promise<void> {
  await ctx.shell.allowAssetScope(dir);
  const { manifest, css, warnings } = await loadTheme(
    dir,
    async (rel) => ctx.shell.readFile(joinPath(dir, rel)),
    (abs) => ctx.shell.assetUrl(abs),
  );
  applyTheme(css);
  current = 'folder';
  const notice = themeNoticeText(manifest.name, warnings);
  if (notice !== null) notify({ kind: 'info', text: notice });
  checkAvgCharAfterPaint(css, manifest.name);
  await relayoutKeepingPosition(ctx);
  await ctx.shell.mark('user_theme', Date.now(), `dir=${dir}`);
}

/** Loads `dir`, applies `#marxy-theme`, watches for changes, and relayouts with position kept. */
export async function startUserTheme(ctx: UserThemeContext, dir: string | null): Promise<{ stop(): void }> {
  let watchClose: (() => void) | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const stop = (): void => {
    if (running === self) running = null;
    generation += 1;
    watchClose?.();
    watchClose = undefined;
    if (debounce !== undefined) clearTimeout(debounce);
  };

  const self = { stop };
  running = self;
  if (dir === null) return self;

  const gen = generation;
  try {
    await applyLoadedTheme(ctx, dir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const where = displayPath(dir);
    notify({
      kind: 'error',
      text: msg.includes('theme.css') ? `Theme at ${where} could not be read: theme.css not found.` : `Theme at ${where} could not be read: ${msg}.`,
    });
    return self;
  }

  if (gen !== generation) return self;

  // The theme is applied; a folder that cannot be watched only means a later edit is not followed. The open
  // this runs after must not fail for it (V-11).
  try {
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
  } catch (e) {
    console.warn(`marxy: the theme folder ${displayPath(dir)} is not watched: ${String(e)}`);
  }

  return self;
}
