// What the open document may show (docs/design/13-trust.md): trust.json, the HTML grant and its
// revoke, the blocked-content and truncation notices, and the one late re-render when trust.json
// arrives after first text. One instance per app (B-10); app.ts owns the page it re-renders.

import type { Buffer } from '@marxy/core';
import type { Shell } from '@marxy/shell-api';
import { policyFor, type Policy } from '@marxy/core/src/sanitize/policy.ts';
import type { RenderRemoval } from '@marxy/core/src/render/pipeline.ts';
import type { BlockedImage } from '@marxy/core/src/render/images.ts';
import {
  blockedContentNotice,
  clearBlockedNotices,
  clearGrantSummaryNotices,
  grantSummaryNotice,
  trustBlockedNotices,
} from '../notices/blocked.ts';
import { truncationNotices } from '../notices/truncation.ts';
import { notify as showNotice, type NoticeInput } from '../notices/index.ts';
import {
  TRUST_NEWER_VERSION_TEXT,
  TRUST_UNREADABLE_TEXT,
  grantableBlockedImages,
  htmlGrantWouldChangeForNotice,
  trustWriteFailedText,
} from '../notices/trust-copy.ts';
import { loadTrust, type TrustStore } from './trust.ts';

/** Where the reader is: a byte in the source and how far into its block (ADR-0018). */
export interface TrustPosition {
  readonly byteOffset: number;
  readonly fraction: number;
}

export interface TrustControllerDeps {
  /** A shell without `configPaths` has nowhere to keep trust.json: nothing is granted, ever. */
  readonly shell: Pick<Shell, 'readFile' | 'writeFileAtomic'> & { configPaths?: Shell['configPaths'] };
  /** The open document's path, or null with none open. */
  currentPath(): string | null;
  /** The open document's bytes, read when a notice needs them (the truncation line's offset). */
  buffer(): Buffer | null;
  /** The reader's position in the open document, read before a trust change is written. */
  position(path: string): TrustPosition;
  /** The page again from the open buffer under the new grants, landing on and restoring `at`. */
  rerender(at: TrustPosition): void;
  /** Source mode at a byte: the truncation notice's "show source" action. */
  showSource(byteOffset: number): Promise<void>;
  /** Where notices go; the page's notice line unless a test supplies its own. */
  notify?(input: NoticeInput): void;
}

export interface TrustController {
  /** Reads trust.json once per instance; every later call returns the same promise. */
  load(): Promise<void>;
  /** The sanitiser policy for `path` under the grants read so far (default until load settles). */
  policyFor(path: string): Policy;
  grantsFor(path: string): { html: boolean };
  /** The blocked-content (or grant-offering) notice and the truncation notices for one render. */
  showNotices(removed: readonly RenderRemoval[], blockedImages: readonly BlockedImage[]): void;
  grantHtml(): Promise<void>;
  revokeHtml(): Promise<void>;
  /** After first text: once trust.json is in, re-render if it grants the open document HTML. */
  maybeRerenderForLateTrust(): Promise<void>;
}

