// Command registry: palette and keyboard share one list (docs/design/03-selection-and-operations.md, MARXY-42).
import type { Buffer, Operation, OperationInput } from '@marxy/core';
import type { Shell } from '@marxy/shell-api';
import type { Selection } from '../selection/selection.ts';
import type { DocumentStore } from '../document/store.ts';
import { attachDocumentEdits } from './edits.ts';
import { apply } from '../selection/apply.ts';

export interface AppContext {
  readonly shell: Pick<Shell, 'clipboardWrite'>;
  readonly selection: Selection;
  /** The open document's store (ADR-0037), or null: operations, undo and save are its transitions. */
  readonly document: DocumentStore | null;
  operationInput(): OperationInput | null;
  /**
   * The selection's own input, then its widened ones: a cell's table, a task paragraph's item (C-06).
   * An operation runs on the first it accepts. Absent in a context with no selection runtime.
   */
  operationInputs?(): readonly OperationInput[];
  /** The page the selection was made on and the bytes it was rendered from (B-13): a drag's copies read it. */
  renderedPage?(): { readonly article: HTMLElement; readonly buffer: Buffer } | null;
  closePalette(): void;
  showNotice(text: string, opts?: { transient?: boolean }): void;
  applyBufferMutation?(input: {
    readonly range: OperationInput['range'];
    readonly replacement: string;
    readonly label: string;
  }): Promise<boolean | void>;
}

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly key?: string;
  /** Further chords that run the same command. */
  readonly keys?: readonly string[];
  /** Runs even when focus is in an editable, such as Source mode's editor. */
  readonly global?: boolean;
  readonly group: 'document' | 'selection' | 'view' | 'app';
  when(ctx: AppContext): boolean;
  run(ctx: AppContext): Promise<void>;
}

/** The first of the context's inputs the operation accepts: its own node first, then the widened ones. */
function inputFor(op: Operation, ctx: AppContext): OperationInput | null {
  const inputs = ctx.operationInputs?.() ?? [ctx.operationInput()].filter((i): i is OperationInput => i !== null);
  return inputs.find((input) => op.canApply(input)) ?? null;
}

export function fromOperation(op: Operation): Command {
  return {
    id: `op.${op.id}`,
    title: op.title,
    group: 'selection',
    when(ctx) {
      return inputFor(op, ctx) !== null;
    },
    run(ctx) {
      const input = inputFor(op, ctx);
      if (!input) return Promise.resolve();
      return apply(op, attachDocumentEdits(ctx), input);
    },
  };
}
