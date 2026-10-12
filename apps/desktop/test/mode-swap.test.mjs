import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1' ? 'no webkit' : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
let harnessPromise;
let closeHarness = () => {};
async function harnessBase() {
  harnessPromise ??= (async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'marxy-mode-swap-'));
    await build({ root: join(repoRoot, 'apps', 'desktop'), logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.css': 'text/css' };
    const server = createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
      if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
      res.end(readFileSync(path));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeHarness = () => server.close();
    return `http://127.0.0.1:${server.address().port}/`;
  })();
  return harnessPromise;
}
after(() => closeHarness());
const b64 = (s) => Buffer.from(s).toString('base64');
async function boot(page, files, argv) {
  await page.goto(`${await harnessBase()}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  await page.evaluate(async ({ files, argv }) => {
    const handle = await window.marxyApp.start(files, argv);
    await handle.ready;
    window.__marxyHandle = handle;
  }, { files, argv });
}

const VIEWPORT = { width: 960, height: 800 };
const READING_LINE = Math.round(VIEWPORT.height * 0.4);
const NL = (text, eol) => text.replaceAll('\n', eol);

/** 160 paragraphs of six hand-wrapped lines each. */
const wrappedMd = `# Wrapped\n\n${Array.from({ length: 160 }, (_, p) =>
  Array.from({ length: 6 }, (_, l) => `P${String(p).padStart(3, '0')} line ${l} of a paragraph wrapped by hand in its source, as many are.`).join('\n'),
).join('\n\n')}\n`;
const shortMd = '# Short\n\nA short document to read.\n\nA second paragraph.\n';
/** `inventory.py`: one 120-line paragraph's worth of code with comment lines that Markdown would call headings. */
const inventoryPy = `${Array.from({ length: 120 }, (_, i) => (i % 10 === 0 ? `# section ${i}` : `value_${String(i).padStart(3, '0')} = ${i}`)).join('\n')}\n`;
const smallPy = '# a comment\nvalue = 1\nother = 2\n';

const settle = (page) => page.evaluate(async () => {
  let last = -1;
  let still = 0;
  while (still < 10) {
    await new Promise((r) => setTimeout(r, 100));
    const h = document.documentElement.scrollHeight;
    if (h === last) still++;
    else { still = 0; last = h; }
  }
});
const mode = (page) => page.evaluate(() => document.body.dataset.marxyMode);
const drained = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.view.serially(async () => {}));
async function toSource(page) {
  await page.keyboard.press(`${modKey}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'source' && document.querySelector('#marxy-source .cm-editor'));
  await drained(page);
}
async function toRendered(page) {
  await page.keyboard.press(`${modKey}+e`);
  await page.waitForFunction(() => document.body.dataset.marxyMode === 'rendered');
  await drained(page);
}
const docText = (page) => page.evaluate(() => document.getElementById('doc').textContent);
const editorText = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.view.sourceText?.() ?? [...document.querySelectorAll('#marxy-source .cm-line')].map((l) => l.textContent).join('\n'));
const bufferBytes = (page) => page.evaluate(() => [...window.__marxyHandle.document().snapshot().buffer.bytes]);
const isDirty = (page) => page.evaluate(() => window.__marxyHandle.document().snapshot().dirty);
const renderedAtReadingLine = (page) => page.evaluate((y) => {
  const block = [...document.getElementById('doc').children].find((el) => {
    const r = el.getBoundingClientRect();
    return r.top <= y + 2 && r.bottom > y;
  });
  return block ? { s: Number(block.getAttribute('data-marxy-s')), text: block.textContent.slice(0, 40), top: block.getBoundingClientRect().top } : null;
}, READING_LINE);
const sourceAtReadingLine = (page) => page.evaluate((y) => {
  const line = [...document.querySelectorAll('#marxy-source .cm-line')].find((el) => {
    const r = el.getBoundingClientRect();
    return r.top <= y + 2 && r.bottom > y;
  });
  return line?.textContent ?? null;
}, READING_LINE);
async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await fn(page, browser);
  } finally {
    await browser.close();
  }
}
/** Clicks into Source's text at the end of its first line, and types `text` there. */
async function typeAtStart(page, text) {
  await page.click('#marxy-source .cm-content');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

// V-15 acceptance, as the card words it.

test('an edit in Source, a scroll far away and Mod+E: the block under the reading line stays, and the page is typeset', async () => {
  await withPage(async (page) => {
    await boot(page, { '/d/wrapped.md': b64(wrappedMd) }, ['/d/wrapped.md']);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await settle(page);
    await toSource(page);
    await page.waitForTimeout(300);
    await typeAtStart(page, ' E');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.8));
    await page.waitForTimeout(300);
    const inSource = await sourceAtReadingLine(page);
    await toRendered(page);
    const first = await renderedAtReadingLine(page);
    assert.ok(first?.text?.startsWith(inSource.slice(0, 4)), `Rendered is at ${first?.text}, Source was at ${inSource}`);
    await page.waitForTimeout(1000);
    const later = await renderedAtReadingLine(page);
    assert.equal(later?.s, first.s, 'the same block one second later');
    assert.ok(Math.abs(later.top - first.top) <= 1, `moved ${later.top - first.top}px`);
    const unset = await page.evaluate(() => [...document.querySelectorAll('#doc > p')].filter((p) => !p.classList.contains('marxy-set')).length);
    assert.equal(unset, 0, `${unset} paragraphs are not typeset`);
    assert.ok((await docText(page)).includes(' E'), 'the edit is on the page');
  });
});

