// Search and Transforms in WebKit: Find with Aa, .* and word over this file, its folder or
// every place; ticks; J K walking the matches with the page following; Enter on a hit; staging a replace across files,
// each file its own undo, nothing written; the patch peeked first; saved searches; the transforms' counts, Selection,
// staging, the page marks, the invisible characters asked about.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { drawerShows, fileText, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = '/w/plans/tidemark-1.0-release-plan.md';
const PATCH = '/w/patches/0002-watcher-debounce.patch';
const JSONF = '/w/data/services.json';
const LOG = '/w/logs/indexer-2026-10-14.log';
const TALK = '/w/transcripts/2026-10-14-session.jsonl';
const VEND = '/w/vendor/vendor-drop-notes.md';
const BIN = '/w/data/blob.bin';

const VEND_TEXT = [
  '# Vendor drop notes\r\n',
  '\r\n',
  'The runner takes the drop at nine.\r\n',
  '\r\n',
  'A runner​ checks the seal.\r\n',
  '\n',
  '## Steps\n',
  '\n',
  '1. Load the runner.\n',
  '2. Sign the sheet.\n',
  '\n',
  'The second runner waits  \n',
  'at the gate.\t\n',
  '\n',
  '## After\n',
  '\n',
  'Pay the fee.\n',
  '\n',
  'The last runner leaves.   \n',
  'Done. ',
].join('');

const FILES = {
  '/w/.git/HEAD': 'ref: refs/heads/main\n',
  [PLAN]: [
    '# Tidemark 1.0 release plan',
    '',
    'The watcher debounce is set by max_wait_ms in the config.',
    '',
    '## Watcher',
    '',
    'Watcher settings: max_wait_ms = 250 and max_wait_ms_floor = 10.',
    'Raise max_wait_ms only after the soak.',
    '',
    '- keep max_wait_ms under the budget',
    '- the maximum is 1 s; max is a hard cap',
    '',
    'Rollback: put max_wait_ms back.',
    '',
  ].join('\n'),
  [PATCH]: '--- a/src/watcher.ts\n+++ b/src/watcher.ts\n@@ -1,3 +1,3 @@\n-const max_wait_ms = 100;\n+const max_wait_ms = 250;\n export { max_wait_ms };\n',
  [JSONF]: '{\n  "watcher": { "max_wait_ms": 250 },\n  "indexer": { "max_wait_ms": 500 },\n  "notes": "max_wait_ms is in ms"\n}\n',
  [LOG]: '2026-10-14T08:00:00Z INFO watcher start max_wait_ms=250\n2026-10-14T08:00:01Z WARN burst over max_wait_ms\n2026-10-14T08:00:02Z INFO done\n',
  [TALK]: '{"role":"user","text":"why is max_wait_ms 250?"}\n{"role":"assistant","text":"the Watcher"}\n',
  [VEND]: VEND_TEXT,
  [BIN]: '\u0000\u0001\u0002binary\u0000',
};
const PATHS = [PLAN, PATCH, JSONF, LOG, TALK, VEND];

/** Lines holding a match, counted by hand over every text file. */
const byHand = (src, flags) => {
  const re = new RegExp(src, flags);
  let n = 0;
  for (const p of PATHS) for (const l of FILES[p].split(/\r\n|\n|\r/)) if (re.test(l)) n++;
  return n;
};
const diffLines = (a, b) => {
  const x = a.split('\n');
  const y = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i);
  return out;
};

const show = (page, id, arg) => page.evaluate(([id, arg]) => window.__marxyHandle.frame().left.show(id, arg), [id, arg]);
const search = async (page, q, scope) => {
  await show(page, 'search', { q, scope });
  await drawerShows(page, 'search');
};
/** The count the list's head says, as [matches, files]; [0, 0] when it says none. */
const countNow = () => {
  const s = document.querySelector('.marxy-drawer .marxy-l-body .marxy-l-sec span');
  const m = s && /^([\d,]+) match(?:es)? in ([\d,]+) file/.exec(s.textContent);
  return m ? [Number(m[1].replace(/,/g, '')), Number(m[2])] : [0, 0];
};
const count = (page) => page.evaluate(countNow);
/** The count once it says `want`: the search reads files after the list is drawn. */
async function countIs(page, want, what) {
  await page
    .waitForFunction(([src, want]) => JSON.stringify(new Function(`return (${src})()`)()) === want, [countNow.toString(), JSON.stringify(want)])
    .catch(() => {});
  assert.deepEqual(await count(page), want, what);
}
const opt = (page, label) => page.locator('.marxy-drawer .marxy-l-opt button', { hasText: label }).click();
const cur = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
/** The panel's keys, then j until the cursor rests on row `k`. */
async function goRow(page, k, from = 'start') {
  if (from === 'start') await page.evaluate(() => document.querySelector('.marxy-drawer').focus());
  for (let i = 0; i < 80 && (await cur(page)) !== k; i++) await page.keyboard.press('j');
  assert.equal(await cur(page), k, `the cursor reaches ${k}`);
}
/** Each file's text as the app holds it now (its store, else disk), and its disk bytes. */
const texts = (page) =>
  page.evaluate(async (paths) => {
    const h = window.__marxyHandle;
    const out = {};
    for (const p of paths) {
      const s = h.panes().stores.held(p);
      const disk = new TextDecoder().decode(await h.shell.readFile(p));
      out[p] = { text: s ? new TextDecoder().decode(s.snapshot().buffer.bytes) : disk, disk };
    }
    return out;
  }, PATHS);
