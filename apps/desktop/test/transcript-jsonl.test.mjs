// A JSONL agent session read as a conversation (K-12; ADR-0061): with a `[[kind]]` rule that says `read = true` for its
// folder, the corpus session opens in Read as turns; without one it opens in Source. ⌘E shows Source at the line Read was
// on and back. *Only you* hides the assistant's turns and says how many; *Collapse tools* folds the tool calls into one
// line a run; a turn's ⌘C is its text without its label; a tool's ⌘C its whole output; a drag copies what it shows, an
// invisible's character and not its label. Nothing in the view reaches an operation, and nothing is written. A rule's
// read decides any file's mode. The first paint of a large session, an append to it and the marking of late rows are in
// transcript-lite.test.mjs, on the pull-request path. WebKit, over the shipped skeleton and the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { valueImportSpecs } from '../../../scripts/lib/imports.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 240_000 }, fn);
after(() => closeHarness());

const SESSION = readFileSync(new URL('../../../fixtures/corpus/40-session.jsonl', import.meta.url), 'utf8');
const RULE = '[[kind]]\nglob = "/s/**"\nis = "transcript"\nread = true\n';
const line = (o) => JSON.stringify(o);
/** A session long enough to scroll: 60 exchanges, each a prompt, a reply with a tool call, and its result. */
const LONG = Array.from({ length: 60 }, (_, i) => [
  line({ type: 'user', message: { role: 'user', content: `Prompt number ${i + 1}: what does step ${i + 1} do?` } }),
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Step ${i + 1} reads the file.\n\nIt then writes **${i + 1}** lines of output and stops.` }, { type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: `run --step ${i + 1}` } }] } }),
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: `ok ${i + 1}\ndone` }] } }),
].join('\n')).join('\n') + '\n';
const files = {
  '/ruled/tool.py': 'print("a code file a rule reads")\n',
  '/kept/notes.md': '# Notes\n\nA Markdown file a rule keeps in Source.\n',
  '/s/40-session.jsonl': SESSION,
  '/s/long.jsonl': LONG,
  '/r/40-session.jsonl': SESSION,
  '/config': `${RULE}\n[[kind]]\nglob = "/ruled/**"\nis = "code"\nread = true\n\n[[kind]]\nglob = "/kept/**"\nis = "notes"\nread = false\n`,
};

async function withPage(fn, open = ['/s/40-session.jsonl'], { width = 1440, height = 900, guard = false } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await bootTwoPanes(page, { files, open, guard });
    await waitView(page);
    await fn(page);
  } finally {
    await browser.close();
  }
}

const waitView = (page) => page.waitForFunction(() => {
  const pane = window.__marxyHandle?.panes().focused;
  return pane && (pane.view.mode === 'source' || pane.parts.article.querySelector('[data-marxy-derived]') !== null);
});
const settled = (page) => page.evaluate(async () => {
  const { transcriptIn } = await import('/src/kinds/transcript-view.ts');
  await transcriptIn(window.__marxyHandle.panes().focused.parts.article)?.settled();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const state = (page) => page.evaluate(async () => {
  const { transcriptIn } = await import('/src/kinds/transcript-view.ts');
  return transcriptIn(window.__marxyHandle.panes().focused.parts.article)?.state() ?? null;
});
const openFile = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await waitView(page);
};
const copied = (page) => page.evaluate(() => {
  const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
  return call ? new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes) : null;
});
const copies = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
const run = (page, id) => page.evaluate(async (command) => {
  const { buildAppContext } = await import('/src/selection/bind.ts');
  const handle = window.__marxyHandle;
  await handle.commands().find((c) => c.id === command).run(buildAppContext(handle));
}, id);
const mod = (page) => page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
/** Writes that reached a session (`/s/` or `/r/`): the app's own state files are not the reader's documents. */
const writes = (page) => page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /^write/.test(c.method) && /^\/(?:s|r|ruled|kept)\//.test(String(c.args[0]))).length);
/** The 1-based line of byte `at` in the focused document. */
const lineOf = (page, at) => page.evaluate((b) => {
  const bytes = window.__marxyHandle.panes().focused.view.store().snapshot().buffer.bytes;
  let n = 1;
  for (let i = 0; i < b; i++) if (bytes[i] === 10) n++;
  return n;
}, at);
const modeNow = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.view.mode);

// F-111: the view loads on demand. No module the app loads before first text reaches it, or the deriver, by a static import.
nodeTest('nothing on the way to first text imports the transcript view or the deriver statically', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const resolveSpec = (from, spec) => {
    const base = spec.startsWith('@marxy/core/') ? join(repo, 'packages/core', spec.slice('@marxy/core/'.length)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
    if (base === null) return null;
    return [base, `${base}.ts`, join(base, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
  };
  const seen = new Set();
  const queue = [join(repo, 'apps/desktop/src/main.ts')];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImportSpecs(readFileSync(file, 'utf8'), file)) {
      const next = resolveSpec(file, spec);
      if (next) queue.push(next);
    }
  }
  const reached = [...seen].map((f) => f.slice(repo.length));
  assert.ok(reached.includes('apps/desktop/src/view/rendered-view.ts') && reached.length > 100, `the walk reached the app (${reached.length} modules)`);
  assert.deepEqual(reached.filter((f) => f === 'apps/desktop/src/kinds/transcript-view.ts' || f.startsWith('packages/core/src/derive/')), []);
});

test('with a [[kind]] rule that says read, the session opens in Read as turns; without one it opens in Source', () =>
  withPage(async (page) => {
    await settled(page);
    assert.equal(await modeNow(page), 'rendered');
    const seen = await page.evaluate(() => {
      const article = window.__marxyHandle.panes().focused.parts.article;
      const root = article.querySelector('[data-marxy-derived="jsonl-transcript"]');
      return {
        kind: article.closest('section.marxy-pane').getAttribute('data-marxy-kind'),
        turns: [...root.querySelectorAll('.marxy-turn')].map((t) => t.getAttribute('data-marxy-turn')),
        labels: [...root.querySelectorAll('.marxy-turn > [data-marxy-speaker]')].map((h) => h.textContent),
        head: root.querySelector('.marxy-transcript-head').textContent,
        tools: [...root.querySelectorAll('.marxy-tool .marxy-tool-line')].map((b) => [b.querySelector('.marxy-tool-name').textContent, b.querySelector('.marxy-tool-size').textContent, b.getAttribute('aria-expanded')]),
        thinking: root.querySelector('.marxy-thinking .marxy-tool-line').textContent,
        unreadable: root.querySelector('.marxy-unreadable .marxy-tool-line').textContent,
        pending: root.querySelector('.marxy-pending').textContent,
        bidi: root.querySelectorAll('.marxy-invisible-bidi').length,
        esc: root.querySelectorAll('.marxy-invisible-esc').length,
        surrogate: root.querySelector('.marxy-derived-replaced')?.getAttribute('title') ?? null,
        text: root.innerText,
        provenance: [...root.querySelectorAll('.marxy-turn')].every((t) => /^\d+$/.test(t.getAttribute('data-marxy-s') ?? '')),
      };
    });
    assert.equal(seen.kind, 'transcript');
    assert.deepEqual(seen.turns, ['you', 'agent', 'you', 'agent', 'you', 'agent']);
    assert.deepEqual(seen.labels, ['You', 'Assistant', 'You', 'Assistant', 'You', 'Assistant']);
    assert.match(seen.head, /^Derived from 18 lines of JSONL · 5 not shown · 1 of unknown type · 1 unreadable line · Source (⌘E|Ctrl\+E)$/);
    assert.deepEqual(seen.tools, [['Tool · Bash', '4 lines', 'false'], ['Tool · Edit', '1 line · 1 value not shown', 'false']], 'each tool one line at rest: its name, its result\'s length, and what it does not show');
    assert.match(seen.text, /1 value not shown: image · line 9/, 'the prompt\'s image is counted where it was, a Jump to source');
    assert.equal(seen.thinking, 'Thinking · 12 words');
    assert.equal(seen.unreadable, 'Unreadable line 12');
    assert.equal(seen.pending, 'Still being written · line 18');
    assert.equal(seen.bidi, 1, 'the escaped U+202E is drawn as its marker');
    assert.ok(seen.surrogate?.includes('lone surrogate'), 'the lone surrogate is marked');
    assert.ok(seen.provenance, 'every turn carries its file offset');
    for (const meta of ['model-name-x', '00000000-0000-4000-8000-000000000001', '0.0123', '2026-10-07T15', 'costUSD', 'input_tokens']) {
      assert.equal(seen.text.includes(meta), false, `the page shows ${meta}`);
    }
    // The same bytes in a folder no rule names open in Source, as ADR-0060 decides for a .jsonl.
    await openFile(page, '/r/40-session.jsonl');
    assert.equal(await modeNow(page), 'source');
    assert.equal(await writes(page), 0);
  }));

test('⌘E shows Source at the line Read was on, and Read again at that line', () =>
  withPage(async (page) => {
    await settled(page);
    // Scroll so a turn well down the session is on the reading line.
    const target = await page.evaluate(() => {
      const pane = window.__marxyHandle.panes().focused;
      const turns = pane.parts.article.querySelectorAll('.marxy-turn');
      const turn = turns[61];
      const top = turn.getBoundingClientRect().top + pane.view.scroller.scrollTop - pane.view.scroller.clientHeight * 0.4 + 4;
      pane.view.scroller.scrollTop = top;
      return Number(turn.querySelector('[data-marxy-s]').getAttribute('data-marxy-s'));
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const readAt = await page.evaluate(() => window.__marxyHandle.panes().focused.view.position().byteOffset);
    const want = await lineOf(page, target);
    assert.equal(await lineOf(page, readAt), want, 'Read\'s place is the line of the turn on the reading line');
    await page.keyboard.press(`${await mod(page)}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
    const sourceAt = await page.evaluate(() => window.__marxyHandle.panes().focused.view.sourcePosition().byteOffset);
    assert.equal(await lineOf(page, sourceAt), want, 'Source is at the same line');
    await page.keyboard.press(`${await mod(page)}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'rendered');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const backAt = await page.evaluate(() => window.__marxyHandle.panes().focused.view.position().byteOffset);
    assert.equal(await lineOf(page, backAt), want, 'and Read is back on it');
    assert.ok(await page.evaluate(() => window.__marxyHandle.panes().focused.parts.article.querySelector('[data-marxy-derived]') !== null));
    assert.equal(await writes(page), 0);
  }, ['/s/long.jsonl']));

test('Only you hides the assistant\'s turns and says how many; Collapse tools folds each run of calls into a line; both undo', () =>
  withPage(async (page) => {
    await settled(page);
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    const strip = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-workspace-region="strip"] button')].map((b) => b.textContent.trim()));
    assert.deepEqual(strip.filter((t) => /Collapse tools|Only you|Only assistant/.test(t)), ['Collapse tools', 'Only you', 'Only assistant']);
    const look = () => page.evaluate(() => {
      const root = window.__marxyHandle.panes().focused.parts.article.querySelector('[data-marxy-derived]');
      return {
        shown: [...root.querySelectorAll('.marxy-turn')].filter((t) => !t.hidden).map((t) => t.getAttribute('data-marxy-turn')),
        runs: [...root.querySelectorAll('.marxy-transcript-hidden-run')].map((p) => p.textContent),
        tools: [...root.querySelectorAll('.marxy-tool')].filter((t) => !t.hidden && t.getClientRects().length > 0).length,
      };
    });
    await run(page, 'transcript.only-you');
    let seen = await look();
    assert.deepEqual(seen.shown, ['you', 'you', 'you']);
    assert.deepEqual(seen.runs, ['1 turn from the assistant hidden', '1 turn from the assistant hidden', '1 turn from the assistant hidden']);
    assert.equal((await state(page)).hiddenTurns, 3);
    await run(page, 'transcript.only-you');
    seen = await look();
    assert.equal(seen.shown.length, 6);
    assert.deepEqual(seen.runs, []);
    await run(page, 'transcript.only-assistant');
    assert.deepEqual((await look()).shown, ['agent', 'agent', 'agent']);
    await run(page, 'transcript.only-assistant');
    await run(page, 'transcript.collapse-tools');
    seen = await look();
    assert.equal(seen.tools, 0);
    assert.deepEqual(seen.runs, ['1 tool call collapsed: Bash', '1 tool call collapsed: Edit']);
    await run(page, 'transcript.collapse-tools');
    assert.equal((await look()).tools, 2);
    assert.equal(await writes(page), 0);
  }));

test('copying a turn gives its text without its label; a tool its whole output; a drag what it shows; nothing reaches an operation', () =>
  withPage(async (page) => {
    await settled(page);
    // Every registered operation's canApply counts its calls from here: none may be asked about a derived selection.
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /packages\/core\/src\/operations\/index\.ts/.test(n));
      const { OPERATIONS } = await import(url);
      window.__canApply = 0;
      for (const op of OPERATIONS) {
        const was = op.canApply.bind(op);
        op.canApply = (input) => {
          window.__canApply++;
          return was(input);
        };
      }
    });
    const M = await mod(page);
    // A click on the label selects the turn; ⌘C copies its text.
    await page.locator('.marxy-turn >> nth=0').locator('[data-marxy-speaker]').click();
    await page.keyboard.press(`${M}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await copied(page), 'The indexer takes 40 seconds on my notes folder.\nCan you find out why?');
    // The assistant's turn: its text as shown, folds as their one line.
    await page.locator('.marxy-turn >> nth=1').locator('[data-marxy-speaker]').click();
    await page.keyboard.press(`${M}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === 2);
    const agentText = await copied(page);
    assert.ok(agentText.startsWith('Thinking · 12 words\n\nI\'ll profile a cold run first'), agentText);
    assert.ok(agentText.includes('Tool · Bash · 4 lines') && agentText.includes('`notes\u202etxt.md`'));
    // A tool line opens on a click and its ⌘C is the whole output.
    const bash = page.locator('.marxy-tool >> nth=0').locator('.marxy-tool-line');
    await bash.click();
    assert.equal(await bash.getAttribute('aria-expanded'), 'true');
    assert.match(await page.locator('.marxy-tool >> nth=0').locator('.marxy-tool-body').innerText(), /indexed 932 files in 41\.8s/);
    await page.keyboard.press(`${M}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === 3);
    assert.equal(await copied(page), 'indexed 932 files in 41.8s\n  parse      2.1s\n  \u001b[31mhighlight 37.9s\u001b[0m\n  write      1.8s');
    // Source lines (JSONL), from the turn's menu: the exact bytes of the lines it came from.
    await page.locator('.marxy-turn >> nth=2').locator('[data-marxy-speaker]').click({ button: 'right' });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.marxy-verb-menu [role="menuitem"]')].map((r) => r.querySelector('span')?.textContent));
    assert.deepEqual(rows, ['Copy turn', 'Copy as…', 'Source lines (JSONL)', 'Copy your prompts', 'Jump to source', 'Open in Source']);
    await page.locator('.marxy-verb-menu [data-row-key="transcript.copy-source-lines"]').click();
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length === 4);
    assert.equal(await copied(page), `${SESSION.split('\n')[8]}\n`);
    // A click on a prompt's text or on a reply selects nothing of the app's: neither resolves to a node of any document.
    await page.locator('.marxy-derived-plain >> nth=0').click();
    await page.locator('.marxy-derived-markdown >> nth=1').click();
    assert.equal(await page.evaluate(() => window.__marxyHandle.selection.state().selection.kind), 'none');
    // A drag: the text as displayed, the override's character and not its label.
    const dragged = await page.evaluate(() => {
      const code = [...document.querySelectorAll('[data-marxy-derived] code')].find((c) => c.querySelector('.marxy-invisible-bidi'));
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const event = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
      code.dispatchEvent(event);
      return { text: event.clipboardData.getData('text/plain'), prevented: event.defaultPrevented };
    });
    assert.deepEqual(dragged, { text: 'notes\u202etxt.md', prevented: true });
    // With the drag still on the page, every command is asked whether it applies, as the palette and the verb menu ask:
    // no operation is handed anything, because the app's own selection never took the drag.
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const ctx = buildAppContext(window.__marxyHandle);
      for (const c of window.__marxyHandle.commands()) {
        try {
          c.when(ctx);
        } catch {}
      }
    });
    assert.equal(await page.evaluate(() => window.__canApply), 0, 'no operation was asked about a derived selection');
    const selection = await page.evaluate(() => window.__marxyHandle.selection.state().selection.kind);
    assert.equal(selection, 'none');
    assert.equal(await writes(page), 0);
  }));