test('a file written externally with CRLF while Source shows is not dirty after leaving Source', async () => {
  await withPage(async (page) => {
    await boot(page, { '/d/short.md': b64(shortMd) }, ['/d/short.md']);
    await toSource(page);
    await page.evaluate(async (crlf) => {
      const shell = window.__marxyHandle.shell;
      await shell.writeFileAtomic('/d/short.md', new TextEncoder().encode(crlf));
      shell.emit([{ kind: 'modified', path: '/d/short.md' }]);
    }, NL(shortMd, '\r\n'));
    await page.waitForFunction(() => window.__marxyHandle.document().snapshot().buffer.eol === 'crlf');
    await page.waitForTimeout(300);
    await toRendered(page);
    assert.equal(await isDirty(page), false, 'leaving Source after a reload from disk changed nothing');
    assert.deepEqual(await bufferBytes(page), [...Buffer.from(NL(shortMd, '\r\n'))]);
  });
});

test('opening another .md from Source never shows an empty overlay, and lands at its stored place', async () => {
  await withPage(async (page, browser) => {
    const path = '/d/wrapped.md';
    await boot(page, { [path]: b64(wrappedMd) }, [path]);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await settle(page);
    const stored = await renderedAtReadingLine(page);
    await page.evaluate(() => window.__marxyHandle.shell.quit(0));
    const positions = await page.evaluate(async () => [...await window.__marxyHandle.shell.readFile('/data/positions.json')]);
    const again = await browser.newPage({ viewport: VIEWPORT });
    await boot(again, { '/d/short.md': b64(shortMd), [path]: b64(wrappedMd), '/data/positions.json': Buffer.from(positions).toString('base64') }, ['/d/short.md']);
    await toSource(again);
    await again.evaluate(() => {
      window.__empty = 0;
      window.__sampling = true;
      const sample = () => {
        const host = document.getElementById('marxy-source');
        if (host && !host.hidden && host.getClientRects().length > 0 && !host.querySelector('.cm-line')) window.__empty += 1;
        if (window.__sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    // The marks of an open are IPC in the app: slowed, the frames between the editor going and the page showing are many.
    await again.evaluate(() => {
      const shell = window.__marxyHandle.shell;
      const mark = shell.mark.bind(shell);
      shell.mark = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return mark(...args);
      };
    });
    await again.evaluate((p) => window.__marxyHandle.open(p), path);
    await settle(again);
    await again.evaluate(() => { window.__sampling = false; });
    assert.equal(await again.evaluate(() => window.__empty), 0, 'a frame showed Source with no text in it');
    const landed = await renderedAtReadingLine(again);
    assert.ok(landed && Math.abs(landed.s - stored.s) <= 0, `landed on byte ${landed?.s}, stored ${stored.s}`);
  });
});

test('Show source and then an immediate open of another file: the next Mod+E commits nothing into the new store', async () => {
  await withPage(async (page) => {
    const OTHER = '# Other\n\nOther text.\n';
    await boot(page, { '/d/short.md': b64(shortMd), '/d/other.md': b64(OTHER) }, ['/d/short.md']);
    // Source's code has not loaded in this page: hold it, so Show source is still on its way when the open comes.
    const gate = { promise: null, release: () => {}, hits: 0 };
    gate.promise = new Promise((resolve) => { gate.release = resolve; });
    // Only the module that builds the editor: an open needs the other chunks.
    await page.route('**/assets/editor-cm6-*.js', async (route) => {
      gate.hits += 1;
      await gate.promise;
      return route.continue();
    });
    await page.evaluate(() => {
      window.__jump = window.__marxyHandle.jumpToSource(0);
    });
    for (let i = 0; i < 200 && gate.hits === 0; i++) await page.waitForTimeout(10);
    assert.ok(gate.hits > 0, 'Source was on its way');
    await page.evaluate(() => {
      window.__open = window.__marxyHandle.open('/d/other.md');
    });
    await page.waitForTimeout(200);
    gate.release();
    await page.evaluate(() => Promise.all([window.__jump, window.__open]));
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__commits = [];
      const store = window.__marxyHandle.document();
      const commit = store.commitSource.bind(store);
      store.commitSource = (...args) => { window.__commits.push(String(args[0]).slice(0, 20)); return commit(...args); };
    });
    assert.equal(await page.evaluate(() => window.__marxyHandle.currentPath()), '/d/other.md');
    // Whatever mode the open ended in, the editor on the page is the new document's, never the closed one's.
    const landedIn = await mode(page);
    const shows = async () => (await mode(page)) === 'source' ? await editorText(page) : await docText(page);
    const showsOther = async () => (await mode(page)) === 'source' ? (await editorText(page)) === OTHER : (await docText(page)).includes('Other text');
    assert.ok(await showsOther(), `${landedIn} shows ${JSON.stringify((await shows()).slice(0, 40))}, not the other document`);
    await page.keyboard.press(`${modKey}+e`);
    await drained(page);
    await page.waitForTimeout(300);
    assert.notEqual(await mode(page), landedIn);
    assert.ok(await showsOther(), 'the other mode shows the closed document');
    await page.keyboard.press(`${modKey}+e`);
    await drained(page);
    await page.waitForTimeout(300);
    assert.equal(await mode(page), landedIn);
    assert.deepEqual(await page.evaluate(() => window.__commits.filter((c) => c !== '# Other\n\nOther text.')), [], 'the closed document was folded into the new store');
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().snapshot().canUndo), false, 'nothing was committed');
    assert.equal(await isDirty(page), false);
    assert.deepEqual(await bufferBytes(page), [...Buffer.from(OTHER)]);
    assert.ok(await showsOther(), 'the document shown at the end is the other one');
  });
});