const undoIn = (page, path) => page.evaluate((p) => window.__marxyHandle.panes().stores.held(p)?.undo(), path);
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' | '));
const asOf = (page, k) =>
  page.evaluate((k) => {
    const r = document.querySelector(`.marxy-drawer [data-marxy-left-row="${CSS.escape(k)}"]`);
    return r ? { as: r.querySelector('.marxy-l-as')?.textContent ?? '', dim: r.classList.contains('marxy-l-dim') } : null;
  }, k);
/** Transforms shown, its counts worked out. */
async function transforms(page) {
  await show(page, 'transforms');
  await drawerShows(page, 'transforms');
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="t:"] .marxy-l-as')];
    return rows.length > 0 && rows.every((r) => r.textContent !== '…');
  });
}
const vendText = (page) => page.evaluate((p) => new TextDecoder().decode(window.__marxyHandle.panes().stores.held(p).snapshot().buffer.bytes), VEND);

test('Search: max_wait_ms everywhere is 14 matches in 5 files, the open file first', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5], 'matches and files');
    const s = await page.evaluate(() => ({
      subject: document.querySelector('.marxy-drawer .marxy-l-subject').textContent,
      groups: [...document.querySelectorAll('.marxy-drawer .marxy-l-prow')].map((r) => r.dataset.marxyLeftRow).filter((k) => k.startsWith('g:')).map((k) => k.slice(2)),
      focus: document.activeElement.dataset.marxyLeftField,
      marks: [...document.querySelectorAll('.marxy-drawer .marxy-l-hit mark')].map((m) => m.textContent),
    }));
    assert.equal(s.subject, 'w', 'the head names where it searches');
    assert.equal(s.groups.length, 5, 'five file rows');
    assert.equal(s.groups[0], PLAN, 'the open file comes first');
    assert.equal(s.focus, 'search-q', 'the Find field has the focus');
    assert.ok(s.marks.length > 0 && s.marks.every((m) => m === 'max_wait_ms'), 'the matched words are marked');
  });
});

test('Search: This file gives 5 for the release plan; the In control widens it again', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max_wait_ms', 'find');
    await countIs(page, [5, 1], 'This file');
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-subject'), 'tidemark-1.0-release-plan.md');
    await page.locator('.marxy-drawer .marxy-l-sg button', { hasText: 'plans/' }).click();
    await countIs(page, [5, 1], 'its folder');
    await page.locator('.marxy-drawer .marxy-l-sg button', { hasText: /^w$/ }).click();
    await countIs(page, [14, 5], 'every place again');
  });
});

test('Search: Aa, word and .* each change the count as a hand count says', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'watcher', 'grep');
    const anyCase = byHand('watcher', 'i');
    const exact = byHand('watcher', '');
    assert.notEqual(anyCase, exact, 'the sample has watcher in more than one case');
    const lines = async (want) => {
      await page.waitForFunction(([src, want]) => new Function(`return (${src})()`)()[0] === want, [countNow.toString(), want]).catch(() => {});
      return (await count(page))[0];
    };
    assert.equal(await lines(anyCase), anyCase, 'watcher, any case');
    await opt(page, 'Aa');
    assert.equal(await lines(exact), exact, 'watcher with Aa');
    await search(page, 'max', 'grep');
    const loose = byHand('max', 'i');
    const word = byHand('\\bmax\\b', 'i');
    assert.notEqual(loose, word);
    await countIs(page, [loose, 5], 'max anywhere');
    await opt(page, 'word');
    await countIs(page, [word, 1], 'max as a word');
    await search(page, 'max.wait', 'grep');
    assert.equal(await page.waitForFunction(() => /Nothing in w holds that/.test(document.querySelector('.marxy-drawer .marxy-l-body').textContent)).then(() => true), true, 'max.wait as plain text is in no file');
    await opt(page, '.*');
    await countIs(page, [14, 5], 'max.wait as a regular expression');
  });
});