test('Jump to source selects the turn\'s lines in Source; a dropped count unfolds to its lines', () =>
  withPage(async (page) => {
    await settled(page);
    await page.locator('.marxy-transcript-count[data-marxy-dropped="unknown"]').click();
    const unknown = await page.locator('ul.marxy-transcript-dropped[data-marxy-dropped="unknown"]').innerText();
    assert.match(unknown, /mystery-record · 1 line: 14/);
    await page.locator('.marxy-turn >> nth=2').locator('[data-marxy-speaker]').click({ button: 'right' });
    await page.locator('.marxy-verb-menu [data-row-key="transcript.jump"]').click();
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    const selected = await page.evaluate(async () => {
      const { activeSourceEditor } = await import('/src/source/editor.ts');
      const editor = activeSourceEditor(window.__marxyHandle.panes().focused.parts.source);
      const { from, to } = editor.view.state.selection.main;
      return editor.view.state.sliceDoc(from, to);
    });
    assert.equal(selected, `${SESSION.split('\n')[8]}\n`, 'the turn is the whole of its line, its newline with it');
    assert.equal(await writes(page), 0);
  }));

test('the agent finishes its last line and writes another: Read derives the view again, and nothing is written', () =>
  withPage(async (page) => {
    await settled(page);
    const before = await page.evaluate(() => ({
      pending: document.querySelector('.marxy-pending')?.textContent ?? null,
      turns: document.querySelectorAll('.marxy-turn').length,
    }));
    assert.deepEqual(before, { pending: 'Still being written · line 18', turns: 6 });
    const finished = `${SESSION}"}]}}\n${line({ type: 'user', message: { role: 'user', content: 'Thanks.' } })}\n`;
    const writesBefore = await writes(page);
    await page.evaluate((text) => window.__outside('/s/40-session.jsonl', text), finished);
    await page.waitForFunction(() => document.querySelectorAll('.marxy-turn').length === 7);
    await settled(page);
    const after = await page.evaluate(() => ({
      pending: document.querySelector('.marxy-pending')?.textContent ?? null,
      last: [...document.querySelectorAll('.marxy-turn')].at(-1).innerText,
      agentLast: [...document.querySelectorAll('.marxy-turn[data-marxy-turn="agent"]')].at(-1).innerText,
      mode: window.__marxyHandle.panes().focused.view.mode,
    }));
    assert.equal(after.pending, null, 'the line is finished');
    assert.equal(after.mode, 'rendered');
    assert.match(after.last, /Thanks\./);
    assert.match(after.agentLast, /Writing the sum/, 'the finished line joined the assistant\'s last turn');
    assert.equal(await writes(page), writesBefore + 1, 'the other program\'s write, and none of the app\'s');
  }, ['/s/40-session.jsonl'], { guard: true }));

test('a rule\'s read decides the mode of any file, not only a session: a code file in Read, a Markdown file in Source', () =>
  withPage(async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/ruled/tool.py'));
    assert.equal(await modeNow(page), 'rendered', 'read = true opens a .py in Read');
    await page.evaluate(() => window.__marxyHandle.open('/kept/notes.md'));
    assert.equal(await modeNow(page), 'source', 'read = false opens a .md in Source');
    assert.equal(await writes(page), 0);
  }));
