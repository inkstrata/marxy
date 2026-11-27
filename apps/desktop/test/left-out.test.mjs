// Export and Versions in WebKit: what leaves the reader and the file through time. Builds are
// checked here, outside the page: the zip is read from the bytes written, CRCs and SHA-256 sums are worked out again in
// Node, and a patch is applied with a small applier of the test's own. The memory shell's save dialog answers with what
// the test queues.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { fileText, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PG = '/r/plans/pg16-upgrade-plan.md';
const PLAN = '/r/plans/release-plan.md';
const VEND = '/r/vendor-drop-notes.md';
const CSV = '/r/data/latency.csv';
const PG_TEXT = '# Postgres 14 → 16 upgrade plan\n\nThe plan for [the release](release-plan.md).\n\n## Scope\n\nWhat is in scope.\n\n- One\n- Two\n\n## Rollback\n\nHow to go back.\n';
const PLAN_TEXT = '# Release plan\n\nThe release.\n\n## Steps\n\nFirst, then second.\n';
const FILES = {
  [PG]: PG_TEXT,
  [PLAN]: PLAN_TEXT,
  [VEND]: '# Vendor drop\r\n\r\nNotes from the vendor.\r\nNo final newline',
  [CSV]: 'service,p95_ms\nindexer,120\nwatcher,80\n',
  '/r/blob.bin': '\u0000\u0001\u0002\u00ff\u0000\u0009',
};

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const sha = (b) => createHash('sha256').update(Uint8Array.from(b)).digest('hex');
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const utf8 = (s) => [...new TextEncoder().encode(s)];

/** The entries of a zip, read from its end record and central directory; each local header must agree. */
function unzip(bytes) {
  const b = Uint8Array.from(bytes), dv = new DataView(b.buffer), e = b.length - 22;
  assert.equal(dv.getUint32(e, true), 0x06054b50, 'an end record at the end');
  const n = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true), out = [];
  let o = cdOff;
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(o, true), 0x02014b50, `central header ${i}`);
    const nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), lo = dv.getUint32(o + 42, true), csize = dv.getUint32(o + 20, true);
    const name = new TextDecoder().decode(b.subarray(o + 46, o + 46 + nl));
    assert.equal(dv.getUint32(lo, true), 0x04034b50, `local header of ${name}`);
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name, flags: dv.getUint16(o + 8, true), method: dv.getUint16(o + 10, true), crc: dv.getUint32(o + 16, true), localCrc: dv.getUint32(lo + 14, true), data: [...b.subarray(start, start + csize)] });
    o += 46 + nl + xl + cl;
  }
  assert.equal(o - cdOff, cdSize, 'the central directory is as long as it says');
  return out;
}

/** A unified patch applied to text with LF lines. */
function applyPatch(text, patch) {
  const src = text.split('\n'), pl = patch.split('\n'), out = [];
  let at = 0;
  for (let i = 0; i < pl.length; i++) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(pl[i]);
    if (!m) continue;
    const a0 = +m[1] - (m[2] === '0' ? 0 : 1);
    while (at < a0) out.push(src[at++]);
    for (i++; i < pl.length && !pl[i].startsWith('@@'); i++) {
      const c = pl[i][0], s = pl[i].slice(1);
      if (c === ' ') { assert.equal(src[at], s, `context at line ${at + 1}`); out.push(src[at++]); }
      else if (c === '-') { assert.equal(src[at], s, `removed line ${at + 1}`); at++; }
      else if (c === '+') out.push(s);
    }
    i--;
  }
  while (at < src.length) out.push(src[at++]);
  return out.join('\n');
}

const show = async (page, id, arg) => {
  await page.evaluate(([id, arg]) => window.__marxyHandle.frame().left.show(id, arg ?? undefined, false), [id, arg ?? null]);
  await page.waitForFunction((id) => document.querySelector(`.marxy-drawer .marxy-l-body[data-marxy-left="${id}"]`), id);
};
const subject = (page) => page.textContent('.marxy-drawer .marxy-l-head .marxy-l-subject');
const row = (page, k) =>
  page.evaluate((k) => {
    const el = document.querySelector(`.marxy-drawer .marxy-l-body [data-marxy-left-row="${CSS.escape(k)}"]`);
    return el ? { text: el.textContent, on: !!el.querySelector('.marxy-l-rd.marxy-l-on, .marxy-l-ck.marxy-l-on'), dim: el.classList.contains('marxy-l-dim'), cur: el.classList.contains('marxy-l-cur') } : null;
  }, k);
