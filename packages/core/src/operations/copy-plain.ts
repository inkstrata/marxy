// copy-plain: the words of a block, section or document, without markup (C-07).
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { isBlockOrDocument } from './copy-source.ts';
import { blocksOf, plainTextOf } from './plain-text.ts';

/** Copy as plain text. Pure; never emits markdown. */
export const copyPlain: Operation = {
  id: 'copy-plain',
  title: 'Copy as plain text',
  appliesTo: ['block', 'section', 'document'],
  canApply: isBlockOrDocument,
  run(input: OperationInput): OperationResult {
    return { replacement: input.text, clipboard: { text: plainTextOf(blocksOf(input)) } };
  },
};
