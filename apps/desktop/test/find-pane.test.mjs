// Rendered find and the outline on the focused pane (D-13; docs/design/09-app-shell.md §Find, §Outline).
// `Mod+F` opens a field in the focused pane, matches that pane's article only, counts `N of M`, lands the
// current match on that pane's reading line and steps with Enter and Shift+Enter; `Esc` takes every
// highlight away and gives focus back. Without CSS.highlights it wraps <mark> and unwraps byte for byte.
// In a Source pane, `Mod+F` is CodeMirror's panel in that pane. The outline lists, follows and sits
// against the focused pane. Booted on the shipped skeleton and CSS (test/support/two-pane.mjs).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { outlineFrom, parseMarkdown } from '@marxy/core';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const para = (word, i) =>
  `${word} paragraph ${i} runs long enough to wrap across several lines of the column, so that the ` +
  'typesetter has real lines to break and the page is tall enough to scroll a match to the reading line.';
/** `count` paragraphs; those whose index is in `shared` carry the word "lantern". */
const body = (word, count, shared) =>
  Array.from({ length: count }, (_, i) => (shared.includes(i) ? `${para(word, i)} A lantern here.` : para(word, i))).join('\n\n');

const A = `# Alpha\n\n${body('Alpha', 20, [2, 5, 8, 11, 14])}\n\n## Alpha two\n\n${body('Alpha', 20, [])}\n\n## Alpha three\n\n${body('Alpha', 20, [])}\n`;
const B = `# Bravo\n\n${body('Bravo', 20, [])}\n\n## Bravo two\n\n${body('Bravo', 30, [6, 14, 22])}\n\n## Bravo three\n\n${body('Bravo', 20, [])}\n`;
const files = {
  '/r/A.md': A,
  '/r/B.md': B,
  '/r/hid.md': `# Hidden\n\nRead [the guide](https://xyzzyhost.example/deep/path) for details.\n\n\`\`\`text\n${'x'.repeat(300)} head ${'y'.repeat(900)} tailzebra\n\`\`\`\n`,
  '/r/wide.md': `# Wide\n\n| ${Array.from({ length: 24 }, (_, i) => `column${i}_unbreakable_heading`).join(' | ')} |\n| ${Array(24).fill('---').join(' | ')} |\n| ${Array.from({ length: 24 }, (_, i) => (i === 23 ? 'farright' : `cell${i}_unbreakable_content`)).join(' | ')} |\n`,
  '/r/inv.md': `# Invisible\n\nThe word foo​bar hides a zero-width space, and so does nothing else here.\n`,
};
const LEFT_LANTERNS = 5;
const RIGHT_LANTERNS = 3;

async function withPanes(open, fn, viewport = { width: 1470, height: 900 }) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport });
    await bootTwoPanes(page, { files, open });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** Two frames: the run one frame after the last keystroke has happened. */
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Waits for the run one frame after the last keystroke: the count is painted for `query`. */
const typeQuery = async (page, query) => {
  await page.keyboard.type(query);
  await settle(page);
  await page.waitForFunction(
    (q) => {
      const field = document.querySelector('.marxy-find');
      return field?.querySelector('input')?.value === q && /\d+ of \d+/.test(field.querySelector('.marxy-find-count')?.textContent ?? '');
    },
    query,
  );
};

/** Where the find field and the highlights are. */
const findState = (page) =>
  page.evaluate(() => {
    const hosts = [...document.querySelectorAll('#marxy-main > section.marxy-pane')];
    const ranges = [...(CSS.highlights.get('marxy-find') ?? [])];
    const inPane = (node) => hosts.findIndex((h) => h.contains(node));
    return {
      fields: hosts.map((h) => h.querySelectorAll('.marxy-find').length),
      count: document.querySelector('.marxy-find-count')?.textContent ?? null,
      highlighted: ranges.map((r) => inPane(r.startContainer)),
      current: [...(CSS.highlights.get('marxy-find-current') ?? [])].length,
    };
  });

