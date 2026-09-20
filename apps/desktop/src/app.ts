// Application startup: given a shell, open the document, render it, and emit startup marks (MARXY-95).
import { parseMarkdown, type Document } from '@marxy/core';
import { renderDocumentSafeHtml } from '@marxy/core/src/render/index.ts';
import { attach, snapToGrid, type TypesetController } from '@marxy/typeset';
import type { Shell } from '@marxy/shell-api';
import { buildBlocks, buildNodeMap, type BlockList, type NodeMap } from './render/post.ts';
import { applyImages, pathsForDocument } from './render/images.ts';
import { blockedContentNotice } from './notices/blocked.ts';
import { ensureNoticesRegion } from './notices/index.ts';
import { applyWeightOffset, platformOf } from './theme/offset.ts';
import { isDocVisible, waitForEnginePaint } from './paint-signal.mjs';

/** The Phase 0 shell surface: frozen Shell members tauri.ts already implements, plus startup extras. */
export type AppShell = Pick<Shell, 'readFile' | 'writeFileAtomic' | 'watch' | 'platform' | 'startupMarks'> & {
  args(): Promise<string[]>;
  mark(name: string, t: number, data?: string): Promise<void>;
  quit(code?: number): Promise<void>;
  imageSize(path: string): Promise<{ width: number; height: number } | null>;
  allowAssetScope(dir: string): Promise<void>;
  assetUrl(path: string): string;
};

export interface OpenDocument {
  readonly ast: Document;
  readonly html: string;
  /** Rendered element → AST node, through its byte range (ADR-0023). */
  readonly nodeMap: NodeMap;
  /** Refreshed whenever layout moves them; built once here for now (MARXY-38 reads them). */
  blocks: BlockList;
}

export type AppHandle = {
  readonly state: { document: OpenDocument | null };
  dispatch(action: unknown): void;
  commands(): readonly unknown[];
  readonly shell: AppShell;
  readonly ready: Promise<void>;
};

const t0 = Date.now();

const state: { document: OpenDocument | null } = { document: null };

/**
 * Counts animation frames from the moment the script runs, independently of anything below. The
 * paint mark reports how many frames passed between the DOM mutation and `first_text`, and the CLI
 * smoke check asserts that count is at least two — because a mark that only *claims* to be after
 * the paint would silently make every cold-start number optimistic (ADR-0013). The counter lives
 * out here, not inside waitForEnginePaint(), so that a wait which never actually waited still
 * reports frames=0 and fails the check instead of passing quietly.
 */
let framesObserved = 0;
let observing = true;
const observeFrame = () => { framesObserved += 1; if (observing) requestAnimationFrame(observeFrame); };
requestAnimationFrame(observeFrame);

/** Sanitised (or empty-state) HTML into `#doc`. `app.ts` is in registry.innerHtmlAllowedIn. */
function assignHtml(doc: HTMLElement, html: string): void {
  doc.innerHTML = html;
}

interface RenderEvidence { readonly blocks: number; readonly chars: number; readonly heading: string }

/** Evidence that the document actually reached the DOM, for the CLI smoke check. */
function renderEvidence(doc: HTMLElement): RenderEvidence {
  return {
    blocks: doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote').length,
    chars: doc.textContent?.length ?? 0,
    heading: doc.querySelector('h1,h2,h3')?.textContent?.trim().replace(/\s+/g, ' ') ?? '',
  };
}

/** The arguments this launch was given, kept so the error path can honour the flag too. */
let launchArgs: readonly string[] = [];

/** The shell this launch is using; set by startApp, never imported from tauri.ts. */
let shell: AppShell;

/** Asset-protocol roots allowed this session (post-pass 3). */
const scopedAssetRoots = new Set<string>();

/** True when a harness launched us: the startup harness sets the env var, the flag is for a person. */
async function inHarness(): Promise<boolean> {
  if (launchArgs.includes('--quit-after-paint')) return true;
  try {
    return Boolean((await shell.startupMarks()).quit_after_paint);
  } catch {
    return false;
  }
}

