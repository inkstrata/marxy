// Applies a core operation: clipboard, optional splice, notice (§03, MARXY-42, C-06).
import type { Operation, OperationInput } from '@marxy/core';
import { writeCopy } from '../commands/copy-write.ts';
import type { AppContext, Command } from '../commands/registry.ts';
import { copyDefault } from './verbs.ts';

/** What a copy says it did, from its title: "Copy table as TSV" says "Copied table as TSV". */
export function copiedNotice(title: string): string {
  return title.startsWith('Copy ') ? `Copied ${title.slice('Copy '.length)}` : 'Copied';
}

export async function apply(
  op: Operation,
  ctx: AppContext,
  input: OperationInput,
): Promise<void> {
  if (!op.canApply(input)) return;
  const result = op.run(input);
  if (result.clipboard) {
    // One pasteboard item and one notice that carries its size: the operation's own account first
    // ("Copied 3 links"), else what its title says it copied.
    if (!(await writeCopy(ctx, result.clipboard, result.summary ?? copiedNotice(op.title)))) return;
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
  // A copy has closed the palette and said its notice already (writeCopy); closing it again would be after it.
  if (result.clipboard) return;
  ctx.closePalette();
  if (result.summary) ctx.showNotice(result.summary, { kind: 'done' });
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
