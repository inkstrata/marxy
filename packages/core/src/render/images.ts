// Local image paths, reserved boxes, and the hosts a blocked-content notice will name.
// Pure: no shell, no DOM. The renderer stays shell-free; the app asks the shell for bytes
// and an asset URL after this module has decided the path is inside the image root.

import { normalizePath } from '../index-model/paths.ts';
import { DEFAULT_POLICY } from '../sanitize/policy.ts';
import type { Removal } from '../sanitize/sanitize-html.ts';
import { sanitizeUrl } from '../sanitize/urls.ts';
import { hostForms } from './link-host.ts';
import { own } from '../util/text.ts';

export interface BlockedImage {
  readonly host: string;
  readonly url: string;
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export type ImageResolution =
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'remote'; readonly host: string; readonly url: string }
  | { readonly kind: 'outside' }
  | { readonly kind: 'invalid' };

/**
 * Host of a remote subresource URL, or `undefined` when the value is local, empty, or a scheme that
 * names no host (`data:`, `javascript:`). Uses the same parser the sanitiser does, so `/\host` and
 * `https://HOST` agree with the removal report.
 */
export function hostOfRefusedSrc(raw: string): string | undefined {
  const decision = sanitizeUrl(raw, 'subresource', DEFAULT_POLICY);
  if (!decision.absolute || decision.resolved === undefined) return undefined;
  try {
    const host = new URL(decision.resolved).hostname.toLowerCase();
    return host === '' ? undefined : host;
  } catch {
    return undefined;
  }
}

/** Every remote `img src` the allow-list took out, in document order, so a notice can name the hosts. */
export function blockedImagesFrom(removed: readonly Removal[]): readonly BlockedImage[] {
  const images: BlockedImage[] = [];
  const seen = new Set<string>();
  for (const removal of removed) {
    if (removal.what !== 'attribute' || removal.name !== 'src' || removal.on !== 'img') continue;
    const reference = removal.url ?? removal.value;
    if (reference === undefined) continue;
    const host = hostOfRefusedSrc(reference);
    if (host === undefined) continue;
    const key = `${host}\0${reference}`;
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({ host, url: reference });
  }
  return images;
}

/** Hosts in first-seen order, each once — one notice names `img.shields.io` once, not per badge. */
export function blockedHosts(images: readonly BlockedImage[]): readonly string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    if (seen.has(image.host)) continue;
    seen.add(image.host);
    hosts.push(image.host);
  }
  return hosts;
}

/**
 * A blocked host as the reader should recognise it. The URL parser hands back punycode, so an
 * internationalised host is shown with its Unicode form beside it (same rule as link destinations,
 * link-host.ts): `xn--pple-43d.com (аpple.com)`. An ordinary host is shown as is.
 */
export function displayBlockedHost(host: string): string {
  const { punycode, unicode } = hostForms(host);
  if (punycode === unicode) return punycode;
  return punycode.includes('xn--') ? `${punycode} (${unicode})` : `${unicode} (${punycode})`;
}

/**
 * The one wording for blocked remote images, without its full stop so a caller can join a second
 * clause: `4 images from a.example and b.example were not loaded`. Every host is named (a hostile
 * document is the case where the reader most needs to see them). Empty when nothing was blocked. `blockedImageNoticeText` is this plus the full stop.
 */
export function blockedImageClause(images: readonly BlockedImage[]): string {
  const hosts = blockedHosts(images).map(displayBlockedHost);
  if (hosts.length === 0) return '';
  const n = images.length;
  const noun = n === 1 ? 'image' : 'images';
  const verb = n === 1 ? 'was' : 'were';
  const from = hosts.length === 1 ? hosts[0]! : `${hosts.slice(0, -1).join(', ')} and ${hosts[hosts.length - 1]}`;
  return `${n} ${noun} from ${from} ${verb} not loaded`;
}

/** The one-line blocked-content notice for a document with remote images and nothing else to say. */
export function blockedImageNoticeText(images: readonly BlockedImage[]): string {
  const clause = blockedImageClause(images);
  return clause === '' ? '' : `${clause}.`;
}

/** `//?/C:` or `//?/UNC/server/share` (a Windows long path), or `//server/share` (a share): the part `..` may not climb out of. */
const PATH_ANCHOR = /^\/\/(?:\?\/(?:UNC\/[^/]+\/[^/]+|[A-Za-z]:)|[^/?.][^/]*\/[^/]+)(?=\/|$)/;
/** A drive's root, plain or as a long path (`C:/`, `//?/C:/`). */
const DRIVE_ROOT = /^(?:\/\/\?\/)?[A-Za-z]:\/$/;