const secs = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-sec > span')].map((x) => x.textContent));
const click = async (page, k) => {
  await page.click(`.marxy-drawer .marxy-l-body [data-marxy-left-row="${k}"] .marxy-l-nm`);
  await page.waitForTimeout(60);
};
const button = (page, label) =>
  page.evaluate((l) => {
    const b = [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-btns button')].find((x) => x.textContent.trim().startsWith(l));
    if (!b) return null;
    b.click();
    return b.textContent;
  }, label);
/** Ticks `paths` in Places, as Space on their rows does. */
const tick = async (page, ...paths) => {
  await show(page, 'places');
  await page.evaluate((ps) => { const st = window.__marxyHandle.frame().left.stateOf('places'); for (const p of ps) st.sel.add(p); }, paths);
};
const queueSave = (page, path) => page.evaluate((p) => window.__marxyHandle.shell.queueSaveDialog(p), path);
const bytesAt = (page, path) => page.evaluate(async (p) => [...(await window.__marxyHandle.shell.readFile(p))], path);
const written = (page, path) => page.waitForFunction((p) => window.__marxyHandle.shell.calls.some((c) => c.method === 'writeFileAtomic' && c.args[0] === p), path, { timeout: 8000 });
const writesTo = (page, prefix) => page.evaluate((x) => window.__marxyHandle.shell.calls.filter((c) => (c.method === 'writeFileAtomic' || c.method === 'writeFileNew') && String(c.args[0]).startsWith(x)).map((c) => c.args[0]), prefix);
const notices = (page) => page.evaluate(() => [...document.querySelectorAll('.marxy-notice-text')].map((n) => n.textContent));
const cur = (page) => page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-prow.marxy-l-cur')?.dataset.marxyLeftRow ?? null);
/** Gives the panel the keys and moves its cursor with j until it rests on row `k`. */
async function goRow(page, k) {
  await page.evaluate(() => window.__marxyHandle.frame().left.focusPanel());
  await page.waitForFunction(() => document.querySelector('.marxy-drawer').contains(document.activeElement));
  for (let i = 0; i < 40 && (await cur(page)) !== k; i++) await page.keyboard.press('j');
  assert.equal(await cur(page), k, `the cursor reaches ${k}`);
}
const stage = (page, path, edit) =>
  page.evaluate(async ([p, edit]) => {
    const h = window.__marxyHandle;
    const store = h.panes().panes.find((x) => x.path() === p).content.store();
    const snap = store.snapshot();
    const text = new TextDecoder().decode(snap.buffer.bytes);
    const next = edit.kind === 'append' ? text + edit.text : edit.kind === 'insertAfterLine' ? text.split('\n').toSpliced(edit.line, 0, edit.text).join('\n') : text.replace(edit.from, edit.to);
    await store.apply({ range: { file: p, start: 0, end: snap.buffer.bytes.length }, replacement: next, label: 'test', baseVersion: snap.version });
  }, [path, edit]);
const saveNow = async (page) => {
  await page.evaluate(() => window.__marxyHandle.save());
  await page.waitForFunction(() => window.__marxyHandle.document().snapshot().dirty === false);
};

// ---- Export ------------------------------------------------------------------------------------------------------

test('Export defaults to This file and names it in the head', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await show(page, 'export');
    assert.equal(await subject(page), 'pg16-upgrade-plan.md', 'the head says what is exported');
    const f = await row(page, 'w:file');
    assert.ok(f?.on, 'This file is chosen');
    // Grey rows are not the cursor's: nothing there can be chosen.
    const grey = await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-row.marxy-l-dim')].filter((r) => !r.classList.contains('marxy-l-prow')).map((r) => r.textContent));
    assert.ok(grey.includes('The selectionnothing selected'), `the selection is grey, not choosable, with nothing selected: ${grey}`);
    assert.ok(grey.includes('The files ticked in Placesnone ticked'), 'nothing ticked is grey');
    assert.ok(await row(page, 'a:html'), 'one file offers a web page');
    assert.match((await row(page, 'a:raw')).text, /Markdown, as written/, 'Markdown offers itself as written');
  });
});

