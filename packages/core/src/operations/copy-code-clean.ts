// copy-code-clean: fenced code content without markup (ADR-0004, MARXY-42).
import type { CodeBlock } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';

function clipText(value: string): string {
  if (value.length === 0) return '';
  return value.endsWith('\n') ? value : `${value}\n`;
}

/** Copy code. Pure: text in, text out; never touches bytes outside input.range. */
export const copyCodeClean: Operation = {
  id: 'copy-code-clean',
  title: 'Copy code',
  appliesTo: ['block'],
  canApply(input) {
    return input.node?.type === 'codeBlock';
  },
  run(input: OperationInput): OperationResult {
    const block = input.node as CodeBlock;
    return {
      replacement: input.text,
      clipboard: { text: clipText(block.value) },
    };
  },
};
