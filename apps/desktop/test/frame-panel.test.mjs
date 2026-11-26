// What the left section's Metadata, Outline and Links panels say of a file, by what the
// file is: a Markdown file's reading, front matter, footnotes and facts (Metadata), its headings (Outline) and links
// (Links); a data file's Keys, Columns or Elements; verse's Stanzas; a changelog's Releases; a log's Levels; the part under
// the cursor; two panes; and reading a file as another kind. The data files are the demo's (fixtures/demo). WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { panelHero, panelKvs, panelRows, panelSecs, panelText, showPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo');
const DEMO = Object.fromEntries(
  ['data/release.json', 'data/p95-latency.csv', 'data/index-runs.jsonl', 'tidemark/docs/releases.xml', 'reading/tide-table.txt', 'tidemark/CHANGELOG.md', 'logs/build-2026-10-14.log', 'src/indexer.rs'].map((p) => [`/demo/${p}`, readFileSync(join(demo, p), 'utf8')]),
);

const para = (n) => `${'Words that run on long enough to fill the measure and make the page tall. '.repeat(14)}(${n})\n`;
const PLAN = '/r/plan.md';
const PLAN_TEXT = [
  '---\ntitle: The plan\nowner: ops\n---\n',
  '# The plan\n\nIt starts with a [link](https://example.com/plan) in it.\n',
  `## First\n\n${para(1)}\n${para(2)}`,
  `## Second\n\nThe end has a note.[^1]\n\n${para(3)}`,
  '[^1]: The note itself.\n',
].join('\n');
const FILES = { [PLAN]: PLAN_TEXT, '/r/other.md': '# Other\n\nA second file.\n', ...DEMO };

const subject = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent ?? null);
const show = async (page, path, panel = 'metadata') => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await showPanel(page, panel);
  await page.waitForFunction((p) => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === p.slice(p.lastIndexOf('/') + 1), path);
};
const titles = async (page, id) => (await panelSecs(page, id)).map(([t]) => t);

test('a Markdown file: Metadata says its reading, the file, its front matter and what it holds; Outline its headings; Links its links; an Outline row goes to its heading', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    const hero = await panelHero(page);
    assert.equal(hero.big, 'Markdown');
    assert.match(hero.small, /^Read so because its name ends \.md\./);
    assert.equal(await subject(page), 'plan.md', 'each panel says the file it is about');
    assert.deepEqual(await titles(page, 'metadata'), ['Read as', 'The file', 'Written in it', 'It holds']);
    const kv = await panelKvs(page, 'metadata');
    assert.equal(kv.title, 'The plan');
    assert.equal(kv.owner, 'ops');
    assert.match(kv.Size, /^[\d,]+ bytes · \d+ lines · [\d,]+ words$/);
    assert.equal(kv.Bytes, 'UTF-8, no byte order mark');
    assert.equal(kv['Line ends'], 'LF, and a final newline');
    assert.equal(kv.In, '/r');
    const holds = await panelRows(page, 'metadata');
    const foot = holds.find((r) => r.k === 'h:foot');
    assert.equal(foot.n, '1');
    // With Notes where you read on, the count is followed by where the note is read.
    assert.match(foot.as, /^(in the margin|the margin has no room)$/);
    assert.equal(holds.find((r) => r.k === 'h:links').n, '1');
    assert.deepEqual((await panelRows(page, 'outline')).map((r) => r.name), ['The plan', 'First', 'Second']);
    assert.match(await panelText(page, 'links'), /https:\/\/example\.com\/plan/);
    assert.ok((await titles(page, 'links')).includes('Outside · 1'));
    // A row goes to its heading; the row of the section the page is at is marked.
    await showPanel(page, 'outline');
    await page.click('.marxy-drawer [data-marxy-left-row="h:second"]');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="h:second"]')?.classList.contains('marxy-l-at'));
    const second = Buffer.from(PLAN_TEXT.slice(0, PLAN_TEXT.indexOf('## Second')), 'utf8').length;
    assert.ok((await page.evaluate(() => window.__marxyHandle.panes().focused.view.position().byteOffset)) >= second - 1);
  });
});

