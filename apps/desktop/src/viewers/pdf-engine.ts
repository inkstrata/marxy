// pdf.js, set up the way Marxy reads a PDF: loaded only when a PDF opens, its worker bundled with the app, the file's
// bytes asked for by range through the shell (`marxy-file://` with Range in the Tauri shell, so a large PDF is never read
// whole), no scripts (pdf.js runs none without its scripting sandbox, which is not loaded), no XFA, no WebAssembly (the
// CSP allows none: the decoders' plain-JavaScript forms instead), and nothing fetched from anywhere else.
/// <reference types="vite/client" />
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { rangePieces } from '@marxy/core/src/viewer/pdf.ts';
import type { AppShell } from '../app-types.ts';

export type PdfDocument = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;
export type PdfViewport = pdfjs.PageViewport;
export type PdfTextContent = Awaited<ReturnType<PdfPage['getTextContent']>>;
export const TextLayer = pdfjs.TextLayer;
export const PasswordException = pdfjs.PasswordException;

/** The most one read asks the shell for: `marxy-file://` answers one Range of at most 4 MB (file_scheme.rs). */
const RANGE_MAX = 4 * 1024 * 1024;

// The Adobe CMaps (BSD-3) a PDF names for its text when its fonts do not carry one; each is a chunk of its own, loaded
// only when a page asks for it, read as data so nothing is fetched under the CSP.
const CMAPS = import.meta.glob('../../node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?inline', import: 'default' }) as Record<string, () => Promise<string>>;

/** pdf.js's factory for its built-in data, answered from the bundle: CMaps only (no standard fonts are shipped). */
class BundledData {
  constructor(_o: { cMapUrl?: string | null; standardFontDataUrl?: string | null; wasmUrl?: string | null }) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = kind === 'cMapUrl' ? Object.entries(CMAPS).find(([path]) => path.endsWith(`/${filename}`))?.[1] : undefined;
    if (!load) throw new Error(`${filename}: not bundled`);
    const url = await load();
    return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  }
}

let worker: pdfjs.PDFWorker | null = null;

/** One worker for every PDF the app opens. */
function sharedWorker(): pdfjs.PDFWorker {
  if (!worker || worker.destroyed) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    worker = new pdfjs.PDFWorker();
  }
  return worker;
}

/** The file's bytes for pdf.js, a range at a time, as it asks for them; `read` counts what was read, for the checks. */
class ShellRange extends pdfjs.PDFDataRangeTransport {
  private readonly read: (offset: number, length: number) => Promise<Uint8Array>;
  private readonly failed: (e: unknown) => void;

  constructor(length: number, read: (offset: number, length: number) => Promise<Uint8Array>, failed: (e: unknown) => void) {
    super(length, null);
    this.read = read;
    this.failed = failed;
  }

  override requestDataRange(begin: number, end: number): void {
    void (async () => {
      const parts = await Promise.all(rangePieces(begin, end, RANGE_MAX).map(([a, b]) => this.read(a, b - a)));
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      this.onDataRange(begin, out);
    })().catch(this.failed);
  }
}

export interface OpenedPdf {
  readonly doc: PdfDocument;
  /** Bytes read so far through the shell, and in how many reads. */
  readonly read: () => { bytes: number; reads: number };
  destroy(): void;
}

/** Opens `path` (`size` bytes) through `shell`'s ranged read. Rejects with pdf.js's PasswordException for a locked file. */
export async function openPdf(shell: Pick<AppShell, 'readRange'>, path: string, size: number): Promise<OpenedPdf> {
  let bytes = 0;
  let reads = 0;
  let fail: (e: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  const range = new ShellRange(
    size,
    async (offset, length) => {
      const got = await shell.readRange(path, offset, length);
      bytes += got.length;
      reads += 1;
      return got;
    },
    (e) => fail(e),
  );
  const task = pdfjs.getDocument({
    range,
    worker: sharedWorker(),
    // Ranges as pdf.js needs them, and nothing read ahead of the pages shown.
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 65536,
    useWasm: false,
    wasmUrl: new URL('pdfjs/', document.baseURI).href,
    useWorkerFetch: false,
    cMapUrl: 'marxy-bundled:cmaps/',
    cMapPacked: true,
    BinaryDataFactory: BundledData,
    enableXfa: false,
    isOffscreenCanvasSupported: true,
    stopAtErrors: false,
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  // No password is asked for: a locked file is said so, and Open in default app is one press away.
  task.onPassword = () => fail(new pdfjs.PasswordException('This PDF is locked with a password.', 'needs a password'));
  const doc = await Promise.race([task.promise, failed]).catch(async (e: unknown) => {
    await task.destroy().catch(() => {});
    throw e;
  });
  return {
    doc,
    read: () => ({ bytes, reads }),
    destroy: () => void task.destroy().catch(() => {}),
  };
}
