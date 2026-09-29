// Blocked remote images: one notice line naming each host (docs/design/02-render.md post-pass 4). MARXY-138.
import type { BlockedImage } from '@marxy/core/src/render/images.ts';
import { blockedImageNoticeText } from '@marxy/core/src/render/images.ts';
import { dismiss, notify } from './index.ts';

let current: number | null = null;

/** One dismissible notice for the document's blocked remote images; nothing when the list is empty. */
export function blockedContentNotice(images: readonly BlockedImage[]): void {
  // Only this notice's previous line: file, theme and index notices are not this document's blocked images.
  if (current !== null) dismiss(current);
  current = null;
  const text = blockedImageNoticeText(images);
  if (text === '') return;
  current = notify({ kind: 'blocked', text });
}
