// The one path a copy takes to the pasteboard (J-04, ADR-0065 §2): one item holding every representation
// the copy has (plain text always, HTML when it has any), written through `clipboardWriteItem`, and one quiet
// notice that says the format and the size. Where the shell has no native pasteboard (it answers `unsupported`)
// the same copy goes through `clipboardWrite`, and the notice is unchanged. Nothing is read from the pasteboard.
import type { ClipboardRep } from '@marxy/shell-api';
import type { AppContext } from './registry.ts';

const TEXT = 'public.utf8-plain-text';
const HTML = 'public.html';
const encoder = new TextEncoder();

/** What a copy holds: the text, and the HTML beside it when the format has one. */
export interface CopyRep {
  readonly text: string;
  readonly html?: string;
}

/** "312 B", "1.2 KB", "3.4 MB": the size of the text a copy put on the pasteboard (decimal units, as Finder says them). */
export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const unsupported = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'unsupported';

/**
 * Writes `rep` as one pasteboard item and says "`label`, 1.2 KB" once, transient. `label` is the whole of what
 * was copied: "Copied as Slack", "Copied table as TSV". Closes the palette, as every copy does. A write the
 * shell refuses says so instead, and returns false.
 */
export async function writeCopy(ctx: AppContext, rep: CopyRep, label: string): Promise<boolean> {
  const reps: ClipboardRep[] = [{ type: TEXT, bytes: encoder.encode(rep.text) }];
  if (rep.html !== undefined && rep.html !== '') reps.push({ type: HTML, bytes: encoder.encode(rep.html) });
  const size = reps[0]!.bytes.byteLength;
  try {
    if (typeof ctx.shell.clipboardWriteItem === 'function') {
      try {
        await ctx.shell.clipboardWriteItem(reps, { transient: false });
      } catch (err) {
        if (!unsupported(err)) throw err;
        await ctx.shell.clipboardWrite(rep.html !== undefined && rep.html !== '' ? { text: rep.text, html: rep.html } : { text: rep.text });
      }
    } else {
      await ctx.shell.clipboardWrite(rep.html !== undefined && rep.html !== '' ? { text: rep.text, html: rep.html } : { text: rep.text });
    }
  } catch (err) {
    ctx.closePalette();
    const why = err instanceof Error ? err.message : String(err);
    ctx.showNotice(`Could not copy: ${why}`, { transient: true });
    return false;
  }
  ctx.closePalette();
  ctx.showNotice(`${label}, ${sizeLabel(size)}`, { transient: true });
  return true;
}
