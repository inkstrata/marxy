// Helpers shared by the D-10 tests: the same file twice, one watch per store, notices per pane, and the
// adversarial interleaving. Booted on the shipped skeleton over the memory shell (support/two-pane.mjs),
// with the stale-write guard of the Tauri shell emulated (`guard: true`).
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes } from './two-pane.mjs';

export const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
// A guard that waits for an answer no test gives would hang: the timeout makes that a failure.
export const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);

export const para = (word) =>
  `${word} runs long enough to wrap across several lines of the column, so that the typesetter has ` +
  'real paragraphs to break and the page is tall enough to scroll a heading to the reading line. ';

export const files = {
  '/r/A.md': `# Alpha\n\n${para('Alpha').repeat(12)}\n\n## Later\n\n${para('Later').repeat(12)}\n\n- [ ] alpha task\n`,
  '/r/B.md': `# Bravo\n\n${para('Bravo').repeat(4)}\n\n- [ ] bravo task\n`,
  '/r/C.md': `# Charlie\n\n${para('Charlie').repeat(4)}\n`,
  '/r/L.md': Array.from({ length: 12 }, (_, i) => `line${i + 1} hello world`).join('\n') + '\n',
};

/** A page on `open` (one or two paths), with the guard emulated; `fn(page, mod)` runs, the browser closes after. */
export async function withPanes(open, fn, { guard = true, extra = {} } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await bootTwoPanes(page, { files: { ...files, ...extra }, open, guard });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** The pane's notices, as `{ text, buttons }`; slot 0's region is `#marxy-notices`, slot 1's `#marxy-notices-2`. */
export const notices = (page, slot) =>
  page.evaluate(
    (id) =>
      [...(document.getElementById(id)?.querySelectorAll('.marxy-notice') ?? [])].map((line) => ({
        text: line.querySelector('.marxy-notice-text')?.textContent,
        buttons: [...line.querySelectorAll('button')].map((b) => b.textContent),
      })),
    slot === 0 ? 'marxy-notices' : 'marxy-notices-2',
  );

export const texts = async (page, slot) => (await notices(page, slot)).map((n) => n.text);

export const paths = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));

/** The text in pane `slot`'s Source editor, or null with none mounted. */
export const editorText = (page, slot) =>
  page.evaluate(async (slot) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const pane = window.__marxyHandle.panes().panes[slot];
    return pane ? activeSourceEditor(pane.parts.source)?.docText() ?? null : null;
  }, slot);

/** The bytes pane `slot`'s store holds, as text. */
export const storeText = (page, slot) =>
  page.evaluate(
    (slot) => new TextDecoder().decode(window.__marxyHandle.panes().panes[slot].view.store().snapshot().buffer.bytes),
    slot,
  );

export const disk = (page, path) => page.evaluate((p) => window.__disk(p), path);
export const outside = (page, path, text, events) => page.evaluate(({ path, text, events }) => window.__outside(path, text, events), { path, text, events });
/** The app's writes to the documents (its own index and history files are not). */
export const appWrites = (page) => page.evaluate(() => window.__appWrites.filter((w) => w.path.startsWith('/r/')).map((w) => ({ ...w })));
export const watchCalls = (page) =>
  page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'watch').map((c) => c.args[0]));
export const liveWatches = (page) => page.evaluate(() => window.__marxyWatches);
export const readsOf = (page, path) =>
  page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === p).length, path);

export const focusPane = (page, slot) =>
  page.evaluate((s) => {
    const panes = window.__marxyHandle.panes();
    panes.focus(panes.panes[s]);
  }, slot);

export const mode = (page, slot) => page.evaluate((s) => window.__marxyHandle.panes().panes[s].view.mode, slot);

/** `slot`'s pane in Source (Mod+E when it is Rendered), waiting for its editor. */
export async function toSource(page, slot) {
  if ((await mode(page, slot)) === 'source') return;
  await focusPane(page, slot);
  await page.evaluate((s) => window.__marxyHandle.panes().panes[s].view.toggleMode(), slot);
  await page.waitForFunction((s) => window.__marxyHandle.panes().panes[s].view.mode === 'source', slot);
  await page.waitForSelector(`#${slot === 0 ? 'marxy-source' : 'marxy-source-2'} .cm-content`);
}

/** Types `typed` at the end of line `line` (1-based) of `slot`'s Source editor, through the keyboard, focus left in it. */
export async function typeAtLineEnd(page, slot, line, typed) {
  const mount = slot === 0 ? '#marxy-source' : '#marxy-source-2';
  await page.focus(`${mount} .cm-content`);
  await page.evaluate(async ({ mount, line }) => {
    const { activeSourceEditor } = await import('/src/source/editor.ts');
    const view = activeSourceEditor(document.querySelector(mount)).view;
    const end = view.state.doc.line(Math.min(line, view.state.doc.lines)).to;
    view.dispatch({ selection: { anchor: end, head: end } });
  }, { mount, line });
  await page.keyboard.type(typed);
}

/** Ticks the task in the pane at `slot`, through its own article. */
export async function tickTask(page, slot) {
  await page.evaluate((s) => {
    const article = window.__marxyHandle.panes().panes[s].article;
    article.querySelector('input[type=checkbox]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, slot);
}

export async function untilSettled(page, ms = 400) {
  await page.waitForTimeout(ms);
}

export { assert };
