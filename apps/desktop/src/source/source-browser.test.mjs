// CodeMirror Source mode in WebKit: round-trip, undo, stray bytes, colour. The scroll measurement is scripts/measure-source-scroll.mjs.

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const desktopRoot = join(repoRoot, 'apps', 'desktop');
const outDir = mkdtempSync(join(tmpdir(), 'marxy-source-'));
let server;
let base;

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: { harness: join(desktopRoot, 'src/source/harness-shell.html') },
      },
    },
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = pathname.replace(/^\//, '') || 'src/source/harness-shell.html';
    const path = join(outDir, rel);
    if (!existsSync(path)) {
      res.statusCode = 404;
      return res.end('missing');
    }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/javascript');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});

after(() => {
  server?.close();
  rmSync(outDir, { recursive: true, force: true });
});

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

test('mode switch twice without editing keeps bytes and byteOffset', async () => {
  const bytes = readFileSync(join(repoRoot, 'fixtures/corpus/19-source-file.md'));
  const bytesB64 = b64(bytes);
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.roundTrip === 'function');
    // Inside line 40: deep enough that Source must scroll to put it on the reading line.
    const lineStarts = [0];
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) lineStarts.push(i + 1);
    const at = lineStarts[40] + 5;
    const result = await page.evaluate(
      async ({ bytesB64, at }) => window.marxySourceHarness.roundTrip(bytesB64, '/19-source-file.md', at),
      { bytesB64, at },
    );
    assert.equal(result.changed, false);
    assert.equal(result.hashSame, true);
    assert.equal(result.byteOffset, lineStarts[40], 'the line on the reading line is the line holding the byte');
  } finally {
    await browser.close();
  }
});

test('multi-cursor edit undo restores prior doc length', async () => {
  const bytes = new TextEncoder().encode('hello world\n');
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.multiCursorUndo === 'function');
    const result = await page.evaluate(
      async ({ bytesB64 }) => window.marxySourceHarness.multiCursorUndo(bytesB64, '/x.txt'),
      { bytesB64: b64(bytes) },
    );
    assert.ok(result.afterEdit > result.before, 'expected edits to grow the doc');
    assert.equal(result.afterUndo, result.before, 'undo should restore the original length');
  } finally {
    await browser.close();
  }
});

test('bytes that are not UTF-8: shown as marked bytes, copied as U+FFFD, pasted back and moved as themselves', async () => {
  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const enc = new TextEncoder();
  const line1 = [...enc.encode('caf'), 0xe9, ...enc.encode(' and '), 0xe2, 0x82, 0x0a];
  const line2 = [...enc.encode('second '), 0xff, 0x0a];
  const bytes = Uint8Array.from([...line1, ...line2]);
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.strayBytes === 'function');
    const result = await page.evaluate(
      async ({ bytesB64 }) => window.marxySourceHarness.strayBytes(bytesB64, '/latin.md'),
      { bytesB64: b64(bytes) },
    );
    assert.deepEqual(
      result.markers.map((m) => m.text),
      ['E9', 'E2', '82', 'FF'],
      'each stray byte is marked with its value',
    );
    assert.equal(result.markers[0].label, 'Byte E9, not UTF-8');
    assert.equal(result.pageHasLone, false, 'no lone surrogate in the page');
    assert.equal(result.pageHasLoneAfter, false, 'nor after a paste and a move');
    assert.equal(result.copiedHasLone, false, 'nor on the clipboard');
    assert.equal(result.copied, 'caf\uFFFD and \uFFFD\uFFFD\nsecond \uFFFD\n');
    // The copy pasted back is the bytes themselves; the foreign lone surrogate is EF BF BD; the first line moved
    // below the second keeps its bytes.
    const expected = [...line2, ...line1, ...line1, ...line2, ...enc.encode('X'), 0xef, 0xbf, 0xbd, ...enc.encode('Y')];
    assert.equal(result.hex, hex(expected));
  } finally {
    await browser.close();
  }
});

/** Runs `name` in the Source harness on `bytes`. */
async function harness(name, bytes, path = '/stray.md', extra = undefined) {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction((n) => typeof window.marxySourceHarness?.[n] === 'function', name);
    return await page.evaluate(async ({ name, bytesB64, path, extra }) => window.marxySourceHarness[name](bytesB64, path, extra), { name, bytesB64: b64(bytes), path, extra });
  } finally {
    await browser.close();
  }
}
const hexBytes = (s) => s.split(' ').map((h) => Number.parseInt(h, 16));

