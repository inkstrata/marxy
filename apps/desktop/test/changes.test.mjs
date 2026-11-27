// Changes, the tray and notes in WebKit: a change is staged until Save and read as a patch (R), the
// part's change verbs (d, Alt+↑/↓, < >, u U) are byte-exact both ways, y collects into the tray (T), n writes a margin note
// kept beside the file, and Y lays the notes out as a reply.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = [
  '# Plan', '', 'The first paragraph of the plan.', '', '- one', '- two', '  - two a', '- three', '',
  '> A quoted line.', '', '## Scope', '', 'What is in scope.', '',
  '- [ ] a task to do', '- [x] done already', '', '## Rollback', '', 'Put it back.', '', '# Last', '', 'The end.', '',
].join('\n');
// CRLF lines, a tab, and no final newline: what a move must give back byte for byte.
const VEND = '# Vendor\r\n\r\n## 1. What arrived\r\n\r\nA box\twith a tab.\r\n\r\n- a\r\n- b\r\n\r\n## 2. How to build\r\n\r\nRun it.\r\n\r\n## 3. Last\r\n\r\nNo newline at the end.';
const FILES = { '/r/plan.md': PLAN, '/r/vend.md': VEND };

const keys = async (page, ...list) => {
  for (const k of list) await page.keyboard.press(k);
};
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const bufferText = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
const diskText = (page, path) => page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), path);
/** Polls the file at `path` in the memory shell until `want(text)` holds (a write lands after the store says saved). */
async function diskUntil(page, path, want) {
  for (let i = 0; i < 100; i++) {
    const text = await page.evaluate(async (p) => {
      try {
        return new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p));
      } catch {
        return null;
      }
    }, path);
    if (text !== null && want(text)) return text;
    await page.waitForTimeout(50);
  }
  throw new Error(`${path} never became what was wanted`);
}
const curText = (page) => page.evaluate(() => document.querySelector('[data-marxy-pane="0"] .marxy-article .marxy-cursor')?.textContent.trim().split('\n')[0] ?? null);
const settle = (page) => page.waitForFunction(() => window.__marxyHandle.selection.runtime()?.version === window.__marxyHandle.document()?.snapshot().version);
const clipboard = (page) =>
  page.evaluate(() => {
    const last = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    const rep = last?.args[0].find((r) => r.type === 'public.utf8-plain-text');
    return rep ? new TextDecoder().decode(rep.bytes) : null;
  });
/** Goes to the part whose text begins with `text`, from the top, with j and l. */
async function goTo(page, text, path = 0) {
  await blur(page);
  await keys(page, 'g', 'g');
  for (let i = 0; i < 40; i++) {
    const t = await curText(page);
    if (t?.startsWith(text)) return;
    await keys(page, 'j');
  }
  throw new Error(`no part begins ${text} (${path})`);
}

test('18: t stages a tick: the buffer changes on that line only, the disk does not, and the summary says one place', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'Scope');
    await keys(page, 'l', 'j', 'l', 't');
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
    assert.equal(await bufferText(page), PLAN.replace('- [ ] a task', '- [x] a task'));
    assert.equal(await diskText(page, '/r/plan.md'), PLAN, 'nothing written');
    const sum = await page.evaluate(async () => (await import('/src/changes/state.ts')).changesSummary('/r/plan.md'));
    assert.deepEqual(sum, { places: 1, added: 1, removed: 1 });
  });
});

