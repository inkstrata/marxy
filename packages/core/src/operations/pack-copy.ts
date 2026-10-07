// The copy pack: operations land here, one pack per story, so no two stories edit the same file.
import type { Operation } from '../contracts/operation.ts';
import { copyPlain } from './copy-plain.ts';
import { copyRich } from './copy-rich.ts';
import { copySource } from './copy-source.ts';

export const COPY_PACK: readonly Operation[] = [copySource, copyPlain, copyRich];
