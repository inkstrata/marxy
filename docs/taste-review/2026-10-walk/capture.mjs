// The taste walk's screenshots (X-11). One command regenerates every PNG in this folder:
//
//   node docs/taste-review/2026-10-walk/capture.mjs [--h04 <path to a worktree of #551's head>] [--only <name,...>]
//
// The H-04 worktree can also come from MARXY_H04_WORKTREE; it defaults to ../X-11-h04 beside the
// repository when that folder exists. Without it, section 1 is captured for `main` only.
// Headless Playwright WebKit over the app's own harness page (apps/desktop/app.html, served by Vite) booted on a
// memory shell: no GUI window, no network, nothing written outside this folder. The recipe is
// docs/plan/roadmap-2026-10/harness-map.md.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const h04Arg = arg('--h04') ?? process.env.MARXY_H04_WORKTREE ?? resolve(repo, '../X-11-h04');
const h04 = existsSync(join(h04Arg, 'apps/desktop/app.html')) ? resolve(h04Arg) : null;
const only = arg('--only')?.split(',');
const MAX_TALL = 2400; // the folder's limit; a tall capture stops at TALL, two screens, to keep the folder small
const TALL = 1600;
const W = 1280;
const H = 800;

/** One Vite dev server over `root`'s apps/desktop, on a free port; vite comes from that checkout's own install. */
async function serve(root) {
  const desktop = join(root, 'apps/desktop');
  const { createServer } = await import(pathToFileURL(createRequire(join(desktop, 'package.json')).resolve('vite')).href);
  const server = await createServer({
    root: desktop,
    configFile: join(desktop, 'vite.config.ts'),
    logLevel: 'silent',
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  return { base: `http://127.0.0.1:${server.config.server.port}/`, desktop, close: () => server.close() };
}

/** The shipped skeleton of index.html: its inline default-theme style and its body without scripts. */
function skeleton(desktop) {
  const html = readFileSync(join(desktop, 'index.html'), 'utf8');
  const style = html.match(/<!-- marxy:default-theme -->\s*<style>([\s\S]*?)<\/style>/)?.[1];
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/)?.[1].replace(/<script[\s\S]*?<\/script>/g, '');
  if (!style || !body) throw new Error('index.html has no inline style or body');
  return { style, body };
}

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const read = (rel) => readFileSync(join(repo, rel), 'utf8');
const corpus = (name) => read(`fixtures/corpus/${name}`);
const entryOf = (path, text, kind = 'markdown') => ({
  path,
  root: dirname(path),
  title: text.match(/^# (.*)$/m)?.[1] ?? path.split('/').pop(),
  headings: [],
  mtimeMs: 1,
  size: text.length,
  kind,
});

/**
 * A fresh page on `srv` booted on `files` ({ path: text }), opening `open` (first in the left pane, the rest
 * beside it in turn), in `variant` ('dark' | 'light'), with `config` lines added to /config.
 */
async function boot(browser, srv, { files, open, variant = 'dark', config = '', width = W, height = H, entries = [], scale = 1 }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  const { style, body } = skeleton(srv.desktop);
  await page.route(`${srv.base}app.html`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('</head>', `<style>${style}</style></head>`)
      .replace(/<body[^>]*>/, `<body data-marxy-mode="rendered" data-marxy-variant="${variant}">`)
      .replace('<article id="doc" class="marxy-article"></article>', body);
    await route.fulfill({ response, body: html });
  });
  await page.goto(`${srv.base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  const all = { ...files, '/config': `variant = "${variant}"\n${config}` };
  const encoded = Object.fromEntries(Object.entries(all).map(([p, t]) => [p, b64(t)]));
  await page.evaluate(
    async ({ encoded, open, entries }) => {
      const bytes = {};
      for (const [p, t] of Object.entries(encoded)) bytes[p] = Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
      const { createMemoryShell } = await import('/src/shell/memory.ts');
      const { bootApplication } = await import('/src/main.ts');
      const handle = await bootApplication(createMemoryShell(bytes), { argv: [open[0]] });
      await handle.ready;
      window.__marxyHandle = handle;
      handle.palette.setIndexEntries(entries);
      for (const p of open.slice(1)) await handle.panes().openIn('other', p);
    },
    { encoded, open, entries },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return page;
}

const outDir = here;
const written = [];
/** Screenshots `page` to `name`.png: the viewport, or with `tall` the page down to TALL px. */
async function shot(page, name, { tall = false } = {}) {
  const path = join(outDir, `${name}.png`);
  if (tall) {
    const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    await page.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: W, height: Math.min(height, TALL) } });
  } else {
    await page.screenshot({ path });
  }
  written.push(`${name}.png`);
  console.log(`  ${name}.png`);
}


export const sections = {};
export { boot, shot, serve, corpus, read, entryOf, repo, h04 };

/** Section 1: main against #551, Night/Paper (dark/light) on four pages and the split. */
sections['s1-h04'] = async (browser, servers) => {
  const pages = {
    readme: ['02-readme-real-world.md', false],
    article: ['01-long-technical.md', true],
    code: ['19-source-file.md', true],
  };
  const files = Object.fromEntries(Object.values(pages).map(([f]) => [`/w/${f}`, corpus(f)]));
  files['/w/14-marxy-plan.md'] = corpus('14-marxy-plan.md');
  for (const [side, srv] of servers) {
    for (const variant of ['dark', 'light']) {
      for (const [key, [file, tall]] of Object.entries(pages)) {
        const page = await boot(browser, srv, { files, open: [`/w/${file}`], variant });
        await shot(page, `s1-${side}-${variant}-${key}`, { tall });
        await page.close();
      }
      const page = await boot(browser, srv, { files, open: ['/w/02-readme-real-world.md', '/w/14-marxy-plan.md'], variant });
      await shot(page, `s1-${side}-${variant}-split`);
      await page.close();
    }
  }
};


const HOUR = 3_600_000;
/** Index rows for the palette: the path decides each row's kind glyph, the age is relative to now. */
function paletteEntries(rows) {
  return rows.map(([path, text, hoursAgo]) => ({ ...entryOf(path, text), mtimeMs: Date.now() - hoursAgo * HOUR }));
}
const palettePage = [
  ['/w/README.md', '# widgetlib\n', 2],
  ['/w/CHANGELOG.md', '# Changelog\n', 26],
  ['/w/plan.md', '# Release plan\n', 5],
  ['/w/report.html', '<h1>Report</h1>', 70],
  ['/w/build-index.py', 'print(1)\n', 8],
  ['/w/server.log', '2026-10-09 10:00:01 INFO started\n', 30],
  ['/w/dataset.json', '{}\n', 200],
  ['/w/notes/2026-10-09.md', '# Standup\n', 48],
  ['/w/fix-needed.patch', '--- a\n+++ b\n', 3],
];
const paletteFiles = Object.fromEntries(palettePage.map(([p, t]) => [p, t]));

/** The reader's own place for each Rendered page: palette on a query, the outline, and the verb menu. */
async function openPalette(page, query = '') {
  await page.keyboard.press('Meta+p');
  if (query) await page.keyboard.type(query);
  await page.waitForTimeout(500);
}

/** Section 2: two documents beside each other, the notice bar in a pane (Phase D). */
sections['s2-split'] = async (browser, servers) => {
  const srv = servers[0][1];
  const files = { '/w/02-readme-real-world.md': corpus('02-readme-real-world.md'), '/w/14-marxy-plan.md': corpus('14-marxy-plan.md') };
  for (const variant of ['dark', 'light']) {
    const page = await boot(browser, srv, { files, open: ['/w/14-marxy-plan.md', '/w/02-readme-real-world.md'], variant });
    await shot(page, `s2-split-${variant}`);
    await page.close();
  }
};

/** Section 3: the verb menu on a table, All actions…, and the palette's operations under `>`. */
sections['s3-verbs'] = async (browser, servers) => {
  const srv = servers[0][1];
  const files = { '/w/03-ai-plan.md': corpus('03-ai-plan.md') };
  for (const variant of ['dark', 'light']) {
    const page = await boot(browser, srv, { files, open: ['/w/03-ai-plan.md'], variant });
    const table = page.locator('table').first();
    await table.scrollIntoViewIfNeeded();
    await table.click({ button: 'right', position: { x: 60, y: 30 } });
    await page.waitForTimeout(400);
    await shot(page, `s3-verb-menu-${variant}`);
    await page.locator('.marxy-verb-menu-item', { hasText: 'All actions' }).click();
    await page.waitForTimeout(500);
    await shot(page, `s3-all-actions-${variant}`);
    await page.keyboard.type('align');
    await page.waitForTimeout(400);
    await shot(page, `s3-operations-${variant}`);
    await page.close();
  }
};

/** Sections 4 and 5: the palette and outline edges (H-03.1) and the kind glyphs (K-18). */
sections['s4-edges'] = async (browser, servers) => {
  const srv = servers[0][1];
  const files = { ...paletteFiles, '/w/01-long-technical.md': corpus('01-long-technical.md') };
  for (const variant of ['dark', 'light']) {
    const page = await boot(browser, srv, { files, open: ['/w/01-long-technical.md'], variant, entries: paletteEntries(palettePage) });
    await openPalette(page, 'e');
    await shot(page, `s4-palette-${variant}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Shift+o');
    await page.waitForTimeout(500);
    await shot(page, `s4-outline-${variant}`);
    await page.close();
    // K-18: the palette's rows alone at twice the density, 640 CSS px wide so the PNG is 1280 wide.
    const zoom = await boot(browser, srv, { files, open: ['/w/01-long-technical.md'], variant, entries: paletteEntries(palettePage), scale: 2 });
    await openPalette(zoom, 'e');
    const box = await zoom.locator('#marxy-palette').boundingBox();
    const name = `s5-glyphs-${variant}`;
    await zoom.screenshot({ path: join(outDir, `${name}.png`), clip: { x: box.x - 4, y: box.y - 4, width: 640 - 0, height: Math.min(box.height + 8, 400) } });
    written.push(`${name}.png`);
    console.log(`  ${name}.png`);
    await zoom.close();
  }
};

/** A task list with no working headings: ADR-0060 tier 6 reads it as a `report` (K-03). */
const TASKS_DOC = `# Launch checklist

A short list the team keeps open while the release goes out.

- [x] Tag the release candidate
- [x] Run the nightly suites
- [ ] Write the release notes
- [ ] Check the installer on a clean machine
  - [ ] macOS 15
  - [ ] macOS 26
- [ ] Announce
`;

/** Sections 6 and 7: the page a task list makes, what K-03 calls it, and what Copy as plain text copies from a list. */
sections['s6-tasks'] = async (browser, servers) => {
  const srv = servers[0][1];
  const { detectKind } = await import(pathToFileURL(join(repo, 'packages/core/src/kind/detect.ts')).href);
  const result = detectKind({ path: '/w/launch-checklist.md', head: new TextEncoder().encode(TASKS_DOC) });
  const lines = [`kind: ${result.kind}`, ...result.reasons.map((r) => `tier ${r.tier}${r.decisive ? ' (decides)' : ''}: ${r.signal} -> ${r.kind} at ${r.at}`)];
  writeText('s6-kind.txt', lines.join('\n') + '\n');
  const files = { '/w/launch-checklist.md': TASKS_DOC, '/w/03-ai-plan.md': corpus('03-ai-plan.md') };
  for (const variant of ['dark', 'light']) {
    const page = await boot(browser, srv, { files, open: ['/w/launch-checklist.md'], variant });
    await shot(page, `s6-tasks-${variant}`);
    await page.close();
  }
  // E-11: right-click a list item with sub-items, take the "plain text" row, read what the shell was asked to copy.
  const page = await boot(browser, srv, { files, open: ['/w/03-ai-plan.md'] });
  const item = page.locator('li', { hasText: 'Attestation policy decided' }).first();
  await item.click({ button: 'right', position: { x: 40, y: 8 } });
  await page.waitForTimeout(300);
  await page.locator('.marxy-verb-menu-item', { hasText: 'plain text' }).click();
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => {
    const call = window.__marxyHandle.shell.calls.filter((c) => /clipboard/i.test(c.method ?? c.name ?? JSON.stringify(c))).pop();
    return call ? JSON.stringify(call) : null;
  });
  const parsed = copied ? JSON.parse(copied) : null;
  const text = parsed?.args?.[0]?.text ?? parsed?.args?.[0] ?? parsed?.text ?? copied;
  writeText('s7-copy-plain.txt', String(text).replace(/\n?$/, '\n'));
  await page.close();
};