/** The current match's top below its pane's top, and 40 % of that pane's height. */
const currentAtReadingLine = (page, slot) =>
  page.evaluate((slot) => {
    const host = document.querySelector(`section.marxy-pane[data-marxy-pane="${slot}"]`);
    const range = [...(CSS.highlights.get('marxy-find-current') ?? [])][0];
    if (!range) return null;
    const top = range.getClientRects()[0].top - host.getBoundingClientRect().top;
    return { top, line: 0.4 * host.clientHeight, text: range.toString() };
  }, slot);


test('Mod+F in the right pane finds in the right article only, counts it, and lands on its reading line', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    // At rest: no field, and each slot empty and not drawn.
    const rest = await page.evaluate(() =>
      [...document.querySelectorAll('.marxy-find-slot')].map((s) => [s.childElementCount, getComputedStyle(s).display]));
    assert.deepEqual(rest, [[0, 'none'], [0, 'none']]);

    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+KeyF`);
    await page.waitForSelector('#marxy-main > section[data-marxy-pane="1"] .marxy-find input:focus');
    await typeQuery(page, 'lantern');
    const state = await findState(page);
    assert.deepEqual(state.fields, [0, 1], 'the field is in the right pane only');
    assert.equal(state.highlighted.length, RIGHT_LANTERNS);
    assert.ok(state.highlighted.every((i) => i === 1), 'every highlight is in the right article');
    assert.match(state.count, new RegExp(`^\\d+ of ${RIGHT_LANTERNS}$`));
    assert.equal(state.current, 1);

    // Enter steps forward to the next match, on the right pane's reading line; Shift+Enter steps back.
    const first = Number(state.count.split(' ')[0]);
    await page.keyboard.press('Enter');
    await settle(page);
    const second = Number((await findState(page)).count.split(' ')[0]);
    assert.equal(second, (first % RIGHT_LANTERNS) + 1);
    const at = await currentAtReadingLine(page, 1);
    assert.equal(at.text, 'lantern');
    assert.ok(Math.abs(at.top - at.line) <= 2, `current match top ${at.top} vs reading line ${at.line}`);
    await page.keyboard.press('Shift+Enter');
    await settle(page);
    assert.equal(Number((await findState(page)).count.split(' ')[0]), first);
    const back = await currentAtReadingLine(page, 1);
    assert.ok(Math.abs(back.top - back.line) <= 2, `after Shift+Enter ${back.top} vs ${back.line}`);
    // The left pane did not move: find scrolled only the pane it searched.
    assert.equal(await page.evaluate(() => document.querySelector('section[data-marxy-pane="0"]').scrollTop), 0);
  });
});

test('Esc closes find, removes its highlights and gives focus back to the pane it opened from', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+KeyF`);
    await typeQuery(page, 'lantern');
    assert.equal((await findState(page)).highlighted.length, RIGHT_LANTERNS);
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => ({
      find: CSS.highlights.get('marxy-find')?.size ?? 0,
      current: CSS.highlights.get('marxy-find-current')?.size ?? 0,
      fields: document.querySelectorAll('.marxy-find').length,
      slots: [...document.querySelectorAll('.marxy-find-slot')].map((s) => [s.childElementCount, getComputedStyle(s).display]),
      focusInRight: document.querySelector('section[data-marxy-pane="1"]').contains(document.activeElement),
      focused: window.__marxyHandle.panes().focused.slot,
    }));
    assert.deepEqual(after, { find: 0, current: 0, fields: 0, slots: [[0, 'none'], [0, 'none']], focusInRight: true, focused: 1 });

    // Opening in the other pane closes it here; each pane keeps its own last query.
    await page.keyboard.press(`${mod}+KeyF`);
    assert.equal(await page.inputValue('.marxy-find input'), 'lantern');
    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+KeyF`);
    assert.deepEqual((await findState(page)).fields, [1, 0]);
    assert.equal(await page.inputValue('.marxy-find input'), '');
    await typeQuery(page, 'lantern');
    const left = await findState(page);
    assert.equal(left.highlighted.length, LEFT_LANTERNS);
    assert.ok(left.highlighted.every((i) => i === 0));
  });
});

test('without CSS.highlights the fallback draws overlay rectangles and never writes the article', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await waitForTypeset(page);
    await page.evaluate(() => {
      delete CSS.highlights;
      if (CSS.highlights !== undefined) Object.defineProperty(CSS, 'highlights', { value: undefined, configurable: true });
    });
    assert.equal(await page.evaluate(() => CSS.highlights), undefined);
    const before = await page.evaluate(() => document.getElementById('doc-2').innerHTML);
    await page.evaluate(() => {
      window.__articleWrites = 0;
      new MutationObserver((records) => { window.__articleWrites += records.length; }).observe(document.getElementById('doc-2'), { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+KeyF`);
    await typeQuery(page, 'lantern');
    const drawn = await page.evaluate(() => ({
      marks: document.querySelectorAll('mark').length,
      rects: document.querySelectorAll('#marxy-main > section[data-marxy-pane="1"] .marxy-find-rects .marxy-find-rect').length,
      current: document.querySelectorAll('.marxy-find-rect-current').length,
      left: document.querySelectorAll('section[data-marxy-pane="0"] .marxy-find-rect').length,
    }));
    assert.equal(drawn.marks, 0);
    assert.ok(drawn.rects >= 1, 'rectangles are drawn for the matches near the view');
    assert.ok(drawn.current >= 1, 'the current match is drawn apart');
    assert.equal(drawn.left, 0);
    await page.keyboard.press('Enter');
    await settle(page);
    // The current rectangle sits on the current match, at the reading line.
    const placed = await page.evaluate(() => {
      const host = document.querySelector('section[data-marxy-pane="1"]');
      const rect = document.querySelector('.marxy-find-rect-current').getBoundingClientRect();
      return { top: rect.top - host.getBoundingClientRect().top, line: 0.4 * host.clientHeight };
    });
    assert.ok(Math.abs(placed.top - placed.line) <= 24, `overlay top ${placed.top} vs reading line ${placed.line}`);
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => ({ html: document.getElementById('doc-2').innerHTML, writes: window.__articleWrites, rects: document.querySelectorAll('.marxy-find-rects').length }));
    assert.equal(after.html, before);
    assert.equal(after.writes, 0, 'find wrote nothing into the article');
    assert.equal(after.rects, 0, 'the overlay is gone on close');
  });
});

