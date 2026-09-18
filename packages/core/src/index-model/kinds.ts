// Extension allow-list: markdown and text first, then source, then a theme document (ADR-0012).

import type { IndexEntry } from '../contracts/index-entry.ts';
import { basename } from './paths.ts';

const MARKDOWN = new Set(['md', 'mdx', 'markdown', 'mdown', 'mkd']);
const TEXT = new Set(['txt', 'text']);
const SOURCE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'rs',
  'py',
  'go',
  'java',
  'kt',
  'kts',
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hpp',
  'hh',
  'rb',
  'php',
  'swift',
  'sh',
  'bash',
  'zsh',
  'json',
  'toml',
  'yaml',
  'yml',
  'html',
  'htm',
  'xml',
  'sql',
  'graphql',
  'lua',
  'r',
  'ex',
  'exs',
  'hs',
  'vue',
  'svelte',
  'css',
  'scss',
]);

/** Lowercase extension without the dot, or `''` when the name has none. */
export function extensionOf(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i + 1).toLowerCase();
}

/**
 * Classifies a path into an index kind, or `undefined` when the allow-list rejects it.
 * Binaries drop out here: they have no listed extension.
 */
export function classify(path: string): IndexEntry['kind'] | undefined {
  const name = basename(path);
  if (name === 'theme.css' || name === 'theme.toml') return 'theme';
  if (name === 'Dockerfile' || name === 'Makefile') return 'source';
  const ext = extensionOf(path);
  if (MARKDOWN.has(ext)) return 'markdown';
  if (TEXT.has(ext)) return 'text';
  if (SOURCE.has(ext)) return 'source';
  return undefined;
}