test('Search: a press on word while the result lands still turns word on', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max', 'find');
    await countIs(page, [6, 1], 'max anywhere in this file');
    const word = page.locator('.marxy-drawer .marxy-l-opt button', { hasText: 'word' });
    const box = await word.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // The panel draws again between the press and the release, as it does when a search's result arrives.
    await page.evaluate(() => window.__marxyHandle.frame().left.draw());
    await page.mouse.up();
    assert.equal(await word.getAttribute('aria-pressed'), 'true', 'the press was not lost');
    await countIs(page, [1, 1], 'max as a word in this file');
  });
});

test('Search: the log and the transcript start unticked; Space on a file row flips it', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5]);
    const ck = () =>
      page.evaluate(() =>
        Object.fromEntries([...document.querySelectorAll('.marxy-drawer .marxy-l-prow')].filter((r) => r.dataset.marxyLeftRow.startsWith('g:')).map((r) => [r.dataset.marxyLeftRow.slice(2), r.querySelector('.marxy-l-ck').classList.contains('marxy-l-on')])),
      );
    const a = await ck();
    assert.deepEqual([a[PLAN], a[PATCH], a[JSONF], a[LOG], a[TALK]], [true, true, true, false, false], 'plan, patch, json ticked; log, transcript not');
    assert.equal(await page.evaluate(() => /Stage \d/.test(document.querySelector('.marxy-drawer').textContent)), false, 'no Replace section while Replace is empty');
    const rowText = (path) => page.evaluate((p) => document.querySelector(`.marxy-drawer [data-marxy-left-row="g:${p}"]`).textContent, path);
    assert.match(await rowText(LOG), /a log: Replace leaves it alone until ticked/, 'an unticked log says why');
    assert.match(await rowText(TALK), /JSON Lines: Replace leaves it alone until ticked/, 'so does a transcript');
    assert.doesNotMatch(await rowText(PLAN), /leaves it alone/, 'a ticked file says nothing');
    await goRow(page, `g:${LOG}`);
    await page.keyboard.press('Space');
    await page.waitForFunction((p) => document.querySelector(`.marxy-drawer [data-marxy-left-row="g:${p}"] .marxy-l-ck.marxy-l-on`), LOG);
    assert.equal((await ck())[LOG], true, 'Space ticked the log');
    assert.doesNotMatch(await rowText(LOG), /leaves it alone/, 'ticked, the reason goes');
  });
});

test('Search: an open credential file is not searched in the scope of its folder', async () => {
  const NPM = '/w/plans/.npmrc';
  await withFrame({ files: { ...FILES, [NPM]: '//registry.example/:_authToken=max_wait_ms\n' }, open: [PLAN] }, async (page) => {
    await page.evaluate(async (p) => {
      const panes = window.__marxyHandle.panes();
      await panes.openIn('other', p);
      panes.focus(panes.panes[0]);
    }, NPM);
    await search(page, 'max_wait_ms', 'find');
    await countIs(page, [5, 1], 'This file');
    await page.locator('.marxy-drawer .marxy-l-sg button', { hasText: 'plans/' }).click();
    await countIs(page, [5, 1], 'its folder leaves the open .npmrc out');
  });
});

test('Search: J on the hits opens each file at its line, lit, and the panel keeps the focus', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5]);
    await page.keyboard.press('ArrowDown');
    const first = (await page.evaluate((p) => [...document.querySelectorAll('.marxy-drawer .marxy-l-prow')].map((r) => r.dataset.marxyLeftRow).find((k) => k.startsWith(`h:${p}:`)), PLAN));
    await goRow(page, first, 'here');
    const line = Number(first.split(':').pop());
    await page.waitForFunction(() => window.__marxyHandle.selection.state().selection.kind !== 'none');
    const on = await page.evaluate(() => {
      const h = window.__marxyHandle;
      const sel = h.selection.state().selection;
      const src = sel.kind === 'node' ? sel.node.src : sel.range;
      const bytes = h.document().snapshot().buffer.bytes;
      const lineOf = (b) => bytes.subarray(0, b).filter((x) => x === 10).length;
      return [lineOf(src.start), lineOf(Math.max(src.start, src.end - 1))];
    });
    assert.ok(on[0] <= line && line <= on[1], `the page cursor holds line ${line + 1}: ${on}`);
    for (let i = 0; i < 20 && !(await cur(page))?.startsWith(`h:${PATCH}`); i++) await page.keyboard.press('j');
    assert.ok((await cur(page))?.startsWith(`h:${PATCH}`), 'reached a hit in the patch');
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, PATCH);
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ q: document.querySelector('.marxy-find-input')?.value ?? null, inDrawer: !!document.activeElement?.closest('.marxy-drawer') }));
    assert.equal(s.q, 'max_wait_ms', 'the find is lit on the page');
    assert.equal(s.inDrawer, true, 'focus stayed in the panel');
  });
});

