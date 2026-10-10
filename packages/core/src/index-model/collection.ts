// `collection.toml`: the folders a reader declared (06 §4.2). Parse, and append one folder without
// touching another byte. Shell-free: the host passes bytes and the home directory (ADR-0020).

import { parse } from 'smol-toml';
import { type CaptureRule, parseCaptures } from './capture.ts';
import { type IgnoreRule, parseIgnore } from './ignore.ts';
import { isWindowsPath, normalizePath } from './paths.ts';

export interface CollectionRoot {
  readonly path: string;
  readonly name?: string;
  readonly watch: boolean;
}

/** A saved query (a Smart collection): `q` is stored as the reader wrote it; Q-02 parses it. */
export interface SavedQuery {
  readonly name: string;
  readonly q: string;
  readonly description?: string;
}

export interface Collection {
  readonly roots: readonly CollectionRoot[];
  readonly denyGlobs: readonly string[];
  readonly queries: readonly SavedQuery[];
  readonly captures: readonly CaptureRule[];
}

export interface ParseCollectionResult {
  readonly collection: Collection;
  readonly warnings: readonly string[];
  readonly unknownKeys: readonly string[];
}

/** A placeholder ceiling on declared folders; more warn and are dropped. */
const MAX_ROOTS = 32;

const ROOT_KEYS = new Set(['path', 'name', 'watch']);
const QUERY_KEYS = new Set(['name', 'q', 'description']);
const TOP_KEYS = new Set(['root', 'deny', 'query', 'capture']);

const MAX_QUERIES = 200;
const MAX_QUERY_NAME = 80;
const MAX_QUERY_Q = 1000;

const UNPARSEABLE = 'collection.toml could not be parsed; no extra folders';

const EMPTY: Collection = { roots: [], denyGlobs: [], queries: [], captures: [] };

/** Header comment of a fresh file (06 §4.2). Ends in a blank line. */
export const COLLECTION_TEMPLATE: string = [
  '# Folders Marxy searches. Edit freely; Marxy re-reads this file when it changes.',
  '#',
  '# [[root]]',
  '# path  = "~/notes"          # absolute, or starting with ~',
  '# name  = "Notes"            # optional; shown dim beside results',
  '# watch = true               # default true; false = rescan on launch only',
  '#',
  '# [deny]',
  '# globs = ["**/drafts/**"]   # added to the built-in deny list',
  '',
  '',
].join('\n');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Expands `~` and `~/…`; returns null for anything that is not an absolute local path. */
function resolveRootPath(raw: string, home: string): string | null {
  if (raw.includes('://')) return null;
  const h = normalizePath(home);
  // A backslash separates only in a Windows path (a drive, or a home that is one).
  const windows = isWindowsPath(raw) || (isWindowsPath(h) && raw.startsWith('~\\'));
  let expanded = windows ? raw.replace(/\\/g, '/') : raw;
  if (raw === '~') expanded = h;
  else if (expanded.startsWith('~/')) expanded = `${h === '/' ? '' : h}/${expanded.slice(2)}`;
  const normalized = normalizePath(expanded);
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
  return absolute ? normalized : null;
}

