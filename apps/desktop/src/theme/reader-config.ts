// The reader's own settings from config.toml: light variant and text size, applied before first
// text and changed by command (A-14), and the Source line-number choice (L-06.1). Only `variant`, `size`,
// `chrome_size`, `line_numbers`, `show_whitespace`, `column_guide` (V-08), `theme` (H-05), `contrast` and `reduce_transparency` (W-22) are read or written here.
import { applyVariant, parseConfig, resolveVariantPreference, setTopLevelKey } from '@marxy/theme';
import type { Config } from '@marxy/theme';
import type { AppShell } from '../app.ts';
import { setLineNumbersChoice } from '../source/line-numbers.ts';
import { setColumnGuideChoice, setShowWhitespaceChoice } from '../source/view-aids.ts';

type ConfigShell = Pick<AppShell, 'readFile' | 'configPaths'>;
type WriteShell = Pick<AppShell, 'readFile' | 'writeFileAtomic' | 'configPaths'>;

export const DEFAULT_SIZE = 20;
export const MIN_SIZE = 15;
export const MAX_SIZE = 50;

const DEFAULTS: Pick<Config, 'variant' | 'size'> = { variant: 'dark', size: DEFAULT_SIZE }

/** The custom property the reader's `chrome_size` sets on the root (ADR-0059 item 6). */
export const CHROME_SIZE_PROPERTY = '--marxy-size-chrome';;

/** The config bytes the pre-paint read saw, handed on once to the theme read so the file is read once. */
let lastRead: { readonly path: string; readonly bytes: Uint8Array } | null = null;

/** Takes the bytes `readReaderConfig` read, if it read any; the second caller gets null and reads for itself. */
export function takeConfigRead(): { readonly path: string; readonly bytes: Uint8Array } | null {
  const read = lastRead;
  lastRead = null;
  return read;
}

/** What the config read has to tell the reader (a refused `chrome_size`), held until a document is on the page, since opening one clears notices. */
let pendingNotices: string[] = [];

/** Takes the config notices; the second caller gets none. */
export function takeConfigNotices(): string[] {
  const out = pendingNotices;
  pendingNotices = [];
  return out;
}

/** The bytes `readReaderConfig` read, kept in place: the launch's kind decision parses its `[[kind]]` rules from them (K-05a.1). */
export function peekConfigRead(): { readonly path: string; readonly bytes: Uint8Array } | null {
  return lastRead;
}

/**
 * The parsed config, or the defaults on any failure (no path, no file, unreadable, unparsable). `onPaths` is told
 * where config.toml and the data directory are as soon as the shell has said, before config.toml is read, so a
 * caller can start a read of its own beside this one without asking the shell for the paths again (K-05a.1).
 */
export async function readReaderConfig(
  shell: ConfigShell,
  onPaths?: (paths: { readonly config: string; readonly data: string }) => void,
): Promise<Config> {
  lastRead = null;
  pendingNotices = [];
  const fallback = parseConfig(new Uint8Array()).config;
  if (shell.configPaths === undefined) return fallback;
  let path: string;
  try {
    const paths = await shell.configPaths();
    path = paths.config;
    onPaths?.(paths);
  } catch {
    return fallback;
  }
  try {
    const bytes = await shell.readFile(path);
    lastRead = { path, bytes };
    const parsed = parseConfig(bytes);
    pendingNotices = parsed.warnings.filter((w) => w.startsWith('chrome_size'));
    return parsed.config;
  } catch (e) {
    // No file is an answer too: the theme read need not ask the same question again.
    if ((e as { code?: string } | null)?.code === 'not-found') lastRead = { path, bytes: new Uint8Array() };
    return fallback;
  }
}

/** The line box for a body size: twice the rounded three-quarter, so it is always even (ADR-0030). */
export function lineBoxFor(sizePx: number): number {
  return 2 * Math.round(0.75 * sizePx);
}

/**
 * The code face for a body size: nine-tenths of it, to the half pixel. The mono face runs large at
 * equal size, so code is set at about 0.85 to 0.9 em of the text around it (06-code.md, "Size and
 * the monospace quirk"); 18 of 20 is the default's ratio, kept at every size (the half-pixel rounding moves it a little: 0.9 becomes 16 of 18, and the x-height ratio dips to 0.964 there).
 */
export function codeSizeFor(sizePx: number): number {
  return Math.round(sizePx * 0.9 * 2) / 2;
}

/**
 * The Source editor's type for a body size: seven-tenths of it, to the half pixel (14 of 20). Source holds no
 * prose, so it is not set on the prose grid; the ratio is the author's ruling K-R1 (a), ADR-0067. Inside prose the
 * research sets code at 0.85 to 0.9 em of the text around it (06-code.md, "Size and the monospace quirk"); an
 * editor that is the whole window has no text around it, and the cited incumbent, GitHub, sets code at 13 px
 * (reader-artifacts/04-code-typography.md, "Leading").
 */
export function sourceSizeFor(sizePx: number): number {
  return Math.round(sizePx * 0.7 * 2) / 2;
}

/**
 * The Source line box for a body size: one and a half times its type, to the whole pixel (21 of 14), inside the
 * handbook's 1.5 to 1.6 for code (06-code.md, "Line length, tabs and line height"). A whole pixel keeps every
 * row, every number and every caret on the same pixel at every size.
 */
export function sourceLineBoxFor(sizePx: number): number {
  return Math.round(sourceSizeFor(sizePx) * 1.5);
}

/**
 * The custom properties a body size overrides, name to value. The code line box is the body line
 * box, two grid units, so a code line is a whole number of units at every size (design-language
 * constraint 5). The default size overrides nothing: the stylesheet's own values stand.
 */