test('the fallback on a 1 MB document does not hang the typesetter: first match and typeset_done both arrive', async () => {
  const unit = readFileSync(new URL('../../../fixtures/corpus/15-prose-volume.md', import.meta.url), 'utf8');
  files['/r/big.md'] = Array.from({ length: Math.ceil(1_000_000 / unit.length) }, (_, i) => unit.replace(/^# .*$/m, `# Volume ${i}`)).join('\n\n');
  assert.ok(files['/r/big.md'].length >= 1_000_000);
  await withPanes(['/r/big.md'], async (page, mod) => {
    await page.evaluate(() => {
      delete CSS.highlights;
      if (CSS.highlights !== undefined) Object.defineProperty(CSS, 'highlights', { value: undefined, configurable: true });
    });
    await page.keyboard.press(`${mod}+KeyF`);
    const started = Date.now();
    await page.keyboard.type('the');
    await page.waitForFunction(() => /\d+ of \d{3,}/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''), null, { timeout: 30_000 });
    const firstMatchMs = Date.now() - started;
    // The page still answers, and the typesetter finishes while the find is open.
    const answered = Date.now();
    await page.evaluate(() => 1);
    const responseMs = Date.now() - answered;
    await page.waitForFunction(
      () => window.__marxyHandle.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'typeset_done'),
      null,
      { timeout: 60_000 },
    );
    console.log(`find fallback, 1 MB: first match ${firstMatchMs} ms, page answers in ${responseMs} ms, typeset_done reached (${Date.now() - started} ms in all)`);
    assert.ok(firstMatchMs < 20_000, `first match ${firstMatchMs} ms`);
    assert.ok(responseMs < 2_000, `page answered in ${responseMs} ms`);
    const rects = await page.evaluate(() => document.querySelectorAll('.marxy-find-rect').length);
    assert.ok(rects > 0 && rects <= 2_000, `${rects} rectangles: bounded to the matches near the view`);
  });
});

