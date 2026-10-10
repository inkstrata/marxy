// Plain-language strings for blocked-content and truncation notices (docs/design/13-trust.md).

import type { BlockedImage } from '@marxy/core/src/render/images.ts';
import { blockedImageClause } from '@marxy/core/src/render/images.ts';
import type { RenderRemoval } from '@marxy/core/src/render/pipeline.ts';

const WIDE_STILL_REMOVES = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'svg',
  'math',
  'link',
  'meta',
  'base',
]);

function isDeferredImage(removal: RenderRemoval): boolean {
  return removal.what === 'attribute' && removal.name === 'src' && removal.on === 'img'
    && (removal.reason?.includes('remote image') ?? false);
}

function isHttpImage(removal: RenderRemoval): boolean {
  return isDeferredImage(removal) && (removal.reason?.includes('plain http') ?? false);
}

function simplifiedElementNames(removed: readonly RenderRemoval[]): string[] {
  const names = new Set<string>();
  for (const r of removed) {
    if (r.what === 'element' && r.reason?.includes('markdown-equivalent')) {
      if (r.name === 'div' || r.name === 'details' || r.name === 'summary') names.add(r.name);
    }
    if (r.what === 'attribute' && (r.name === 'width' || r.name === 'height') && r.on === 'img') {
      names.add('img size');
    }
    if (r.what === 'attribute' && r.name === 'align') names.add('align');
  }
  return [...names].sort();
}

/** False when deferred images are the only widening a reader can opt into (hostile fixtures). */
export function htmlGrantWouldChangeForNotice(removed: readonly RenderRemoval[]): boolean {
  if (!htmlGrantWouldChange(removed)) return false;
  const hasAttrWiden = removed.some(
    (r) => r.what === 'attribute' && (r.name === 'width' || r.name === 'height' || r.name === 'align' || r.name === 'open'),
  );
  const hasStructureHtml = removed.some(
    (r) => r.what === 'element' && r.reason?.includes('markdown-equivalent')
      && (r.name === 'details' || r.name === 'summary'),
  );
  const hasImages = removed.some(isDeferredImage);
  if (hasImages && !hasAttrWiden && !hasStructureHtml) return false;
  return true;
}

export function htmlGrantWouldChange(removed: readonly RenderRemoval[]): boolean {
  for (const r of removed) {
    if (r.what === 'truncation' || isDeferredImage(r) || isHttpImage(r)) continue;
    if (r.what === 'element' && WIDE_STILL_REMOVES.has(r.name)) continue;
    if (r.what === 'element' && r.reason?.includes('allow-list')) return true;
    if (r.what === 'element' && r.reason?.includes('markdown-equivalent')) {
      if (r.name === 'div' || r.name === 'details' || r.name === 'summary') return true;
    }
    if (r.what === 'attribute') {
      if (r.name === 'width' || r.name === 'height' || r.name === 'align' || r.name === 'open') return true;
    }
  }
  return false;
}

function isSchemeRelative(removal: RenderRemoval): boolean {
  return (removal.reason?.includes('scheme-relative') ?? false) || /^[\\/]{2}/.test((removal.value ?? '').trim());
}

/**
 * The blocked images worth naming. A protocol-relative `//host/y.png` is refused whatever the reader
 * does (it takes the document's scheme, which is no network scheme), so it is not counted or named.
 * `blockedImages` carry the resolved https URL, so the removal report is what says how each was written;
 * one written both ways stays, because the absolute one loads.
 */
export function grantableBlockedImages(
  images: readonly BlockedImage[],
  removed: readonly RenderRemoval[],
): readonly BlockedImage[] {
  const loadable = new Map<string, boolean>();
  for (const r of removed) {
    if (r.what !== 'attribute' || r.name !== 'src' || r.on !== 'img') continue;
    const key = r.url ?? r.value ?? '';
    loadable.set(key, (loadable.get(key) ?? false) || !isSchemeRelative(r));
  }
  return images.filter((image) => loadable.get(image.url) !== false);
}

function elementNoticePart(removed: readonly RenderRemoval[]): string {
  const names = simplifiedElementNames(removed);
  if (names.length === 0) return '';
  const list = names.join(', ');
  return `some HTML was simplified (${list})`;
}

export function blockedTrustNoticeText(
  removed: readonly RenderRemoval[],
  blockedImages: readonly BlockedImage[],
): string {
  const grantable = grantableBlockedImages(blockedImages, removed);
  const images = blockedImageClause(grantable);
  const elements = elementNoticePart(removed);
  const httpCount = removed.filter(isHttpImage).length;
  let text = '';
  if (images && elements) {
    text = `${images}, and ${elements}.`;
  } else if (images) {
    text = `${images}.`;
  } else if (elements) {
    text = `Some HTML in this document was simplified (${simplifiedElementNames(removed).join(', ')}).`;
  }
  if (httpCount > 0) {
    const httpLine = httpCount === 1
      ? '1 image over plain http is never loaded.'
      : `${httpCount} images over plain http are never loaded.`;
    text = text === '' ? httpLine : `${text} ${httpLine}`;
  }
  return text;
}

export function truncationNoticeText(line: number, remainingLines: number, tagName: string): string {
  const noun = remainingLines === 1 ? 'line' : 'lines';
  return `Everything after line ${line} (${remainingLines} ${noun}) is inside an unclosed <${tagName}> and was not shown.`;
}

/** What the reader is told when a trust change could not be saved. */
export function trustWriteFailedText(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message === '' ? 'Could not save trust settings.' : `Could not save trust settings: ${message}`;
}

export const TRUST_NEWER_VERSION_TEXT =
  'Trust settings are from a newer Marxy and were left unchanged, so this change was not saved.';

export const TRUST_UNREADABLE_TEXT =
  'Marxy could not read its trust settings, so nothing is trusted this session.';