export function sizeProperties(sizePx: number): Record<string, string> {
  return {
    '--marxy-size-body': `${sizePx}px`,
    '--marxy-line-box': `${lineBoxFor(sizePx)}px`,
    '--marxy-size-code': `${codeSizeFor(sizePx)}px`,
    '--marxy-line-box-code': `${lineBoxFor(sizePx)}px`,
    '--marxy-size-source': `${sourceSizeFor(sizePx)}px`,
    '--marxy-line-box-source': `${sourceLineBoxFor(sizePx)}px`,
  };
}

/** The root attributes more contrast and solid fills set (W-22); the stylesheet's `base.css` keys on them. */
export const CONTRAST_ATTRIBUTE = 'data-marxy-contrast';
export const TRANSPARENCY_ATTRIBUTE = 'data-marxy-transparency';

let stopContrast: (() => void) | null = null;

/**
 * Sets `data-marxy-contrast` to `more` or `normal` on `root` and `data-marxy-transparency="reduced"` when asked.
 * `system` follows the system's Increase contrast live, until the next call; `more` and `normal` ignore it. The
 * attribute is always resolved, so the stylesheet's media-query rule yields to `normal`.
 */
export function applyContrast(root: HTMLElement, mode: Config['contrast'], reduceTransparency: boolean): void {
  stopContrast?.();
  stopContrast = null;
  if (mode === 'system') {
    const query = root.ownerDocument.defaultView?.matchMedia('(prefers-contrast: more)');
    if (query === undefined) {
      root.setAttribute(CONTRAST_ATTRIBUTE, 'normal');
    } else {
      const follow = (): void => root.setAttribute(CONTRAST_ATTRIBUTE, query.matches ? 'more' : 'normal');
      follow();
      query.addEventListener('change', follow);
      stopContrast = () => query.removeEventListener('change', follow);
    }
  } else {
    root.setAttribute(CONTRAST_ATTRIBUTE, mode);
  }
  if (reduceTransparency) root.setAttribute(TRANSPARENCY_ATTRIBUTE, 'reduced');
  else root.removeAttribute(TRANSPARENCY_ATTRIBUTE);
}

let currentSize = DEFAULT_SIZE;
let stopAuto: (() => void) | null = null;

/** The text size now in force, in px. */
export function currentTextSize(): number {
  return currentSize;
}

/** The variant now on the root, or dark. */
export function currentVariant(root: HTMLElement = document.documentElement): 'light' | 'dark' {
  return root.getAttribute('data-marxy-variant') === 'light' ? 'light' : 'dark';
}

/**
 * Applies variant and size to `root`. `auto` follows the system until the next call; the returned
 * function stops that following.
 */
export function applyReaderConfig(root: HTMLElement, cfg: Partial<Pick<Config, 'variant' | 'size' | 'lineNumbers' | 'chromeSize' | 'showWhitespace' | 'columnGuide' | 'contrast' | 'reduceTransparency'>>): () => void {
  stopAuto?.();
  stopAuto = null;
  const variant = cfg.variant ?? DEFAULTS.variant;
  const size = cfg.size ?? DEFAULTS.size;
  // Only a key the reader wrote speaks for the gutter; absent, the per-path default stands (L-06.1).
  if (cfg.lineNumbers !== undefined) setLineNumbersChoice(cfg.lineNumbers);
  // The same for the two Source aids (V-08): absent, whitespace is off and the guide follows the kind of file.
  if (cfg.showWhitespace !== undefined) setShowWhitespaceChoice(cfg.showWhitespace);
  if (cfg.columnGuide !== undefined) setColumnGuideChoice(cfg.columnGuide);
  // Contrast and transparency are the config's alone: a call that names neither (the palette's variant and size commands) leaves them as they are.
  if (cfg.contrast !== undefined || cfg.reduceTransparency !== undefined) applyContrast(root, cfg.contrast ?? 'system', cfg.reduceTransparency ?? false);
  const doc = root.ownerDocument;
  let stop = (): void => {};
  if (variant === 'auto') {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = (): void => applyVariant(resolveVariantPreference('auto', query.matches), doc);
    follow();
    query.addEventListener('change', follow);
    stop = () => query.removeEventListener('change', follow);
    stopAuto = stop;
  } else {
    applyVariant(variant, doc);
  }
  currentSize = size;
  for (const [name, value] of Object.entries(sizeProperties(size))) {
    if (size === DEFAULT_SIZE) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  // Set only when the reader wrote a valid value; unset, the theme's value stands (the default look is unchanged).
  if (cfg.chromeSize === undefined || cfg.chromeSize === null) root.style.removeProperty(CHROME_SIZE_PROPERTY);
  else root.style.setProperty(CHROME_SIZE_PROPERTY, `${cfg.chromeSize}px`);
  return stop;
}

let writes: Promise<void> = Promise.resolve();

/**
 * Sets one top-level key of config.toml, every other byte kept (`setTopLevelKey`). A missing file is
 * created; a file that exists but cannot be read is left alone. Writes run one after another, so
 * three quick presses are three read-modify-writes in order, not three that overwrite each other.
 */
export function writeReaderKey(shell: WriteShell, key: 'variant' | 'size' | 'line_numbers' | 'show_whitespace' | 'column_guide' | 'chrome_size' | 'theme' | 'contrast' | 'reduce_transparency', tomlValue: string): Promise<void> {
  const run = async (): Promise<void> => {
    if (shell.configPaths === undefined) return;
    const { config } = await shell.configPaths();
    let bytes: Uint8Array;
    try {
      bytes = await shell.readFile(config);
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== 'not-found') throw e;
      bytes = new Uint8Array();
    }
    await shell.writeFileAtomic(config, setTopLevelKey(bytes, key, tomlValue));
  };
  const next = writes.then(run, run);
  writes = next.catch(() => {});
  return next;
}