test('two files ticked in Places: Export defaults to them and to a bundle', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await tick(page, PG, PLAN);
    await show(page, 'export');
    assert.equal(await subject(page), '2 files ticked in Places');
    const tk = await row(page, 'w:ticked');
    assert.ok(tk.on && /^The files ticked in Places2 · /.test(tk.text), `the ticked files are chosen, with count and size: ${tk.text}`);
    assert.ok((await row(page, 'a:zip')).on, 'A bundle is the form chosen');
    const s = await secs(page);
    assert.ok(s.includes('In the bundle') && !s.includes('Set as'), `the bundle shows what goes in it, and no page settings: ${s}`);
  });
});

test('choosing a form shows only its options (keys: j then o)', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await tick(page, PG, PLAN);
    await show(page, 'export');
    await goRow(page, 'a:html1');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="a:html1"] .marxy-l-rd.marxy-l-on'));
    const s = await secs(page);
    assert.ok(s.includes('Set as') && !s.includes('In the bundle'), `a web page shows Set as and not the bundle: ${s}`);
    await click(page, 'a:zip');
    const s2 = await secs(page);
    assert.ok(s2.includes('In the bundle') && !s2.includes('Set as'), `back to the bundle: ${s2}`);
  });
});

test('L-out 03b One web page of two ticked files, one not open: both pages, in order, nothing that loads or runs', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await tick(page, PG, PLAN);
    await show(page, 'export');
    await click(page, 'a:html1');
    await queueSave(page, '/out/plans.html');
    assert.equal(await button(page, 'Save the page'), 'Save the page…');
    await written(page, '/out/plans.html');
    const s = await fileText(page, '/out/plans.html');
    assert.ok(s.indexOf('upgrade plan') > 0 && s.indexOf('upgrade plan') < s.indexOf('Release plan'), 'the pg16 plan, then the release plan');
    assert.match(s, /First, then second\./, 'the file not open is read from disk');
    assert.doesNotMatch(s, /<script|\b(src|srcset)\s*=|data-marxy/i);
  });
});

test('a bundle of the two plans: the files byte for byte, CRCs right, the manifest\'s SHA-256 true', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await tick(page, PG, PLAN);
    await show(page, 'export');
    await queueSave(page, '/out/plans.zip');
    assert.equal(await button(page, 'Build '), 'Build plans.zip', 'the button says what it builds');
    await written(page, '/out/plans.zip');
    const z = unzip(await bytesAt(page, '/out/plans.zip'));
    assert.deepEqual(z.map((e) => e.name), ['plans/pg16-upgrade-plan.md', 'plans/release-plan.md', 'manifest.md'], 'entries');
    for (const e of z) {
      assert.equal(e.method, 0, `${e.name} stored`);
      assert.ok(e.flags & 0x800, `${e.name} has the UTF-8 flag`);
      assert.equal(e.crc, crc32(e.data), `${e.name} CRC-32`);
      assert.equal(e.localCrc, e.crc, `${e.name} local CRC`);
    }
    assert.ok(same(z[0].data, utf8(PG_TEXT)), 'the pg16 plan is byte for byte');
    assert.ok(same(z[1].data, utf8(PLAN_TEXT)), 'the release plan is byte for byte');
    const man = new TextDecoder().decode(Uint8Array.from(z[2].data));
    const line = man.split('\n').find((l) => l.startsWith('| plans/pg16-upgrade-plan.md '));
    assert.ok(line?.includes(sha(utf8(PG_TEXT))) && line.includes(`| ${utf8(PG_TEXT).length} |`), `the manifest gives size and SHA-256 of the pg16 plan: ${line}`);
    assert.ok((await notices(page)).some((t) => t.startsWith('Exported plans.zip to /out')), 'it says where it went');
  });
});

