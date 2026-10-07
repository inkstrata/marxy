// copy-rich: sanitised HTML with plain text beside it (C-07).
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';
import { renderDocumentSafeHtml } from '../render/pipeline.ts';
import { isBlockOrDocument } from './copy-source.ts';
import { stripRendererProvenance } from './html-clean.ts';
import { blocksOf, plainTextOf } from './plain-text.ts';

/** Copy as rich text. Pure: built exactly as copy-section builds its HTML. */
export const copyRich: Operation = {
  id: 'copy-rich',
  title: 'Copy as rich text',
  appliesTo: ['block', 'section', 'document'],
  canApply: isBlockOrDocument,
  run(input: OperationInput): OperationResult {
    const blocks = blocksOf(input);
    const section = { ...input.document, src: input.range, children: blocks };
    return {
      replacement: input.text,
      clipboard: {
        text: plainTextOf(blocks),
        html: stripRendererProvenance(renderDocumentSafeHtml(section).html),
      },
    };
  },
};
