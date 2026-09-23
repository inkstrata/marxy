// Applies a core operation: clipboard, optional splice, notice (§03, MARXY-42).
import type { Operation, OperationInput } from '@marxy/core';
import type { AppContext } from '../commands/registry.ts';

export async function apply(
  op: Operation,
  ctx: AppContext,
  input: OperationInput,
): Promise<void> {
  if (!op.canApply(input)) return;
  const result = op.run(input);
  if (result.clipboard) {
    await ctx.shell.clipboardWrite(result.clipboard);
  }
  if (result.replacement !== input.text) {
    if (!ctx.applyBufferMutation) {
      throw new Error('applyBufferMutation is not wired');
    }
    await ctx.applyBufferMutation({
      range: input.range,
      replacement: result.replacement,
      label: op.title,
    });
  }
  ctx.closePalette();
  if (result.clipboard) {
    ctx.showNotice('Copied', { transient: true });
  } else if (result.summary) {
    ctx.showNotice(result.summary, { transient: true });
  }
}

/** Mod+C: first applicable copy operation, else native copy. */
export async function runCopyShortcut(ctx: AppContext, copyOps: readonly Operation[]): Promise<void> {
  const input = ctx.operationInput();
  if (input) {
    for (const op of copyOps) {
      if (op.id.startsWith('copy-') && op.canApply(input)) {
        await apply(op, ctx, input);
        return;
      }
    }
  }
  if (ctx.selection.kind === 'text') {
    const text = ctx.selection.text;
    await ctx.shell.clipboardWrite({ text });
    return;
  }
  document.execCommand('copy');
}
