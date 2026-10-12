// Resolves EditorConfig tab width for Source mode and Rendered code (reader-artifacts handbook §04, V-16).
// Follows https://spec.editorconfig.org: matching sections merge in file order and the later one wins,
// files nearer the document win over those above, `root = true` stops the walk, and the walk never
// leaves the indexed root (which already ends at a `.git`).

import { normalizePath } from '@marxy/core/src/index-model/paths.ts';

const TAB_KEYS = new Set(['tab_width', 'indent_size', 'indent_style', 'max_line_length']);

export interface EditorConfigSection {
  readonly pattern: string;
  readonly tabWidth?: number;
  readonly indentSize?: number | 'tab';
  readonly indentStyle?: string;
  /** `max_line_length` as a number of columns; `off` and `unset` are none (V-08: the Source column guide follows it). */
  readonly maxLineLength?: number;
}

export interface EditorConfigFile {
  readonly root: boolean;
  readonly sections: readonly EditorConfigSection[];
}

/** Parse the few EditorConfig keys Marxy uses; ignores unknown lines and malformed values. */
export function parseEditorConfigFile(text: string): EditorConfigFile {
  const sections: EditorConfigSection[] = [];
  let root = false;
  let current: EditorConfigSection | null = null;
  const flush = (): void => {
    if (current !== null) sections.push(current);
    current = null;
  };
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      flush();
      current = { pattern: section[1]!.trim() };
      continue;
    }
    const kv = /^([a-zA-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.trim().toLowerCase();
    if (current === null) {
      // The preamble holds only `root`; a key before the first section applies to no file.
      if (key === 'root') root = value === 'true';
      continue;
    }
    if (!TAB_KEYS.has(key)) continue;
    if (key === 'tab_width') {
      if (value === 'unset') current = { ...current, tabWidth: undefined };
      else if (/^\d+$/.test(value)) current = { ...current, tabWidth: Number.parseInt(value, 10) };
    } else if (key === 'indent_size') {
      if (value === 'unset') current = { ...current, indentSize: undefined };
      else if (value === 'tab') current = { ...current, indentSize: 'tab' };
      else if (/^\d+$/.test(value)) current = { ...current, indentSize: Number.parseInt(value, 10) };
    } else if (key === 'max_line_length') {
      if (/^\d+$/.test(value)) current = { ...current, maxLineLength: Number.parseInt(value, 10) };
      else current = { ...current, maxLineLength: undefined };
    } else {
      current = { ...current, indentStyle: value === 'unset' ? undefined : value };
    }
  }
  flush();
  return { root, sections };
}

export function parseEditorConfig(text: string): EditorConfigSection[] {
  return [...parseEditorConfigFile(text).sections];
}

const RANGE_LIMIT = 1000;

/** Translate an EditorConfig glob into a regular expression source, or null when it cannot match. */
function globToRegExpSource(glob: string): string | null {
  let i = 0;
  const parseSeq = (inBrace: boolean): string | null => {
    let out = '';
    while (i < glob.length) {
      const c = glob[i]!;
      if (inBrace && (c === ',' || c === '}')) return out;
      if (c === '\\' && i + 1 < glob.length) {
        out += escapeRe(glob[i + 1]!);
        i += 2;
      } else if (c === '*') {
        if (glob[i + 1] === '*') {
          if (glob[i + 2] === '/' && (i === 0 || glob[i - 1] === '/')) {
            out += '(?:.*/)?'; // `**/` is zero or more folders
            i += 3;
          } else {
            out += '.*';
            i += 2;
          }
        } else {
          out += '[^/]*';
          i += 1;
        }
      } else if (c === '?') {
        out += '[^/]';
        i += 1;
      } else if (c === '[') {
        const close = glob.indexOf(']', i + 2);
        if (close < 0 || glob.slice(i, close).includes('/')) {
          out += '\\[';
          i += 1;
        } else {
          let body = glob.slice(i + 1, close);
          const negate = body.startsWith('!');
          if (negate) body = body.slice(1);
          out += `[${negate ? '^' : ''}${body.replace(/[\\\]^]/g, '\\$&')}]`;
          i = close + 1;
        }
      } else if (c === '{') {
        const braced = parseBrace();
        if (braced === null) return null;
        out += braced;
      } else {
        out += escapeRe(c);
        i += 1;
      }
    }
    return inBrace ? null : out;
  };
  const parseBrace = (): string | null => {
    const start = i;
    i += 1; // {
    const alts: string[] = [];
    for (;;) {
      const alt = parseSeq(true);
      if (alt === null) {
        // Unbalanced: the brace is literal text.
        i = start + 1;
        return '\\{';
      }
      alts.push(alt);
      if (glob[i] === ',') {
        i += 1;
        continue;
      }
      i += 1; // }
      break;
    }
    if (alts.length === 1) {
      const range = /^(-?\d+)\\\.\\\.(-?\d+)$/.exec(alts[0]!);
      if (range) {
        const lo = Number.parseInt(range[1]!, 10);
        const hi = Number.parseInt(range[2]!, 10);
        const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
        if (b - a > RANGE_LIMIT) return '(?!)';
        const nums: string[] = [];
        for (let n = a; n <= b; n++) nums.push(String(n).replace('-', '\\-'));
        return `(?:${nums.join('|')})`;
      }
      return `\\{${alts[0]}\\}`;
    }
    return `(?:${alts.join('|')})`;
  };
  return parseSeq(false);
}

function escapeRe(c: string): string {
  return c.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
}

