// Transform the clipboard (J-06, ADR-0065 §3): one command per runnable transform, `Transform clipboard: <name>`. Running one
// reads the pasteboard on that command and not before (types first; a concealed item is refused and nothing is read), runs the
// transform on its text and opens the result sheet (`transform/sheet.ts`) with the clipboard as the input. The sheet's
// primary action writes the result back as one plain-text item; Esc writes nothing. No document is read or changed.
import { TRANSFORMS, readableText } from '@marxy/core';
import { NOTHING_TO_TRANSFORM, pasteShellOf, readForTransform } from '../paste/read-clipboard.ts';
import type { SheetTarget } from '../transform/sheet.ts';
import type { AppContext, Command } from './registry.ts';

export async function transformClipboard(ctx: AppContext, id: string): Promise<void> {
  const shell = pasteShellOf(ctx.shell);
  if (!shell) return ctx.showNotice('Not transformed: this window has no clipboard access.', { transient: true });
  const got = await readForTransform(shell);
  if (got.refused !== undefined) return ctx.showNotice(got.refused, { transient: true });
  if (got.empty === true) return ctx.showNotice(NOTHING_TO_TRANSFORM, { transient: true });
  const sheet = await import('../transform/sheet.ts');
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const target: SheetTarget = {
    text: got.text,
    scope: 'clipboard',
    // Results keep the clipboard's line ending when it uses CRLF throughout.
    eol: /\r\n/.test(got.text) && !/(?<!\r)\n|\r(?!\n)/.test(got.text) ? '\r\n' : null,
    markdown: true,
    // A transform may leave a lone surrogate (cutting text mid-pair): shown and written as U+FFFD, never as the surrogate.
    readable: readableText,
    apply: async () => 'unchanged',
    restoreFocus: () => origin?.focus({ preventScroll: true }),
  };
  try {
    sheet.openTransformSheet(ctx, target, id);
  } catch (error) {
    ctx.showNotice(`Could not run ${id}: ${error instanceof Error ? error.message : String(error)}. The clipboard is unchanged.`, { transient: true });
  }
}

export function transformClipboardCommands(): readonly Command[] {
  return TRANSFORMS.map(
    (t): Command => ({
      id: `transform.clipboard.${t.id}`,
      title: `Transform clipboard: ${t.name}`,
      group: 'transform',
      when: () => true,
      run: (ctx) => transformClipboard(ctx, t.id),
    }),
  );
}