// The restore reads the pasteboard item the paste carries, so
// a drag cannot overwrite it and another program's U+FFFD cannot be taken for it.
test('a copied stray line pastes back exactly after a drag that went nowhere; another program\'s U+FFFD stays U+FFFD', async () => {
  const input = '23 20 54 0a 0a 66 69 72 73 74 0a 0a 6d 69 64 20 ff 20 78 0a 0a 70 6c 61 69 6e 20 6c 69 6e 65 0a 0a 65 6e 64 20 e9 0a';
  const result = await harness('strayClipboard', Uint8Array.from(hexBytes(input)));
  assert.equal(result.afterDrag, `${input} 6d 69 64 20 ff 20 78`, 'the copy, after a cancelled drag');
  assert.equal(result.copiedOne, '"\\udcff"', 'the copy of the one byte carried it');
  assert.equal(result.otherApp, `${input} ef bf bd`, 'another program\'s U+FFFD');
  assert.equal(result.types, 'text/plain,application/x-marxy-source-text', 'one pasteboard item, two types');
  assert.equal(result.mismatch, `${input} 6d 69 64 20 ef bf bd 20 78 21`, 'readable text that disagrees with the type is read as it is');
  // The second review: a forged type with a lone surrogate that is no stray byte's, pasted before the last stray.
  const head = input.slice(0, -'e9 0a'.length);
  assert.equal(result.forgedHigh, `${head}ef bf bd e9 0a`, 'a lone high surrogate no longer fuses with the stray: its readable text is pasted');
  assert.equal(result.forgedLow, `${head}ef bf bd e9 0a`);
  assert.equal(result.forgedMixed, `${head}ef bf bd ef bf bd e9 0a`);
});

test('the find panel, opened on a selection with a stray byte, and its announcement hold no lone surrogate', async () => {
  const input = '23 20 54 0a 0a 6d 69 64 20 69 64 20 ff 20 78 0a';
  const result = await harness('strayFind', Uint8Array.from(hexBytes(input)));
  assert.equal(result.opened, false, 'the panel as it opens');
  assert.equal(result.afterFind, false, 'after find next');
  assert.equal(result.query, 'd � ', 'the query is the selection read with U+FFFD');
  assert.ok(!/[\uD800-\uDFFF]/u.test(result.announced), JSON.stringify(result.announced));
});

// The follow-up: the second Mod+Z after that save was not byte-exact, because the read-back replaced the two
// bytes by the character they spell and the history mapped the line break's undo through that replacement.
const JOIN_FILE = '23 20 54 0a 0a 68 65 6c 6c 6f 0a 0a 78 c3 0a a9 79 0a 0a 74 61 69 6c 0a';
const JOINED = '23 20 54 0a 0a 68 65 6c 6c 6f 0a 0a 78 c3 a9 79 0a 0a 74 61 69 6c 0a';
const JOINED_Q = '23 20 54 0a 0a 68 65 6c 6c 6f 0a 0a 78 c3 a9 79 51 0a 0a 74 61 69 6c 0a';

test('a save after two stray bytes are made neighbours keeps the caret, and each Mod+Z puts back exactly the bytes the reader had', async () => {
  const result = await harness('strayJoin', Uint8Array.from(hexBytes(JOIN_FILE)));
  assert.equal(result.saved, JOINED_Q);
  assert.equal(result.caretText, 'yQ', 'the caret stays after the Q');
  assert.deepEqual(result.steps, [JOINED_Q, JOINED, JOIN_FILE, JOIN_FILE], 'save, then Mod+Z takes the Q back, then the join, byte for byte');
});

test('the same when the caret moved after the typing: the read-back is a step of its own, and every step is still exact', async () => {
  const result = await harness('strayJoin', Uint8Array.from(hexBytes(JOIN_FILE)), '/stray.md', 'moved');
  assert.equal(result.saved, JOINED_Q);
  // The first Mod+Z undoes the read-back (the character becomes its two bytes again, no byte changes).
  assert.deepEqual(result.steps, [JOINED_Q, JOINED_Q, JOINED, JOIN_FILE]);
});

test('the same when the typing was undone before the save: the redo is gone, and Mod+Z is exact', async () => {
  const result = await harness('strayJoin', Uint8Array.from(hexBytes(JOIN_FILE)), '/stray.md', 'redo');
  assert.equal(result.saved, JOINED);
  assert.equal(result.redone, false, 'a read-back ends redo');
  assert.equal(result.steps.at(-1), JOIN_FILE);
  assert.ok(result.steps.every((s) => s === JOINED || s === JOIN_FILE), JSON.stringify(result.steps));
});

