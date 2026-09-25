// Operation registry: palette order (ADR-0004). Story MARXY-42, MARXY-43.
import type { Operation } from '../contracts/operation.ts';
import { alignTablePipes } from './align-table-pipes.ts';
import { copyCodeClean } from './copy-code-clean.ts';
import { copySection } from './copy-section.ts';
import { toggleTask } from './toggle-task.ts';

export const OPERATIONS: readonly Operation[] = [copyCodeClean, copySection, toggleTask, alignTablePipes];

export { alignTablePipes, copyCodeClean, copySection, toggleTask };