/**
 * Every path ends here: the frame observer stops so an idle window is not woken once a frame, and a
 * harness launch exits with a code that says whether it painted. Harness mode is resolved here rather
 * than before the render so that its IPC round trip stays out of the measured path.
 */
let settleReady: (code: number) => void = () => {};

async function finish(code: number): Promise<void> {
  observing = false;
  settleReady(code);
  if (await inHarness()) await shell.quit(code);
}

/**
 * The grid pass (ADR-0030), now and whenever heights can change under it: when fonts arrive and
 * when the column is resized. Reading position is re-read after each, because tops move.
 */
let typeset: TypesetController | null = null;

function snap(article: HTMLElement): void {
  snapToGrid(article, parseFloat(getComputedStyle(article).lineHeight));
  if (state.document) state.document.blocks = buildBlocks(article, state.document.nodeMap);
}

function keepOnGrid(article: HTMLElement): void {
  snap(article);
  void document.fonts.ready.then(() => snap(article));
  let pending = 0;
  let width = article.clientWidth;
  new ResizeObserver(() => {
    if (article.clientWidth === width) return;
    width = article.clientWidth;
    clearTimeout(pending);
    // A new width re-breaks every paragraph; the relayout's passes re-run the grid pass themselves.
    pending = window.setTimeout(() => (typeset ? typeset.relayout('resize') : snap(article)), 100);
  }).observe(article);
}

/**
 * The typesetter (MARXY-23), after first text: the reader sees the engine's wrapping for at most a
 * frame, then the viewport set by Knuth–Plass, and the rest in idle time. Hyphenation and hanging
 * punctuation are MARXY-24.
 */
async function typesetDocument(article: HTMLElement): Promise<void> {
  const lineBox = parseFloat(getComputedStyle(article).lineHeight);
  typeset = attach(article, { lineBox, glueStretchEm: 0.6, lastLineMinWidth: 0.33, onPass: () => snap(article) });
  await typeset.ready;
  await shell.mark('typeset_viewport', Date.now(), `ms=${typeset.stats.viewportMs.toFixed(1)} set=${typeset.stats.typeset}`);
}

