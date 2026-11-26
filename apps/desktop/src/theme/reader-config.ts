// The reader's own settings from config.toml: light variant and text size, applied before first
// text and changed by command, and the Source line-number choice. Applied here: `variant`, `size`, `chrome_size`,
// `line_numbers`, `show_whitespace`, `column_guide`, `contrast` and `reduce_transparency`, and `measure`.
// Written here: those and `theme`, and, for the Settings page, every key it changes (`READER_KEYS`).
import { applyVariant, parseConfig, removeTopLevelKey, resolveVariantPreference, setTopLevelKey } from '@marxy/theme';
import type { Config } from '@marxy/theme';
import type { AppShell } from '../app.ts';
import { setLineNumbersChoice } from '../source/line-numbers.ts';
import { setColumnGuideChoice, setShowWhitespaceChoice } from '../source/view-aids.ts';
import { noteWritten } from './written.ts';

type ConfigShell = Pick<AppShell, 'readFile' | 'configPaths'>;
export type WriteShell = Pick<AppShell, 'readFile' | 'writeFileAtomic' | 'configPaths'>;

export const DEFAULT_SIZE = 20;
/** The property a configured measure sets on the root (tokens.css's own `--marxy-measure-chars`). */
export const MEASURE_PROPERTY = '--marxy-measure-chars';
/** What a configured measure also sets: a kind's own `--marxy-measure-chars` (theme.css) cannot override it, because the kind scope prefers this one (base.css). */
export const MEASURE_USER_PROPERTY = '--marxy-measure-user';
export const MIN_SIZE = 15;
export const MAX_SIZE = 50;

const DEFAULTS: Pick<Config, 'variant' | 'size'> = { variant: 'dark', size: DEFAULT_SIZE }

/** The custom property the reader's `chrome_size` sets on the root. */
export const CHROME_SIZE_PROPERTY = '--marxy-size-chrome';;

/** The config bytes the pre-paint read saw, handed on once to the theme read so the file is read once. */
let lastRead: { readonly path: string; readonly bytes: Uint8Array } | null = null;

/** Takes the bytes `readReaderConfig` read, if it read any; the second caller gets null and reads for itself. */
export function takeConfigRead(): { readonly path: string; readonly bytes: Uint8Array } | null {
  const read = lastRead;
  lastRead = null;
  return read;
}

/** What the config read has to tell the reader (a refused `chrome_size`, `size`, `variant` or `measure`, a file that cannot be read), held until a document is on the page, since opening one clears notices. */
let pendingNotices: string[] = [];

/** Takes the config notices; the second caller gets none. */
export function takeConfigNotices(): string[] {
  const out = pendingNotices;
  pendingNotices = [];
  return out;
}

/** The bytes `readReaderConfig` read, kept in place: the launch's kind decision parses its `[[kind]]` rules from them. */
export function peekConfigRead(): { readonly path: string; readonly bytes: Uint8Array } | null {
  return lastRead;
}

const notReadable = (what: string): string => `config.toml ${what} · every setting is at its default · fix the file, then reopen Marxy`;
const firstLine = (text: string): string => text.split('\n', 1)[0]!.trim().replace(/\.$/, '');

/** A read failure without the path the shell prefixes it with or the OS error number. */
function plainReason(e: unknown, path: string): string {
  const raw = e instanceof Error ? e.message : typeof (e as { message?: unknown } | null)?.message === 'string' ? (e as { message: string }).message : String(e);
  const text = (raw.startsWith(`${path}:`) ? raw.slice(path.length + 1) : raw).replace(/\s*\(os error \d+\)/, '').trim().replace(/\.$/, '');
  return text === '' ? 'the file could not be opened' : text;
}

/**
 * The parsed config, or the defaults on any failure (no path, no file, unreadable, unparsable). `onPaths` is told
 * where config.toml and the data directory are as soon as the shell has said, before config.toml is read, so a
 * caller can start a read of its own beside this one without asking the shell for the paths again.
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
    pendingNotices = parsed.warnings.filter((w) => /^(chrome_size|variant|size|measure) /.test(w));
    if (parsed.parseError !== undefined) pendingNotices.push(notReadable(`is not valid TOML (${firstLine(parsed.parseError)})`));
    return parsed.config;
  } catch (e) {
    // No file is an answer too: the theme read need not ask the same question again.
    if ((e as { code?: string } | null)?.code === 'not-found') lastRead = { path, bytes: new Uint8Array() };
    else pendingNotices = [notReadable(`could not be read (${plainReason(e, path)})`)];
    return fallback;
  }
}

/** The line box for a body size: twice the rounded three-quarter, so it is always even. */
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
 * prose, so it is not set on the prose grid. Inside prose the
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

