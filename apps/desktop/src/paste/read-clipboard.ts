// Reading the pasteboard on a reader's paste and converting what was read (J-05, ADR-0065 §3). Nothing
// here runs on its own: a command or a paste handler calls `readConverted`, which lists the types first,
// refuses a concealed item before it reads anything, and then reads only the representations it needs.
import { classifyClipboard, type ClipboardKind, type ClipboardPayload } from '@marxy/core/src/paste/classify.ts';
import type { Shell } from '@marxy/shell-api';
import { clipboard } from '../shell/clipboard.ts';
import { htmlToMarkdown } from './html-to-markdown.ts';

export interface Converted {
  readonly markdown: string;
  readonly kind: ClipboardKind;
}

/** E-14's two halves as one call: classify, and convert HTML when that is what the clipboard holds. Reads nothing. */
export function convertClipboard(payload: ClipboardPayload): Converted {
  const got = classifyClipboard(payload);
  if (got.kind !== 'html') return { kind: got.kind, markdown: got.markdown ?? '' };
  const markdown = htmlToMarkdown(payload.html ?? '');
  if (markdown !== '') return { kind: 'html', markdown };
  // Nothing readable survived the sanitiser (a payload of scripts and pixels): fall back to the text.
  const text = payload.text ?? '';
  return text.trim() === '' ? { kind: 'empty', markdown: '' } : { kind: 'text', markdown: text };
}

/** The two Shell methods a paste uses. */
export type PasteShell = Pick<Shell, 'clipboardTypes' | 'clipboardRead'>;

/** `shell` as a `PasteShell`, or null where it has no pasteboard methods (a harness without them). */
export function pasteShellOf(shell: unknown): PasteShell | null {
  const s = shell as Partial<PasteShell> | null | undefined;
  return typeof s?.clipboardTypes === 'function' && typeof s.clipboardRead === 'function' ? (s as PasteShell) : null;
}

/** Said when the item is concealed (a password manager's copy). */
export const CONCEALED_REFUSAL = 'Not pasted: the clipboard holds a concealed item (a password, perhaps), and Marxy does not read those.';

const refusalFor = (err: unknown): string => {
  const said = err instanceof Error ? err.message : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  const text = said.replace(/[.\s]+$/, '');
  return `Not pasted: ${text === '' ? 'the clipboard could not be read' : text}.`;
};

/** A refusal; `unsupported` is set when the shell has no native pasteboard at all (not a refusal of this item). */
export interface Refusal {
  readonly refused: string;
  readonly unsupported?: true;
}

export type PasteRead =
  | Refusal
  | { readonly refused?: undefined; readonly html: string | null; readonly text: string | null };

async function readText(shell: PasteShell, type: string): Promise<string | null> {
  const rep = await shell.clipboardRead(type);
  if (rep === null) return null;
  try {
    return clipboard.text(rep.bytes);
  } catch {
    throw new Error(`${type === clipboard.HTML ? 'the HTML on the clipboard' : 'the text on the clipboard'} is not valid UTF-8`);
  }
}

/**
 * The types, then the representations named in `want` that the item holds. A concealed item is refused
 * after the type list and before any read; a rejected read refuses with its own message. A type the
 * item does not hold is `null`, and is not asked for.
 */
export async function readForPaste(shell: PasteShell, want: { readonly html: boolean; readonly text: boolean }): Promise<PasteRead> {
  try {
    const types = await shell.clipboardTypes();
    if (types.includes(clipboard.CONCEALED)) return { refused: CONCEALED_REFUSAL };
    const html = want.html && types.includes(clipboard.HTML) ? await readText(shell, clipboard.HTML) : null;
    const text = want.text && types.includes(clipboard.TEXT) ? await readText(shell, clipboard.TEXT) : null;
    return { html, text };
  } catch (err) {
    const unsupported = (err as { code?: unknown } | null)?.code === 'unsupported';
    return { refused: refusalFor(err), ...(unsupported ? { unsupported: true as const } : {}) };
  }
}

export type ConvertedRead =
  | Refusal
  | { readonly refused?: undefined; readonly payload: { readonly html: string | null; readonly text: string | null }; readonly converted: Converted };

/** `readForPaste` for HTML and text, then `convertClipboard`: what a paste in Source or in Rendered works from. */
export async function readConverted(shell: PasteShell): Promise<ConvertedRead> {
  const read = await readForPaste(shell, { html: true, text: true });
  if (read.refused !== undefined) return read;
  const { html, text } = read;
  return { payload: { html, text }, converted: convertClipboard({ ...(html === null ? {} : { html }), ...(text === null ? {} : { text }) }) };
}

/** The notice for a paste that converted HTML. */
export const CONVERTED_NOTICE = 'Pasted as Markdown (converted from HTML)';
export const NOTHING_TO_PASTE = 'Nothing to paste';
