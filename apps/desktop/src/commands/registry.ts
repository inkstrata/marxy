// Command registry: palette and keyboard share one list (docs/design/03-selection-and-operations.md, MARXY-42).
import type { Operation, OperationInput } from '@marxy/core';
import type { Shell } from '@marxy/shell-api';
import type { Selection } from '../selection/selection.ts';
import { apply } from '../selection/apply.ts';

export interface AppContext {
  readonly shell: Pick<Shell, 'clipboardWrite'>;
  readonly selection: Selection;
  operationInput(): OperationInput | null;
  closePalette(): void;
  showNotice(text: string, opts?: { transient?: boolean }): void;
  applyBufferMutation?(input: {
    readonly range: OperationInput['range'];
    readonly replacement: string;
    readonly label: string;
  }): Promise<void>;
}

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly key?: string;
  readonly group: 'document' | 'selection' | 'view' | 'app';
  when(ctx: AppContext): boolean;
  run(ctx: AppContext): Promise<void>;
}

export function fromOperation(op: Operation): Command {
  return {
    id: `op.${op.id}`,
    title: op.title,
    group: 'selection',
    when(ctx) {
      const input = ctx.operationInput();
      if (!input) return false;
      return op.canApply(input);
    },
    run(ctx) {
      const input = ctx.operationInput();
      if (!input || !op.canApply(input)) return Promise.resolve();
      return apply(op, ctx, input);
    },
  };
}