test('with a staged change the bundle holds the file as on disk, and the patch applies to it', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await stage(page, PG, { kind: 'insertAfterLine', line: 8, text: 'A line added and not saved.' });
    await tick(page, PG, PLAN);
    await show(page, 'export');
    assert.ok((await row(page, 'a:zip')).on, 'bundle chosen');
    const pr = await row(page, 'b:patches');
    assert.ok(/1$/.test(pr.text) && !pr.on, `one dirty file; patches off by default: ${pr.text}`);
    await goRow(page, 'b:patches');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="b:patches"] .marxy-l-ck.marxy-l-on'));
    await queueSave(page, '/out/plans.zip');
    await button(page, 'Build ');
    await written(page, '/out/plans.zip');
    const z = unzip(await bytesAt(page, '/out/plans.zip'));
    const f = await page.evaluate((p) => { const s = window.__marxyHandle.document().snapshot(); return { disk: new TextDecoder().decode(s.disk), text: new TextDecoder().decode(s.buffer.bytes), dirty: s.dirty }; }, PG);
    assert.ok(same(z.find((e) => e.name === 'plans/pg16-upgrade-plan.md').data, utf8(f.disk)), 'the pg16 plan in the bundle is what is on disk');
    const pe = z.find((e) => e.name === 'patches/pg16-upgrade-plan.md.patch');
    assert.ok(pe, `a patch is in the bundle: ${z.map((e) => e.name)}`);
    assert.equal(applyPatch(f.disk, new TextDecoder().decode(Uint8Array.from(pe.data))), f.text, 'the patch applied to the disk copy gives the text in the reader');
    const man = new TextDecoder().decode(Uint8Array.from(z.find((e) => e.name === 'manifest.md').data));
    assert.match(man, /1 file has unsaved changes; the bundle holds it as it is on disk/, 'the manifest says what is left out');
    assert.equal(f.dirty, true, 'nothing was saved by exporting');
    assert.equal(await fileText(page, PG), PG_TEXT, 'the file on disk is untouched');
  });
});

test('"Markdown, as written" for the vendor notes is the file byte for byte: CRLF lines, no final newline', async () => {
  await withFrame({ files: FILES, open: [VEND] }, async (page) => {
    await show(page, 'export');
    await click(page, 'a:raw');
    assert.ok((await row(page, 'a:raw')).on, 'chosen');
    await queueSave(page, '/out/vendor-drop-notes.md');
    assert.equal(await button(page, 'Save '), 'Save vendor-drop-notes.md…', 'button');
    await written(page, '/out/vendor-drop-notes.md');
    const b = await bytesAt(page, '/out/vendor-drop-notes.md');
    assert.ok(same(b, utf8(FILES[VEND])), 'byte for byte');
    const s = Buffer.from(b).toString('utf8');
    assert.ok(s.includes('\r\n'), 'keeps its CRLF lines');
    assert.ok(!s.endsWith('\n'), 'still has no final newline');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-btns button')].some((b) => b.textContent === 'Copy instead')), true, 'text offers Copy instead');
  });
});

test('a selection exports exactly its lines', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    const at = Buffer.byteLength(PG_TEXT.slice(0, PG_TEXT.indexOf('## Scope')));
    await page.evaluate((b) => window.__marxyHandle.selection.cursorAt(b), at);
    const r = await page.evaluate(() => { const s = window.__marxyHandle.selection.state().selection; return s.kind === 'section' ? s.range : null; });
    assert.ok(r, 'the cursor on a heading stands for its section');
    const lineAt = (byte) => Buffer.from(PG_TEXT).subarray(0, byte).toString('utf8').split('\n').length;
    const first = lineAt(r.start);
    // The verb bar's address: line breaks at a part's end do not reach the next line.
    let e = r.end;
    while (e > r.start && /[\r\n]/.test(Buffer.from(PG_TEXT).subarray(e - 1, e).toString())) e--;
    const last = lineAt(e - 1);
    await show(page, 'export');
    const s = await row(page, 'w:selection');
    assert.ok(!s.dim && s.text.includes(`Scope, lines ${first} to ${last}`), `the selection row gives its section and lines: ${s.text}`);
    await click(page, 'w:selection');
    assert.equal(await subject(page), `lines ${first} to ${last}`, 'head names the lines');
    assert.ok((await row(page, 'a:raw')).on, 'as written by default');
    await queueSave(page, '/out/part.md');
    assert.equal(await button(page, 'Save '), `Save pg16-upgrade-plan-lines-${first}-${last}.md…`);
    await written(page, '/out/part.md');
    const want = PG_TEXT.match(/[^\n]*\n|[^\n]+$/g).slice(first - 1, last).join('');
    assert.equal(Buffer.from(await bytesAt(page, '/out/part.md')).toString('utf8'), want, 'exactly those lines');
  });
});