const readingByte = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.view.sourcePosition()?.byteOffset ?? null);
const lineAt = (bytes, offset) => bytes.toString('utf8', offset, bytes.indexOf(0x0a, offset));

for (const [name, path, text] of [['inventory.py', '/d/inventory.py', inventoryPy], ['a hard-wrapped .md', '/d/wrapped.md', wrappedMd]]) {
  test(`Source, Rendered, Source on ${name} keeps the line on the reading line`, async () => {
    await withPage(async (page) => {
      await boot(page, { [path]: b64(text) }, [path]);
      await page.waitForFunction(() => document.querySelector('#marxy-source .cm-line') || document.querySelector('#doc [data-marxy-s]'));
      if (await mode(page) !== 'source') await toSource(page);
      await page.waitForTimeout(300);
      const lineH = await page.evaluate(() => document.querySelector('#marxy-source .cm-line').getBoundingClientRect().height);
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(45 * lineH - READING_LINE + lineH / 2));
      await page.waitForTimeout(400);
      const before = await readingByte(page);
      const bytes = Buffer.from(text);
      assert.match(lineAt(bytes, before), /^(value_04\d|P0\d\d line \d)/, lineAt(bytes, before));
      await toRendered(page);
      await settle(page);
      await toSource(page);
      await page.waitForTimeout(400);
      const after = await readingByte(page);
      assert.equal(lineAt(bytes, after), lineAt(bytes, before), `byte ${before} became ${after}`);
    });
  });
}