test('Search: staging a replace changes exactly the ticked files, each match, and writes nothing', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5]);
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'max_burst_ms');
    await page.waitForFunction(() => /^Stage/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''));
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-btns button.marxy-l-pri'), 'Stage 11 places in 3 files', 'the button says what it will stage');
    const before = await texts(page);
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => /Staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    const after = await texts(page);
    const touched = [PLAN, PATCH, JSONF];
    for (const p of PATHS) {
      const want = touched.includes(p) ? before[p].text.replace(/max_wait_ms/g, 'max_burst_ms') : before[p].text;
      assert.equal(after[p].text, want, `${p}: ${touched.includes(p) ? 'replaced as by hand' : 'unchanged'}`);
      assert.equal(after[p].disk, before[p].disk, `${p}: nothing written`);
    }
    assert.match(await notices(page), /Staged 11 places in 3 files.*Nothing is written until (Ctrl\+S|⌘S)/, 'the notice says nothing is written until Save');
    for (const p of touched) {
      await undoIn(page, p);
      assert.equal((await texts(page))[p].text, before[p].text, `${p}: one undo step gives its bytes back`);
    }
  });
});

test('Search: U in each staged file restores it; a file no pane showed opens with its staged change', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page, { mod }) => {
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5]);
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'max_burst_ms');
    const before = await texts(page);
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => /Staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    assert.match(await page.textContent('.marxy-drawer .marxy-l-body'), /3 files have unsaved changes/, 'the panel says how many files have unsaved changes');
    for (const p of [PATCH, PLAN]) {
      // Leaving a staged file asks nothing: its store is kept, changes and all.
      await page.evaluate((p) => window.__marxyHandle.open(p), p);
      await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, p);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-notice-text').length > 0 && /without saving/.test(document.body.textContent)), false, 'no unsaved-changes question');
      assert.ok((await page.evaluate((p) => new TextDecoder().decode(window.__marxyHandle.panes().focused.content.store().snapshot().buffer.bytes), p)).includes('max_burst_ms'), `${p} opens with its staged change`);
      await blur(page);
      // u is the Markdown cursor's undo; the patch is a reading of its own, where the window's undo is Mod+Z.
      await page.keyboard.press(p === PLAN ? 'u' : `${mod}+z`);
      await page.waitForFunction(([p, t]) => new TextDecoder().decode(window.__marxyHandle.panes().stores.held(p).snapshot().buffer.bytes) === t, [p, before[p].text]);
    }
    // The json no pane shows: its group's u.
    await show(page, 'search', { q: 'max_burst_ms', scope: 'grep' });
    await countIs(page, [3, 1], 'only the json still says max_burst_ms');
    await goRow(page, `g:${JSONF}`);
    await page.keyboard.press('u');
    await page.waitForFunction(([p, t]) => new TextDecoder().decode(window.__marxyHandle.panes().stores.held(p)?.snapshot().buffer.bytes ?? new Uint8Array()) === t || window.__marxyHandle.panes().stores.held(p) === null, [JSONF, before[JSONF].text]);
    assert.equal((await texts(page))[JSONF].text, before[JSONF].text, 'the json is back to its bytes');
    assert.equal(await page.evaluate((p) => window.__marxyHandle.panes().stores.held(p), JSONF), null, 'and, clean again, no longer held');
  });
});

test('Search: Enter on one hit replaces that line only, staged', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5]);
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'max_burst_ms');
    const before = await texts(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('j');
    const k = await cur(page);
    assert.ok(k?.startsWith(`h:${PLAN}:`), `on the first hit of the plan: ${k}`);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Replaced on line/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    const after = await texts(page);
    const l = Number(k.split(':').pop());
    assert.deepEqual(diffLines(before[PLAN].text, after[PLAN].text), [l], "one line changed, the hit's");
    assert.ok(after[PLAN].text.split('\n')[l].includes('max_burst_ms'));
    assert.deepEqual(PATHS.filter((p) => p !== PLAN && before[p].text !== after[p].text), [], 'no other file changed');
    assert.equal(after[PLAN].disk, before[PLAN].disk, 'nothing written');
  });
});

test('Search: a replace on the vendor notes keeps CRLF lines and the missing final newline', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await search(page, 'runner', 'find');
    await countIs(page, [5, 1], 'runner in the vendor notes');
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'builder');
    await page.waitForSelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => /Staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    const after = await vendText(page);
    assert.equal(after, VEND_TEXT.replace(/runner/g, 'builder'), 'every byte as a replace by hand');
    assert.equal((after.match(/\r\n/g) ?? []).length, 5, 'CRLF endings kept');
    assert.equal(/[\r\n]$/.test(after), false, 'still no final newline');
    assert.equal(await fileText(page, VEND), VEND_TEXT, 'nothing written');
  });
});

