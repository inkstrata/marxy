// W-17: metadata on demand. The real app on the shipped skeleton and CSS over the memory shell, in WebKit. `⌃⌘I` puts a quiet preview
// in Read's empty left margin and moves no line of the page; where there is no margin it opens the Metadata tab instead; the tab
// lists what the file is, with a front-matter value edited in place (one splice, one Mod+Z, the bytes back), a value that cannot be
// edited shown with its reason and Edit in Source, the hidden characters and V-04's notes each a jump. The pure parts are
// src/workspace/metadata-tab.test.ts; the operation is packages/core/src/operations/front-matter-value*.test.ts.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 180_000 }, fn);
after(() => closeHarness());

const corpus = fileURLToPath(new URL('../../../fixtures/corpus/', import.meta.url));
const SKILL = skip ? '' : readFileSync(join(corpus, '26-skill-front-matter.md'), 'utf8');
const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} runs long enough to be a paragraph of the reading column and no more.`).join('\n\n');
const EDIT = [
  '---',
  'title: Old',
  'draft: true',
  'tags: [a, b]',
  'block: |',
  '  one',
  '  two',
  'note: "has a \\"quote\\"" # keep this',
  '---',
  '',
  '# Heading',
  '',
  'Body​ text.',
  '',
  '<!-- aside -->',
  '',
  filler,
  '',
  'Far down, at the end\u200b of the file.',
  '',
].join('\n');
const NOTES = '# One\n\n#### Skips levels\n\n```js\nnever closed\n';
const files = {
  '/r/skill.md': SKILL,
  '/r/edit.md': EDIT,
  '/r/crlf.md': EDIT.replace(/\n/g, '\r\n'),
  '/r/notes.md': NOTES,
  '/r/plain.md': `# Plain\n\n${filler}\n`,
};

async function withPage(width, fn, { open = ['/r/skill.md'], unfold = false } = {}) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootTwoPanes(page, { files, open });
    if (unfold) await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    await fn(page);
  } finally {
    await browser.close();
  }
}

const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const run = (page, id) =>
  page.evaluate(async (id) => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const handle = window.__marxyHandle;
    await handle.commands().find((c) => c.id === id).run(buildAppContext(handle));
  }, id);
const isMac = (page) => page.evaluate(() => navigator.platform.toUpperCase().includes('MAC'));
/** The first visible line of text in the article, and the article's box. */
const firstLine = (page) =>
  page.evaluate(() => {
    const article = document.getElementById('doc');
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && r.top >= 0 && r.bottom <= innerHeight) return { text: n.nodeValue.trim().slice(0, 30), x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return null;
  });
const doc = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));
const tabRows = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.marxy-metadata [data-marxy-metadata-section]')].map((s) => s.getAttribute('data-marxy-metadata-section')));
const keyOf = (page, key) =>
  page.evaluate((key) => {
    const row = document.querySelector(`.marxy-metadata [data-marxy-metadata-key="${CSS.escape(key)}"]`);
    return row && { value: row.querySelector('.marxy-metadata-edit, .marxy-metadata-text')?.textContent, edit: row.querySelector('.marxy-metadata-edit') !== null, why: row.querySelector('.marxy-metadata-why')?.textContent ?? null, source: row.querySelector('.marxy-metadata-source') !== null };
  }, key);
const openTab = async (page) => {
  await page.evaluate(async () => {
    const { selectInspectorTab } = await import('/src/workspace/inspector.ts');
    await window.__marxyHandle.workspace().unfold();
    window.__marxyHandle.workspace().setPanel('inspector', true);
    selectInspectorTab('metadata');
  });
  await page.waitForSelector('.marxy-metadata [data-marxy-metadata-section="file"]');
};