test('find matches only visible reading text: not a hidden link destination, elided code, aria-hidden text or Marxy labels', async () => {
  await withPanes(['/r/hid.md'], async (page, mod) => {
    await page.waitForSelector('#doc .marxy-elided', { timeout: 15_000 });
    await page.evaluate(() => {
      const doc = document.getElementById('doc');
      const hidden = document.createElement('p');
      hidden.setAttribute('aria-hidden', 'true');
      hidden.textContent = 'quokka behind aria';
      const note = document.createElement('p');
      note.className = 'marxy-notice';
      note.textContent = 'quokka in a Marxy notice';
      const visible = document.createElement('p');
      visible.textContent = 'a plain visible sentence';
      doc.append(hidden, note, visible);
    });
    const hiddenText = await page.evaluate(() =>
      [...document.querySelectorAll('#doc .marxy-link-dest, #doc .marxy-link-host-label')].map((el) => el.textContent).filter(Boolean));
    assert.ok(hiddenText.length > 0, 'the document carries link labels to search for');
    await page.keyboard.press(`${mod}+KeyF`);
    const count = async (query) => {
      await page.fill('.marxy-find input', query);
      await settle(page);
      await page.waitForFunction((q) => document.querySelector('.marxy-find input').value === q && /\d+ of \d+/.test(document.querySelector('.marxy-find-count').textContent), query);
      return page.textContent('.marxy-find-count');
    };
    assert.equal(await count('guide'), '1 of 1', 'the link text is read');
    assert.equal(await count('a plain visible'), '1 of 1');
    for (const text of ['xyzzyhost', 'tailzebra', 'more characters', 'quokka', ...hiddenText]) {
      assert.equal(await count(text), '0 of 0', `"${text}" is not reading text`);
    }
  });
});

test('a match in a horizontally scrolled table brings the table into view too', async () => {
  await withPanes(['/r/wide.md'], async (page, mod) => {
    const overflow = await page.evaluate(() => {
      const t = document.querySelector('#doc table');
      return t.scrollWidth - t.clientWidth;
    });
    assert.ok(overflow > 100, `the table scrolls (${overflow}px)`);
    await page.keyboard.press(`${mod}+KeyF`);
    await typeQuery(page, 'farright');
    const seen = await page.evaluate(() => {
      const t = document.querySelector('#doc table');
      const box = [...CSS.highlights.get('marxy-find-current')][0].getBoundingClientRect();
      const frame = t.getBoundingClientRect();
      return { scrollLeft: t.scrollLeft, inside: box.left >= frame.left - 1 && box.right <= frame.right + 1 };
    });
    assert.ok(seen.scrollLeft > 0, 'the table was scrolled');
    assert.equal(seen.inside, true, 'the match is inside the table box that shows it');
  }, { width: 900, height: 700 });
});

test('find sits above the outline when both are open', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+Shift+KeyO`);
    await page.waitForSelector('#marxy-outline[open]');
    await page.evaluate(async () => {
      await window.__marxyHandle.commands().find((c) => c.id === 'view.find').run({});
    });
    await page.waitForSelector('.marxy-find input');
    const top = await page.evaluate(() => {
      const field = document.querySelector('.marxy-find').getBoundingClientRect();
      const outline = document.getElementById('marxy-outline').getBoundingClientRect();
      const x = field.right - 8;
      const y = field.top + field.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { overlaps: field.right > outline.left, hitInField: hit?.closest('.marxy-find') !== null && hit !== null };
    });
    assert.equal(top.overlaps, true, 'the field and the outline share pixels, so stacking decides');
    assert.equal(top.hitInField, true, 'the field is what is drawn there');
  });
});

/** Both panes typeset: two `typeset_done` marks and line breaks in the right article. */
async function waitForTypeset(page) {
  await page.waitForFunction(
    () =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'typeset_done').length >= 2 &&
      document.querySelector('#doc-2 p.marxy-set .marxy-lb') !== null,
    null,
    { timeout: 15_000 },
  );
}

test('after the typesetter split text nodes, a match across a line break is found and highlighted', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await waitForTypeset(page);
    // The two words either side of a line break in the right article: the break split their text node.
    const phrase = await page.evaluate(() => {
      for (const lb of document.querySelectorAll('#doc-2 p.marxy-set .marxy-lb:not(.marxy-hyphen)')) {
        const before = lb.previousSibling;
        const next = lb.nextSibling;
        if (before?.nodeType !== 3 || next?.nodeType !== 3) continue;
        const left = before.data.match(/(\w+) $/);
        const right = next.data.match(/^(\w+)/);
        if (left && right) return `${left[1]} ${right[1]}`;
      }
      return null;
    });
    assert.ok(phrase, 'a line break between two words');
    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+KeyF`);
    await typeQuery(page, phrase);
    const crossing = await page.evaluate(() =>
      [...(CSS.highlights.get('marxy-find') ?? [])].some((r) => {
        const tops = new Set([...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top)));
        return r.startContainer !== r.endContainer && tops.size >= 2 && r.cloneContents().querySelector('.marxy-lb') !== null;
      }));
    assert.equal(crossing, true, `a highlight of "${phrase}" spans the break`);
  });
});

