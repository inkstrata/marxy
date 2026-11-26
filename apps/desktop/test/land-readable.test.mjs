// Code and web pages land readable. A source file opens in Read's coloured code reading, with no editor chrome (no
// facts bar, column ruler or caret footer) above its first line, and Mod+E is Source with the caret at the reading line;
// a reader who leaves it in Source finds it there again. An HTML file opens in Read as the sandboxed page a message's
// HTML part is drawn in: no script, no handler, a form that cannot be sent, its image from the network held back with
// the offer to load it for this page, and the account naming what was left out; Source is its code, one key away. WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const RS = Array.from({ length: 160 }, (_, i) => (i % 10 === 0 ? `/// Section ${i}.` : `fn f${i}() -> u32 { ${i} }`)).join('\n') + '\n';
const PY = '# a comment that Markdown would call a heading\n\ndef main():\n    return 1\n';
const MAKE = '# Build it\nall: build\n\nbuild:\n\tcargo build --release\n';
const PAGE = '/r/site/notice.html';
const HTML = [
  '<!doctype html><html><head><title>Notice</title>',
  '<script>document.title = "ran";</script>',
  '</head><body>',
  '<h1 id="head" onclick="this.textContent = \'clicked\'">Channel closed</h1>',
  '<p>Dredging narrows the channel.</p>',
  '<img src="https://cdn.harbour.example/mouth.jpg" alt="The mouth" width="300" height="200">',
  '<form action="https://harbour.example/subscribe" method="post"><input name="email"><button>Subscribe</button></form>',
  '</body></html>',
  '',
].join('\n');
const FILES = {
  '/r/README.md': '# Here\n\nWords.\n',
  '/r/src/main.rs': RS,
  '/r/app.py': PY,
  '/r/Makefile': MAKE,
  [PAGE]: HTML,
};

const mode = (page) => page.evaluate(() => window.__marxyHandle.panes().focused.view.mode);
const open = (page, path) => page.evaluate((p) => window.__marxyHandle.open(p), path);
/** What the focused pane shows above and around the text: Source's frame and its rows, and Read's code block. */
const shown = (page) =>
  page.evaluate(() => {
    const host = window.__marxyHandle.panes().focused.host;
    const seen = (sel) => [...host.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0);
    return {
      code: seen('pre code'),
      heading: seen('article h1'),
      frame: seen('.marxy-source-frame'),
      facts: seen('.marxy-source-top'),
      ruler: seen('.marxy-source-ruler'),
      footer: seen('.marxy-source-bottom'),
    };
  });

test('a .rs, a .py and a Makefile land in Read as coloured code, with no editor chrome above the first line', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    for (const path of ['/r/src/main.rs', '/r/app.py', '/r/Makefile']) {
      await open(page, path);
      await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('pre code')?.dataset.marxyDone === 'highlight', null, { timeout: 15_000 });
      assert.equal(await mode(page), 'rendered', `${path} lands in Read`);
      assert.deepEqual(await shown(page), { code: true, heading: false, frame: false, facts: false, ruler: false, footer: false }, path);
      const coloured = await page.evaluate(() => window.__marxyHandle.panes().focused.host.querySelectorAll('pre code span[class^="marxy-tok-"]').length);
      assert.ok(coloured > 0, `${path} is coloured`);
    }
  });
});

test('Mod+E takes a code file from Read to Source with the caret at the reading line; left in Source, it opens there again', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page, { mod }) => {
    await open(page, '/r/src/main.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('pre code'));
    // Read scrolled well into the file: the line on the reading line is far from the first.
    await page.evaluate(() => {
      document.scrollingElement.scrollTop = 2000;
    });
    await page.waitForTimeout(300);
    // The line Read shows at the reading line, 40 % down the window, read from where its text lies.
    const readLine = await page.evaluate(() => {
      const code = window.__marxyHandle.panes().focused.host.querySelector('pre code');
      const hit = document.caretRangeFromPoint(code.getBoundingClientRect().left + 1, Math.round(innerHeight * 0.4));
      const before = document.createRange();
      before.setStart(code, 0);
      before.setEnd(hit.startContainer, hit.startOffset);
      return before.toString().split('\n').length;
    });
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.activeElement?.closest('.cm-content'));
    const caret = await page.evaluate(async () => {
      const { view } = (await import('/src/source/editor.ts')).activeSourceEditor();
      const line = view.state.doc.lineAt(view.state.selection.main.head).number;
      const at = view.coordsAtPos(view.state.selection.main.head);
      const r = view.scrollDOM.getBoundingClientRect();
      return { line, inView: at !== null && at.top >= r.top && at.bottom <= r.bottom };
    });
    assert.ok(readLine > 40, `Read was scrolled well into the file (line ${readLine})`);
    assert.equal(caret.line, readLine, 'the caret is on the line Read showed at the reading line');
    assert.equal(caret.inView, true, 'and on screen');
    // Left in Source, then opened again from elsewhere: Source, as the reader left it.
    await open(page, '/r/README.md');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'rendered');
    await open(page, '/r/src/main.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    // Another code file the reader never put in Source still lands in Read.
    await open(page, '/r/app.py');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('pre code'));
    assert.equal(await mode(page), 'rendered');
    // Put back in Read by the reader, it lands in Read again.
    await open(page, '/r/src/main.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source');
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'rendered');
    await open(page, '/r/README.md');
    await open(page, '/r/src/main.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('pre code'));
    assert.equal(await mode(page), 'rendered');
  });
});

