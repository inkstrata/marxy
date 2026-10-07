// `collection.toml`: the folders a reader declared (06 §4.2). Parse, and append one folder without
// touching another byte. Shell-free: the host passes bytes and the home directory (ADR-0020).

import { parse } from 'smol-toml';
import { type IgnoreRule, parseIgnore } from './ignore.ts';
import { normalizePath } from './paths.ts';

export interface CollectionRoot {
  readonly path: string;
  readonly name?: string;
  readonly watch: boolean;
}

export interface Collection {
  readonly roots: readonly CollectionRoot[];
  readonly denyGlobs: readonly string[];
}

export interface ParseCollectionResult {
  readonly collection: Collection;
  readonly warnings: readonly string[];
  readonly unknownKeys: readonly string[];
}

/** A placeholder ceiling on declared folders; more warn and are dropped. */
const MAX_ROOTS = 32;

const ROOT_KEYS = new Set(['path', 'name', 'watch']);
const TOP_KEYS = new Set(['root', 'deny']);

const UNPARSEABLE = 'collection.toml could not be parsed; no extra folders';

const EMPTY: Collection = { roots: [], denyGlobs: [] };

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

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

/** True when the path holds a backslash that is not part of a Windows drive path. */
function hasUnsupportedBackslash(raw: string): boolean {
  return raw.includes('\\') && !WINDOWS_DRIVE.test(raw);
}

/** Expands `~` and `~/…`; returns null for anything that is not an absolute local path. */
function resolveRootPath(raw: string, home: string): string | null {
  if (raw.includes('://') || hasUnsupportedBackslash(raw)) return null;
  const h = normalizePath(home);
  let expanded = raw;
  if (raw === '~') expanded = h;
  else if (raw.startsWith('~/')) expanded = `${h === '/' ? '' : h}/${raw.slice(2)}`;
  const normalized = normalizePath(expanded);
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
  return absolute ? normalized : null;
}

/** Parses collection.toml bytes. Bad entries are skipped with a warning; a bad file is empty. */
export function parseCollection(bytes: Uint8Array, ctx: { readonly home: string }): ParseCollectionResult {
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
    if (hasUnsupportedBackslash(entry.path)) {
      warnings.push(`${label} path "${entry.path}": a backslash in a folder path is not supported yet; skipped`);
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
  return { collection: { roots, denyGlobs }, warnings, unknownKeys: [...unknown] };
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
  if (normalized === null) throw new RangeError(`not an absolute local folder, or has a backslash: ${path}`);
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
