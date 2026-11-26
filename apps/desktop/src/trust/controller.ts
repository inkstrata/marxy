// What the open document may show: trust.json, the HTML grant and its
// revoke, the blocked-content and truncation notices, and the one late re-render when trust.json
// arrives after first text. One instance per app; app.ts owns the page it re-renders.

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
import { isUntitled } from '../document/untitled.ts';
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

/** Where the reader is: a byte in the source and how far into its block. */
export interface TrustPosition {
  readonly byteOffset: number;
  readonly fraction: number;
}

/**
 * Each pane-taking dep acts on the pane whose host is `pane` (a notice's own pane), or on the focused pane when
 * `pane` is unset. A pane that has gone shows nothing: its path is null.
 */
export interface TrustControllerDeps {
  /** A shell without `configPaths` has nowhere to keep trust.json: nothing is granted, ever. */
  readonly shell: Pick<Shell, 'readFile' | 'writeFileAtomic'> & { configPaths?: Shell['configPaths'] };
  /** The open document's path, or null with none open. */
  currentPath(pane?: HTMLElement): string | null;
  /** The open document's bytes, read when a notice needs them (the truncation line's offset). */
  buffer(pane?: HTMLElement): Buffer | null;
  /** The reader's position in the open document, read before a trust change is written. */
  position(path: string, pane?: HTMLElement): TrustPosition;
  /** The page again from the open buffer under the new grants, landing on and restoring `at`. */
  rerender(at: TrustPosition, pane?: HTMLElement): void;
  /** Every pane and the file it shows, so a grant reaches each pane showing the same file; unset, only the pane acted on. */
  panes?(): readonly { readonly host: HTMLElement; readonly path: string | null }[];
  /** Source mode at a byte: the truncation notice's "show source" action. */
  showSource(byteOffset: number, pane?: HTMLElement): Promise<void>;
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
  showNotices(
    removed: readonly RenderRemoval[],
    blockedImages: readonly BlockedImage[],
    at?: { readonly path: string; readonly buffer: Buffer; readonly pane?: HTMLElement },
  ): void;
  /** Grants `at.path` HTML and re-renders `at.pane` (a notice's own file and pane); unset, the focused pane's. */
  grantHtml(at?: { readonly path: string; readonly pane?: HTMLElement }): Promise<void>;
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
        notify({ kind: 'error', text: TRUST_UNREADABLE_TEXT });
      }
    })();
    return loading;
  }

  async function byteOffsetForLine(line: number, from: Buffer | null = deps.buffer()): Promise<number> {
    const buffer = from;
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

  /**
   * The notices for one render. A view says which document and pane it rendered (`at`), so a render in an
   * unfocused pane speaks in that pane about its own file; unset, the focused pane's.
   */
  function showNotices(
    removed: readonly RenderRemoval[],
    allBlockedImages: readonly BlockedImage[],
    at?: { readonly path: string; readonly buffer: Buffer; readonly pane?: HTMLElement },
  ): void {
    const path = at?.path ?? deps.currentPath();
    const buffer = at?.buffer ?? deps.buffer();
    const pane = at?.pane;
    if (!path || !buffer) return;
    // Protocol-relative images are never loadable, so they are neither counted nor named.
    const blockedImages = grantableBlockedImages(allBlockedImages, removed);
    clearBlockedNotices(pane);
    if (blockedImages.length > 0 && !htmlGrantWouldChangeForNotice(removed)) {
      blockedContentNotice(blockedImages, pane);
    } else {
      trustBlockedNotices({
        pane,
        path,
        removed,
        blockedImages,
        grants: grantsFor(path),
        // Bound to this render's file and pane: a click lands after focus may have moved to the other pane.
        onGrantHtml: () => { void grantHtml({ path, pane }); },
      });
    }
    truncationNotices({
      buffer,
      removed,
      pane,
      showSource: (line) => {
        if (deps.currentPath(pane) !== path) return;
        void byteOffsetForLine(line, buffer).then((b) => deps.showSource(b, pane));
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
      notify({ kind: 'error', text: TRUST_NEWER_VERSION_TEXT });
    } catch (err) {
      notify({ kind: 'error', text: trustWriteFailedText(err) });
    }
    return false;
  }

  /**
   * Waits for the one read in flight and says whether a store resulted. A read that failed earlier may have
   * been transient (EMFILE, EAGAIN), so a change that follows it (`mayRetry`) reads again, once for all the
   * changes waiting on that failure: the first of them to see it reset starts the retry and the rest join
   * it, so every change lands in the one store that results, in the order it was made. A second
   * failure notifies again inside load() and the changes are dropped with nothing written.
   */
  async function storeReady(mayRetry: boolean): Promise<boolean> {
    const attempt = load();
    await attempt;
    if (!store && loadFailed && mayRetry) {
      if (loading === attempt) loading = null;
      await load();
    }
    return store !== null;
  }

  /** The panes showing `path` (just `origin` when the app does not list its panes). */
  function showing(path: string, origin?: HTMLElement): { readonly host?: HTMLElement }[] {
    const all = deps.panes?.();
    return all ? all.filter((p) => p.path === path) : [{ host: origin }];
  }

  /** Re-renders each pane showing `path` from the position it had before the change, then drops panes that moved on meanwhile. */
  function rerenderShowing(path: string, origin: HTMLElement | undefined, before: ReadonlyMap<HTMLElement | undefined, TrustPosition>): void {
    for (const { host } of showing(path, origin)) {
      if (deps.currentPath(host) !== path) continue;
      deps.rerender(before.get(host) ?? deps.position(path, host), host);
    }
  }

  const positions = (path: string, origin?: HTMLElement): Map<HTMLElement | undefined, TrustPosition> =>
    new Map(showing(path, origin).map(({ host }) => [host, deps.position(path, host)]));

  async function grantHtml(at?: { readonly path: string; readonly pane?: HTMLElement }): Promise<void> {
    const pane = at?.pane;
    const path = at?.path ?? deps.currentPath();
    if (!path || deps.currentPath(pane) !== path || !deps.buffer(pane)) return;
    // A grant is kept by file path, and a scratch document has none: it stays blocked until it is saved.
    if (isUntitled(path)) {
      notify({ kind: 'refused', text: 'Raw HTML in a document that is not saved yet stays blocked. Save it first, then allow it.' });
      return;
    }
    // The read starts a task after first text, so a click on the offer can land before it settles: wait for
    // it rather than dropping the grant with nothing shown.
    if (!(await storeReady(loading !== null))) return;
    const before = positions(path, pane);
    const granted = await applyTrustChange((s) => s.grant(path, { html: true }));
    // The reader may have opened another document while the write ran; the grant is theirs to keep
    // for `path`, but nothing here may re-render or announce over the document now open.
    if (!granted) return;
    rerenderShowing(path, pane, before);
    if (deps.currentPath(pane) === path) grantSummaryNotice(path, true);
  }

  async function revokeHtml(): Promise<void> {
    const path = deps.currentPath();
    if (!path) return;
    if (!(await storeReady(loading !== null))) return;
    const before = positions(path);
    if (!(await applyTrustChange((s) => s.revoke(path, 'html')))) return;
    if (deps.currentPath() === path) clearGrantSummaryNotices();
    rerenderShowing(path, undefined, before);
  }

  async function maybeRerenderForLateTrust(): Promise<void> {
    await load();
    const path = deps.currentPath();
    if (!path || !store || !grantsFor(path).html) return;
    const before = positions(path);
    rerenderShowing(path, undefined, before);
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