// Data safety: what is typed in Source is in Rendered, and not a byte moves that was not asked to.

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const withEol = (text, eol) => Buffer.from(NL(text, eol));
const MD_BODY = '# A title\n\nA paragraph of words.\n\n- one\n- two\n';
const PY_BODY = '# a comment that Markdown calls a heading\nvalue = 1\n\ndef main():\n    return value\n';
const VARIANTS = [
  ['LF', (body) => withEol(body, '\n')],
  ['CRLF', (body) => withEol(body, '\r\n')],
  ['BOM', (body) => Buffer.concat([BOM, withEol(body, '\n')])],
  ['BOM and CRLF', (body) => Buffer.concat([BOM, withEol(body, '\r\n')])],
  ['stray bytes', (body) => Buffer.concat([Buffer.from(body.split('\n')[0] + '\n'), Buffer.from('a stray '), Buffer.from([0xff, 0xfe]), Buffer.from(' pair\n'), Buffer.from(body.split('\n').slice(1).join('\n'))])],
];
/** `bytes` with `text` put at the end of its first line, before the line ending. */
function withTyped(bytes, text) {
  let at = bytes.indexOf(0x0a);
  if (at > 0 && bytes[at - 1] === 0x0d) at -= 1;
  return Buffer.concat([bytes.subarray(0, at), Buffer.from(text), bytes.subarray(at)]);
}

for (const [ext, body] of [['md', MD_BODY], ['py', PY_BODY]]) {
  for (const [label, make] of VARIANTS) {
    test(`an edit in Source shows in Rendered, and every other byte stays: .${ext} with ${label}`, async () => {
      await withPage(async (page) => {
        const path = `/d/file.${ext}`;
        const original = make(body);
        await boot(page, { [path]: original.toString('base64') }, [path]);
        if (await mode(page) !== 'source') await toSource(page);
        await page.waitForSelector('#marxy-source .cm-line');
        // Read before anything is typed: a code file's Markdown parse waits for the first ask for Rendered (V-11.1).
        const deferred = ext === 'py' ? await page.evaluate(() => window.__marxyHandle.document().parsed()) === false : null;
        if (ext === 'py') assert.equal(deferred, true, 'the parse of a code file is still deferred');
        // No edit: there and back, the same bytes and nothing to save.
        await toRendered(page);
        assert.deepEqual(await bufferBytes(page), [...original]);
        assert.equal(await isDirty(page), false);
        await toSource(page);
        await typeAtStart(page, 'ZZ');
        await toRendered(page);
        const edited = withTyped(original, 'ZZ');
        assert.ok((await docText(page)).includes('ZZ'), 'Rendered shows the edit');
        assert.deepEqual(await bufferBytes(page), [...edited]);
        assert.equal(await isDirty(page), true);
        await toSource(page);
        assert.ok((await editorText(page)).includes('ZZ'));
        assert.deepEqual(await bufferBytes(page), [...edited]);
      });
    });
  }
}

test('a .py edited in Source and left at once, before its Markdown parse was ever made, shows the edit in Rendered', async () => {
  await withPage(async (page) => {
    const original = Buffer.from(PY_BODY);
    await boot(page, { '/d/file.py': original.toString('base64') }, ['/d/file.py']);
    await page.waitForSelector('#marxy-source .cm-line');
    assert.equal(await page.evaluate(() => window.__marxyHandle.document().parsed()), false);
    await typeAtStart(page, 'ZZ');
    // No wait between the key and the switch, and none between the switches: three presses end in Rendered.
    await page.keyboard.press(`${modKey}+e`);
    await page.keyboard.press(`${modKey}+e`);
    await page.keyboard.press(`${modKey}+e`);
    await drained(page);
    await page.waitForTimeout(300);
    assert.equal(await mode(page), 'rendered');
    assert.ok((await docText(page)).includes('ZZ'), 'Rendered shows the edit');
    assert.deepEqual(await bufferBytes(page), [...withTyped(original, 'ZZ')]);
  });
});