/** Parses collection.toml bytes. Bad entries are skipped with a warning; a bad file is empty. */
export function parseCollection(bytes: Uint8Array, ctx: { readonly home: string; readonly ownFolders?: readonly string[] }): ParseCollectionResult {
  const text = new TextDecoder().decode(bytes); // strips a leading BOM
  const warnings: string[] = [];
  const unknown = new Set<string>();
  let raw: Record<string, unknown> = {};
  if (text.trim() !== '') {
    try {
      raw = parse(text) as Record<string, unknown>;
    } catch {
      return {
        collection: EMPTY,
        warnings: [UNPARSEABLE],
        unknownKeys: [],
      };
    }
  }
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) unknown.add(k);

  const roots: CollectionRoot[] = [];
  const seen = new Set<string>();
  const entries = Array.isArray(raw.root) ? raw.root : raw.root === undefined ? [] : null;
  if (entries === null) warnings.push('root must be a list of [[root]] tables; ignored');
  for (const [i, entry] of (entries ?? []).entries()) {
    const label = `root ${i + 1}`;
    if (!isRecord(entry)) {
      warnings.push(`${label} is not a table; skipped`);
      continue;
    }
    for (const k of Object.keys(entry)) if (!ROOT_KEYS.has(k)) unknown.add(`root.${k}`);
    if (typeof entry.path !== 'string' || entry.path === '') {
      warnings.push(`${label} has no path; skipped`);
      continue;
    }
    const path = resolveRootPath(entry.path, ctx.home);
    if (path === null) {
      warnings.push(`${label} path "${entry.path}" is not an absolute local folder; skipped`);
      continue;
    }
    if (seen.has(path)) {
      warnings.push(`${label} repeats ${path}; dropped`);
      continue;
    }
    if (roots.length >= MAX_ROOTS) {
      warnings.push(`more than ${MAX_ROOTS} folders; ${path} dropped`);
      continue;
    }
    let watch = true;
    if (typeof entry.watch === 'boolean') watch = entry.watch;
    else if (entry.watch !== undefined) warnings.push(`${label} watch was not true or false; using true`);
    let name: string | undefined;
    if (typeof entry.name === 'string') name = entry.name;
    else if (entry.name !== undefined) warnings.push(`${label} name was not a string; ignored`);
    seen.add(path);
    roots.push(name === undefined ? { path, watch } : { path, name, watch });
  }

  let denyGlobs: string[] = [];
  if (raw.deny !== undefined) {
    if (!isRecord(raw.deny)) warnings.push('deny must be a table; ignored');
    else {
      for (const k of Object.keys(raw.deny)) if (k !== 'globs') unknown.add(`deny.${k}`);
      const g = raw.deny.globs;
      if (Array.isArray(g) && g.every((x) => typeof x === 'string')) denyGlobs = g as string[];
      else if (g !== undefined) warnings.push('deny.globs must be a list of strings; ignored');
    }
  }
  const queries = parseQueries(raw.query, warnings, unknown);
  const cap = parseCaptures(raw.capture, { home: ctx.home, ownFolders: ctx.ownFolders ?? [], denyGlobs, resolvePath: resolveRootPath });
  warnings.push(...cap.warnings);
  for (const k of cap.unknownKeys) unknown.add(k);
  return { collection: { roots, denyGlobs, queries, captures: cap.captures }, warnings, unknownKeys: [...unknown] };
}

/** Why a name/q pair cannot be a saved query, or null. Lengths count characters, not UTF-16 units. */
function queryProblem(name: unknown, q: unknown): string | null {
  if (typeof name !== 'string' || name.trim() === '') return 'has no name';
  if (typeof q !== 'string' || q.trim() === '') return 'has no q';
  if ([...name].length > MAX_QUERY_NAME) return `has a name over ${MAX_QUERY_NAME} characters`;
  if ([...q].length > MAX_QUERY_Q) return `has a q over ${MAX_QUERY_Q} characters`;
  return null;
}

function parseQueries(rawQuery: unknown, warnings: string[], unknown: Set<string>): SavedQuery[] {
  const out: SavedQuery[] = [];
  if (rawQuery === undefined) return out;
  if (!Array.isArray(rawQuery)) {
    warnings.push('query must be a list of [[query]] tables; ignored');
    return out;
  }
  const names = new Set<string>();
  for (const [i, entry] of rawQuery.entries()) {
    const label = `query ${i + 1}`;
    if (!isRecord(entry)) {
      warnings.push(`${label} is not a table; skipped`);
      continue;
    }
    for (const k of Object.keys(entry)) if (!QUERY_KEYS.has(k)) unknown.add(`query.${k}`);
    const problem = queryProblem(entry.name, entry.q);
    if (problem !== null) {
      warnings.push(`${label} ${problem}; skipped`);
      continue;
    }
    const name = entry.name as string;
    const q = entry.q as string;
    const key = name.trim().toLowerCase();
    if (names.has(key)) {
      warnings.push(`${label} repeats the name "${name}"; dropped`);
      continue;
    }
    if (out.length >= MAX_QUERIES) {
      warnings.push(`more than ${MAX_QUERIES} queries; "${name}" dropped`);
      continue;
    }
    let description: string | undefined;
    if (typeof entry.description === 'string') description = entry.description;
    else if (entry.description !== undefined) warnings.push(`${label} description was not a string; ignored`);
    names.add(key);
    out.push(description === undefined ? { name, q } : { name, q, description });
  }
  return out;
}

