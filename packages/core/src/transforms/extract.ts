// The Extract group (J-03): the output is new text made from the input. Code blocks, tasks and links go through
// E's extract operations (so their rules, including the refusal of deceptive characters, stay in one place).
import type { CodeBlock } from '../contracts/ast.ts';
import { copyCommand, hasDeceptiveCharacters } from '../operations/copy-command.ts';
import { extractCodeBlocks, extractLinks, extractTasks } from '../operations/extract.ts';
import { clipboardOf, gapsOf, nodesOf, parseText } from './prose.ts';
import { tablesAs } from './convert.ts';
import { copyTableCsv } from '../operations/copy-table.ts';
import type { TransformDef } from './types.ts';

const of = (op: typeof extractTasks) => (lf: string): string => clipboardOf(op, parseText(lf), lf) ?? '';

export const xCode: TransformDef = { id: 'x-code', kind: 'derive', run: of(extractCodeBlocks) };
export const xTasks: TransformDef = { id: 'x-tasks', kind: 'derive', run: of(extractTasks) };
export const xLinks: TransformDef = { id: 'x-links', kind: 'derive', run: of(extractLinks) };
export const xTables: TransformDef = { id: 'x-tables', kind: 'derive', run: (lf) => tablesAs(lf, copyTableCsv) ?? '' };

const SHELL = /^(?:bash|sh|shell|zsh|console)$/i;

export const xCommands: TransformDef = {
  id: 'x-commands',
  kind: 'derive',
  run(lf) {
    const doc = parseText(lf);
    const parts: string[] = [];
    let skipped = 0;
    for (const { node } of nodesOf<CodeBlock>(lf, doc, ['codeBlock'])) {
      if (!SHELL.test((node.lang ?? '').trim())) continue;
      if (hasDeceptiveCharacters(node.value)) {
        skipped++;
        continue;
      }
      // A console block with prompts yields its commands (output left out); a plain shell block is all commands.
      const commands = clipboardOf(copyCommand, doc, lf, node) ?? node.value.replace(/\n+$/, '');
      if (commands.trim() !== '') parts.push(commands);
    }
    if (parts.length === 0 && skipped === 0) return '';
    const note = skipped > 0 ? `# ${skipped} block${skipped === 1 ? '' : 's'} left out: invisible or direction-changing characters\n` : '';
    return `set -euo pipefail\n\n${note}${parts.join('\n\n')}`.replace(/\n+$/, '');
  },
};

/** Lines of prose (outside code and front matter) that satisfy `keep`, in order. */
function proseLines(lf: string, keep: (line: string) => boolean): string[] {
  return gapsOf(lf)
    .flatMap((g) => lf.slice(g.start, g.end).split('\n'))
    .filter(keep);
}

export const xQuestions: TransformDef = {
  id: 'x-questions',
  kind: 'derive',
  run: (lf) => proseLines(lf, (l) => /\?\s*$/.test(l)).map((l) => l.replace(/^(\s*)[*+]\s+/, '$1- ').replace(/\s+$/, '')).join('\n'),
};

/**
 * The paths the prose of `lf` names: backticked, with a slash and an extension (`src/a.ts`, `./b/c.md`, `~/x/y.toml`), unique,
 * in order of first mention. Code and front matter are not read. A bare `README.md` is not a mention (no slash). Called by
 * `x-paths` below and by the desktop inspector's Links tab (W-09).
 */
export function pathMentions(lf: string): string[] {
  const found: string[] = [];
  for (const line of proseLines(lf, () => true)) {
    for (const m of line.matchAll(/`([~.\w-]*\/[\w./-]+\.\w{1,6})`/g)) found.push(m[1]!);
  }
  return [...new Set(found)];
}

export const xPaths: TransformDef = {
  id: 'x-paths',
  kind: 'derive',
  run: (lf) => pathMentions(lf).join('\n'),
};

export const xHeadings: TransformDef = {
  id: 'x-headings',
  kind: 'derive',
  run(lf) {
    const doc = parseText(lf);
    return nodesOf(lf, doc, ['heading'])
      .map(({ node, span }) => {
        const level = (node as { level: number }).level;
        const raw = lf.slice(span.start, span.end).replace(/\n+$/, '');
        // ATX: drop the marks and any closing run; setext: the first line is the text.
        const text = raw.startsWith('#') ? raw.replace(/^#{1,6}[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '') : raw.split('\n')[0]!;
        return `${'  '.repeat(level - 1)}- ${text.trim()}`;
      })
      .join('\n');
  },
};

export const EXTRACT: readonly TransformDef[] = [xCode, xCommands, xTasks, xLinks, xPaths, xHeadings, xTables, xQuestions];