async function boot(): Promise<void> {
  await shell.mark('script_start', t0);
  // Before anything is laid out, so no weight is set twice. The WebKitGTK version arrives with the
  // shell-api amendment (MARXY-94); until then Linux takes the table's unknown-version row.
  const offset = applyWeightOffset(document.documentElement, platformOf(navigator.userAgent), null);
  void shell.mark('weight_offset', Date.now(), `offset=${offset}`);
  launchArgs = launchArgs.length > 0 ? launchArgs : await shell.args();
  // Skip flags and the macOS launcher's -psn_… argument; the first plain argument is the document.
  const file = launchArgs.find(a => !a.startsWith('-'));
  const doc = document.getElementById('doc')!;
  // Harness-only: the negative test that `#doc { visibility: hidden }` is not first readable text.
  // The flag only hides the element; refusing `first_text` is the visibility check below, not the flag.
  if (launchArgs.includes('--smoke-hide-doc')) doc.style.visibility = 'hidden';

  // No document means no `first_text`: nothing was read, so a launch like this must not be able to
  // hand the startup measurement a cold-start number.
  if (!file) {
    assignHtml(doc, '<p class="marxy-empty">Open a markdown file: <code>marxy README.md</code></p>');
    await shell.mark('no_document', Date.now());
    return finish(0);
  }

  const bytes = await shell.readFile(file);
  // One parse, then the sanitised render from that AST — not a second parser (ADR-0001, ADR-0021).
  const ast = parseMarkdown(bytes, { file });
  const { html, removed, blockedImages } = renderDocumentSafeHtml(ast);
  const nodeMap = buildNodeMap(ast);
  console.info(`marxy: sanitiser removed ${removed.length}`);
  ensureNoticesRegion();
  // Watermark before the mutation so a blank-page first-paint cannot satisfy the wait.
  const after = performance.now();
  assignHtml(doc, html);
  state.document = { ast, html, nodeMap, blocks: [] };
  const { documentDir, imageRoot } = pathsForDocument(file);
  await applyImages(doc, { documentPath: file, documentDir, imageRoot, shell, scopedRoots: scopedAssetRoots });
  blockedContentNotice(blockedImages);
  // The faces are preloaded and `font-display: block`: first text is never the fallback face, and
  // the grid pass below measures the real one (ADR-0015).
  // Layout first: a face is requested when text needs it, and `fonts.ready` waits only for requests.
  void doc.offsetHeight;
  await document.fonts.ready;
  await shell.mark('fonts_ready', Date.now(), `faces=${[...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}/${f.style}`).join(',')}`);
  document.title = `${file.split('/').pop()} — marxy`;

  keepOnGrid(doc);
  const evidence = renderEvidence(doc);
  state.document.blocks = buildBlocks(doc, nodeMap);
  const renderedAt = Date.now();
  await shell.mark('render', renderedAt, `blocks=${evidence.blocks} chars=${evidence.chars} heading=${evidence.heading}`);

  // Nothing on screen is not "first readable text": a build whose rendering silently produced nothing
  // must not be able to hand the startup measurement a number either — and it has no paint to wait for,
  // so this runs before the wait. The `no_text` mark also disarms the shell's paint deadline.
  if (evidence.blocks === 0 || evidence.chars === 0) {
    await shell.mark('no_text', Date.now(), `blocks=${evidence.blocks} chars=${evidence.chars}`);
    return finish(1);
  }

  // Hidden text is still in `textContent` and frames still tick; that is not a paint (MARXY-71).
  if (!isDocVisible(doc)) {
    await shell.mark('no_paint', Date.now(), 'reason=not-visible');
    return finish(1);
  }

  // Counted from here, so the number covers the wait and not the render mark's IPC round trip.
  // The wait has no deadline of its own: some environments deliver no frames and no paint entries
  // (a Mac in dark wake, a locked screen) and there it never resolves. A harness launch is ended
  // by the shell's deadline instead, because WebKit aligns in-page timers in a window that cannot
  // paint to about 15 s. A reader is left waiting and gets the document when the display wakes.
  const framesAtRender = framesObserved;
  const { signal } = await waitForEnginePaint({ after });
  // One timestamp for both marks: the paint detail costs an IPC round trip and `first_text` must not
  // be pushed later by the cost of reporting it.
  const paintedAt = Date.now();
  const frames = framesObserved - framesAtRender;

  await shell.mark('painted', paintedAt, `frames=${frames} since_render_ms=${paintedAt - renderedAt} signal=${signal}`);
  // Two fields exactly: the acceptance criterion names this line, and the startup harness parses it.
  // Anything the check needs beyond the timestamp goes on the `painted` line above.
  await shell.mark('first_text', paintedAt);
  await typesetDocument(doc);
  return finish(0);
}

/**
 * Everything main.ts used to do after it had a shell. `opts.argv` overrides `shell.args` so the
 * browser harness can name a document without Tauri.
 */
export async function startApp(injected: AppShell, opts?: { argv?: readonly string[] }): Promise<AppHandle> {
  shell = injected;
  launchArgs = opts?.argv ? [...opts.argv] : [];
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  settleReady = () => resolveReady();
  const handle: AppHandle = {
    get state() { return state; },
    dispatch() {},
    commands() { return []; },
    shell: injected,
    ready,
  };
  try {
    await boot();
  } catch (e) {
    document.getElementById('doc')!.textContent = String(e);
    await shell.mark('error', Date.now(), String(e));
    await finish(1);
  }
  return handle;
}