test('Search: Peek the patch shows the change and stages nothing', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5]);
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'max_burst_ms');
    const before = await texts(page);
    await page.locator('.marxy-drawer .marxy-l-btns button', { hasText: 'Peek the patch' }).click();
    await page.waitForSelector('.marxy-drawer .marxy-l-hit ins');
    const after = await texts(page);
    assert.deepEqual(PATHS.filter((p) => before[p].text !== after[p].text), [], 'no file changed');
    assert.equal(await page.evaluate((p) => window.__marxyHandle.panes().stores.held(p).snapshot().canUndo, PLAN), false, 'and no undo step');
    const s = await page.evaluate(() => ({
      ins: [...document.querySelectorAll('.marxy-drawer .marxy-l-hit ins')].map((x) => x.textContent),
      del: [...document.querySelectorAll('.marxy-drawer .marxy-l-hit del')].map((x) => x.textContent),
      btn: [...document.querySelectorAll('.marxy-drawer .marxy-l-btns button')].map((b) => b.textContent),
    }));
    assert.ok(s.ins.length >= 3 && s.ins.every((x) => /burst/.test(x)), `inserted words say burst: ${s.ins}`);
    assert.ok(s.del.length >= 3 && s.del.every((x) => /wait/.test(x)), `struck words say wait: ${s.del}`);
    assert.ok(s.btn.includes('Hide the patch'));
  });
});

test('Search: a saved search is kept in collection.toml and restores the query, toggles and scope', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'max', 'find');
    await opt(page, 'word');
    await countIs(page, [1, 1], 'max as a word in this file');
    const menu = async (title) => {
      await page.click('.marxy-drawer .marxy-l-hb');
      await page.locator('[role="menu"] [role="menuitem"]', { hasText: title }).first().click();
    };
    await menu('Save this search');
    await page.waitForFunction(() => /Saved in collection\.toml/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    assert.match(await fileText(page, '/collection.toml'), /name = ['"]Search: max · this file · word['"]/);
    await menu('Clear');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer .marxy-l-body .marxy-l-sec'));
    assert.deepEqual(await count(page), [0, 0], 'cleared');
    await menu('this file · word');
    await countIs(page, [1, 1], 'the same count');
    assert.equal(await page.inputValue('.marxy-drawer input[data-marxy-left-field="search-q"]'), 'max');
    assert.equal(await page.getAttribute('.marxy-drawer .marxy-l-opt button:text-is("word")', 'aria-pressed'), 'true');
  });
});

test("Search: This file counts what the page's find counts", async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page, { mod }) => {
    await search(page, 'runner', 'find');
    await countIs(page, [5, 1]);
    await blur(page);
    await page.keyboard.press(`${mod}+f`);
    await page.waitForSelector('.marxy-find-input');
    await page.fill('.marxy-find-input', 'runner');
    await page.waitForFunction(() => /\d/.test(document.querySelector('.marxy-find-count')?.textContent ?? ''));
    await page.waitForTimeout(100);
    assert.match(await page.textContent('.marxy-find-count'), /\b5\b/);
  });
});

test('Transforms: the vendor notes say 4 lines for Trim trailing spaces, nothing for Renumber', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await transforms(page);
    assert.deepEqual(await asOf(page, 't:trim-trailing'), { as: '4 lines', dim: false });
    assert.deepEqual(await asOf(page, 't:renumber-list'), { as: 'nothing to change', dim: true });
    assert.deepEqual(await asOf(page, 't:eol-lf'), { as: '5 lines', dim: false });
    const secs = await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-sec')].map((s) => [s.querySelector('span').textContent, s.querySelector('em').textContent, s.querySelector('em').classList.contains('marxy-l-staged')]));
    assert.deepEqual(secs.map((s) => s[0]), ['Space', 'Lines', 'Markdown', 'Bytes', 'Your commands']);
    assert.deepEqual(secs[0].slice(1), ['staged · the patch shows first', true], 'the first section says it stages');
  });
});

test('Transforms: Enter stages Trim trailing spaces on exactly those lines; u restores the bytes', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await transforms(page);
    await goRow(page, 't:trim-trailing');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    const after = await vendText(page);
    assert.equal(after, VEND_TEXT.split(/(?<=\n)/).map((l) => l.replace(/[ \t]+(?=\r?\n?$)/, '')).join(''), 'every byte as trimmed by hand');
    assert.deepEqual(diffLines(VEND_TEXT, after), [11, 12, 18, 19], 'the four lines changed');
    assert.equal(await fileText(page, VEND), VEND_TEXT, 'nothing written');
    await page.keyboard.press('u');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === t, VEND_TEXT);
  });
});

