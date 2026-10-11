// The test entry for E-14's converter: `paste-convert.test.mjs` builds this file and drives the page global `marxyPaste`.
// The app imports `read-clipboard.ts` and never this file, so the page global exists only in that test.
import { classifyClipboard } from '@marxy/core/src/paste/classify.ts';
import { convertClipboard } from './read-clipboard.ts';
import { htmlToMarkdown } from './html-to-markdown.ts';

export type { Converted } from './read-clipboard.ts';
export { classifyClipboard, convertClipboard, htmlToMarkdown };

(window as unknown as { marxyPaste?: unknown }).marxyPaste = { classifyClipboard, htmlToMarkdown, convertClipboard };
