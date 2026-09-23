// Operation registry: palette order (ADR-0004). Story MARXY-42.
import type { Operation } from '../contracts/operation.ts';
import { copyCodeClean } from './copy-code-clean.ts';
import { copySection } from './copy-section.ts';

export const OPERATIONS: readonly Operation[] = [copyCodeClean, copySection];

export { copyCodeClean, copySection };