test('find_first_match is marked, under the asserted bound, for 01-long-technical.md', async () => {
  const fixture = readFileSync(new URL('../../../fixtures/corpus/01-long-technical.md', import.meta.url), 'utf8');
  files['/r/long.md'] = fixture;
  await withPanes(['/r/long.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+KeyF`);
    await typeQuery(page, 'the');
    const marks = await page.evaluate(() =>
      window.__marxyHandle.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'find_first_match').map((c) => c.args[2]));
    assert.ok(marks.length >= 1, 'find_first_match marked');
    const ms = Number(/ms=([\d.]+)/.exec(marks.at(-1))[1]);
    console.log(`find_first_match 01-long-technical.md: ${marks.at(-1)}`);
    assert.ok(ms < 500, `find_first_match took ${ms} ms`);
  });
});

test('a zero-width character: its marker is highlighted, never a zero-width box; its label and a word split by it are not matched', async () => {
  await withPanes(['/r/inv.md'], async (page, mod) => {
    await page.keyboard.press(`${mod}+KeyF`);
    await typeQuery(page, 'foobar');
    assert.equal(await page.textContent('.marxy-find-count'), '0 of 0', 'the space splits the word, as its marker shows');
    // The marker's label is Marxy's words about the byte, not the document's text.
    const label = await page.evaluate(() => document.querySelector('#doc .marxy-invisible-glyph').textContent);
    await page.fill('.marxy-find input', label);
    await settle(page);
    assert.equal(await page.textContent('.marxy-find-count'), '0 of 0', `the label ${label} is not text`);
    await page.fill('.marxy-find input', 'foo\u200Bbar');
    await settle(page);
    await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '1 of 1');
    // The byte alone: the highlight is widened to the whole marker, glyph included.
    await page.fill('.marxy-find input', '\u200B');
    await settle(page);
    await page.waitForFunction(() => document.querySelector('.marxy-find-count')?.textContent === '1 of 1');
    const covers = await page.evaluate(() => {
      const range = [...CSS.highlights.get('marxy-find')][0];
      const glyph = document.querySelector('#doc .marxy-invisible-glyph');
      return { glyph: range.intersectsNode(glyph), width: Math.round(range.getBoundingClientRect().width) > 0 };
    });
    assert.deepEqual(covers, { glyph: true, width: true });
  });
});

test('a match in a closed <details> is opened when it becomes current; a [hidden] subtree and KaTeX glyphs are not searched', async () => {
  await withPanes(['/r/A.md'], async (page, mod) => {
    // Markup a trusted document may carry (wide policy); put in place here so the test needs no trust grant.
    await page.evaluate(() => {
      const doc = document.getElementById('doc');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'More';
      const inner = document.createElement('p');
      inner.textContent = 'A glowworm sleeps in here.';
      details.append(summary, inner);
      const hidden = document.createElement('p');
      hidden.hidden = true;
      hidden.textContent = 'Another glowworm nobody can see.';
      const math = document.createElement('p');
      const katex = document.createElement('span');
      katex.className = 'katex';
      katex.textContent = 'glowworm';
      math.append(katex);
      doc.append(details, hidden, math);
    });
    await page.keyboard.press(`${mod}+KeyF`);
    await typeQuery(page, 'glowworm');
    assert.equal(await page.textContent('.marxy-find-count'), '1 of 1');
    assert.equal(await page.evaluate(() => document.querySelector('#doc details').open), true, 'the current match is shown');
  });
});