test('Outline is named for what the file holds: Keys, Columns, Elements, Stanzas, Releases, Levels; code has no parts', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await show(page, '/demo/data/release.json', 'outline');
    assert.equal((await titles(page, 'outline'))[0], 'Keys');
    assert.equal((await panelHero(page)).big, 'A data tree');
    assert.ok((await panelRows(page, 'outline')).length > 1);
    await show(page, '/demo/data/p95-latency.csv', 'outline');
    assert.equal((await titles(page, 'outline'))[0], 'Columns');
    assert.deepEqual((await panelRows(page, 'outline')).map((r) => r.name), ['date', 'service', 'p50_ms', 'p95_ms', 'p99_ms', 'errors']);
    await show(page, '/demo/data/index-runs.jsonl', 'outline');
    assert.equal((await titles(page, 'outline'))[0], 'Columns');
    assert.match(await page.textContent('.marxy-drawer .marxy-l-fld .marxy-l-v'), /^\d+ columns?$/);
    await show(page, '/demo/tidemark/docs/releases.xml', 'outline');
    assert.equal((await titles(page, 'outline'))[0], 'Elements');
    await show(page, '/demo/reading/tide-table.txt', 'outline');
    assert.equal((await titles(page, 'outline'))[0], 'Stanzas');
    const stanza = (await panelRows(page, 'outline'))[0];
    assert.deepEqual([stanza.name, stanza.as], ['Low water at six. The harbour', '4 lines']);
    await show(page, '/demo/tidemark/CHANGELOG.md', 'outline');
    assert.equal((await titles(page, 'outline'))[0], 'Releases');
    assert.match(await panelText(page, 'outline'), /0\.4\.0/);
    await show(page, '/demo/logs/build-2026-10-14.log', 'outline');
    const secs = await panelSecs(page, 'outline');
    assert.match(secs[0][0], /^\d\d:\d\d to \d\d:\d\d$/, 'the strip of time');
    assert.ok(secs.some(([t]) => t === 'Levels'));
    const rows = await panelRows(page, 'outline');
    for (const k of ['lv:info', 'lv:warn', 'lv:error']) assert.ok(rows.some((r) => r.k === k), k);
    assert.ok(rows.some((r) => r.name.startsWith('ERROR sign: codesign failed')), rows.map((r) => r.name).join(' | '));
    assert.match(await panelText(page, 'outline'), /\b2 escape codes in the file\b/);
    await show(page, '/demo/src/indexer.rs', 'outline');
    assert.match(await panelText(page, 'outline'), /no parts to list/);
    assert.equal((await panelHero(page)).big, 'Code');
  });
});

test('the part under the cursor: Metadata says its lines and words while a block is selected, and nothing when none is', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    assert.ok(!(await titles(page, 'metadata')).includes('This part'));
    await page.click('#doc p:has-text("It starts with a")', { position: { x: 4, y: 4 } });
    await page.waitForSelector('.marxy-drawer .marxy-l-sec:has-text("This part")');
    const line = PLAN_TEXT.slice(0, PLAN_TEXT.indexOf('It starts with')).split('\n').length;
    assert.deepEqual((await panelSecs(page, 'metadata')).find(([t]) => t === 'This part'), ['This part', `line ${line}`]);
    assert.equal((await panelKvs(page, 'metadata')).Words, '7 words');
    // Escape with focus on <body>, where a click on the page leaves it.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForSelector('.marxy-drawer .marxy-l-sec:has-text("This part")', { state: 'detached' });
  });
});

// Deleted with the panel of cards: the choices of cards per kind of file (frame.json's cards and sameCards). The panels
// draw every section the file has; there are no cards left to choose.

test('with two panes the panels are about the focused one, and the head says which', async () => {
  await withFrame({ files: FILES, open: [PLAN, '/demo/data/p95-latency.csv'] }, async (page) => {
    await showPanel(page, 'outline');
    assert.equal(await subject(page), 'plan.md');
    assert.deepEqual((await panelRows(page, 'outline')).map((r) => r.name), ['The plan', 'First', 'Second']);
    // A press in the other pane's head moves focus there, and the panel with it.
    await page.click('[data-marxy-head="1"] .marxy-rs-read');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'p95-latency.csv');
    assert.equal((await titles(page, 'outline'))[0], 'Columns');
    await page.click('[data-marxy-head="0"] .marxy-rs-read');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'plan.md');
  });
});

test('Read as reads a file as another kind, which the head says is your choice, and As found puts it back', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await showPanel(page, 'metadata');
    const guess = '[data-marxy-head="0"] .marxy-guess';
    // The plan's kind is guessed from its text, but a Markdown page is read as Markdown: no guess to say.
    assert.equal(await page.isHidden(guess), true);
    await page.click('.marxy-drawer [data-marxy-left-row="ra:another"]');
    await page.click('.marxy-drawer [data-marxy-left-row="ra:code"]');
    await page.waitForFunction((g) => /^code.* · your choice$/.test(document.querySelector(g)?.textContent ?? ''), guess);
    assert.equal(await page.getAttribute(guess, 'data-marxy-mine'), '');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="ra:code"]')?.classList.contains('marxy-l-sel'));
    await page.click('.marxy-drawer [data-marxy-left-row="ra:found"]');
    await page.waitForFunction((g) => document.querySelector(g)?.hidden === true, guess);
    assert.deepEqual((await panelRows(page, 'outline')).map((r) => r.name), ['The plan', 'First', 'Second']);
  });
});
