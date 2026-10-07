// The extract pack: operations land here, one pack per story, so no two stories edit the same file.
import type { Operation } from '../contracts/operation.ts';
import { copyCommand } from './copy-command.ts';
import { extractCodeBlocks, extractLinks, extractTasks } from './extract.ts';

export const EXTRACT_PACK: readonly Operation[] = [copyCommand, extractCodeBlocks, extractTasks, extractLinks];
