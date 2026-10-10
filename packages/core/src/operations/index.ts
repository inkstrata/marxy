// Operation registry: palette order (ADR-0004). Story MARXY-42, MARXY-43, C-02.
import type { Operation } from '../contracts/operation.ts';
import { alignTablePipes } from './align-table-pipes.ts';
import { copyCodeClean } from './copy-code-clean.ts';
import { copySection } from './copy-section.ts';
import { formatJson } from './format-json.ts';
import { formatYaml } from './format-yaml.ts';
import { demoteHeading, promoteHeading } from './heading-level.ts';
import { COPY_PACK } from './pack-copy.ts';
import { EXTRACT_PACK } from './pack-extract.ts';
import { TABLE_PACK } from './pack-table.ts';
import { toggleTask } from './toggle-task.ts';

/** Operations whose replacement is always the input text: they only fill the clipboard. */
export const CLIPBOARD_OPERATIONS: readonly Operation[] = [
  copyCodeClean,
  copySection,
  ...COPY_PACK,
  ...TABLE_PACK,
  ...EXTRACT_PACK,
];

/** Operations that rewrite the bytes they were given, and only those. */
export const MUTATING_OPERATIONS: readonly Operation[] = [toggleTask, alignTablePipes, promoteHeading, demoteHeading, formatJson, formatYaml];

export const OPERATIONS: readonly Operation[] = [...CLIPBOARD_OPERATIONS, ...MUTATING_OPERATIONS];

export { alignTablePipes, copyCodeClean, copySection, toggleTask };
