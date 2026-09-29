// Blocked remote images and simplified HTML: one notice with grant actions (MARXY-44, MARXY-138).

import type { BlockedImage } from '@marxy/core/src/render/images.ts';
import { blockedHosts } from '@marxy/core/src/render/images.ts';
import type { RenderRemoval } from '@marxy/core/src/render/pipeline.ts';
import type { Grants } from '../trust/trust.ts';
import { blockedImageNoticeText } from '@marxy/core/src/render/images.ts';
import { dismiss, ensureNoticesRegion, notify } from './index.ts';
import {
  blockedTrustNoticeText,
  displayHost,
  htmlGrantWouldChangeForNotice,
} from './trust-copy.ts';

export interface BlockedNoticeOpts {
  readonly path: string;
  readonly removed: readonly RenderRemoval[];
  readonly blockedImages: readonly BlockedImage[];
  readonly grants: Grants;
  readonly dismissed?: boolean;
  onGrantHtml?(): void;
  onGrantImages?(hosts: readonly string[]): void;
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

/** A revoked grant no longer holds, so its "Showing …" / "Images will load …" confirmation goes too. */
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
  const hasImages = opts.blockedImages.length > 0;
  const htmlAction = !opts.grants.html && htmlGrantWouldChangeForNotice(opts.removed);
  const pendingHosts = blockedHosts(opts.blockedImages).filter(
    (h) => !opts.grants.imageHosts.includes(h),
  );
  const imageAction = pendingHosts.length > 0;

  if (text === '' && !htmlAction && !imageAction) return;

  const region = ensureNoticesRegion();
  const line = document.createElement('div');
  line.className = 'marxy-notice';
  line.dataset.noticeKind = 'blocked';

  const span = document.createElement('span');
  span.className = 'marxy-notice-text';
  span.textContent = text;
  line.append(span);

  if (htmlAction && imageAction && opts.onGrantHtml && opts.onGrantImages) {
    const both = document.createElement('button');
    both.type = 'button';
    both.className = 'marxy-notice-action';
    both.textContent = 'Show HTML and images';
    both.addEventListener('click', () => {
      opts.onGrantHtml!();
      opts.onGrantImages!(pendingHosts);
    });
    line.append(both);

    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'marxy-notice-action';
    details.textContent = 'Details';
    details.addEventListener('click', () => expandDetails(line, opts, pendingHosts));
    line.append(details);
  } else if (htmlAction && opts.onGrantHtml) {
    const html = document.createElement('button');
    html.type = 'button';
    html.className = 'marxy-notice-action';
    html.textContent = "Show this document's HTML";
    html.addEventListener('click', () => opts.onGrantHtml!());
    line.append(html);
  } else if (imageAction && opts.onGrantImages) {
    const img = document.createElement('button');
    img.type = 'button';
    img.className = 'marxy-notice-action';
    img.textContent = 'Load images from these hosts';
    img.addEventListener('click', () => opts.onGrantImages!(pendingHosts));
    line.append(img);
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

function expandDetails(
  line: HTMLElement,
  opts: BlockedNoticeOpts,
  pendingHosts: readonly string[],
): void {
  const existing = line.querySelector('.marxy-notice-details');
  if (existing) {
    existing.remove();
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'marxy-notice-details';

  const hostCounts = new Map<string, number>();
  for (const img of opts.blockedImages) {
    hostCounts.set(img.host, (hostCounts.get(img.host) ?? 0) + 1);
  }
  for (const host of pendingHosts) {
    const row = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.host = host;
    row.append(box);
    const count = hostCounts.get(host) ?? 0;
    row.append(document.createTextNode(` ${count} from ${displayHost(host)}`));
    panel.append(row);
  }

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'marxy-notice-action';
  const withHtml = Boolean(opts.onGrantHtml) && !opts.grants.html;
  // The label says what the click grants: nothing is widened until the reader has picked a host.
  confirm.textContent = withHtml ? 'Show HTML and load selected hosts' : 'Load selected hosts';
  confirm.addEventListener('click', () => {
    const picked = [...panel.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')]
      .map((el) => el.dataset.host!)
      .filter(Boolean);
    if (picked.length === 0) return;
    opts.onGrantImages?.(picked);
    if (withHtml) opts.onGrantHtml!();
  });
  panel.append(confirm);
  line.append(panel);
}

export function grantSummaryNotice(path: string, html: boolean, hostCount: number): void {
  const base = path.split('/').pop() ?? path;
  const parts: string[] = [];
  if (html) parts.push('HTML');
  if (hostCount > 0) parts.push(`images from ${hostCount} host${hostCount === 1 ? '' : 's'}`);
  const what = parts.join(' and ');
  summaryIds.add(
    notify({
      kind: 'info',
      text: `Showing ${what} for ${base}. Undo in the palette.`,
      transient: true,
    }),
  );
}

/** Confirms an image-host grant; dismissed by `clearGrantSummaryNotices` when a grant is revoked. */
export function imageGrantSummaryNotice(): void {
  summaryIds.add(
    notify({ kind: 'info', text: 'Images will load when Marxy can fetch them.', transient: true }),
  );
}