/** Ignore rules for the reader's extra deny globs. The built-in deny list stays absolute. */
export function denyRulesFor(globs: readonly string[]): IgnoreRule[] {
  return parseIgnore(globs.join('\n'), '');
}

function tomlString(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (!s.includes("'") && !/[\u0000-\u001f\u007f]/.test(s)) return `'${s}'`;
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"${escaped}"`;
}

/**
 * Appends one `[[root]]` table. Every byte of the input survives; only text is added at the end.
 * A folder already listed (after normalisation) returns the input unchanged.
 */
export function appendRoot(bytes: Uint8Array, path: string, ctx: { readonly home: string }): Uint8Array {
  const normalized = resolveRootPath(path, ctx.home);
  if (normalized === null) throw new RangeError(`not an absolute local folder: ${path}`);
  const before = parseCollection(bytes, ctx);
  if (before.warnings.includes(UNPARSEABLE)) {
    throw new Error('collection.toml cannot be read as TOML; edit it by hand');
  }
  if (before.collection.roots.some((r) => r.path === normalized)) return bytes;

  const home = normalizePath(ctx.home);
  let written = normalized;
  if (normalized === home) written = '~';
  else if (home !== '/' && normalized.startsWith(`${home}/`)) written = `~${normalized.slice(home.length)}`;

  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let addition = '';
  if (bytes.length === 0) addition = COLLECTION_TEMPLATE.replace(/\n/g, eol);
  else if (!text.endsWith('\n')) addition = eol;
  addition += `[[root]]${eol}path = ${tomlString(written)}${eol}`;

  const tail = new TextEncoder().encode(addition);
  const out = new Uint8Array(bytes.length + tail.length);
  out.set(bytes, 0);
  out.set(tail, bytes.length);
  const after = parseCollection(out, ctx);
  if (after.warnings.includes(UNPARSEABLE)) {
    throw new Error('collection.toml has a `root` that is not a list of [[root]] tables; edit it by hand');
  }
  if (after.collection.roots.at(-1)?.path !== normalized) {
    throw new Error('collection.toml could not take the new folder; edit it by hand');
  }
  return out;
}

/**
 * Appends one `[[query]]` table. Every byte of the input survives; only text is added at the end.
 * Throws on an unreadable file, an invalid query, or a name already saved (case-insensitive).
 */
export function appendQuery(bytes: Uint8Array, query: SavedQuery, ctx: { readonly home: string }): Uint8Array {
  const problem = queryProblem(query.name, query.q);
  if (problem !== null) throw new RangeError(`query ${problem}`);
  const before = parseCollection(bytes, ctx);
  if (before.warnings.includes(UNPARSEABLE)) {
    throw new Error('collection.toml cannot be read as TOML; edit it by hand');
  }
  const key = query.name.trim().toLowerCase();
  if (before.collection.queries.some((x) => x.name.trim().toLowerCase() === key)) {
    throw new RangeError(`a query named "${query.name}" already exists`);
  }

  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let addition = '';
  if (bytes.length === 0) addition = COLLECTION_TEMPLATE.replace(/\n/g, eol);
  else if (!text.endsWith('\n')) addition = eol;
  addition += `[[query]]${eol}name = ${tomlString(query.name)}${eol}q = ${tomlString(query.q)}${eol}`;
  if (query.description !== undefined) addition += `description = ${tomlString(query.description)}${eol}`;

  const tail = new TextEncoder().encode(addition);
  const out = new Uint8Array(bytes.length + tail.length);
  out.set(bytes, 0);
  out.set(tail, bytes.length);
  const after = parseCollection(out, ctx);
  if (after.warnings.includes(UNPARSEABLE)) {
    throw new Error('collection.toml has a `query` that is not a list of [[query]] tables; edit it by hand');
  }
  const last = after.collection.queries.at(-1);
  if (last?.name !== query.name || last.q !== query.q || last.description !== query.description) {
    throw new Error('collection.toml could not take the new query; edit it by hand');
  }
  return out;
}