test('the web page stands alone: no script, nothing remote, the look applied; Plain drops it', async () => {
  await withFrame({ files: FILES, open: [PLAN] }, async (page) => {
    await show(page, 'export');
    assert.ok((await row(page, 'a:html')).on, 'a web page by default');
    await queueSave(page, '/out/release-plan.html');
    assert.equal(await button(page, 'Save the page'), 'Save the page…', 'button');
    await written(page, '/out/release-plan.html');
    const s = await fileText(page, '/out/release-plan.html');
    assert.match(s, /^<!doctype html>/i, 'a whole page');
    assert.doesNotMatch(s, /<script/i, 'no script element');
    assert.doesNotMatch(s, /\b(src|srcset|poster)\s*=/i, 'nothing loaded by src');
    assert.doesNotMatch(s, /<link\b|@import|url\(/i, 'no link, import or url()');
    assert.match(s, /Release plan/, 'holds the page\'s text');
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marxy-color-bg').trim());
    assert.ok(s.includes(`background: ${bg}`), `the look worn is in the stylesheet (${bg})`);
    await page.click('.marxy-drawer [data-marxy-left-row="s:look"] .marxy-l-sg button:has-text("Plain")');
    await queueSave(page, '/out/plain.html');
    await button(page, 'Save the page');
    await written(page, '/out/plain.html');
    const y = await fileText(page, '/out/plain.html');
    assert.ok(!y.includes(`background: ${bg}`) && y.includes('background: #ffffff'), 'Plain drops the look');
  });
});

test('L-out 08b folded sections go as shown or open, and notes go in the margin when asked', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page, { mod }) => {
    const at = Buffer.byteLength(PG_TEXT.slice(0, PG_TEXT.indexOf('## Scope')));
    await page.evaluate((b) => window.__marxyHandle.selection.cursorAt(b), at);
    await page.keyboard.press('z');
    await page.waitForFunction(() => document.querySelector('.marxy-fold-out'));
    const para = Buffer.byteLength(PG_TEXT.slice(0, PG_TEXT.indexOf('How to go back')));
    await page.evaluate((b) => window.__marxyHandle.selection.cursorAt(b), para);
    await page.keyboard.press('n');
    await page.waitForSelector('.marxy-mnote-field');
    await page.keyboard.type('Check the restore time.');
    await page.keyboard.press(`${mod}+Enter`);
    await page.waitForFunction(() => !document.querySelector('.marxy-mnote-field'));
    await page.evaluate(() => window.__marxyHandle.selection.clear());
    await show(page, 'export');
    await queueSave(page, '/out/a.html');
    await button(page, 'Save the page');
    await written(page, '/out/a.html');
    const shown = await fileText(page, '/out/a.html');
    assert.match(shown, /Folded: \d+ parts? not shown\./, 'as shown: the folded parts are left out and said');
    assert.doesNotMatch(shown, /What is in scope/);
    await page.click('.marxy-drawer [data-marxy-left-row="s:folds"] .marxy-l-sg button:has-text("open")');
    await queueSave(page, '/out/b.html');
    await button(page, 'Save the page');
    await written(page, '/out/b.html');
    const open = await fileText(page, '/out/b.html');
    assert.match(open, /What is in scope/, 'open: the folded section is in');
    assert.doesNotMatch(open, /<aside>/, 'no notes unless asked');
    await page.click('.marxy-drawer [data-marxy-left-row="s:notes"] .marxy-l-tog');
    await queueSave(page, '/out/c.html');
    await button(page, 'Save the page');
    await written(page, '/out/c.html');
    assert.match(await fileText(page, '/out/c.html'), /How to go back\.[\s\S]*<aside>Check the restore time\.<\/aside>/, 'the note after the part it is on');
  });
});