/** Collapse `.` / `..` so a `../` that leaves the root is visible as `null` rather than as a string. */
export function collapsePath(path: string): string | null {
  const normalized = normalizePath(path);
  // A share or a long path keeps its own first segments: reading them as empty parts of `/` named another file.
  const anchor = PATH_ANCHOR.exec(normalized)?.[0];
  const drive = anchor === undefined ? /^[A-Za-z]:/.exec(normalized)?.[0] : undefined;
  const rest = anchor !== undefined ? normalized.slice(anchor.length) : drive === undefined ? normalized : normalized.slice(2);
  const absolute = anchor !== undefined || rest.startsWith('/');
  const out: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  if (anchor !== undefined) {
    const body = out.join('/');
    // A share's root has no trailing slash (`//server/share`), a long path's drive root has one, as `C:/` does.
    if (body === '') return /^\/\/\?\/[A-Za-z]:$/.test(anchor) ? `${anchor}/` : anchor;
    return `${anchor}/${body}`;
  }
  const body = `${absolute ? '/' : ''}${out.join('/')}`;
  const joined = `${drive ?? ''}${body === '' && absolute ? '/' : body}`;
  return joined === '' ? (absolute ? '/' : null) : joined;
}

export function isInsideImageRoot(path: string, imageRoot: string): boolean {
  const resolved = collapsePath(path);
  const root = collapsePath(imageRoot);
  if (resolved === null || root === null) return false;
  if (root === '/' || DRIVE_ROOT.test(root)) return resolved.startsWith(root);
  return resolved === root || resolved.startsWith(`${root}/`);
}

function joinUnder(base: string, rel: string): string {
  const root = normalizePath(base);
  if (rel === '') return root;
  if (root === '/' || DRIVE_ROOT.test(root)) return `${root}${rel.replace(/^\/+/, '')}`;
  return `${root}/${rel.replace(/^\/+/, '')}`;
}

/**
 * Resolve an image `src` the way GitHub does inside a repository: `/x.png` against
 * the image root, relative paths against the document directory, anything that leaves the root
 * refused, anything with its own host treated as remote.
 */