function writeText(name, text) {
  writeFileSync(join(outDir, name), text);
  written.push(name);
  console.log(`  ${name}`);
}

/** Section 9: Source metrics today (18 on 30 px) against V-12's proposal (14 on 21 px). The proposal is a style override on the page. */
sections['s9-source'] = async (browser, servers) => {
  const srv = servers[0][1];
  const files = { '/w/04-source.py': corpus('04-source.py') };
  for (const variant of ['dark', 'light']) {
    for (const [tag, css] of [['today', ''], ['v12', ':root{--marxy-size-code:14px;--marxy-line-box-code:21px}']]) {
      const page = await boot(browser, srv, { files, open: ['/w/04-source.py'], variant });
      // A notice about the file's HTML can sit over Source (the script quotes <label>); dismiss it.
      await page.locator('button', { hasText: 'Dismiss' }).first().click({ timeout: 1000 }).catch(() => {});
      if (css) await page.addStyleTag({ content: css });
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => {
        const line = document.querySelector('.cm-line');
        return line ? [getComputedStyle(line).fontSize, getComputedStyle(line).lineHeight] : null;
      });
      console.log(`  ${tag} ${variant}: ${JSON.stringify(metrics)}`);
      await shot(page, `s9-source-${tag}-${variant}`);
      await page.close();
    }
  }
};