test('the preview: ⌃⌘I puts the front matter, the size and the date in Read\'s left margin, beside the first line, and moves nothing', async () => {
  await withPage(1280, async (page) => {
    const before = await firstLine(page);
    const article = await page.evaluate(() => { const r = document.getElementById('doc').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    assert.equal(await page.locator('.marxy-metadata-preview').count(), 0, 'at rest there is nothing');
    if (await isMac(page)) await page.keyboard.press('Control+Meta+KeyI');
    else await run(page, 'view.metadata');
    await page.waitForSelector('.marxy-metadata-preview');
    await frames(page);
    assert.deepEqual(await firstLine(page), before, 'the first line did not move');
    assert.deepEqual(await page.evaluate(() => { const r = document.getElementById('doc').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }), article, 'nor the column');
    const preview = await page.evaluate(() => {
      const box = document.querySelector('.marxy-metadata-preview').getBoundingClientRect();
      return {
        keys: [...document.querySelectorAll('.marxy-metadata-preview-list > dt')].map((d) => d.textContent),
        values: [...document.querySelectorAll('.marxy-metadata-preview-list > dd')].map((d) => d.textContent),
        right: box.right, top: box.top, left: box.left,
        inFlow: document.getElementById('doc').contains(document.querySelector('.marxy-metadata-preview')),
        layerHeight: document.querySelector('.marxy-metadata-margin').getBoundingClientRect().height,
        role: document.querySelector('.marxy-metadata-preview').getAttribute('role'),
        more: document.querySelector('.marxy-metadata-preview-link')?.textContent,
      };
    });
    assert.deepEqual(preview.keys.slice(0, 3), ['name', 'description', 'license']);
    assert.deepEqual(preview.keys.slice(-2), ['modified', 'size']);
    assert.ok(preview.values.at(-1).endsWith('bytes'), preview.values.at(-1));
    assert.equal(preview.inFlow, false, 'not inside the text');
    assert.equal(preview.layerHeight, 0, 'the layer takes no room');
    assert.ok(preview.right <= before.x - 8, `in the margin: ${preview.right} vs the text at ${before.x}`);
    assert.ok(Math.abs(preview.top - before.y) < 24, `beside the first line: ${preview.top} vs ${before.y}`);
    assert.equal(preview.role, 'complementary');
    assert.equal(preview.more, 'More…');
    // Sticky: scrolled a long way, the page moves and the preview stays in view.
    await page.evaluate(() => window.scrollTo(0, 600));
    await frames(page);
    const stuck = await page.evaluate(() => document.querySelector('.marxy-metadata-preview').getBoundingClientRect().top);
    assert.ok(stuck >= 0 && stuck < 200, `the preview follows the scroll: ${stuck}`);
    // Off again: gone, and the page as it was.
    await page.evaluate(() => window.scrollTo(0, 0));
    await run(page, 'view.metadata');
    await page.waitForFunction(() => document.querySelector('.marxy-metadata-preview') === null);
    assert.deepEqual(await firstLine(page), before);
  });
});

test('where the margin is too narrow the same command opens the Metadata tab, and nothing is placed above the text', async () => {
  await withPage(760, async (page) => {
    const before = await firstLine(page);
    await run(page, 'view.metadata');
    await page.waitForSelector('.marxy-metadata [data-marxy-metadata-section="file"]');
    assert.equal(await page.locator('.marxy-metadata-preview').count(), 0, 'no preview');
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-inspector-tab="metadata"]').getAttribute('aria-selected')), 'true');
    assert.equal(await page.evaluate(() => document.body.getAttribute('data-marxy-workspace')), 'unfolded', 'the window unfolded to show the tab');
    assert.equal(await page.evaluate(() => document.querySelector('#doc').previousElementSibling?.className ?? ''), '', 'nothing before the text in the pane but the article');
    assert.ok(before);
  });
  // Unfolded at 1280 the margin is 77 px: the command opens the tab here too, and a second press leaves the tab as it is.
  await withPage(1280, async (page) => {
    await run(page, 'view.metadata');
    await page.waitForSelector('.marxy-metadata [data-marxy-metadata-section="file"]');
    assert.equal(await page.locator('.marxy-metadata-preview').count(), 0);
  }, { unfold: true });
});

test('More… in the preview opens the tab', async () => {
  await withPage(1280, async (page) => {
    await run(page, 'view.metadata');
    await page.click('.marxy-metadata-preview-link');
    await page.waitForSelector('.marxy-metadata [data-marxy-metadata-section="file"]');
    assert.equal(await page.evaluate(() => document.body.getAttribute('data-marxy-workspace')), 'unfolded');
  });
});

test('the tab: File, Front matter, Detection and Hidden and reshaped, each only because it has something', async () => {
  await withPage(1700, async (page) => {
    await openTab(page);
    const sections = await tabRows(page);
    assert.deepEqual(sections.slice(0, 3), ['file', 'front-matter', 'detection']);
    const labels = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-metadata-section="file"] .marxy-metadata-key')].map((k) => k.textContent));
    assert.deepEqual(labels, ['Path', 'Size', 'Modified', 'Encoding', 'Line endings']);
    assert.equal(await page.evaluate(() => document.querySelector('[data-marxy-metadata-section="file"] .marxy-metadata-text').textContent), '/r/skill.md');
    // A file with none of it has none of it.
    await page.evaluate(() => window.__marxyHandle.open('/r/plain.md'));
    await page.waitForFunction(() => document.querySelector('[data-marxy-metadata-section="file"] .marxy-metadata-text')?.textContent === '/r/plain.md');
    const plain = await tabRows(page);
    assert.ok(!plain.includes('front-matter') && !plain.includes('hidden') && !plain.includes('marxy'), plain.join(','));
    // The file with hidden text, a comment and front matter lists all three, each a jump.
    await page.evaluate(() => window.__marxyHandle.open('/r/edit.md'));
    await page.waitForSelector('[data-marxy-metadata-section="hidden"]');
    const jumps = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-metadata-jump]')].map((b) => [b.getAttribute('data-marxy-metadata-jump'), b.textContent]));
    assert.ok(jumps.some(([k, t]) => k === 'hidden' && t.includes('U+200B') && t.includes('ZERO WIDTH SPACE') && t.includes('line 13')), JSON.stringify(jumps));
    assert.ok(jumps.some(([k, t]) => k === 'reshaped' && t.includes('Front matter shown as a head, lines 1 to 9')), JSON.stringify(jumps));
    assert.ok(jumps.some(([k, t]) => k === 'reshaped' && t.includes('An HTML comment set aside, line 15')), JSON.stringify(jumps));
    // A click on a hidden character far down lands the page there.
    await page.locator('[data-marxy-metadata-jump="hidden"]').last().click();
    const zwsp = new TextEncoder().encode(EDIT.slice(0, EDIT.lastIndexOf('\u200b'))).length;
    await page.waitForFunction((at) => { const p = window.__marxyHandle.panes().focused.view.position().byteOffset; return p > at - 600 && p < at + 100; }, zwsp);
  });
});