export function resolveImageSrc(
  src: string,
  opts: { readonly documentDir: string; readonly imageRoot: string },
): ImageResolution {
  const decision = sanitizeUrl(src, 'subresource', DEFAULT_POLICY);
  if (decision.absolute) {
    const host = hostOfRefusedSrc(src);
    if (host !== undefined) return { kind: 'remote', host, url: decision.resolved ?? src };
    return { kind: 'invalid' };
  }
  // The file is named by the path alone: `?query` and `#fragment` are not part of it, and what is
  // left is percent-encoded. Decoding happens before the traversal check so `..%2f` cannot hide.
  const pathOnly = src.replace(/[?#].*$/s, '');
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    decoded = pathOnly;
  }
  if (decoded === '' || /[\u0000-\u001f]/.test(decoded)) return { kind: 'invalid' };
  const posix = decoded.replace(/\\/g, '/');
  const absoluteFs = /^[A-Za-z]:\//.test(posix);
  const joined = absoluteFs
    ? posix
    : posix.startsWith('/')
      ? joinUnder(opts.imageRoot, posix.slice(1))
      : joinUnder(opts.documentDir, posix);
  const collapsed = collapsePath(joined);
  if (collapsed === null || !isInsideImageRoot(collapsed, opts.imageRoot)) return { kind: 'outside' };
  return { kind: 'local', path: collapsed };
}

/**
 * Scale a measured image down to the measure *before* `src` is set, so decode cannot move layout.
 * Wider than the measure → width = measure, height from the aspect ratio; otherwise the natural size.
 */
export function reserveImageBox(size: ImageSize, measurePx: number): ImageSize {
  if (!(size.width > 0 && size.height > 0 && measurePx > 0)) return size;
  if (size.width <= measurePx) return size;
  return { width: measurePx, height: Math.round((size.height * measurePx) / size.width) };
}

export type ImagePresentation =
  | { readonly kind: 'ready'; readonly src: string; readonly width?: number; readonly height?: number }
  | { readonly kind: 'remote'; readonly host: string }
  | { readonly kind: 'outside' }
  | { readonly kind: 'invalid' };

/**
 * The attributes the app writes on a local `<img>`, in this order: reserved box, then the asset URL.
 * Setting `src` first is what causes a layout shift when the file decodes; this function exists so
 * that cannot happen by construction.
 */
export function presentLocalImage(
  src: string,
  opts: {
    readonly documentDir: string;
    readonly imageRoot: string;
    readonly measurePx: number;
    readonly size: ImageSize | null;
    readonly assetUrl: (path: string) => string;
  },
): ImagePresentation {
  const resolved = resolveImageSrc(src, opts);
  if (resolved.kind !== 'local') return resolved;
  // Box first. The URL is minted only after the reserved size is known, so a decode has nowhere to shift.
  const box = opts.size === null ? undefined : reserveImageBox(opts.size, opts.measurePx);
  const url = opts.assetUrl(resolved.path);
  return box === undefined ? { kind: 'ready', src: url } : { kind: 'ready', src: url, width: box.width, height: box.height };
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function eq(bytes: Uint8Array, offset: number, sig: readonly number[]): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((value, i) => bytes[offset + i] === value);
}

function u16be(bytes: Uint8Array, i: number): number {
  return ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
}

function u16le(bytes: Uint8Array, i: number): number {
  return (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8);
}

function u32be(bytes: Uint8Array, i: number): number {
  return ((bytes[i] ?? 0) * 0x1000000 + ((bytes[i + 1] ?? 0) << 16) + ((bytes[i + 2] ?? 0) << 8) + (bytes[i + 3] ?? 0)) >>> 0;
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  if (!eq(bytes, 0, PNG) || bytes.length < 24) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function gifSize(bytes: Uint8Array): ImageSize | null {
  if (!(eq(bytes, 0, GIF87) || eq(bytes, 0, GIF89)) || bytes.length < 10) return null;
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;
    i += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16be(bytes, i);
    if (length < 2) return null;
    // SOF0–SOF3 and SOF9–SOF11 carry the pixel size the decoder will use.
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc9 && marker <= 0xcb)) {
      if (i + 6 >= bytes.length) return null;
      const height = u16be(bytes, i + 3);
      const width = u16be(bytes, i + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  if (!eq(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || !eq(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return null;
  if (eq(bytes, 12, [0x56, 0x50, 0x38, 0x20])) {
    const width = (u16le(bytes, 26) & 0x3fff) + 1;
    const height = (u16le(bytes, 28) & 0x3fff) + 1;
    return { width, height };
  }
  if (eq(bytes, 12, [0x56, 0x50, 0x38, 0x4c])) {
    const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (eq(bytes, 12, [0x56, 0x50, 0x38, 0x58])) {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

const SVG_HEAD_BYTES = 64 * 1024;
const SVG_UNIT_PX: Readonly<Record<string, number>> = {
  '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, em: 16, rem: 16, ex: 8,
};

function svgLengthPx(value: string | undefined): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(value ?? '');
  const factor = m ? own(SVG_UNIT_PX, (m[2] ?? '').toLowerCase()) : undefined;
  if (!m || factor === undefined) return null;
  const px = Number(m[1]) * factor;
  return Number.isFinite(px) && px > 0 ? px : null;
}

/**
 * An SVG's intrinsic size as `<img>` draws it, from the root element in the first 64 KB (the Rust `svg_dimensions`
 * applies the same rule): width and height, a missing or percentage side from the viewBox, else the viewBox itself.
 */
function svgSize(bytes: Uint8Array): ImageSize | null {
  const text = new TextDecoder().decode(bytes.subarray(0, SVG_HEAD_BYTES)).replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const root = /<svg(?=[\s>/])((?:"[^"]*"|'[^']*'|[^>"'])*)/.exec(text);
  if (!root) return null;
  const attrs = new Map<string, string>();
  for (const a of (root[1] ?? '').matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs.set(a[1] ?? '', a[2] ?? a[3] ?? '');
  const box = (attrs.get('viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const ok = box.length === 4 && box.every(Number.isFinite) && (box[2] ?? 0) > 0 && (box[3] ?? 0) > 0;
  const vw = ok ? (box[2] as number) : 0;
  const vh = ok ? (box[3] as number) : 0;
  const w = svgLengthPx(attrs.get('width'));
  const h = svgLengthPx(attrs.get('height'));
  const width = w ?? (ok ? (h !== null ? (h * vw) / vh : vw) : null);
  const height = h ?? (ok ? (w !== null ? (w * vh) / vw : vh) : null);
  if (width === null || height === null) return null;
  const out = { width: Math.round(width), height: Math.round(height) };
  return out.width >= 1 && out.height >= 1 ? out : null;
}

/** Natural pixel size from the file's own header. `null` when the bytes are not a recognised image. */
export function imageSizeFromBytes(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? gifSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes) ?? svgSize(bytes);
}

/** Drawn when an SVG's size cannot be read: the 300x150 a browser gives an `<img>` whose SVG names none. */
export const SVG_DEFAULT_SIZE: ImageSize = { width: 300, height: 150 };