// The text never waits for the grammar, and a grammar that will not load leaves Source as it is.
// Source's colour is the Shiki grammar the highlight worker loads, so the Go grammar's chunk is the one build
// output that defines the scope `source.go`; the requests for it are held or refused.
function goChunkUrl() {
  const dir = join(outDir, 'assets');
  return readdirSync(dir).find((f) => f.endsWith('.js') && /scopeName\\?"\s*:\s*\\?"source\.go\\?"/.test(readFileSync(join(dir, f), 'utf8')));
}
const goText = 'package main\nfunc f() int { return 1 } // c\n';

test('Source shows the text before a slow grammar arrives, and colours it when it does', async () => {
  const name = goChunkUrl();
  assert.ok(name, 'the Go grammar chunk was not found in the build');
  const browser = await webkit.launch();
  try {
    // The context's route, so the highlight worker's request is held too.
    const context = await browser.newContext({ viewport: { width: 960, height: 800 } });
    const page = await context.newPage();
    await context.route(`**/assets/${name}`, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.mountTimed === 'function');
    const r = await page.evaluate(async ({ b }) => window.marxySourceHarness.mountTimed(b, '/a.go', 3000), { b: b64(Buffer.from(goText)) });
    assert.equal(r.first.text, goText);
    assert.equal(r.first.coloured, false, 'no colour before the grammar has loaded');
    assert.ok(r.mountedAt < 1000, `the mount waited ${r.mountedAt} ms on the grammar`);
    assert.equal(r.later.coloured, true, 'colour once it has');
  } finally {
    await browser.close();
  }
});

test('a grammar that fails to load leaves Source mounted with the exact text, uncoloured', async () => {
  const name = goChunkUrl();
  const browser = await webkit.launch();
  try {
    // The context's route, so the highlight worker's request is held too.
    const context = await browser.newContext({ viewport: { width: 960, height: 800 } });
    const page = await context.newPage();
    await context.route(`**/assets/${name}`, (route) => route.abort());
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.mountTimed === 'function');
    const r = await page.evaluate(async ({ b }) => window.marxySourceHarness.mountTimed(b, '/a.go', 500), { b: b64(Buffer.from(goText)) });
    assert.equal(r.later.text, goText);
    assert.equal(r.later.coloured, false);
    assert.equal(r.inSource, true);
  } finally {
    await browser.close();
  }
});

const ROLES_PAINTED = ['comment', 'string', 'escape', 'number', 'constant', 'keyword', 'operator', 'function', 'builtin', 'type', 'property', 'decorator', 'self', 'tag', 'attribute', 'variable', 'punctuation', 'heading', 'marker', 'link', 'mark'];
const ROLE_COLOURS = [
  `:root { ${ROLES_PAINTED.map((r, i) => `--marxy-tok-${r}: rgb(${10 + i * 10}, 0, 1);`).join(' ')} }`,
  ...ROLES_PAINTED.map((r) => `.marxy-tok-${r} { color: var(--marxy-tok-${r}); }`),
].join('\n');

// Source is coloured from Read's tokenizer. Each file is drawn in Source, and its text drawn as a Read fence in the
// same page by the same worker; every character carries the same `marxy-tok-*` role in both, read from the DOM.
const D1_FILES = [
  ['/a.rb', 'ruby', 'class Greeter < Base\n  def hi(name) # say it\n    puts "hi #{name}"\n    return 42 if name.nil?\n  end\nend\n', 'def', 'keyword'],
  ['/a.ts', 'typescript', 'export class A {\n  run(x: number): string { return `n${x}`; } // c\n}\n', 'class', 'keyword'],
  ['/a.ps1', 'powershell', '# greet\nfunction Get-Hi([string]$Name) {\n  Write-Output "hi $Name" 42\n}\n', 'function', 'keyword'],
  ['/main.tf', 'terraform', '# greet\nresource "aws_s3_bucket" "b" {\n  bucket = "hi"\n  count  = 42\n}\n', '# greet', 'comment'],
  ['/a.cs', 'csharp', 'public class Hi {\n  public static int Main() { return 42; } // c\n}\n', 'public', 'keyword'],
];

