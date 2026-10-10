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
  const parts = relativePath.split('/').filter(Boolean);
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

/** Whether the character at `at` is escaped: preceded by an odd run of backslashes. */
function escapedAt(text: string, at: number): boolean {
  let n = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) n++;
  return n % 2 === 1;
}

function parseLine(raw: string, baseDir: string): IgnoreRule | undefined {
  let line = raw;
  // Trailing spaces are dropped unless a backslash escapes them.
  while (line.endsWith(' ') && !escapedAt(line, line.length - 1)) line = line.slice(0, -1);
  if (line === '' || line.startsWith('#')) return undefined;
  let negated = false;
  if (line.startsWith('!')) {
    negated = true;
    line = line.slice(1);
  }
  let directoryOnly = false;
  if (line.endsWith('/') && !escapedAt(line, line.length - 1)) {
    directoryOnly = true;
    line = line.slice(0, -1);
  }
  let anchored = line.startsWith('/');
  if (anchored) line = line.slice(1);
  if (line.includes('/')) anchored = true;
  if (!line) return undefined;
  // One bad line (`[z-a]`, a lone trailing backslash) drops that rule, never the whole index.
  let regex: RegExp;
  try {
    regex = compile(line, anchored, baseDir);
  } catch {
    return undefined;
  }
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
    if (c === '\\') {
      // A backslash makes the next character literal; one with nothing after it matches nothing.
      if (i + 1 >= pattern.length) return '(?!)';
      out += escapeRegex(pattern[i + 1]!);
      i += 2;
      continue;
    }
    if (c === '[') {
      const cls = bracketClass(pattern, i);
      if (cls) {
        out += cls.regex;
        i = cls.end;
        continue;
      }
    }
    out += escapeRegex(c);
    i += 1;
  }
  return out;
}

/** A bracket expression at `at` as a regex class (`!` or `^` negates; no class matches `/`), or undefined if unclosed. */
function bracketClass(pattern: string, at: number): { regex: string; end: number } | undefined {
  let i = at + 1;
  const negated = pattern[i] === '!' || pattern[i] === '^';
  if (negated) i += 1;
  let body = '';
  let first = true;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === ']' && !first) return { regex: `[${negated ? '^/' : ''}${body}]`, end: i + 1 };
    first = false;
    if (c === '\\' && i + 1 < pattern.length) {
      body += escapeInClass(pattern[i + 1]!);
      i += 2;
      continue;
    }
    body += c === '-' ? c : escapeInClass(c);
    i += 1;
  }
  return undefined;
}

const escapeInClass = (c: string): string => (/[A-Za-z0-9]/.test(c) ? c : `\\${c}`);

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