test('Peek opens the manifest beside and builds nothing', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await stage(page, PG, { kind: 'append', text: 'more\n' });
    await tick(page, PG, PLAN);
    await show(page, 'export');
    await button(page, 'Peek the manifest');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.some((p) => /^# plans\.zip/.test(new TextDecoder().decode(p.content.store()?.snapshot().buffer.bytes ?? new Uint8Array()))), null, { timeout: 8000 });
    const s = await page.evaluate(() => {
      const p = window.__marxyHandle.panes().panes.find((x) => /^# plans\.zip/.test(new TextDecoder().decode(x.content.store()?.snapshot().buffer.bytes ?? new Uint8Array())));
      const snap = p.content.store().snapshot();
      return { text: new TextDecoder().decode(snap.buffer.bytes), dirty: snap.dirty, focused: window.__marxyHandle.panes().focused.path(), dialogs: window.__marxyHandle.shell.calls.filter((c) => c.method === 'saveDialog').length };
    });
    assert.equal(s.dialogs, 0, 'nothing built: no save dialog');
    assert.equal(s.focused, '/r/plans/pg16-upgrade-plan.md', 'the page stays on the plan; the peek is beside');
    assert.deepEqual((await writesTo(page, '/r/')).concat(await writesTo(page, '/out/')), [], 'nothing written');
    assert.match(s.text, /1 file has unsaved changes; the bundle holds it as it is on disk/, 'the peek says what is left out');
    assert.match(s.text, /\| plans\/pg16-upgrade-plan\.md \| \d+ \| [0-9a-f]{64} \|/, 'the peek lists path, size and checksum');
    assert.match(s.text, /A peek: nothing is built or written/);
  });
});