test('Ruby, TypeScript, PowerShell, Terraform and C# in Source take each token\'s role from Read, and carry their language', async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.sourceColour === 'function');
    await page.addStyleTag({ content: ROLE_COLOURS });
    for (const [path, lang, text, needle, role] of D1_FILES) {
      const source = await page.evaluate(async ({ b, path }) => window.marxySourceHarness.sourceColour(b, path), { b: b64(Buffer.from(text)), path });
      const read = await page.evaluate(async ({ text, lang }) => window.marxySourceHarness.readColour(text, lang), { text, lang });
      assert.equal(source.language, lang, `${path}: data-marxy-lang`);
      assert.equal(source.text, text, `${path}: Source's text`);
      assert.equal(read.text, text, `${path}: Read's text`);
      assert.deepEqual(source.roles, read.roles, `${path}: the roles differ between Source and Read`);
      for (let i = 0; i < text.length; i++) {
        if (read.roles[i] !== null) assert.equal(source.colours[i], read.colours[i], `${path}: ${JSON.stringify(text[i])} at ${i} is drawn differently`);
      }
      assert.equal(source.roles[text.indexOf(needle)], role, `${path}: ${needle} is a ${role}`);
    }
  } finally {
    await browser.close();
  }
});

test('a Markdown fence in Source takes the roles Read gives the same fence, and Markdown\'s own marks keep Lezer\'s colour', async () => {
  const body = 'def hi(name) # c\n  "hi"\nend';
  const md = `# Title\n\nSome *text*.\n\n\`\`\`ruby\n${body}\n\`\`\`\n`;
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.sourceColour === 'function');
    // A colour of its own for every role, as base.css paints them, so what is drawn can be compared, not only what is named.
    await page.addStyleTag({ content: ROLE_COLOURS });
    const source = await page.evaluate(async ({ b }) => window.marxySourceHarness.sourceColour(b, '/a.md'), { b: b64(Buffer.from(md)) });
    const read = await page.evaluate(async ({ body }) => window.marxySourceHarness.readColour(body, 'ruby'), { body });
    const at = source.text.indexOf(body);
    assert.ok(at > 0);
    assert.deepEqual(source.roles.slice(at, at + body.length), read.roles.slice(0, body.length));
    // Each token of the fence is drawn in its role's colour, not in a colour Lezer gives the fence's body.
    for (let i = 0; i < body.length; i++) {
      if (read.roles[i] !== null) assert.equal(source.colours[at + i], read.colours[i], `${JSON.stringify(body[i])} at ${i}`);
    }
    assert.equal(source.roles[source.text.indexOf('def')], 'keyword');
    // The heading's text is outside any fence: no run reaches it.
    assert.equal(source.roles[source.text.indexOf('Title')], null);
  } finally {
    await browser.close();
  }
});

test('time to the first coloured token in Source for a 200 KB TypeScript file is recorded', async () => {
  const parts = [];
  for (let i = 0; parts.join('\n').length < 200 * 1024; i++) parts.push(`export function f${i}(a: number): string { return "s" + a * ${i}; } // c`);
  const text = parts.join('\n');
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.sourceColour === 'function');
    const r = await page.evaluate(async ({ b }) => window.marxySourceHarness.sourceColour(b, '/big.ts', 20000), { b: b64(Buffer.from(text)) });
    // Recorded, not a CI failure. What does fail is a measurement that did not happen.
    assert.ok(r.firstColourMs > 0, 'no colour arrived');
    console.log(`200 KB TypeScript: first coloured token in Source after ${r.firstColourMs.toFixed(0)} ms (recorded)`);
  } finally {
    await browser.close();
  }
});

test('an edit is coloured again from the worker, as Read colours the edited text', async () => {
  const text = 'const a = 1;\nfunction f() { return "s"; }\n';
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.goto(`${base}src/source/harness-shell.html`);
    await page.waitForFunction(() => typeof window.marxySourceHarness?.sourceColour === 'function');
    // An opened block comment turns everything after it into comment.
    const source = await page.evaluate(async ({ b }) => window.marxySourceHarness.sourceColour(b, '/a.ts', 5000, { at: 13, insert: '/* ' }), { b: b64(Buffer.from(text)) });
    const edited = `${text.slice(0, 13)}/* ${text.slice(13)}`;
    const read = await page.evaluate(async ({ edited }) => window.marxySourceHarness.readColour(edited, 'typescript'), { edited });
    assert.equal(source.text, edited);
    assert.deepEqual(source.roles, read.roles);
    assert.equal(source.roles[edited.indexOf('function')], 'comment');
    assert.equal(source.roles[0], 'keyword');
  } finally {
    await browser.close();
  }
});
