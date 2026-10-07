// Resolves EditorConfig tab width for Source mode (reader-artifacts handbook §04).

import { normalizePath } from '@marxy/core/src/index-model/paths.ts';

const TAB_KEYS = new Set(['tab_width', 'indent_size', 'indent_style']);

export interface EditorConfigSection {
  readonly pattern: string;
  readonly tabWidth?: number;
  readonly indentSize?: number | 'tab';
  readonly indentStyle?: string;
}

/** Parse the few EditorConfig keys Marxy uses; ignores unknown lines and malformed values. */
export function parseEditorConfig(text: string): EditorConfigSection[] {
  const sections: EditorConfigSection[] = [];
  let current: EditorConfigSection | null = null;
  const flush = (): void => {
    if (current !== null) sections.push(current);
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      flush();
      current = { pattern: section[1]!.trim() };
      continue;
    }
    if (current === null) current = { pattern: '*' };
    const kv = /^([a-zA-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (!kv || !TAB_KEYS.has(kv[1]!)) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    if (key === 'tab_width') {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) current = { ...current, tabWidth: n };
    } else if (key === 'indent_size') {
      if (value === 'tab') current = { ...current, indentSize: 'tab' };
      else {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n)) current = { ...current, indentSize: n };
      }
    } else if (key === 'indent_style') {
      current = { ...current, indentStyle: value };
    }
  }
  flush();
  return sections;
}

function globMatch(pattern: string, path: string): boolean {
  const norm = normalizePath(path);
  const base = norm.split('/').pop() ?? norm;
  if (pattern.includes('/')) {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return re.test(norm);
  }
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(base);
}

function sectionForPath(sections: readonly EditorConfigSection[], filePath: string): EditorConfigSection | null {
  let best: EditorConfigSection | null = null;
  let bestLen = -1;
  for (const section of sections) {
    if (!globMatch(section.pattern, filePath)) continue;
    const len = section.pattern.length;
    if (len >= bestLen) {
      best = section;
      bestLen = len;
    }
  }
  return best;
}

/** Bound tab size 1–8; `tab_width` wins, else numeric `indent_size`, else 4. */
export function tabSizeFromSection(section: EditorConfigSection | null): number {
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

/**
 * Walk from the file's directory toward `indexedRoot`, reading `.editorconfig` through `readText`.
 * Stops at the indexed root; never reads outside it.
 */
export async function resolveTabWidth(
  filePath: string,
  indexedRoot: string,
  readText: (path: string) => Promise<string>,
): Promise<number> {
  let dir = dirname(filePath);
  const root = normalizePath(indexedRoot);
  while (isUnder(dir, root)) {
    const configPath = dir === '/' ? '/.editorconfig' : `${dir}/.editorconfig`;
    try {
      const text = await readText(configPath);
      const section = sectionForPath(parseEditorConfig(text), filePath);
      if (section !== null) return tabSizeFromSection(section);
    } catch {
      // missing file: keep walking
    }
    if (dir === root || dir === '/') break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 4;
}

/** Indexed root for harness documents: `/repo` for `/repo/pkg/file.rs`. */
export function indexedRootForDocument(filePath: string): string {
  const parts = normalizePath(filePath).split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  return `/${parts[0]}`;
}
