// One file-type table (V-09): a path's index kind, default view mode, CodeMirror id and Shiki id, from one place.
// Pure: no DOM, no I/O. The index allow-list, the mode rule, the Source loader and the gutter default read it.

import { basename } from './paths.ts';

export type FileKind = 'markdown' | 'text' | 'source' | 'theme';
export type FileMode = 'rendered' | 'source';

export interface FileType {
  readonly kind: FileKind;
  /** Mode a file opens in before the reader toggles. */
  readonly mode: FileMode;
  /** CodeMirror language id (the loader lives in the app); absent when Source has no grammar. */
  readonly cm?: string;
  /** Shiki language id; absent when there is none. */
  readonly shiki?: string;
  /** False for names the table decides but the index allow-list does not list. */
  readonly indexed: boolean;
}

const md = (shiki: string): FileType => ({ kind: 'markdown', mode: 'rendered', cm: 'markdown', shiki, indexed: true });
const text = (cm?: string): FileType => ({ kind: 'text', mode: 'rendered', cm, indexed: true });
const src = (cm?: string, shiki?: string): FileType => ({ kind: 'source', mode: 'source', cm, shiki, indexed: true });
/** A source file that opens in Read (K-08): a log is read, not edited, and Source is one action away. */
const readSrc = (shiki: string): FileType => ({ kind: 'source', mode: 'rendered', shiki, indexed: true });

/** By lowercase extension, no dot. */
const BY_EXTENSION: Readonly<Record<string, FileType>> = {
  md: md('markdown'),
  markdown: md('markdown'),
  mdown: md('markdown'),
  mkd: md('markdown'),
  mdx: md('mdx'),
  txt: text('markdown'),
  text: text('markdown'),
  ts: src('typescript', 'typescript'),
  tsx: src('tsx', 'tsx'),
  js: src('javascript', 'javascript'),
  jsx: src('jsx', 'jsx'),
  mjs: src('javascript', 'javascript'),
  cjs: src('javascript', 'javascript'),
  mts: src(undefined, 'typescript'),
  cts: src(undefined, 'typescript'),
  rs: src('rust', 'rust'),
  py: src('python', 'python'),
  go: src('go', 'go'),
  java: src('java', 'java'),
  kt: src(undefined, 'kotlin'),
  kts: src(undefined, 'kotlin'),
  c: src('c', 'c'),
  h: src('c', 'c'),
  cc: src('cpp', 'cpp'),
  cpp: src('cpp', 'cpp'),
  cxx: src('cpp', 'cpp'),
  hpp: src('cpp', 'cpp'),
  hh: src('cpp', 'cpp'),
  rb: src(undefined, 'ruby'),
  php: src(undefined, 'php'),
  swift: src(undefined, 'swift'),
  sh: src('shell', 'bash'),
  bash: src('shell', 'bash'),
  zsh: src('shell', 'bash'),
  json: src('json', 'json'),
  toml: src('toml', 'toml'),
  yaml: src('yaml', 'yaml'),
  yml: src('yaml', 'yaml'),
  html: src('html', 'html'),
  htm: src('html', 'html'),
  xml: src(undefined, 'xml'),
  sql: src(undefined, 'sql'),
  graphql: src(undefined, 'graphql'),
  lua: src(undefined, 'lua'),
  r: src(undefined, 'r'),
  ex: src(undefined, 'elixir'),
  exs: src(undefined, 'elixir'),
  hs: src(undefined, 'haskell'),
  vue: src(undefined, 'vue'),
  svelte: src(undefined, 'svelte'),
  css: src('css', 'css'),
  scss: src(undefined, 'scss'),
  // Logs and data (K-06): listed so the palette finds them; ADR-0060 decides how each is read. A log opens in Read
  // (K-08); `.out` is often not a log, and `detectKind` falls back from its shape.
  log: readSrc('log'),
  out: readSrc('log'),
  csv: src(),
  tsv: src(),
  jsonl: src(undefined, 'json'),
};

/** By exact name (case-sensitive). */
const BY_NAME: Readonly<Record<string, FileType>> = {
  'theme.css': { kind: 'theme', mode: 'source', cm: 'css', shiki: 'css', indexed: true },
  'theme.toml': { kind: 'theme', mode: 'source', indexed: true },
  Dockerfile: src('dockerfile', 'docker'),
  Makefile: src(undefined, 'make'),
};

/**
 * The extension-less text family (ADR-0060 item 3, K-05a): README, CONTRIBUTING, CHANGELOG, CHANGES, HISTORY, any
 * case. They open Rendered but are not in the index allow-list.
 */
const TEXT_FAMILY_NAMES: ReadonlySet<string> = new Set(['readme', 'contributing', 'changelog', 'changes', 'history']);
const TEXT_FAMILY: FileType = { kind: 'text', mode: 'rendered', indexed: false };

/** The table row for a lowercase, dotless extension, or `undefined`. */
export function fileTypeForExtension(ext: string): FileType | undefined {
  return Object.hasOwn(BY_EXTENSION, ext) ? BY_EXTENSION[ext] : undefined;
}

/** The table row for `path`: an exact name first, then the extension-less text family, then the extension. */
export function fileTypeOf(path: string): FileType | undefined {
  const name = basename(path);
  if (Object.hasOwn(BY_NAME, name)) return BY_NAME[name];
  const i = name.lastIndexOf('.');
  if (i <= 0) return TEXT_FAMILY_NAMES.has(name.toLowerCase()) && i < 0 ? TEXT_FAMILY : undefined;
  return fileTypeForExtension(name.slice(i + 1).toLowerCase());
}

/** Every extension the table lists, for tests and the Tauri file associations. */
export function tableExtensions(): string[] {
  return Object.keys(BY_EXTENSION);
}