const positions = (paths) => `${JSON.stringify({ version: 1, positions: Object.fromEntries(paths.map((p) => [p, { byteOffset: 0, fraction: 0, mode: 'source', at: 1 }])) }, null, 2)}\n`;
const readings = (source) => `${JSON.stringify({ version: 1, parts: {}, source }, null, 2)}\n`;

test('a place kept in Source by an earlier Marxy lands in Read; only a file the reader put in Source opens there', async () => {
  const files = { ...FILES, '/data/positions.json': positions(['/r/src/main.rs', '/r/app.py']), '/data/readings.json': readings(['/r/app.py']) };
  await withFrame({ files, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/src/main.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('pre code'));
    assert.equal(await mode(page), 'rendered', 'a stored Source place alone is not the reader\'s choice');
    await open(page, '/r/app.py');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.querySelector('.cm-content'));
  });
});

test('a [[kind]] rule that says read = true wins over a code file put in Source, at launch and by open', async () => {
  const config = '[[kind]]\nglob = "/r/src/**"\nis = "code"\nread = true\n';
  const files = { ...FILES, '/r/src/lib.rs': RS, '/data/positions.json': positions(['/r/src/main.rs', '/r/src/lib.rs']), '/data/readings.json': readings(['/r/src/lib.rs', '/r/src/main.rs']) };
  await withFrame({ files, config, open: ['/r/src/main.rs'] }, async (page) => {
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('pre code'));
    // Past the launch's late reads (positions.json, readings.json): still Read.
    await page.waitForTimeout(800);
    assert.equal(await mode(page), 'rendered');
    await open(page, '/r/src/lib.rs');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/src/lib.rs' && window.__marxyHandle.panes().focused.host.querySelector('pre code'));
    await page.waitForTimeout(300);
    assert.equal(await mode(page), 'rendered');
  });
});

/** The sandboxed page's frame, its document as the page draws it, and the account above it. */
const pageSeen = (page) =>
  page.evaluate(() => {
    const host = window.__marxyHandle.panes().focused.host;
    const f = host.querySelector('[data-marxy-viewer="page"] iframe.marxy-sandbox');
    const d = f?.contentDocument;
    return {
      sandbox: f?.getAttribute('sandbox') ?? null,
      heading: d?.querySelector('h1')?.textContent ?? null,
      scripts: d?.querySelectorAll('script').length ?? null,
      handlers: d ? [...d.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length : null,
      formAction: d?.querySelector('form')?.hasAttribute('action') ?? null,
      controlsOff: d ? [...d.querySelectorAll('input, button')].every((e) => e.disabled) : null,
      remote: d ? [...d.querySelectorAll('img[data-marxy-remote]')].map((i) => ({ url: i.getAttribute('data-marxy-remote'), src: i.getAttribute('src') ?? '' })) : null,
      offer: host.querySelector('.marxy-mail-remote')?.textContent ?? null,
      account: host.querySelector('.marxy-htmlpage .marxy-account-body p')?.textContent ?? null,
    };
  });

test('an .html lands in Read as the sandboxed page: script, handler and a working form left out, its remote image held with the offer', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page, { mod }) => {
    const off = [];
    const here = new URL(page.url()).host;
    page.on('request', (r) => {
      const u = r.url();
      if (!/^(data|blob|about):/.test(u) && new URL(u).host !== here) off.push(u);
    });
    await open(page, PAGE);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('iframe.marxy-sandbox')?.contentDocument?.querySelector('h1'));
    assert.equal(await mode(page), 'rendered');
    const seen = await pageSeen(page);
    assert.equal(seen.sandbox, 'allow-same-origin', 'no scripts, forms, popups or navigation in the frame');
    assert.equal(seen.heading, 'Channel closed');
    assert.equal(seen.scripts, 0);
    assert.equal(seen.handlers, 0);
    assert.equal(seen.formAction, false, 'the form names nowhere to send to');
    assert.equal(seen.controlsOff, true);
    assert.deepEqual(seen.remote.map((r) => r.url), ['https://cdn.harbour.example/mouth.jpg']);
    assert.ok(!seen.remote[0].src.startsWith('https:'), 'the image is not fetched');
    assert.match(seen.offer, /^1 image from the network is not loaded\. Loading them tells cdn\.harbour\.example that this page was read, and when\.Load them for this page$/);
    assert.equal(seen.account, 'In the sandbox: 1 script not run, 1 event handler left out; 1 image from the network not loaded (cdn.harbour.example); 1 form shown, never sent.');
    // The press loads it through the shell, for this page only.
    await page.click('.marxy-mail-remote .marxy-btn');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('iframe.marxy-sandbox')?.contentDocument?.querySelector('img[data-marxy-remote]')?.getAttribute('src')?.startsWith('data:'));
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'fetchRemoteImage').map((c) => c.args[0])), ['https://cdn.harbour.example/mouth.jpg']);
    assert.match(await page.textContent('.marxy-mail-remote'), /^Images from the network, loaded for this page until its tab closes; not remembered for other pages\.Block them again$/);
    // Source is its code, one key away, and back again is the page.
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.querySelector('.cm-content'));
    assert.match(await page.textContent('.cm-content'), /^<!doctype html>/);
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'rendered');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('[data-marxy-viewer="page"] iframe.marxy-sandbox'));
    // Nothing reached the network but through the shell.
    assert.deepEqual(off, [], `requests left for the network: ${off.join(', ')}`);
  });
});

