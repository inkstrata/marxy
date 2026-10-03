// The reader's own settings from config.toml: light variant and text size, applied before first
// text and changed by command (A-14). Only `variant` and `size` are read or written here.
import { applyVariant, parseConfig, resolveVariantPreference, setTopLevelKey } from '@marxy/theme';
import type { Config } from '@marxy/theme';
import type { AppShell } from '../app.ts';

type ConfigShell = Pick<AppShell, 'readFile' | 'configPaths'>;
type WriteShell = Pick<AppShell, 'readFile' | 'writeFileAtomic' | 'configPaths'>;

export const DEFAULT_SIZE = 20;
export const MIN_SIZE = 15;
export const MAX_SIZE = 50;

const DEFAULTS: Pick<Config, 'variant' | 'size'> = { variant: 'dark', size: DEFAULT_SIZE };

/** The config bytes the pre-paint read saw, handed on once to the theme read so the file is read once. */
let lastRead: { readonly path: string; readonly bytes: Uint8Array } | null = null;

/** Takes the bytes `readReaderConfig` read, if it read any; the second caller gets null and reads for itself. */
export function takeConfigRead(): { readonly path: string; readonly bytes: Uint8Array } | null {
  const read = lastRead;
  lastRead = null;
  return read;
}

/** The parsed config, or the defaults on any failure (no path, no file, unreadable, unparsable). */
export async function readReaderConfig(shell: ConfigShell): Promise<Config> {
  lastRead = null;
  const fallback = parseConfig(new Uint8Array()).config;
  if (shell.configPaths === undefined) return fallback;
  let path: string;
  try {
    path = (await shell.configPaths()).config;
  } catch {
    return fallback;
  }
  try {
    const bytes = await shell.readFile(path);
    lastRead = { path, bytes };
    return parseConfig(bytes).config;
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
export function applyReaderConfig(root: HTMLElement, cfg: Partial<Pick<Config, 'variant' | 'size'>>): () => void {
  stopAuto?.();
  stopAuto = null;
  const variant = cfg.variant ?? DEFAULTS.variant;
  const size = cfg.size ?? DEFAULTS.size;
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
  if (size === DEFAULT_SIZE) {
    root.style.removeProperty('--marxy-size-body');
    root.style.removeProperty('--marxy-line-box');
  } else {
    root.style.setProperty('--marxy-size-body', `${size}px`);
    root.style.setProperty('--marxy-line-box', `${lineBoxFor(size)}px`);
  }
  return stop;
}

let writes: Promise<void> = Promise.resolve();

/**
 * Sets one top-level key of config.toml, every other byte kept (`setTopLevelKey`). A missing file is
 * created; a file that exists but cannot be read is left alone. Writes run one after another, so
 * three quick presses are three read-modify-writes in order, not three that overwrite each other.
 */
export function writeReaderKey(shell: WriteShell, key: 'variant' | 'size', tomlValue: string): Promise<void> {
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