async function main() {
  const servers = [['main', await serve(repo)]];
  if (h04) servers.push(['h04', await serve(h04)]);
  else console.warn('no H-04 worktree found: section 1 is captured for main only');
  const browser = await launchWebkit();
  try {
    for (const [name, run] of Object.entries(sections)) {
      if (only && !only.includes(name)) continue;
      console.log(name);
      await run(browser, servers);
    }
  } finally {
    await browser.close();
    for (const [, srv] of servers) await srv.close();
  }
  if (!only) verify();
}

/** The folder's own limits: every PNG 1280 px wide and at most 2,400 tall, the folder under 8 MB. */
function verify() {
  let bytes = 0;
  for (const name of readdirSync(outDir)) {
    const size = statSync(join(outDir, name)).size;
    bytes += size;
    if (!name.endsWith('.png')) continue;
    const head = readFileSync(join(outDir, name)).subarray(16, 24);
    const [w, h] = [head.readUInt32BE(0), head.readUInt32BE(4)];
    if (w !== W || h > MAX_TALL) throw new Error(`${name} is ${w} x ${h}; want ${W} wide and at most ${MAX_TALL} tall`);
  }
  if (bytes > 8 * 1024 * 1024) throw new Error(`the folder is ${bytes} bytes; the limit is 8 MB`);
  console.log(`ok: ${written.length} files written, folder ${(bytes / 1048576).toFixed(2)} MB`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