test('an .html whose HTML the reader trusted keeps the trusted page; Its code goes to Source', async () => {
  const trusted = '/r/trusted.html';
  const trust = `${JSON.stringify({ version: 1, documents: { [trusted]: { html: true, at: 1 } } }, null, 2)}\n`;
  const plain = '<h1>Channel closed</h1>\n\n<p>Dredging narrows the channel.</p>\n';
  await withFrame({ files: { ...FILES, [trusted]: plain, '/r/other.html': HTML, '/data/trust.json': trust }, open: ['/r/README.md'] }, async (page) => {
    await open(page, trusted);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('article h1')?.textContent === 'Channel closed');
    assert.equal(await mode(page), 'rendered');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.host.querySelector('iframe.marxy-sandbox')), null, 'drawn in the page, as trusted');
    // An .html with no grant is the sandboxed page, and its line's Its code is Source.
    await open(page, '/r/other.html');
    await page.waitForSelector('.marxy-htmlpage-line .marxy-linkish');
    await page.click('.marxy-htmlpage-line .marxy-linkish:has-text("Its code, in Source")');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.querySelector('.cm-content'));
  });
});

test('an .xhtml lands as the same sandboxed page, script left out', async () => {
  const xhtml = '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>X</title><script>document.title = "ran";</script></head>\n<body><h1 onclick="x()">Strict notice</h1><p>Words.</p></body></html>\n';
  await withFrame({ files: { ...FILES, '/r/site/strict.xhtml': xhtml }, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/site/strict.xhtml');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('iframe.marxy-sandbox')?.contentDocument?.querySelector('h1')?.textContent === 'Strict notice');
    const seen = await pageSeen(page);
    assert.equal(await mode(page), 'rendered');
    assert.deepEqual([seen.sandbox, seen.scripts, seen.handlers], ['allow-same-origin', 0, 0]);
  });
});

test('only an absolute web address counts as an image from the network: relative, //host and data images do not', async () => {
  const mixed = [
    '<p>Pictures.</p>',
    '<img src="pictures/local.png" alt="a">',
    '<img src="//cdn.harbour.example/protocol.png" alt="b">',
    '<img src="data:image/png;base64,iVBORw0KGgo=" alt="c">',
    '<img src="https://cdn.harbour.example/only.png" alt="d">',
    '',
  ].join('\n');
  await withFrame({ files: { ...FILES, '/r/site/mixed.html': mixed }, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/site/mixed.html');
    await page.waitForSelector('.marxy-mail-remote');
    assert.match(await page.textContent('.marxy-mail-remote'), /^1 image from the network is not loaded\. Loading them tells cdn\.harbour\.example that this page was read, and when\./);
    await page.click('.marxy-mail-remote .marxy-btn');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'fetchRemoteImage'));
    await page.waitForSelector('.marxy-mail-remote[data-marxy-on]');
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'fetchRemoteImage').map((c) => c.args[0])), ['https://cdn.harbour.example/only.png']);
  });
});