test('23: R opens the changes beside, read as a patch with word marks; Discard them all goes back to the disk, and u undoes that', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'Shift+R');
    await page.waitForSelector('.marxy-notice');
    assert.match(await page.evaluate(() => document.body.innerText), /No unsaved changes to plan\.md/, 'nothing to show says so');
    await goTo(page, 'Scope');
    await keys(page, 'l', 'j', 'l', 't');
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
    await keys(page, 'Shift+R');
    await page.waitForSelector('[data-marxy-pane="1"] .marxy-diff-add');
    const s = await page.evaluate(() => ({
      paths: window.__marxyHandle.panes().panes.map((p) => p.path()),
      title: document.querySelector('[data-marxy-pane="1"] .marxy-article h1')?.textContent,
      add: document.querySelectorAll('[data-marxy-pane="1"] .marxy-diff-add').length,
      del: document.querySelectorAll('[data-marxy-pane="1"] .marxy-diff-del').length,
      word: document.querySelectorAll('[data-marxy-pane="1"] .marxy-diff-paired').length,
      acts: [...document.querySelectorAll('[data-marxy-pane="1"] [data-marxy-changes-act]')].map((b) => b.textContent),
    }));
    assert.equal(s.paths[0], '/r/plan.md');
    assert.equal(s.title, 'Changes to plan.md');
    assert.ok(s.add === 1 && s.del === 1, `one added and one removed row (${s.add}, ${s.del})`);
    assert.ok(s.word > 0, 'the changed word is marked');
    assert.deepEqual(s.acts, ['Save to disk', 'Undo the last change', 'Discard them all', 'Copy the patch']);
    // The page is read under the same cursor.
    await page.click('[data-marxy-pane="1"] .marxy-article p');
    await blur(page);
    await keys(page, 'j');
    assert.ok(await page.evaluate(() => document.querySelector('[data-marxy-pane="1"] .marxy-cursor') !== null), 'the cursor walks the page');
    await page.click('[data-marxy-pane="1"] [data-marxy-changes-act="copy"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.match(await clipboard(page), /^--- \/r\/plan\.md\n\+\+\+ \/r\/plan\.md\n@@ .*\n(.*\n)*-- \[ \] a task to do\n\+- \[x\] a task to do\n/);
    await page.click('[data-marxy-pane="1"] [data-marxy-changes-act="discard"]');
    await page.waitForFunction(() => {
      const p = window.__marxyHandle.panes().panes[0].content.store().snapshot();
      return !p.dirty;
    });
    await page.waitForFunction(() => /No unsaved changes/.test(document.querySelector('[data-marxy-pane="1"] .marxy-article')?.textContent ?? ''));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-marxy-pane="1"] [data-marxy-changes-act]')].map((b) => b.textContent).join() === 'Undo the last change');
    await page.click('[data-marxy-pane="1"] [data-marxy-changes-act="undo"]');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].content.store().snapshot().dirty);
    assert.equal(await page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.panes().panes[0].content.store().snapshot().buffer.bytes)), PLAN.replace('- [ ] a task', '- [x] a task'));
  });
});

test('22: Mod+S writes the file; with review_changes on it first opens the patch, and Save there writes it', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page, { mod }) => {
    await goTo(page, 'Scope');
    await keys(page, 'l', 'j', 'l', 't');
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
    await page.keyboard.press(`${mod}+KeyS`);
    await diskUntil(page, '/r/plan.md', (t) => t === PLAN.replace('- [ ] a task', '- [x] a task'));
  });
  await withFrame({ files: FILES, open: ['/r/plan.md'], config: 'review_changes = true\n' }, async (page, { mod }) => {
    await goTo(page, 'Scope');
    await keys(page, 'l', 'j', 'l', 't');
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty);
    await page.keyboard.press(`${mod}+KeyS`);
    await page.waitForSelector('[data-marxy-pane="1"] .marxy-diff-add');
    assert.equal(await diskText(page, '/r/plan.md'), PLAN, 'not written yet');
    await page.click('[data-marxy-pane="1"] [data-marxy-changes-act="save"]');
    await diskUntil(page, '/r/plan.md', (t) => t === PLAN.replace('- [ ] a task', '- [x] a task'));
  });
});