test('Rendered after an edit is current whichever way Source was left: Read, Mod+1 and Jump to source back', async () => {
  await withPage(async (page) => {
    const original = Buffer.from(MD_BODY);
    await boot(page, { '/d/file.md': original.toString('base64') }, ['/d/file.md']);
    await toSource(page);
    await typeAtStart(page, 'ZZ');
    await page.keyboard.press(`${modKey}+1`);
    await drained(page);
    assert.equal(await mode(page), 'rendered');
    assert.ok((await docText(page)).includes('ZZ'));
    await page.evaluate(() => window.__marxyHandle.jumpToSource(0));
    await page.waitForFunction(() => document.body.dataset.marxyMode === 'source');
    await page.keyboard.type('YY');
    await page.keyboard.press(`${modKey}+1`);
    await drained(page);
    assert.ok((await docText(page)).includes('YY'));
    assert.deepEqual((await bufferBytes(page)).length, withTyped(original, 'ZZ').length + 2);
  });
});

// Nothing is set while hidden.

/**
 * What a cause does while Source shows (`cause`, run with the page in Source): the hidden article is left alone (no
 * mutation, no repaint), and the first frame Rendered is visible again shows a page set after the cause, not the old
 * one. Each cause is its own test, so that one `pageStale = true` removed fails its own and no other cause covers it.
 */