test('images loaded for one .html are not loaded for another .html, nor for the same file in the other pane', async () => {
  await withFrame({ files: { ...FILES, '/r/site/twin.html': HTML }, open: ['/r/README.md', '/r/app.py'] }, async (page) => {
    const offer = (slot) => page.evaluate((s) => {
      const host = window.__marxyHandle.panes().panes[s].host;
      const bar = host.querySelector('.marxy-mail-remote');
      return { on: bar?.hasAttribute('data-marxy-on') ?? null, src: host.querySelector('iframe.marxy-sandbox')?.contentDocument?.querySelector('img[data-marxy-remote]')?.getAttribute('src') ?? '' };
    }, slot);
    const openIn = (slot, path) => page.evaluate(({ slot, path }) => window.__marxyHandle.panes().openIn(slot, path), { slot, path });
    const shows = (slot, path) => page.waitForFunction(({ slot, path }) => {
      const pane = window.__marxyHandle.panes().panes[slot];
      return pane.path() === path && pane.host.querySelector('.marxy-mail-remote') && pane.host.querySelector('iframe.marxy-sandbox')?.contentDocument?.querySelector('img');
    }, { slot, path });
    await openIn(0, PAGE);
    await shows(0, PAGE);
    await page.click('section.marxy-pane >> nth=0 >> .marxy-mail-remote .marxy-btn');
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].host.querySelector('.marxy-mail-remote[data-marxy-on]'));
    await page.waitForFunction(() => window.__marxyHandle.panes().panes[0].host.querySelector('iframe.marxy-sandbox')?.contentDocument?.querySelector('img[data-marxy-remote]')?.getAttribute('src')?.startsWith('data:image/png'));
    // The same file in the other pane: held back there, with the offer (the shell's fetch gives a PNG; the held-back image is a drawn placeholder).
    await openIn(1, PAGE);
    await shows(1, PAGE);
    const other = await offer(1);
    assert.equal(other.on, false);
    assert.doesNotMatch(other.src, /^data:image\/png/);
    // Another file that names the same image, in the first pane: held back too.
    await openIn(0, '/r/site/twin.html');
    await shows(0, '/r/site/twin.html');
    const twin = await offer(0);
    assert.equal(twin.on, false);
    assert.doesNotMatch(twin.src, /^data:image\/png/);
  });
});

test('Mod+E in Markdown inside a long fence goes to the fence, as it always did: only the code reading maps its lines', async () => {
  const intro = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} of words before the fence, long enough to take a row or two of the page.`).join('\n\n');
  const fence = Array.from({ length: 160 }, (_, i) => `const line${i} = ${i};`).join('\n');
  const md = `# Notes\n\n${intro}\n\n\`\`\`js\n${fence}\n\`\`\`\n`;
  const fenceLine = md.slice(0, md.indexOf('```js')).split('\n').length;
  await withFrame({ files: { ...FILES, '/r/notes.md': md }, open: ['/r/notes.md'] }, async (page, { mod }) => {
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.host.querySelector('pre code'));
    await page.evaluate(() => {
      const pre = window.__marxyHandle.panes().focused.host.querySelector('pre');
      document.scrollingElement.scrollTop += pre.getBoundingClientRect().top + 1200 - innerHeight * 0.4;
    });
    await page.waitForTimeout(300);
    await page.keyboard.press(`${mod}+KeyE`);
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.view.mode === 'source' && document.activeElement?.closest('.cm-content'));
    const line = await page.evaluate(async () => {
      const { view } = (await import('/src/source/editor.ts')).activeSourceEditor();
      return view.state.doc.lineAt(view.state.selection.main.head).number;
    });
    assert.equal(line, fenceLine, 'the caret is on the fence that held the reading line');
  });
});

test('code from 1 MB lands in Source, as it always did, past 5 MB too; under it, in Read', async () => {
  const line = 'export function f(a) { return "s" + a * 2; } // a comment\n';
  const sized = (bytes) => line.repeat(Math.ceil(bytes / line.length));
  const files = { ...FILES, '/r/under.js': sized(0.9 * 1024 * 1024), '/r/over.js': sized(1.1 * 1024 * 1024), '/r/huge.js': sized(6 * 1024 * 1024) };
  await withFrame({ files, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/under.js');
    await page.waitForFunction(() => window.__marxyHandle.panes().focused.path() === '/r/under.js');
    assert.equal(await mode(page), 'rendered');
    for (const path of ['/r/over.js', '/r/huge.js']) {
      await open(page, path);
      await page.waitForFunction((p) => window.__marxyHandle.panes().focused.path() === p && document.querySelector('#marxy-source .cm-line'), path);
      assert.equal(await mode(page), 'source', path);
    }
  });
});