test('Source pane focused: Mod+F is CodeMirror search in that pane, and the other pane shows none', async () => {
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    await page.evaluate(() => window.__marxyHandle.panes().panes[0].view.toggleMode());
    await page.waitForSelector('#marxy-source .cm-content');
    await page.keyboard.press(`${mod}+1`);
    await page.waitForFunction(() => document.activeElement?.classList.contains('cm-content'));
    await page.keyboard.press(`${mod}+KeyF`);
    await page.waitForSelector('#marxy-source .cm-search');
    const panels = await page.evaluate(() => ({
      left: document.querySelectorAll('section[data-marxy-pane="0"] .cm-search').length,
      right: document.querySelectorAll('section[data-marxy-pane="1"] .cm-search, section[data-marxy-pane="1"] .marxy-find').length,
      rendered: document.querySelectorAll('.marxy-find').length,
    }));
    assert.deepEqual(panels, { left: 1, right: 0, rendered: 0 });

    // The command itself, run with the Source pane focused but its editor not (the palette's route).
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#marxy-source .cm-search') === null);
    await page.evaluate(async () => {
      const handle = window.__marxyHandle;
      handle.panes().panes[0].host.focus();
      const cmd = handle.commands().find((c) => c.id === 'view.find');
      await cmd.run({});
    });
    await page.waitForSelector('#marxy-source .cm-search');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-find, section[data-marxy-pane="1"] .cm-search').length), 0);
  });
});

test('the outline follows the focused pane: its headings, its scroll, its right edge', async () => {
  const left = outlineFrom(parseMarkdown(Buffer.from(A), { file: '/r/A.md' })).map((e) => e.text);
  const right = outlineFrom(parseMarkdown(Buffer.from(B), { file: '/r/B.md' })).map((e) => e.text);
  await withPanes(['/r/A.md', '/r/B.md'], async (page, mod) => {
    const rows = () => page.$$eval('#marxy-outline .marxy-outline-row', (els) => els.map((el) => el.textContent));
    const marked = () => page.evaluate(() => document.querySelector('#marxy-outline [aria-current="true"]')?.textContent ?? null);
    const edges = (slot) =>
      page.evaluate((slot) => ({
        dialog: document.getElementById('marxy-outline').getBoundingClientRect().right,
        pane: document.querySelector(`section.marxy-pane[data-marxy-pane="${slot}"]`).getBoundingClientRect().right,
      }), slot);

    await page.keyboard.press(`${mod}+1`);
    await page.keyboard.press(`${mod}+Shift+KeyO`);
    assert.deepEqual(await rows(), left);
    assert.equal(await marked(), 'Alpha');
    const leftEdge = await edges(0);
    assert.ok(Math.abs(leftEdge.dialog - leftEdge.pane) <= 2, `left: dialog ${leftEdge.dialog} vs pane ${leftEdge.pane}`);
    // Scrolling the left pane moves the mark.
    await page.evaluate(() => {
      const host = document.querySelector('section[data-marxy-pane="0"]');
      host.scrollTop = host.scrollHeight;
    });
    await page.waitForFunction(() => document.querySelector('#marxy-outline [aria-current="true"]')?.textContent === 'Alpha three');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.slot), 0);

    await page.keyboard.press(`${mod}+2`);
    await page.keyboard.press(`${mod}+Shift+KeyO`);
    assert.deepEqual(await rows(), right);
    const rightEdge = await edges(1);
    assert.ok(Math.abs(rightEdge.dialog - rightEdge.pane) <= 2, `right: dialog ${rightEdge.dialog} vs pane ${rightEdge.pane}`);
    // Scrolling the other pane does not move this outline's mark.
    await page.evaluate(() => {
      const host = document.querySelector('section[data-marxy-pane="0"]');
      host.scrollTop = 0;
    });
    await settle(page);
    assert.equal(await marked(), 'Bravo');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('section[data-marxy-pane="1"]').contains(document.activeElement)), true);
  });
});
