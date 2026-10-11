// The two halves of E-14 as one call, and the hook the WebKit test drives. Reads nothing: the
// payload comes from the caller (the shell reads the clipboard on a reader action, ADR-0065 §3).
import { classifyClipboard, type ClipboardKind, type ClipboardPayload } from '@marxy/core/src/paste/classify.ts';
import { htmlToMarkdown } from './html-to-markdown.ts';

export interface Converted {
  readonly markdown: string;
  readonly kind: ClipboardKind;
}

export function convertClipboard(payload: ClipboardPayload): Converted {
  const got = classifyClipboard(payload);
  if (got.kind !== 'html') return { kind: got.kind, markdown: got.markdown ?? '' };
  const markdown = htmlToMarkdown(payload.html ?? '');
  if (markdown !== '') return { kind: 'html', markdown };
  // Nothing readable survived the sanitiser (a payload of scripts and pixels): fall back to the text.
  const text = payload.text ?? '';
  return text.trim() === '' ? { kind: 'empty', markdown: '' } : { kind: 'text', markdown: text };
}

export { classifyClipboard, htmlToMarkdown };

(window as unknown as { marxyPaste?: unknown }).marxyPaste = { classifyClipboard, htmlToMarkdown, convertClipboard };
