// What the frame says about a file, with no DOM: a kind's label, and the word counter the status bar, the palette preview and
// the Outline share.
import type { Kind } from '@marxy/core/src/contracts/kinds.ts';
import { fileTypeOf } from '@marxy/core/src/kind/registry.ts';

/** How the language of a code file is written; any id not here is capitalised. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  typescript: 'TypeScript', javascript: 'JavaScript', tsx: 'TSX', jsx: 'JSX', cpp: 'C++', c: 'C', rust: 'Rust', python: 'Python',
  go: 'Go', java: 'Java', kotlin: 'Kotlin', ruby: 'Ruby', php: 'PHP', swift: 'Swift', shellscript: 'Shell', json: 'JSON', toml: 'TOML',
  yaml: 'YAML', html: 'HTML', xml: 'XML', sql: 'SQL', graphql: 'GraphQL', lua: 'Lua', r: 'R', elixir: 'Elixir', haskell: 'Haskell',
  vue: 'Vue', svelte: 'Svelte', css: 'CSS', scss: 'SCSS', docker: 'Dockerfile', make: 'Makefile', markdown: 'Markdown', mdx: 'MDX', csharp: 'C#', powershell: 'PowerShell', ini: 'INI', dotenv: '.env', rst: 'reStructuredText',
};

/** "Report", "Log", "Code · Rust": the kind with its first letter up, and for code the language the file's name says. */
export function kindLabel(kind: Kind, path: string): string {
  const name = kind.charAt(0).toUpperCase() + kind.slice(1);
  if (kind !== 'code') return name;
  const id = fileTypeOf(path)?.lang;
  if (id === undefined) return name;
  return `${name} · ${LANGUAGE_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)}`;
}

// The counter is core's words.ts: one function, so the bar, the palette preview and the Outline's sections agree.
export { countsAsMarkdown, countWords, createWordCounter, type WordCounter } from '@marxy/core/src/index-model/words.ts';