const MOVES = [
  ['/r/plan.md', PLAN, 'a paragraph', 'The first paragraph', 'Alt+ArrowDown', 'Alt+ArrowUp'],
  ['/r/plan.md', PLAN, 'a list item', 'two', 'Alt+ArrowUp', 'Alt+ArrowDown', true],
  ['/r/plan.md', PLAN, 'a top-level section', 'Plan', 'Alt+ArrowDown', 'Alt+ArrowUp'],
  ['/r/vend.md', VEND, 'a CRLF paragraph with a tab', 'A box', 'Alt+ArrowDown', 'Alt+ArrowUp'],
  ['/r/vend.md', VEND, 'the last paragraph, no final newline', 'No newline', 'Alt+ArrowUp', 'Alt+ArrowDown'],
];

for (const [path, text, what, start, k1, k2, into] of MOVES) {
  test(`20: ${k1} then ${k2} is byte-exact: ${what} (${path})`, async () => {
    await withFrame({ files: FILES, open: [path] }, async (page) => {
      if (into) {
        // Into the list, then its second item.
        await goTo(page, 'one');
        await keys(page, 'l', 'j');
      } else await goTo(page, start);
      assert.ok(((await curText(page)) ?? '').startsWith(start), `on ${start}: ${await curText(page)}`);
      await keys(page, k1);
      await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) !== t, text);
      await settle(page);
      assert.ok(((await curText(page)) ?? '').startsWith(start), 'the cursor stays on the part it moved');
      await keys(page, k2);
      await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === t, text);
      assert.equal(await bufferText(page), text);
      assert.equal(await diskText(page, path), text, 'staged only');
    });
  });
}

test('Alt+Down moves nothing with focus in the tab row or under a dialog; from the page it moves the part', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'The first paragraph');
    await page.focus('.marxy-tabbar .marxy-tab .marxy-tab-open');
    await keys(page, 'Alt+ArrowDown');
    await page.evaluate(() => {
      const d = document.createElement('dialog');
      d.id = 'probe-dialog';
      d.append(document.createElement('button'));
      document.body.append(d);
      d.showModal();
    });
    await keys(page, 'Alt+ArrowDown');
    await page.waitForTimeout(200);
    assert.equal(await bufferText(page), PLAN, 'not moved from the tab row or the dialog');
    await page.evaluate(() => document.getElementById('probe-dialog').remove());
    await blur(page);
    await keys(page, 'Alt+ArrowDown');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) !== t, PLAN);
  });
});

test('20: d then u, and > then <, are byte-exact; U redoes', async () => {
  await withFrame({ files: FILES, open: ['/r/vend.md'] }, async (page) => {
    await blur(page);
    await keys(page, 'g', 'g', 'l');
    for (let i = 0; i < 10 && !((await curText(page)) ?? '').startsWith('1. What'); i++) await keys(page, 'j');
    assert.equal(await curText(page), '1. What arrived');
    await keys(page, 'Shift+>');
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('### 1. What arrived\r\n'));
    await settle(page);
    await keys(page, 'Shift+<');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === t, VEND);
    await settle(page);
    await keys(page, 'l', 'd');
    await page.waitForFunction(() => !new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('A box'));
    assert.equal(await bufferText(page), VEND.replace('A box\twith a tab.\r\n\r\n', ''));
    await settle(page);
    await keys(page, 'u');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === t, VEND);
    await keys(page, 'Shift+U');
    await page.waitForFunction(() => !new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('A box'));
  });
});