/** The root attributes more contrast and solid fills set; the stylesheet's `base.css` keys on them. */
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

type ReaderConfig = Partial<Pick<Config, 'variant' | 'size' | 'lineNumbers' | 'chromeSize' | 'showWhitespace' | 'columnGuide' | 'contrast' | 'reduceTransparency' | 'measure' | 'measureSet' | 'typeset'>>;

/** Every key as last applied: the looks paint over the same root properties, and give these back when they go off. */
let applied: ReaderConfig = {};
const appliedListeners = new Set<() => void>();

/** Called after each `applyReaderConfig`: the look painter paints its tokens again over what a write just set. */
export function onReaderConfigApplied(cb: () => void): () => void {
  appliedListeners.add(cb);
  return () => appliedListeners.delete(cb);
}

/** The variant (`auto` following the system again), sizes and measure as config.toml last said them, on `root` again. */
export function reapplyReaderConfig(root: HTMLElement): void {
  const { variant, size, measure, measureSet, typeset } = applied;
  applyReaderConfig(root, { variant, size, measure, measureSet, typeset, ...('chromeSize' in applied ? { chromeSize: applied.chromeSize } : {}) });
}

/**
 * Applies variant and size to `root`. `auto` follows the system until the next call; the returned
 * function stops that following.
 */
export function applyReaderConfig(root: HTMLElement, cfg: ReaderConfig): () => void {
  applied = { ...applied, ...cfg };
  stopAuto?.();
  stopAuto = null;
  const variant = cfg.variant ?? DEFAULTS.variant;
  const size = cfg.size ?? DEFAULTS.size;
  // Only a key the reader wrote speaks for the gutter; absent, the per-path default stands.
  if (cfg.lineNumbers !== undefined) setLineNumbersChoice(cfg.lineNumbers);
  // The same for the two Source aids: absent, whitespace is off and the guide follows the kind of file.
  if (cfg.showWhitespace !== undefined) setShowWhitespaceChoice(cfg.showWhitespace);
  if (cfg.columnGuide !== undefined) setColumnGuideChoice(cfg.columnGuide);
  // Contrast and transparency are the config's alone: a call that names neither (the palette's variant and size commands) leaves them as they are.
  if (cfg.contrast !== undefined || cfg.reduceTransparency !== undefined) applyContrast(root, cfg.contrast ?? 'system', cfg.reduceTransparency ?? false);
  // The measure: a `measure` the reader wrote applies to every kind, over the kind's own, while Typeset is on (with it off Marxy sets no
  // measure, and the Settings page disables the control to say so). Unset, each kind keeps its own. A call that names no measure (the palette's
  // variant and size) leaves it.
  if (cfg.measure !== undefined) {
    if (cfg.measureSet === true && cfg.typeset !== false) {
      root.style.setProperty(MEASURE_PROPERTY, String(cfg.measure));
      root.style.setProperty(MEASURE_USER_PROPERTY, String(cfg.measure));
    } else {
      root.style.removeProperty(MEASURE_PROPERTY);
      root.style.removeProperty(MEASURE_USER_PROPERTY);
    }
  }
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
  // Set only when the reader wrote a valid value; unset, the theme's value stands. A call that does not name it (the variant
  // and size commands) leaves it as it is.
  if ('chromeSize' in cfg) {
    if (cfg.chromeSize === undefined || cfg.chromeSize === null) root.style.removeProperty(CHROME_SIZE_PROPERTY);
    else root.style.setProperty(CHROME_SIZE_PROPERTY, `${cfg.chromeSize}px`);
  }
  for (const cb of [...appliedListeners]) cb();
  return stop;
}

let writes: Promise<void> = Promise.resolve();