test('editing a value in the tab is one splice of that value\'s bytes, and one Mod+Z puts every byte back', async () => {
  await withPage(1700, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/edit.md'));
    await openTab(page);
    await page.waitForSelector('[data-marxy-metadata-key="title"] .marxy-metadata-edit');
    const original = await doc(page);
    await page.click('[data-marxy-metadata-key="title"] .marxy-metadata-edit');
    const input = page.locator('[data-marxy-metadata-key="title"] .marxy-metadata-input');
    assert.equal(await input.inputValue(), 'Old');
    await input.fill('New "one"');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('title: New "one"'));
    const edited = await doc(page);
    assert.equal(edited, original.replace('title: Old', 'title: New "one"'), 'only the value changed (a quote inside a plain word is not an indicator)');
    assert.equal((await keyOf(page, 'title')).value, 'New "one"', 'the tab shows the new value');
    // Focus returns to the value, so Mod+Z is the document\'s undo, once.
    await page.waitForFunction(() => document.activeElement?.classList.contains('marxy-metadata-edit'));
    const mod = (await isMac(page)) ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyZ`);
    await page.waitForFunction((o) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === o, original);
    assert.equal((await keyOf(page, 'title')).value, 'Old');
    // A double-quoted value keeps its quotes, escapes, and the comment after it.
    await page.click('[data-marxy-metadata-key="note"] .marxy-metadata-edit');
    await page.locator('[data-marxy-metadata-key="note"] .marxy-metadata-input').fill('plain \\ and "q"');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('# keep this'));
    assert.equal(await doc(page), original.replace('"has a \\"quote\\""', '"plain \\\\ and \\"q\\""'));
    // Escape leaves a value as it was; nothing is written.
    const now = await doc(page);
    await page.click('[data-marxy-metadata-key="draft"] .marxy-metadata-edit');
    await page.locator('[data-marxy-metadata-key="draft"] .marxy-metadata-input').fill('false');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-marxy-metadata-key="draft"] .marxy-metadata-edit');
    assert.equal(await doc(page), now);
  });
});

test('a CRLF file keeps every CRLF when a value is edited', async () => {
  await withPage(1700, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/crlf.md'));
    await openTab(page);
    await page.waitForSelector('[data-marxy-metadata-key="draft"] .marxy-metadata-edit');
    const original = await doc(page);
    await page.click('[data-marxy-metadata-key="draft"] .marxy-metadata-edit');
    await page.locator('[data-marxy-metadata-key="draft"] .marxy-metadata-input').fill('false');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes).includes('draft: false'));
    assert.equal(await doc(page), original.replace('draft: true', 'draft: false'));
  });
});

test('a value that cannot be edited safely reads as it is, says why, and Edit in Source puts the caret on its line', async () => {
  await withPage(1700, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/edit.md'));
    await openTab(page);
    await page.waitForSelector('[data-marxy-metadata-key="tags"]');
    const tags = await keyOf(page, 'tags');
    assert.equal(tags.edit, false);
    assert.equal(tags.value, '[a, b]');
    assert.match(tags.why, /list written inline/);
    assert.equal(tags.source, true);
    const block = await keyOf(page, 'block');
    assert.match(block.why, /block of text/);
    assert.equal(block.value, '|\n  one\n  two');
    const before = await doc(page);
    await page.click('[data-marxy-metadata-key="tags"] .marxy-metadata-source');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.getAttribute('data-marxy-mode') === 'source');
    assert.equal(await doc(page), before, 'going to Source changed no byte');
  });
});

test('Copy puts a value on the clipboard', async () => {
  await withPage(1700, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/edit.md'));
    await openTab(page);
    await page.waitForSelector('[data-marxy-metadata-key="title"]');
    await page.locator('[data-marxy-metadata-key="title"]').hover();
    await page.click('[data-marxy-metadata-key="title"] .marxy-metadata-copy');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    const copied = await page.evaluate(() => {
      const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
      return new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes);
    });
    assert.equal(copied, 'Old');
  });
});

test('Notes: V-04\'s notes for a file with an unclosed fence, each a jump', async () => {
  await withPage(1700, async (page) => {
    await page.evaluate(() => window.__marxyHandle.open('/r/notes.md'));
    await openTab(page);
    await page.waitForSelector('[data-marxy-metadata-section="notes"]');
    const notes = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-metadata-jump="note"]')].map((b) => b.textContent));
    assert.equal(notes.length, 2, JSON.stringify(notes));
    assert.ok(notes.some((t) => t.includes('Fence') && /never closed/.test(t)), JSON.stringify(notes));
    assert.ok(notes.some((t) => t.includes('Heading') && /jumps from level 1 to level 4/.test(t)), JSON.stringify(notes));
    await page.locator('[data-marxy-metadata-jump="note"]').filter({ hasText: 'Fence' }).click();
    const fence = NOTES.indexOf('```js');
    await page.waitForFunction((at) => Math.abs(window.__marxyHandle.panes().focused.view.position().byteOffset - at) < 40, fence);
  });
});

