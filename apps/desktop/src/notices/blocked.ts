// Blocked remote images and simplified HTML: one notice, with the HTML opt-in when there is one (MARXY-44, MARXY-138).

import type { BlockedImage } from '@marxy/core/src/render/images.ts';
import type { RenderRemoval } from '@marxy/core/src/render/pipeline.ts';
import type { Grants } from '../trust/trust.ts';
import { blockedImageNoticeText } from '@marxy/core/src/render/images.ts';
import { dismiss, ensureNoticesRegion, notify } from './index.ts';
import { blockedTrustNoticeText, htmlGrantWouldChangeForNotice } from './trust-copy.ts';

export interface BlockedNoticeOpts {
  readonly path: string;
  readonly removed: readonly RenderRemoval[];
  readonly blockedImages: readonly BlockedImage[];
  readonly grants: Grants;
  readonly dismissed?: boolean;
  onGrantHtml?(): void;
  onDismiss?(): void;
}

const dismissedPaths = new Set<string>();
let current: number | null = null;
/** Grant-summary info notices; they describe a grant that a revoke or re-render may end. */
const summaryIds = new Set<number>();

/**
 * Removes only this module's blocked-content lines before a render shows them again: the file-removed,
 * theme and index notices are not this document's blocked content and must survive a re-render.
 */
export function clearBlockedNotices(): void {
  if (current !== null) dismiss(current);
  current = null;
  for (const el of ensureNoticesRegion().querySelectorAll('[data-notice-kind="blocked"]')) el.remove();
}

/** A revoked grant no longer holds, so its "Showing …" confirmation goes too. */
export function clearGrantSummaryNotices(): void {
  for (const id of summaryIds) dismiss(id);
  summaryIds.clear();
}

export function resetDismissedNotices(): void {
  dismissedPaths.clear();
}

export function dismissBlockedNoticeForPath(path: string): void {
  dismissedPaths.add(path);
}

/** Each open shows the notice again until the reader dismisses it for that visit (§12). */
export function clearDismissForPath(path: string): void {
  dismissedPaths.delete(path);
}

/** Image-only path kept for documents with no HTML widening story yet (MARXY-138 harness). */
export function blockedContentNotice(images: readonly BlockedImage[]): void {
  // Only this notice's previous line: file, theme and index notices are not this document's blocked images.
  if (current !== null) dismiss(current);
  current = null;
  const text = blockedImageNoticeText(images);
  if (text === '') return;
  current = notify({ kind: 'blocked', text });
}

export function trustBlockedNotices(opts: BlockedNoticeOpts): void {
  if (opts.dismissed || dismissedPaths.has(opts.path)) return;

  const text = blockedTrustNoticeText(opts.removed, opts.blockedImages);
  const htmlAction = !opts.grants.html && htmlGrantWouldChangeForNotice(opts.removed);

  if (text === '' && !htmlAction) return;

  const region = ensureNoticesRegion();
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  line.dataset.noticeKind = 'blocked';

  const span = document.createElement('span');
  span.className = 'marxy-notice-text';
  span.textContent = text;
  line.append(span);

  if (htmlAction && opts.onGrantHtml) {
    const html = document.createElement('button');
    html.type = 'button';
    html.className = 'marxy-notice-action';
    html.textContent = "Show this document's HTML";
    html.addEventListener('click', () => opts.onGrantHtml!());
    line.append(html);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'marxy-notice-dismiss';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    dismissBlockedNoticeForPath(opts.path);
    line.remove();
    opts.onDismiss?.();
  });
  line.append(dismiss);

  region.append(line);
}

export function grantSummaryNotice(path: string, html: boolean): void {
  if (!html) return;
  const base = path.split('/').pop() ?? path;
  summaryIds.add(
    notify({
      kind: 'info',
      text: `Showing HTML for ${base}. Undo in the palette.`,
      transient: true,
    }),
  );
}