test('a table offers JSON Lines: one record a line, keys from the header', async () => {
  await withFrame({ files: FILES, open: [CSV] }, async (page) => {
    await show(page, 'export');
    assert.ok(await row(page, 'a:jsonl'), 'JSON Lines offered');
    await goRow(page, 'a:jsonl');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="a:jsonl"] .marxy-l-rd.marxy-l-on'));
    assert.equal((await secs(page)).includes('Set as'), false, 'no options for JSON Lines');
    await queueSave(page, '/out/latency.jsonl');
    assert.equal(await button(page, 'Save '), 'Save latency.jsonl…', 'name');
    await written(page, '/out/latency.jsonl');
    const recs = (await fileText(page, '/out/latency.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(recs.length, 2, 'one record a row');
    assert.deepEqual(Object.keys(recs[0]), ['service', 'p95_ms'], 'keys from the header');
    assert.deepEqual(recs[1], { service: 'watcher', p95_ms: '80' });
  });
});

test('app pages, the tray and bytes: plain sentences, nothing thrown', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    const at = Buffer.byteLength(PG_TEXT.slice(0, PG_TEXT.indexOf('What is in scope')));
    await page.evaluate((b) => window.__marxyHandle.selection.cursorAt(b), at);
    await page.keyboard.press('y');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /^Collected/.test(n.textContent)));
    await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'tray.open').run({}));
    await page.waitForSelector('.marxy-apppage[aria-label="Tray"]');
    await show(page, 'export');
    assert.equal(await subject(page), '1 piece in the tray', 'the tray is what is exported');
    assert.ok((await row(page, 'a:trmd')).on, 'as Markdown');
    assert.ok(await row(page, 'a:brief'), 'or a brief for an agent');
    await queueSave(page, '/out/tray.md');
    await button(page, 'Save ');
    await written(page, '/out/tray.md');
    assert.match(await fileText(page, '/out/tray.md'), /What is in scope\.[\s\S]*pg16-upgrade-plan\.md:7`/, 'the tray as Markdown, each piece with its source');
    await page.click('.marxy-apppage-bar button');
    await page.evaluate(() => window.__marxyHandle.open('/r/blob.bin'));
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/blob.bin');
    await show(page, 'export');
    assert.ok((await row(page, 'a:raw')) && !(await row(page, 'a:text')), 'bytes: as stored, and no plain text');
    await show(page, 'versions');
    await page.waitForFunction(() => /None yet\./.test(document.querySelector('.marxy-drawer .marxy-l-body').textContent));
  });
});

test('File › Export… opens the Export panel on the file in front; the panel owns the keys and Escape gives them back', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'document.export').run({}));
    await page.waitForFunction(() => document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left="export"]') && document.querySelector('.marxy-drawer').contains(document.activeElement));
    assert.ok((await row(page, 'w:file')).on);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.marxy-drawer').contains(document.activeElement));
    assert.deepEqual(await writesTo(page, '/r/'), [], 'looking writes nothing');
  });
});

// ---- Versions ----------------------------------------------------------------------------------------------------

test('Versions: after an edit and a save, Now says nothing unsaved and a copy "before your save" is listed', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await show(page, 'versions');
    assert.equal(await subject(page), 'pg16-upgrade-plan.md', 'head');
    await page.waitForFunction(() => /None yet\./.test(document.querySelector('.marxy-drawer .marxy-l-body').textContent), null, { timeout: 8000 });
    assert.deepEqual(await secs(page), ['Now', 'Earlier copies', 'Backup'], 'sections in order');
    await stage(page, PG, { kind: 'replace', from: 'Postgres 14 → 16 upgrade plan', to: 'Postgres 14 to 16 upgrade plan' });
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="now"]'));
    const n = await row(page, 'now');
    assert.ok(/1 place not yet saved/.test(n.text) && /\+1 −1/.test(n.text), `Now says what is not yet saved: ${n.text}`);
    await saveNow(page);
    await page.waitForFunction(() => /before your save/.test(document.querySelector('.marxy-drawer .marxy-l-body').textContent), null, { timeout: 8000 });
    const body = await page.textContent('.marxy-drawer .marxy-l-body');
    assert.ok(body.includes('Nothing unsaved.'), 'Now says nothing unsaved');
    assert.equal(await row(page, 'now'), null, 'the unsaved row is gone');
    const copy = await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="c:"]')].map((r) => r.textContent));
    assert.equal(copy.length, 1);
    assert.match(copy[0], /^Today, \d\d:\d\d · \d+ bytesbefore your save$/, copy[0]);
  });
});

test('no copy is made by opening, by showing Versions, or by any press in it but Save', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await show(page, 'versions');
    await page.waitForFunction(() => /None yet\./.test(document.querySelector('.marxy-drawer .marxy-l-body').textContent), null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.marxy-drawer .marxy-l-head .marxy-l-hb').length), 0, 'no button that keeps a copy now');
    assert.deepEqual(await writesTo(page, '/data/versions-'), [], 'nothing in the data folder');
  });
});

test('Enter on a copy, then Restore, stages its bytes and writes nothing', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await stage(page, PG, { kind: 'append', text: 'An added line.\n' });
    await saveNow(page);
    await show(page, 'versions');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row^="c:"]'), null, { timeout: 8000 });
    const k = await page.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-left-row^="c:"]').dataset.marxyLeftRow);
    await goRow(page, k);
    // The document's own writes: Marxy's state files (layout.json, frame.json) are written on their own timers meanwhile.
    const before = await page.evaluate((p) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length, PG);
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="menu"]');
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((x) => x.textContent));
    assert.ok(items.some((t) => t.startsWith('Restore')) && items.some((t) => t.startsWith('Compare')), `Enter lists the verbs: ${items}`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) === t, PG_TEXT, { timeout: 8000 });
    const after = await page.evaluate((p) => ({ dirty: window.__marxyHandle.document().snapshot().dirty, writes: window.__marxyHandle.shell.calls.filter((c) => c.method === 'writeFileAtomic' && c.args[0] === p).length }), PG);
    assert.equal(after.dirty, true, 'staged, not saved');
    assert.equal(after.writes, before, 'nothing written');
    assert.equal(await fileText(page, PG), `${PG_TEXT}An added line.\n`, 'the file on disk is as saved');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /staged over the file/.test(n.textContent)));
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row="now"]'));
  });
});

test('M keeps a copy for good, and the copies limit never removes it', async () => {
  await withFrame({ files: FILES, open: [PG], config: 'version_copies = "5"\n' }, async (page) => {
    await stage(page, PG, { kind: 'append', text: 'v1\n' });
    await saveNow(page);
    await show(page, 'versions');
    await page.waitForFunction(() => document.querySelector('.marxy-drawer [data-marxy-left-row^="c:"]'), null, { timeout: 8000 });
    const k = await page.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-left-row^="c:"]').dataset.marxyLeftRow);
    await goRow(page, k);
    await page.keyboard.press('m');
    await page.waitForFunction((k) => /^◆/.test(document.querySelector(`.marxy-drawer [data-marxy-left-row="${k}"]`)?.textContent ?? '') && /kept for good/.test(document.querySelector(`.marxy-drawer [data-marxy-left-row="${k}"]`).textContent), k);
    for (let i = 2; i <= 8; i++) {
      await stage(page, PG, { kind: 'append', text: `v${i}\n` });
      await saveNow(page);
    }
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="c:"]').length === 5, null, { timeout: 8000 });
    assert.ok(await row(page, k), 'the kept copy is still listed');
    assert.equal(await page.textContent('.marxy-drawer [data-marxy-left-row="b:copies"] .marxy-l-sg .marxy-l-on'), '5', 'the setting shows 5');
  });
});

test('no row in Versions says how a copy differs; only Now carries a +n −n', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await stage(page, PG, { kind: 'append', text: 'one\n' });
    await saveNow(page);
    await stage(page, PG, { kind: 'append', text: 'two\n' });
    await saveNow(page);
    await stage(page, PG, { kind: 'append', text: 'x\n' });
    await show(page, 'versions');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="c:"]').length === 2 && document.querySelector('.marxy-drawer [data-marxy-left-row="now"]'), null, { timeout: 8000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-row, .marxy-drawer .marxy-l-body .marxy-l-kv')].map((r) => ({ k: r.dataset.marxyLeftRow ?? '', t: r.textContent })));
    const counted = rows.filter((r) => /[+−-]\d+\s*[−-]\d+|\d+ (lines? )?(changed|differ)/.test(r.t)).map((r) => r.k);
    assert.deepEqual(counted, ['now'], 'only the Now row has a count');
  });
});

test('Export all as a zip holds one entry per copy, each its bytes', async () => {
  await withFrame({ files: FILES, open: [PG, VEND] }, async (page) => {
    await stage(page, PG, { kind: 'append', text: 'end\n' });
    await saveNow(page);
    await page.evaluate((v) => window.__marxyHandle.panes().focus(window.__marxyHandle.panes().panes.find((p) => p.path() === v)), VEND);
    await stage(page, VEND, { kind: 'append', text: 'end\n' });
    await saveNow(page);
    await show(page, 'versions');
    await page.waitForFunction(() => /2 copies of 2 files/.test(document.querySelector('.marxy-drawer [data-marxy-left-row="b:all"]')?.textContent ?? ''), null, { timeout: 8000 });
    await queueSave(page, '/out/copies.zip');
    await button(page, 'Export all as a zip');
    await written(page, '/out/copies.zip');
    const z = unzip(await bytesAt(page, '/out/copies.zip'));
    assert.equal(z.length, 2, 'one entry per copy');
    assert.ok(z.some((e) => e.name.startsWith('r/plans/pg16-upgrade-plan.md/') && same(e.data, utf8(PG_TEXT))), 'the pg16 plan as it was before the save');
    assert.ok(z.some((e) => e.name.startsWith('r/vendor-drop-notes.md/') && same(e.data, utf8(FILES[VEND]))), 'the vendor notes, CRLF and all');
    assert.ok(z.every((e) => /^.+\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d(?: \(\d+\))?\.[a-z]+$/.test(e.name) && e.crc === crc32(e.data)), `names are path/timestamp.ext and CRCs hold: ${z.map((e) => e.name)}`);
  });
});

test('Backup: the copies setting writes config.toml; Clear older than… clears all but a copy kept for good', async () => {
  await withFrame({ files: FILES, open: [PG] }, async (page) => {
    await stage(page, PG, { kind: 'append', text: 'a\n' });
    await saveNow(page);
    await stage(page, PG, { kind: 'append', text: 'b\n' });
    await saveNow(page);
    await show(page, 'versions');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="c:"]').length === 2, null, { timeout: 8000 });
    await page.click('.marxy-drawer [data-marxy-left-row="b:copies"] .marxy-l-sg button:has-text("100")');
    await page.waitForFunction(async () => /version_copies = "100"/.test(new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/config'))));
    const k = await page.evaluate(() => document.querySelector('.marxy-drawer [data-marxy-left-row^="c:"]').dataset.marxyLeftRow);
    await goRow(page, k);
    await page.keyboard.press('m');
    await page.waitForFunction((k) => /kept for good/.test(document.querySelector(`.marxy-drawer [data-marxy-left-row="${k}"]`)?.textContent ?? ''), k);
    await button(page, 'Clear older than');
    await page.waitForSelector('[role="menu"]');
    await page.click('[role="menu"] [role="menuitem"]:has-text("Every copy not kept for good")');
    await page.waitForFunction(() => document.querySelectorAll('.marxy-drawer [data-marxy-left-row^="c:"]').length === 1, null, { timeout: 8000 });
    assert.ok(await row(page, k), 'the copy kept for good stays');
    assert.equal(await fileText(page, PG), `${PG_TEXT}a\nb\n`, 'the file is untouched');
  });
});