test('09: y collects; T opens the tray; d removes; Copy all as Markdown holds the reference; write makes a new file', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    await goTo(page, 'The first paragraph');
    await keys(page, 'y');
    await keys(page, 'j', 'y');
    await keys(page, 'Shift+T');
    await page.waitForSelector('.marxy-apppage .marxy-piece');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.marxy-apppage .marxy-piece-src')].map((x) => x.textContent)), ['/r/plan.md:3', '/r/plan.md:5-8']);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-apppage .marxy-piece-text').textContent), 'The first paragraph of the plan.');
    await keys(page, 'j', 'j', 'd');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-apppage .marxy-piece').length === 1);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.marxy-apppage .marxy-piece-src')].map((x) => x.textContent)), ['/r/plan.md:3']);
    await page.fill('.marxy-apppage .marxy-piece-note', 'Check the range');
    await page.press('.marxy-apppage .marxy-piece-note', 'Enter');
    await page.click('.marxy-apppage [data-marxy-page-act="copy"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await clipboard(page), '> The first paragraph of the plan.\n\n— `/r/plan.md:3`\n\nCheck the range\n');
    await page.click('.marxy-apppage [data-marxy-page-act="file"]');
    await page.waitForFunction(() => window.__marxyHandle.currentPath()?.endsWith('gathered.md'));
    const written = await page.evaluate(() => window.__marxyHandle.currentPath());
    assert.equal(await diskText(page, written), '# Gathered\n\n> The first paragraph of the plan.\n\n— `/r/plan.md:3`\n\nCheck the range\n');
  });
});

test('10a, 10b: n opens a note box in the margin of a wide pane; typing survives a redraw; Ctrl+Enter keeps it beside the file; Y lays it out as a reply', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 1600, height: 900 } }, async (page) => {
    await goTo(page, 'The first paragraph');
    await keys(page, 'n');
    await page.waitForSelector('.marxy-mnote-field');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('marxy-mnote-field')), true);
    await page.keyboard.type('half typed');
    // A page set again mid-edit keeps what was typed.
    await page.evaluate(() => window.__marxyHandle.relayout());
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-mnote-field')?.value), 'half typed');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Check the range');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.marxy-mnote[data-marxy-mnote-at="margin"]:not(:has(textarea))');
    const s = await page.evaluate(() => {
      const n = document.querySelector('.marxy-mnote');
      const p = [...document.querySelectorAll('[data-marxy-pane="0"] .marxy-article > p')].find((x) => x.textContent.startsWith('The first'));
      return { text: n.textContent, right: n.getBoundingClientRect().left >= p.getBoundingClientRect().right, top: Math.abs(n.getBoundingClientRect().top - p.getBoundingClientRect().top) < 4 };
    });
    assert.deepEqual(s, { text: 'Check the range', right: true, top: true });
    const sidecar = JSON.parse(await diskUntil(page, '/data/notes.json', (t) => t.includes('Check the range')));
    assert.deepEqual(sidecar, { version: 1, files: { '/r/plan.md': [{ l0: 2, l1: 3, key: 'The first paragraph of the plan.', text: 'Check the range' }] } });
    assert.equal(await diskText(page, '/r/plan.md'), PLAN, 'never written into the file');
    // Find passes over the note.
    assert.equal(await page.evaluate(async () => (await import('/src/find/walk.ts')).NON_CONTENT.includes('.marxy-mnote')), true);

    await blur(page);
    await keys(page, 'Shift+Y');
    await page.waitForSelector('.marxy-apppage .marxy-piece');
    const reply = await page.evaluate(() => [...document.querySelectorAll('.marxy-apppage .marxy-piece')].map((c) => c.textContent));
    assert.equal(reply.length, 1);
    assert.ok(reply[0].includes('Check the range') && reply[0].includes('/r/plan.md:3'), reply[0]);
    await page.click('.marxy-apppage [data-marxy-page-act="copy"]');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await clipboard(page), '> The first paragraph of the plan.\n\n— `/r/plan.md:3`\n\nCheck the range\n');
  });
});