export function createTrustController(deps: TrustControllerDeps): TrustController {
  const { shell } = deps;
  const notify = deps.notify ?? showNotice;
  let store: TrustStore | null = null;
  let loading: Promise<void> | null = null;
  /** True after a read that failed for a reason other than the file being absent. */
  let loadFailed = false;

  function grantsFor(path: string): { html: boolean } {
    return store?.grantsFor(path) ?? { html: false };
  }

  function load(): Promise<void> {
    if (loading) return loading;
    loading = (async () => {
      if (shell.configPaths === undefined) return;
      try {
        if (shell.configPaths === undefined) return;
        const io = {
          readFile: (p: string) => shell.readFile(p),
          writeFileAtomic: (p: string, b: Uint8Array) => shell.writeFileAtomic(p, b),
          dataDirectory: async () => (await shell.configPaths!()).data,
        };
        store = await loadTrust(io);
        loadFailed = false;
      } catch {
        // Fail closed: nothing is trusted and nothing is written. Say so, since a grant offer may be on
        // screen and would otherwise do nothing.
        store = null;
        loadFailed = true;
        notify({ kind: 'info', text: TRUST_UNREADABLE_TEXT });
      }
    })();
    return loading;
  }

  async function byteOffsetForLine(line: number): Promise<number> {
    const buffer = deps.buffer();
    if (!buffer) return 0;
    // Bytes, not UTF-16 units: a multi-byte character or a byte-order mark shifts every later offset.
    const bytes = buffer.bytes;
    let byte = 0;
    let current = 1;
    for (let i = 0; i < bytes.length && current < line; i++) {
      if (bytes[i] === 10) {
        current++;
        byte = i + 1;
      }
    }
    return byte;
  }

  function showNotices(removed: readonly RenderRemoval[], allBlockedImages: readonly BlockedImage[]): void {
    const path = deps.currentPath();
    const buffer = deps.buffer();
    if (!path || !buffer) return;
    // Protocol-relative images are never loadable, so they are neither counted nor named.
    const blockedImages = grantableBlockedImages(allBlockedImages, removed);
    clearBlockedNotices();
    if (blockedImages.length > 0 && !htmlGrantWouldChangeForNotice(removed)) {
      blockedContentNotice(blockedImages);
    } else {
      trustBlockedNotices({
        path,
        removed,
        blockedImages,
        grants: grantsFor(path),
        onGrantHtml: () => { void grantHtml(); },
      });
    }
    truncationNotices({
      buffer,
      removed,
      showSource: (line) => {
        void byteOffsetForLine(line).then((b) => deps.showSource(b));
      },
    });
  }

  /**
   * Applies one trust change and says so when it cannot be kept: trust.json from a newer Marxy is left
   * alone, and a failed write leaves the store as it was. True only when the change really landed.
   */
  async function applyTrustChange(change: (store: TrustStore) => Promise<boolean>): Promise<boolean> {
    const current = store;
    if (!current) return false;
    try {
      if (await change(current)) return true;
      notify({ kind: 'info', text: TRUST_NEWER_VERSION_TEXT });
    } catch (err) {
      notify({ kind: 'info', text: trustWriteFailedText(err) });
    }
    return false;
  }

  async function grantHtml(): Promise<void> {
    const path = deps.currentPath();
    if (!path || !deps.buffer()) return;
    if (!store && loadFailed) {
      // The failure may have been transient (EMFILE, EAGAIN): read again, once, for this grant. A second
      // failure notifies again inside load() and the grant is dropped with nothing written.
      loading = null;
      await load();
    }
    if (!store) return;
    const pos = deps.position(path);
    const granted = await applyTrustChange((s) => s.grant(path, { html: true }));
    // The reader may have opened another document while the write ran; the grant is theirs to keep
    // for `path`, but nothing here may re-render or announce over the document now open.
    if (!granted || deps.currentPath() !== path) return;
    deps.rerender(pos);
    grantSummaryNotice(path, true);
  }

  async function revokeHtml(): Promise<void> {
    const path = deps.currentPath();
    if (!path || !store) return;
    const pos = deps.position(path);
    if (!(await applyTrustChange((s) => s.revoke(path, 'html')))) return;
    if (deps.currentPath() !== path) return;
    clearGrantSummaryNotices();
    deps.rerender(pos);
  }

  async function maybeRerenderForLateTrust(): Promise<void> {
    await load();
    const path = deps.currentPath();
    if (!path || !store || !grantsFor(path).html) return;
    deps.rerender(deps.position(path));
  }

  return {
    load,
    policyFor: (path) => policyFor({ html: grantsFor(path).html }),
    grantsFor,
    showNotices,
    grantHtml,
    revokeHtml,
    maybeRerenderForLateTrust,
  };
}
