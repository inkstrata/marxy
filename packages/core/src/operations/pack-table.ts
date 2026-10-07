// The table pack: operations land here, one pack per story, so no two stories edit the same file.
import type { Operation } from '../contracts/operation.ts';
import { copyTableCsv, copyTableJson, copyTableTsv } from './copy-table.ts';

export const TABLE_PACK: readonly Operation[] = [copyTableTsv, copyTableCsv, copyTableJson];