test('10c and re-anchoring: at 760 px the note sits under its part; it follows its line when lines are added above; Escape leaves an edit unkept', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 760, height: 800 } }, async (page) => {
    await goTo(page, 'The first paragraph');
    await keys(page, 'n');
    await page.waitForSelector('.marxy-mnote-field');
    await page.keyboard.type('Narrow note');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.marxy-mnote[data-marxy-mnote-at="under"]:not(:has(textarea))');
    const s = await page.evaluate(() => {
      const n = document.querySelector('.marxy-mnote');
      const prev = n.previousElementSibling;
      return { text: n.textContent, prev: prev?.textContent.slice(0, 19), under: n.getBoundingClientRect().top >= prev.getBoundingClientRect().bottom - 1 };
    });
    assert.deepEqual(s, { text: 'Narrow note', prev: 'The first paragraph', under: true });
    // Escape leaves an edit without keeping it.
    await page.click('.marxy-mnote');
    await page.waitForSelector('.marxy-mnote-field');
    await page.keyboard.type(' and more');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.marxy-mnote:not(:has(textarea))');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-mnote').textContent), 'Narrow note');
    // Two lines added above: the note follows its line.
    await page.evaluate(async () => {
      const store = window.__marxyHandle.document();
      await store.apply({ range: { file: '/r/plan.md', start: 0, end: 0 }, replacement: 'Added.\n\n', label: 'test', baseVersion: store.snapshot().version });
    });
    for (let i = 0; i < 60 && (await page.evaluate(async () => (await import('/src/notes/store.ts')).notesFor('/r/plan.md')[0]?.l0)) !== 4; i++) await page.waitForTimeout(50);
    assert.equal(await page.evaluate(async () => (await import('/src/notes/store.ts')).notesFor('/r/plan.md')[0]?.l0), 4, 'the note followed its line');
    await page.waitForFunction(() => document.querySelector('.marxy-mnote')?.previousElementSibling?.textContent.startsWith('The first paragraph'));
  });
});

test('a kept note open for change follows its line when lines are added above under the field, and keeping it writes it once', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 1600, height: 900 } }, async (page) => {
    const notes = () => page.evaluate(async () => (await import('/src/notes/store.ts')).notesFor('/r/plan.md').map((n) => [n.l0, n.text]));
    await goTo(page, 'The first paragraph');
    await keys(page, 'n');
    await page.waitForSelector('.marxy-mnote-field');
    await page.keyboard.type('Keep me');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.marxy-mnote:not(:has(textarea))');
    await page.click('.marxy-mnote');
    await page.waitForSelector('.marxy-mnote-field');
    await page.keyboard.type(' once');
    await page.evaluate(async () => {
      const store = window.__marxyHandle.document();
      await store.apply({ range: { file: '/r/plan.md', start: 0, end: 0 }, replacement: 'Added.\n\n', label: 'test', baseVersion: store.snapshot().version });
    });
    for (let i = 0; i < 60 && (await notes())[0]?.[0] !== 4; i++) await page.waitForTimeout(50);
    await page.waitForTimeout(150);
    await page.focus('.marxy-mnote-field');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-mnote-field').value), 'Keep me once');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.marxy-mnote:not(:has(textarea))');
    assert.deepEqual(await notes(), [[4, 'Keep me once']]);
  });
});

test('a reply on a scratch document is not written to a file: it has no folder, and a notice says so', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'], viewport: { width: 1600, height: 900 } }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.openScratch('# Scratch\n\nA line to answer.\n'));
    await page.waitForFunction(() => window.__marxyHandle.currentPath() === 'untitled');
    await goTo(page, 'A line to answer');
    await keys(page, 'n');
    await page.waitForSelector('.marxy-mnote-field');
    await page.keyboard.type('Answer');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.marxy-mnote:not(:has(textarea))');
    await blur(page);
    await keys(page, 'Shift+Y');
    await page.waitForSelector('.marxy-apppage .marxy-piece');
    const before = await page.evaluate(() => window.__marxyHandle.shell.calls.length);
    await page.click('.marxy-apppage [data-marxy-page-act="file"]');
    await page.waitForFunction(() => /not saved yet, so it has no folder/.test(document.querySelector('#marxy-notices')?.textContent ?? ''));
    const wrote = await page.evaluate((b) => window.__marxyHandle.shell.calls.slice(b).filter((c) => /write/i.test(c.method) && !String(c.args[0]).startsWith('/data/')).map((c) => c.args[0]), before);
    assert.deepEqual(wrote, []);
  });
});