async function staleCase({ files, path, cause, setup, wanted, typeset = true }) {
  await withPage(async (page) => {
    await boot(page, files, [path]);
    await settle(page);
    // Every element of the page Rendered holds before Source: a page set again has none of these marks.
    await page.evaluate(() => { for (const el of document.querySelectorAll('#doc *')) el.__old = true; });
    await toSource(page);
    await page.waitForTimeout(300);
    await setup?.(page);
    await page.evaluate(() => {
      const article = document.getElementById('doc');
      window.__mutations = 0;
      window.__repaints = performance.getEntriesByName('marxy:repaint').length;
      window.__observer = new MutationObserver((records) => { window.__mutations += records.length; });
      window.__observer.observe(article, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await cause(page);
    await page.waitForTimeout(300);
    const quiet = await page.evaluate(() => ({
      mutations: window.__mutations + window.__observer.takeRecords().length,
      repaints: performance.getEntriesByName('marxy:repaint').length - window.__repaints,
    }));
    assert.deepEqual(quiet, { mutations: 0, repaints: 0 }, 'the hidden article was set while Source showed');
    // The first moment the article is visible again.
    await page.evaluate(() => {
      const article = document.getElementById('doc');
      window.__first = null;
      window.__observer.disconnect();
      new MutationObserver(() => {
        if (article.hidden || window.__first) return;
        const ps = [...article.querySelectorAll(':scope > p')];
        window.__first = {
          text: article.textContent,
          details: article.querySelector('details') !== null,
          old: [...article.querySelectorAll('*')].some((el) => el.__old === true),
          fontSize: ps[0] ? getComputedStyle(ps[0]).fontSize : null,
        };
      }).observe(article, { attributes: true, attributeFilter: ['hidden'] });
    });
    await toRendered(page);
    await settle(page);
    const first = await page.evaluate(() => window.__first);
    assert.ok(first, 'Rendered was never visible');
    assert.equal(first.old, false, 'Rendered came back showing the page it had before the cause');
    wanted(first);
    if (typeset) {
      const unset = await page.evaluate(() => [...document.querySelectorAll('#doc > p')].filter((p) => !p.classList.contains('marxy-set')).length);
      assert.equal(unset, 0, `${unset} paragraphs are not typeset`);
    }
    assert.equal(await isDirty(page), false);
  });
}

test('while Source shows, a reload from disk leaves the hidden page alone, and Rendered is the file as it now is when it comes back', async () => {
  await staleCase({
    files: { '/d/wrapped.md': b64(wrappedMd) },
    path: '/d/wrapped.md',
    cause: async (page) => {
      await page.evaluate(async (text) => {
        const shell = window.__marxyHandle.shell;
        await shell.writeFileAtomic('/d/wrapped.md', new TextEncoder().encode(text));
        shell.emit([{ kind: 'modified', path: '/d/wrapped.md' }]);
      }, wrappedMd.replace('# Wrapped', '# Wrapped by disk'));
      await page.waitForFunction(() => document.querySelector('#marxy-source .cm-content').textContent.includes('by disk'));
    },
    wanted: (first) => assert.ok(first.text.includes('Wrapped by disk'), 'the first frame of Rendered is not the file as it now is'),
  });
});

test('while Source shows, a theme relayout leaves the hidden page alone, and Rendered is set to the theme when it comes back', async () => {
  await staleCase({
    files: { '/d/wrapped.md': b64(wrappedMd) },
    path: '/d/wrapped.md',
    setup: async (page) => {
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.id = 'zz-test-theme';
        document.head.append(style);
      });
    },
    cause: async (page) => {
      await page.evaluate(async () => {
        document.getElementById('zz-test-theme').textContent = '#doc > p { font-size: 23px !important; }';
        await window.__marxyHandle.panes().focused.view.relayoutForTheme();
      });
    },
    wanted: (first) => assert.equal(first.fontSize, '23px', 'the first frame of Rendered is not set to the theme'),
  });
});

test('while Source shows, a trust change leaves the hidden page alone, and Rendered shows the new trust when it comes back', async () => {
  const html = '# HTML\n\nLead paragraph.\n\n<details><summary>HTMLMARK summary</summary>\n\nHTMLMARK body words.\n\n</details>\n\nAfter paragraph.\n';
  const trust = JSON.stringify({ version: 1, documents: { '/d/h.md': { html: true, at: 1 } } });
  await staleCase({
    files: { '/d/h.md': b64(html), '/data/trust.json': b64(trust) },
    path: '/d/h.md',
    typeset: false,
    cause: async (page) => {
      await page.evaluate(() => window.__marxyHandle.commands().find((c) => c.id === 'trust.revoke-html').run({ shell: window.__marxyHandle.shell, selection: { kind: 'none' }, operationInput: () => null, closePalette: () => {}, showNotice: () => {} }));
    },
    wanted: (first) => assert.equal(first.details, false, 'the first frame of Rendered still shows the HTML that was revoked'),
  });
});

// Opening another file from Source: the new file's text, exactly, and nothing typed into the old one.

const slowMarks = (page, ms, only) => page.evaluate(({ ms, only }) => {
  const shell = window.__marxyHandle.shell;
  const mark = shell.mark.bind(shell);
  shell.mark = async (name, ...args) => {
    if (!only || only === name) await new Promise((resolve) => setTimeout(resolve, ms));
    return mark(name, ...args);
  };
}, { ms, only });
/** The whole document of the Source editor on the page, as CodeMirror holds it (the DOM shows only the lines in view). */
const exactEditorText = (page) => page.evaluate(() => document.querySelector('#marxy-source .cm-content').cmTile.root.view.state.doc.toString());
const sample = (word, path) => path.endsWith('.py')
  ? `# ${word}\nvalue_${word} = 1\n${'x = 2\n'.repeat(60)}`
  : `# ${word}\n\n${word} paragraph one.\n\n${'filler paragraph '.repeat(40)}\n`;
/** What `#marxy-source` shows now: how many editors it holds and any text a reader could type into. */
const sourceHostState = (page) => page.evaluate(() => {
  const host = document.getElementById('marxy-source');
  return {
    editors: host.querySelectorAll('.cm-editor').length,
    typable: host.querySelectorAll('[contenteditable="true"]').length,
    inert: host.querySelectorAll('[inert]').length,
    text: [...host.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'),
  };
});

for (const [from, to] of [['/d/a.py', '/d/b.py'], ['/d/a.md', '/d/b.py'], ['/d/a.py', '/d/b.md'], ['/d/a.md', '/d/b.md']]) {
  test(`opening ${to.slice(3)} from Source on ${from.slice(3)} shows the new file's exact text, in Source, and never an empty or doubled editor`, async () => {
    await withPage(async (page) => {
      const a = sample('AAAA', from);
      const b = sample('BBBB', to);
      await boot(page, { [from]: b64(a), [to]: b64(b) }, [from]);
      await settle(page);
      if ((await mode(page)) !== 'source') await toSource(page);
      await page.waitForTimeout(300);
      await slowMarks(page, 100);
      await page.evaluate(() => {
        window.__frames = [];
        window.__sampling = true;
        const host = document.getElementById('marxy-source');
        const loop = () => {
          if (!host.hidden && host.getClientRects().length > 0) {
            window.__frames.push({ editors: host.querySelectorAll('.cm-editor').length, lines: host.querySelectorAll('.cm-line').length });
          }
          if (window.__sampling) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      await page.evaluate((p) => window.__marxyHandle.open(p), to);
      await settle(page);
      await page.evaluate(() => { window.__sampling = false; });
      const frames = await page.evaluate(() => window.__frames);
      assert.deepEqual(frames.filter((f) => f.editors !== 1 || f.lines === 0), [], 'a frame showed Source with no editor, no text, or two editors');
      assert.equal(await page.evaluate(() => window.__marxyHandle.currentPath()), to);
      if ((await mode(page)) !== 'source') await toSource(page);
      const state = await sourceHostState(page);
      assert.equal(state.editors, 1, `Source holds ${state.editors} editors`);
      assert.equal(state.inert, 0, 'a picture of the old text is left in Source');
      assert.equal(await exactEditorText(page), b, 'Source does not show the new file exactly');
      assert.deepEqual(await bufferBytes(page), [...Buffer.from(b)]);
      assert.equal(await isDirty(page), false);
    });
  });
}

for (const [from, to] of [['/d/a.md', '/d/b.md'], ['/d/a.py', '/d/b.py']]) {
  test(`keys typed into Source while ${to.slice(3)} opens from ${from.slice(3)} are refused, shown nowhere and lost from nothing`, async () => {
    await withPage(async (page) => {
      const a = sample('AAAA', from);
      const b = sample('BBBB', to);
      await boot(page, { [from]: b64(a), [to]: b64(b) }, [from]);
      await settle(page);
      if ((await mode(page)) !== 'source') await toSource(page);
      await page.waitForTimeout(300);
      // The open reads its file slowly: the old store is gone and the new page is not there yet for 600 ms.
      await slowMarks(page, 600, 'file_read');
      await page.evaluate((p) => { window.__open = window.__marxyHandle.open(p); }, to);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__marxyHandle.currentPath()), null, 'the open was not in its gap');
      const during = await sourceHostState(page);
      assert.ok(during.text.length > 0, 'nothing of the old text stayed on screen');
      assert.equal(during.typable, 0, 'the old text is still an editor a reader can type into');
      // Click and type where the old text is.
      const box = await page.evaluate(() => { const r = document.querySelector('#marxy-source .cm-content').getBoundingClientRect(); return { x: r.x + 80, y: r.y + 20 }; });
      await page.mouse.click(box.x, box.y);
      await page.keyboard.type('LOSTKEYS');
      const typed = await sourceHostState(page);
      assert.equal(typed.text.includes('LOSTKEYS'), false, 'keys typed in the gap show on screen, and the next page will drop them');
      assert.equal(typed.typable, 0);
      await page.evaluate(() => window.__open);
      await settle(page);
      if ((await mode(page)) !== 'source') await toSource(page);
      assert.equal(await exactEditorText(page), b);
      assert.deepEqual(await bufferBytes(page), [...Buffer.from(b)]);
      assert.equal(await isDirty(page), false);
      assert.equal(await page.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/d/' + window.__marxyHandle.currentPath().split('/').pop())).includes('LOSTKEYS')), false);
    });
  });
}