test('Transforms: Selection acts only inside the selected lines', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    // The cursor on the paragraph of lines 12 and 13.
    await page.evaluate((t) => window.__marxyHandle.selection.cursorAt(new TextEncoder().encode(t.slice(0, t.indexOf('The second runner'))).length), VEND_TEXT);
    await transforms(page);
    await page.locator('.marxy-drawer .marxy-l-sg button', { hasText: 'Selection' }).click();
    await page.waitForFunction(() => /^On lines?/.test(document.querySelector('.marxy-drawer .marxy-l-top .marxy-l-hint')?.textContent ?? ''));
    assert.equal(await page.textContent('.marxy-drawer .marxy-l-top .marxy-l-hint'), 'On lines 12 to 13', 'the hint says what is selected');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="t:trim-trailing"] .marxy-l-as')?.textContent === '2 lines');
    await goRow(page, 't:trim-trailing');
    await page.keyboard.press('o');
    await page.waitForFunction(() => /staged/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    assert.deepEqual(diffLines(VEND_TEXT, await vendText(page)), [11, 12], 'changed only inside lines 12 to 13; 19 and 20 keep their trailing spaces');
  });
});

test('Transforms: Line ends, all LF leaves no CRLF and changes no other byte', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await transforms(page);
    await goRow(page, 't:eol-lf');
    await page.keyboard.press('o');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) !== t, VEND_TEXT);
    assert.equal(await vendText(page), VEND_TEXT.replace(/\r\n/g, '\n'), 'only the five CRs went');
  });
});

test('Transforms: End the file with a newline adds exactly one byte', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await transforms(page);
    assert.deepEqual(await asOf(page, 't:final-newline'), { as: '1 line', dim: false });
    await goRow(page, 't:final-newline');
    await page.keyboard.press('o');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) !== t, VEND_TEXT);
    assert.equal(await vendText(page), `${VEND_TEXT}\n`, 'the old text and one LF, the ending most lines have');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="t:final-newline"] .marxy-l-as')?.textContent === 'nothing to change');
    assert.deepEqual(await asOf(page, 't:final-newline'), { as: 'nothing to change', dim: true });
  });
});

for (const [ends, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
test(`Transforms: Alt+6 on a half-megabyte Markdown file with ${ends} line ends never stops the window for long, and every count fills in`, async () => {
  // The shape of a long page: per section a heading, a paragraph with a link, a numbered list, tasks and a table.
  let big = '';
  for (let h = 0; h < 3000; h++) big += `## Heading ${h}\n\nSome plain prose for section ${h}, with a [link](https://e.com/${h}).\n\n1. one\n3. two\n\n- [ ] task\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`.replace(/\n/g, eol);
  const BIG = '/w/notes/long-page.md';
  await withFrame({ files: { ...FILES, [BIG]: big }, open: [BIG] }, async (page) => {
    await page.waitForFunction(() => window.__marxyHandle.document()?.parsed());
    // A beat the page keeps while the counts are worked out: the longest gap between two beats is the longest the window stopped.
    await page.evaluate(() => {
      window.__beat = { last: performance.now(), worst: 0 };
      window.__beat.timer = setInterval(() => {
        const now = performance.now();
        window.__beat.worst = Math.max(window.__beat.worst, now - window.__beat.last);
        window.__beat.last = now;
      }, 10);
    });
    await page.keyboard.press('Alt+6');
    await drawerShows(page, 'transforms');
    await page.waitForFunction(
      () => {
        const rows = [...document.querySelectorAll('.marxy-drawer .marxy-l-prow[data-marxy-left-row^="t:"] .marxy-l-as')];
        return rows.length > 0 && rows.every((r) => r.textContent !== '…');
      },
      undefined,
      { timeout: 90_000 },
    );
    const worst = await page.evaluate(() => (clearInterval(window.__beat.timer), window.__beat.worst));
    assert.ok(worst < 3000, `the window stopped for ${Math.round(worst)} ms at most; one row was one task of many seconds before`);
    assert.deepEqual(await asOf(page, 't:renumber-list'), { as: '3000 lines', dim: false });
    assert.deepEqual(await asOf(page, 't:tick-all'), { as: '3000 lines', dim: false });
    assert.deepEqual(await asOf(page, 't:table-align'), { as: '9000 lines', dim: false });
  });
});
}

test('Transforms: a JSON file shows the JSON group and not the Markdown group', async () => {
  await withFrame({ files: FILES, open: [JSONF] }, async (page) => {
    await transforms(page);
    const secs = await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-sec span')].map((s) => s.textContent));
    assert.ok(secs.includes('JSON') && !secs.includes('Markdown'), secs.join(', '));
    assert.ok(await asOf(page, 't:json-minify'), 'Minify JSON is a row');
  });
});

test('Both panels draw on a file read as bytes and on an empty query without failing', async () => {
  await withFrame({ files: FILES, open: [BIN] }, async (page) => {
    await show(page, 'transforms');
    await drawerShows(page, 'transforms');
    await page.waitForSelector('.marxy-drawer .marxy-l-body .marxy-l-empty');
    const a = await page.textContent('.marxy-drawer .marxy-l-body');
    assert.match(a, /only read here/, 'Transforms says nothing changes it');
    await show(page, 'search', '');
    await drawerShows(page, 'search');
    await page.waitForSelector('.marxy-drawer .marxy-l-body .marxy-l-empty');
    assert.match(await page.textContent('.marxy-drawer .marxy-l-body'), /^Searches the text of all \d+ files in .+, as it is now\.$/, 'Search says what it searches');
    assert.doesNotMatch(a + (await page.textContent('.marxy-drawer .marxy-l-body')), /could not be drawn/);
  });
});

test('Transforms: Remove invisible characters asks which, and removes only that kind', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await transforms(page);
    await goRow(page, 't:invisible');
    await page.keyboard.press('o');
    await page.waitForSelector('[role="menu"]');
    const items = await page.$$eval('[role="menu"] [role="menuitem"]', (els) => els.map((e) => e.textContent));
    assert.ok(items.some((t) => t.startsWith('Zero-width characters')) && items.some((t) => t.startsWith('No-break spaces, made plain spaces')) && items.some((t) => t.startsWith('All of these')), items.join(' | '));
    await page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Zero-width characters' }).click();
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) !== t, VEND_TEXT);
    assert.equal(await vendText(page), VEND_TEXT.replace(/​/g, ''), 'only the zero-width space went');
  });
});