const globCache = new Map<string, RegExp | null>();

function globRegExp(pattern: string): RegExp | null {
  if (globCache.has(pattern)) return globCache.get(pattern) ?? null;
  // A pattern with no slash matches a name at any depth; one with a slash is anchored at the config's folder.
  let glob = pattern;
  if (glob.startsWith('/')) glob = glob.slice(1);
  else if (!glob.includes('/')) glob = `**/${glob}`;
  const source = globToRegExpSource(glob);
  let re: RegExp | null = null;
  if (source !== null) {
    try {
      re = new RegExp(`^${source}$`);
    } catch {
      re = null;
    }
  }
  globCache.set(pattern, re);
  return re;
}

/** True when `relPath` (relative to the .editorconfig's folder, no leading slash) matches `pattern`. */
export function globMatch(pattern: string, relPath: string): boolean {
  const re = globRegExp(pattern);
  if (re === null) return false;
  return re.test(relPath);
}

export interface TabSettings {
  tabWidth?: number;
  indentSize?: number | 'tab';
  indentStyle?: string;
  maxLineLength?: number;
}

function mergeInto(into: TabSettings, section: EditorConfigSection): void {
  for (const key of ['tabWidth', 'indentSize', 'indentStyle', 'maxLineLength'] as const) {
    if (key in section) (into as Record<string, unknown>)[key] = section[key];
  }
}

/** Bound tab size 1–8; `tab_width` wins, else numeric `indent_size`, else 4. */
export function tabSizeFromSection(section: TabSettings | EditorConfigSection | null | undefined): number {
  if (section?.tabWidth !== undefined) return clampTab(section.tabWidth);
  if (typeof section?.indentSize === 'number') return clampTab(section.indentSize);
  return 4;
}

export function clampTab(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.min(8, Math.max(1, Math.round(n)));
}

/** POSIX dirname. */
export function dirname(path: string): string {
  const norm = normalizePath(path);
  const slash = norm.lastIndexOf('/');
  if (slash <= 0) return '/';
  return norm.slice(0, slash) || '/';
}

function isUnder(path: string, root: string): boolean {
  const p = normalizePath(path);
  const r = normalizePath(root);
  if (r === '/') return true;
  return p === r || p.startsWith(`${r}/`);
}

interface LocatedFile {
  readonly dir: string;
  readonly file: EditorConfigFile;
}

/** One walk per directory per session: the chain of parsed files from the root down to each directory. */
export interface EditorConfigCache {
  readonly chains: Map<string, Promise<readonly LocatedFile[]>>;
}

export function createEditorConfigCache(): EditorConfigCache {
  return { chains: new Map() };
}

function chainFor(
  dir: string,
  root: string,
  readText: (path: string) => Promise<string>,
  cache: EditorConfigCache,
): Promise<readonly LocatedFile[]> {
  const key = `${root}\0${dir}`;
  const hit = cache.chains.get(key);
  if (hit) return hit;
  const made = (async (): Promise<readonly LocatedFile[]> => {
    let file: EditorConfigFile | null = null;
    try {
      file = parseEditorConfigFile(await readText(dir === '/' ? '/.editorconfig' : `${dir}/.editorconfig`));
    } catch {
      // missing file: keep walking
    }
    const stop = file?.root === true || dir === root || dir === '/';
    const above = stop ? [] : await chainFor(dirname(dir), root, readText, cache);
    return file ? [...above, { dir, file }] : above;
  })();
  cache.chains.set(key, made);
  return made;
}

/**
 * Walk from the file's directory toward `indexedRoot`, reading `.editorconfig` through `readText`.
 * Stops at `root = true` or at the indexed root; never reads above it. Matching sections merge in file
 * order (nearer files and later sections win), per key.
 */
async function resolveSettings(
  filePath: string,
  indexedRoot: string,
  readText: (path: string) => Promise<string>,
  cache: EditorConfigCache,
): Promise<TabSettings> {
  const norm = normalizePath(filePath);
  const root = normalizePath(indexedRoot);
  const dir = dirname(norm);
  if (!isUnder(dir, root)) return {};
  const chain = await chainFor(dir, root, readText, cache);
  const merged: TabSettings = {};
  for (const { dir: configDir, file } of chain) {
    const rel = configDir === '/' ? norm.slice(1) : norm.slice(configDir.length + 1);
    for (const section of file.sections) {
      if (globMatch(section.pattern, rel)) mergeInto(merged, section);
    }
  }
  return merged;
}

/** The tab width for a file: `tab_width`, else a numeric `indent_size`, else 4. */
export async function resolveTabWidth(
  filePath: string,
  indexedRoot: string,
  readText: (path: string) => Promise<string>,
  cache: EditorConfigCache = createEditorConfigCache(),
): Promise<number> {
  return tabSizeFromSection(await resolveSettings(filePath, indexedRoot, readText, cache));
}

/** The file's `max_line_length` in columns, or null when no section gives one (V-08: the Source column guide). */
export async function resolveMaxLineLength(
  filePath: string,
  indexedRoot: string,
  readText: (path: string) => Promise<string>,
  cache: EditorConfigCache = createEditorConfigCache(),
): Promise<number | null> {
  return (await resolveSettings(filePath, indexedRoot, readText, cache)).maxLineLength ?? null;
}

/** The root when nothing can say where the project is (a shell with no `readDir`): the file's own folder. */
export function fallbackRoot(filePath: string): string {
  return dirname(filePath);
}