/**
 * Every key a command or the Settings page writes through `writeReaderKey` and `resetReaderKey`. The tables (`kind`, `strip`, `linux`) are
 * not here: they are edited in config.toml, never by a line write.
 */
export const READER_KEYS = [
  'variant', 'size', 'line_numbers', 'show_whitespace', 'column_guide', 'chrome_size', 'theme', 'contrast', 'reduce_transparency',
  'measure', 'typeset', 'external_editor', 'copy_format', 'versions', 'verbs', 'review_changes', 'proposals', 'version_copies',
] as const;
export type ReaderKey = (typeof READER_KEYS)[number];

export function isReaderKey(key: string): key is ReaderKey {
  return (READER_KEYS as readonly string[]).includes(key);
}

/**
 * config.toml is not the bytes the caller last saw (a hand edit, another program): the write is refused and nothing is written.
 * `current` is the file as it is now, for the page to show.
 */
export class ConfigChangedError extends Error {
  readonly code = 'changed-on-disk';
  readonly current: Uint8Array;
  constructor(current: Uint8Array) {
    super('config.toml changed on disk since it was read; nothing was written');
    this.current = current;
  }
}

export interface WriteOptions {
  /**
   * The bytes the caller is writing over. When the file holds anything else now, the write is refused with `ConfigChangedError`. A
   * function is asked when the write runs, not when it was queued, so a change made right behind another is over what the first left.
   */
  readonly expected?: Uint8Array | (() => Uint8Array);
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Reads config.toml (a missing file is empty), hands the bytes to `edit`, writes what it returns. A missing file is created; a file that
 * exists but cannot be read is left alone. Writes run one after another, so three quick presses are three read-modify-writes in order,
 * not three that overwrite each other. The shell's own stale-write guard covers the instant between the read and the write.
 * Every write to config.toml goes through here, whatever the caller: the queue is what keeps two edits from losing one.
 */
export function editConfig(shell: WriteShell, edit: (bytes: Uint8Array) => Uint8Array, opts: WriteOptions): Promise<Uint8Array | null> {
  const run = async (): Promise<Uint8Array | null> => {
    if (shell.configPaths === undefined) return null;
    const { config } = await shell.configPaths();
    let bytes: Uint8Array;
    try {
      bytes = await shell.readFile(config);
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== 'not-found') throw e;
      bytes = new Uint8Array();
    }
    const expected = typeof opts.expected === 'function' ? opts.expected() : opts.expected;
    if (expected !== undefined && !sameBytes(bytes, expected)) throw new ConfigChangedError(bytes);
    const next = edit(bytes);
    // Nothing to change (a reset of a key the file does not have): no write, and the file is not touched.
    if (next === bytes) return bytes;
    await shell.writeFileAtomic(config, next);
    noteWritten(config, bytes, next);
    return next;
  };
  const next = writes.then(run, run);
  writes = next.then(() => {}, () => {});
  return next;
}

/**
 * Sets one top-level key of config.toml, every other byte kept (`setTopLevelKey`). A missing file is created; a file that exists but
 * cannot be read is left alone. Resolves to the bytes now in the file. With `expected`, a file that is not those bytes is refused.
 */
export async function writeReaderKey(shell: WriteShell, key: ReaderKey, tomlValue: string, opts: WriteOptions = {}): Promise<Uint8Array | null> {
  return editConfig(shell, (bytes) => setTopLevelKey(bytes, key, tomlValue), opts);
}

/** Takes one top-level key's line out of config.toml, every other byte kept (`removeTopLevelKey`): the setting follows its default again. */
export async function resetReaderKey(shell: WriteShell, key: ReaderKey, opts: WriteOptions = {}): Promise<Uint8Array | null> {
  return editConfig(shell, (bytes) => removeTopLevelKey(bytes, key), opts);
}

/**
 * Puts config.toml back to `bytes`, which were its contents before a reset (the Settings page's Undo). Refused, as any write here, when the
 * file is not `expected`, the bytes the reset left, so an edit made since is never overwritten.
 */
export async function restoreReaderConfig(shell: WriteShell, bytes: Uint8Array, opts: WriteOptions): Promise<Uint8Array | null> {
  return editConfig(shell, () => bytes.slice(), opts);
}
