// Blocked remote images: one notice line naming each host (docs/design/02-render.md post-pass 4). MARXY-138.
import type { BlockedImage } from '@marxy/core/src/render/images.ts';
import { blockedImageNoticeText } from '@marxy/core/src/render/images.ts';
import { clearNotices, notify } from './index.ts';

/** One dismissible notice for the document's blocked remote images; nothing when the list is empty. */
export function blockedContentNotice(images: readonly BlockedImage[]): void {
  clearNotices();
  const text = blockedImageNoticeText(images);
  if (text === '') return;
  notify({ kind: 'blocked', text });
}