test('Transforms: resting on a row marks on the page and the spine the lines it would change; leaving it takes them off', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await transforms(page);
    // Showing the panel puts its cursor on the first row without the page following; a key move does.
    await goRow(page, 't:tabs-to-spaces');
    await page.keyboard.press('k');
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-pane="0"] [data-marxy-tx-wash]').length > 0);
    const washed = await page.evaluate(() => [...document.querySelectorAll('[data-marxy-pane="0"] [data-marxy-tx-wash]')].map((el) => el.textContent.trim().slice(0, 20)));
    assert.ok(washed.some((t) => t.startsWith('The second runner')) && washed.some((t) => t.startsWith('The last runner')), washed.join(' | '));
    // The spine draws its marks on its next full redraw.
    await page.waitForFunction(() => document.querySelectorAll('.marxy-spine-mark[data-marxy-mark="transform"]').length === 4);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.querySelectorAll('[data-marxy-tx-wash], [data-marxy-mark="transform"]').length === 0);
  });
});

test('Transforms: p peeks the patch and stages nothing; Your commands lists config.toml\'s', async () => {
  const config = '[[command]]\nname = "Wrap at 72"\nrun = ["fold", "-s", "-w", "72"]\n';
  await withFrame({ files: FILES, open: [VEND], config }, async (page) => {
    await transforms(page);
    await goRow(page, 't:trim-trailing');
    await page.keyboard.press('p');
    await page.waitForSelector('.marxy-drawer .marxy-l-hit del');
    const s = await page.evaluate(() => ({
      del: [...document.querySelectorAll('.marxy-drawer .marxy-l-hit del')].map((x) => x.textContent),
      ins: [...document.querySelectorAll('.marxy-drawer .marxy-l-hit ins')].map((x) => x.textContent),
    }));
    assert.deepEqual(s.del, ['The second runner waits  ', 'at the gate.\t', 'The last runner leaves.   ', 'Done. ']);
    assert.deepEqual(s.ins, ['The second runner waits', 'at the gate.', 'The last runner leaves.', 'Done.']);
    assert.equal(await vendText(page), VEND_TEXT, 'nothing staged');
    await page.waitForSelector('.marxy-drawer [data-marxy-left-row="c:Wrap at 72"]');
    assert.equal(await page.textContent('.marxy-drawer [data-marxy-left-row="c:Wrap at 72"] .marxy-l-nm'), 'Wrap at 72');
  });
});

