// `.gitignore` / `.ignore` matching. A deny-listed name still wins over a negation (ADR-0012).

import { isDeniedName, isDeniedPath } from './deny.ts';

/** One pattern from a `.gitignore` or `.ignore` file. */
export interface IgnoreRule {
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  readonly anchored: boolean;
  readonly pattern: string;
  readonly baseDir: string;
  readonly regex: RegExp;
}

/**
 * Parse gitignore syntax. `baseDir` is the directory of the ignore file, relative to the
 * index root, so a nested `.gitignore` only applies under itself.
 */
export function parseIgnore(text: string, baseDir = ''): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseLine(raw, baseDir);
    if (parsed) rules.push(parsed);
  }
  return rules;
}

/**
 * True when `relativePath` (from the index root, `/`-separated) must not be indexed.
 * Deny-list names cannot be un-ignored: indexing `node_modules` is never a reader request.
 */
export function isIgnored(relativePath: string, isDir: boolean, rules: readonly IgnoreRule[]): boolean {
  if (isDeniedPath(relativePath)) return true;
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.slice(0, i + 1).join('/');
    const prefixIsDir = isDir || i < parts.length - 1;
    if (isDeniedName(parts[i]!)) return true;
    const status = lastMatch(prefix, prefixIsDir, rules);
    // A denied directory is not descended into; a later `!` cannot resurrect its children.
    if (prefixIsDir && status === true) return true;
    if (!prefixIsDir) return status === true;
  }
  return false;
}

function lastMatch(relativePath: string, isDir: boolean, rules: readonly IgnoreRule[]): boolean | undefined {
  let status: boolean | undefined;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDir) continue;
    if (!underBase(relativePath, rule.baseDir)) continue;
    if (rule.regex.test(relativePath)) status = !rule.negated;
  }
  return status;
}

function underBase(relativePath: string, baseDir: string): boolean {
  if (!baseDir) return true;
  const base = baseDir.replace(/\/+$/, '');
  return relativePath === base || relativePath.startsWith(`${base}/`);
}

function parseLine(raw: string, baseDir: string): IgnoreRule | undefined {
  let line = raw;
  if (!line.endsWith('\\ ')) line = line.replace(/ +$/, '');
  if (line === '' || line.startsWith('#')) return undefined;
  let negated = false;
  if (line.startsWith('!')) {
    negated = true;
    line = line.slice(1);
  }
  if (line.startsWith('\\#')) line = line.slice(1);
  let directoryOnly = false;
  if (line.endsWith('/') && !line.endsWith('\\/')) {
    directoryOnly = true;
    line = line.slice(0, -1);
  }
  let anchored = line.startsWith('/');
  if (anchored) line = line.slice(1);
  if (line.includes('/')) anchored = true;
  if (!line) return undefined;
  const regex = compile(line, anchored, baseDir);
  return { negated, directoryOnly, anchored, pattern: line, baseDir, regex };
}

function compile(pattern: string, anchored: boolean, baseDir: string): RegExp {
  const body = globToRegex(pattern);
  const prefix = baseDir ? `${escapeRegex(baseDir.replace(/\/+$/, ''))}/` : '';
  const start = anchored ? `^${prefix}` : `^${prefix}(?:.*/)?`;
  return new RegExp(`${start}${body}$`);
}

function globToRegex(pattern: string): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (pattern.startsWith('**', i)) {
      out += '.*';
      i += 2;
      continue;
    }
    const c = pattern[i]!;
    if (c === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close > i) {
        out += pattern.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }
    out += escapeRegex(c);
    i += 1;
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
