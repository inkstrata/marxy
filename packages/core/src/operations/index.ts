// Operation registry: palette order (ADR-0004). Story MARXY-42, MARXY-43, C-02.
import type { Operation } from '../contracts/operation.ts';
import { alignTablePipes } from './align-table-pipes.ts';
import { copyCodeClean } from './copy-code-clean.ts';
import { copyCommand } from './copy-command.ts';
import { copyPlain } from './copy-plain.ts';
import { copyRich } from './copy-rich.ts';
import { copySection } from './copy-section.ts';
import { copySource } from './copy-source.ts';
import { copyTableCsv, copyTableJson, copyTableTsv } from './copy-table.ts';
import { dedupeLines } from './dedupe-lines.ts';
import { extractCodeBlocks, extractLinks, extractTasks } from './extract.ts';
import { formatJson } from './format-json.ts';
import { formatYaml } from './format-yaml.ts';
import { demoteHeading, promoteHeading } from './heading-level.ts';
import { bulletsFromGlyphs, listToBullets, listToNumbers, renumberList } from './list-markers.ts';
import { moveSectionDown, moveSectionUp } from './move-section.ts';
import { sortListItems } from './sort-list-items.ts';
import { toggleTask } from './toggle-task.ts';
import { unwrapMarkdownFence } from './unwrap-markdown-fence.ts';

// Both lists below are one entry per line, sorted by operation id, with a trailing comma, so a story that adds an
// operation touches its own line and git merges two such stories without a conflict (F-32). The palette sorts for
// itself (group, then title), so this order is not what the reader sees.

/** Operations whose replacement is always the input text: they only fill the clipboard. */
export const CLIPBOARD_OPERATIONS: readonly Operation[] = [
  copyCodeClean,
  copyCommand,
  copyPlain,
  copyRich,
  copySection,
  copySource,
  copyTableCsv,
  copyTableJson,
  copyTableTsv,
  extractCodeBlocks,
  extractLinks,
  extractTasks,
];

/** Operations that rewrite the bytes they were given, and only those. */
export const MUTATING_OPERATIONS: readonly Operation[] = [
  alignTablePipes,
  bulletsFromGlyphs,
  dedupeLines,
  demoteHeading,
  formatJson,
  formatYaml,
  listToBullets,
  listToNumbers,
  moveSectionDown,
  moveSectionUp,
  promoteHeading,
  renumberList,
  sortListItems,
  toggleTask,
  unwrapMarkdownFence,
];

export const OPERATIONS: readonly Operation[] = [...CLIPBOARD_OPERATIONS, ...MUTATING_OPERATIONS];

export { alignTablePipes, copyCodeClean, copySection, dedupeLines, sortListItems, toggleTask, unwrapMarkdownFence };