test('Search: This file on a second README.md shows its own hits, not the first one\'s', async () => {
  const A = '/w/a/README.md';
  const B = '/w/b/README.md';
  const files = { '/w/.git/HEAD': 'ref: refs/heads/main\n', [A]: '# A\n\nneedle in a\n', [B]: '# B\n\none\ntwo\nneedle in b\n' };
  await withFrame({ files, open: [A] }, async (page) => {
    await search(page, 'needle', 'find');
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="h:${A}:2"]`);
    await page.evaluate((p) => window.__marxyHandle.open(p), B);
    await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p, B);
    await page.evaluate(() => window.__marxyHandle.frame().left.draw());
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="h:${B}:4"]`, { timeout: 5000 });
    assert.equal(await page.locator(`.marxy-drawer [data-marxy-left-row="h:${A}:2"]`).count(), 0, 'the first README\'s hit is gone');
  });
});

test('Search: Stage while a changed query is still reading stages nothing', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, '/max_wait_(ms)/', 'find');
    await countIs(page, [5, 1], 'the regular expression');
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', '$1');
    await page.waitForFunction(() => /^Stage/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''));
    const before = await texts(page);
    // .* off, then Stage in the same task: the new search has not read yet and the old matches are still drawn.
    const drawn = await page.evaluate(() => {
      document.querySelector('.marxy-drawer .marxy-l-opt button[aria-pressed="true"][title^="A regular"]').click();
      const stage = document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
      stage?.click();
      return stage !== null;
    });
    assert.equal(drawn, true, 'the old result and its Stage were still drawn');
    await page.waitForFunction(() => /Still searching/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    const after = await texts(page);
    for (const p of PATHS) assert.equal(after[p].text, before[p].text, `${p}: unchanged`);
  });
});

test('Search: a clean open file changed on disk drops its old hits', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await search(page, 'Rollback', 'find');
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="h:${PLAN}:12"]`);
    await page.evaluate(async (path) => {
      const h = window.__marxyHandle;
      const count = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
      const was = count();
      await h.shell.writeFileAtomic(path, new TextEncoder().encode('Rollback comes first now.\n\nNothing else.\n'));
      h.shell.emit([{ kind: 'modified', path }]);
      for (let i = 0; i < 100 && count() === was; i++) await new Promise((r) => setTimeout(r, 50));
      h.frame().left.draw();
    }, PLAN);
    await page.waitForSelector(`.marxy-drawer [data-marxy-left-row="h:${PLAN}:0"]`, { timeout: 5000 });
    assert.equal(await page.locator(`.marxy-drawer [data-marxy-left-row="h:${PLAN}:12"]`).count(), 0, 'the line that is gone is no hit');
  });
});

test('Search: Stage on an open file whose bytes are not UTF-8 changes nothing and says why', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    const bytesNow = () => page.evaluate((p) => [...window.__marxyHandle.panes().stores.held(p).snapshot().buffer.bytes], PLAN);
    await page.evaluate(async (p) => {
      const s = window.__marxyHandle.panes().stores.held(p);
      const snap = s.snapshot();
      await s.apply({ range: { file: p, start: 0, end: 0 }, replacement: new Uint8Array([0xff, 0x0a]), label: 'a bad byte', baseVersion: snap.version });
    }, PLAN);
    const before = await bytesNow();
    await search(page, 'max_wait_ms', 'find');
    await countIs(page, [5, 1], 'the plan');
    await page.fill('.marxy-drawer input[data-marxy-left-field="search-r"]', 'max_burst_ms');
    await page.waitForFunction(() => /^Stage/.test(document.querySelector('.marxy-drawer .marxy-l-btns button.marxy-l-pri')?.textContent ?? ''));
    await page.click('.marxy-drawer .marxy-l-btns button.marxy-l-pri');
    await page.waitForFunction(() => /not UTF-8 text here/.test([...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent).join(' ')));
    assert.deepEqual(await bytesNow(), before, 'not a byte changed');
  });
});

test('Search: a file over 4 MB is not read, and the note says how many were left out', async () => {
  const BIG = '/w/logs/huge.log';
  const big = `${'x'.repeat(5 * 1024 * 1024)}\nmax_wait_ms here\n`;
  await withFrame({ files: { ...FILES, [BIG]: big }, open: [PLAN] }, async (page) => {
    const readsOfBig = () => page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === p).length, BIG);
    const before = await readsOfBig();
    const note = () => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-body .marxy-l-sec')?.textContent ?? '');
    await search(page, 'max_wait_ms', 'grep');
    await countIs(page, [14, 5], 'the big file is not searched');
    assert.match(await note(), /1 file over 4 MB not searched/);
    await opt(page, '.*');
    await countIs(page, [14, 5], 'nor by a regular expression');
    assert.match(await note(), /1 file over 4 MB not searched/);
    assert.equal(await readsOfBig(), before, 'its bytes never crossed');
  });
});