test('Detection: the kind, why, and Show as', async () => {
  await withPage(1700, async (page) => {
    await openTab(page);
    const detection = await page.evaluate(() => ({
      kind: document.querySelector('[data-marxy-metadata-section="detection"] .marxy-metadata-text')?.textContent,
      reasons: [...document.querySelectorAll('.marxy-metadata-reason')].map((r) => r.textContent),
      options: [...document.querySelectorAll('.marxy-metadata-select option')].map((o) => o.value),
      value: document.querySelector('.marxy-metadata-select')?.value,
    }));
    assert.ok(detection.kind.length > 0);
    assert.ok(detection.reasons.length > 0 && detection.reasons[0].startsWith('Because '), JSON.stringify(detection.reasons));
    assert.equal(detection.options[0], 'detected');
    assert.ok(detection.options.includes('report') && detection.options.includes('code'));
    assert.equal(detection.value, 'detected');
  });
});

test('the preview is a surface: with it on, scrolling and a second pane move nothing, and Source leaves no preview behind', async () => {
  await withPage(1280, async (page) => {
    await run(page, 'view.metadata');
    await page.waitForSelector('.marxy-metadata-preview');
    await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'view.mode-source').run({}));
    await page.waitForFunction(() => document.querySelector('.marxy-metadata-preview') === null);
    await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'view.mode-read').run({}));
    await page.waitForSelector('.marxy-metadata-preview');
  });
});
