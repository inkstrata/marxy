// Applies a core operation: clipboard, optional splice, notice (§03, MARXY-42, C-06).
import type { Operation, OperationInput } from '@marxy/core';
import type { AppContext, Command } from '../commands/registry.ts';
import { copyDefault, markdownCopy } from './verbs.ts';

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
    const written = await ctx.applyBufferMutation({
      range: input.range,
      replacement: result.replacement,
      label: op.title,
    });
    if (written === false) {
      ctx.closePalette();
      return;
    }
  }
  ctx.closePalette();
  if (result.clipboard) {
    ctx.showNotice('Copied', { transient: true });
  } else if (result.summary) {
    ctx.showNotice(result.summary, { transient: true });
  }
}

/**
 * Mod+C: the selection's default copy verb (`COPY_DEFAULT`, ADR-0054), else native copy. Never a splice:
 * every default is clipboard-only, and `verbs.test.ts` holds that over the corpus.
 */
export async function runCopyShortcut(ctx: AppContext, registered: readonly Command[]): Promise<void> {
  const cmd = copyDefault(ctx, registered);
  if (cmd) {
    await cmd.run(ctx);
    return;
  }
  document.execCommand('copy');
}

/** Mod+Shift+C: the selection's exact markdown (`MARKDOWN_COPY`); nothing when no verb applies. */
export async function runMarkdownCopy(ctx: AppContext, registered: readonly Command[]): Promise<void> {
  const cmd = markdownCopy(ctx, registered);
  if (cmd) await cmd.run(ctx);
}
