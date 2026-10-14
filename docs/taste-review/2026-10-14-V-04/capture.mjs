// V-04's pair (ADR-0070): Source with note marks, in Night and Paper, and Paper/Night again with W-22's increase-contrast on.
// The mock has no notes (it was drawn before the story), so the mock side is its Source page, 01-workspace with Source on
// (`node scripts/mock-pair.mjs 02-source-folded --side mock --out <this dir>`), and the app side is a document whose three
// notes show: a heading that skips a level, a path that is not there and a fence that is never closed.
// Local tooling for a human to look at; nothing on the pull-request path runs it.
//   node docs/taste-review/2026-10-14-V-04/capture.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { THEMES, configFor } from '../../../scripts/mock-pair.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import * as support from '../../../apps/desktop/test/support/two-pane.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const PATH = '/r/notes/handoff.md';
const SOURCE = [
  '# Handoff: the indexer',
  '',
  'Where the work stands, what was tried, and what is next.',
  '',
  '## State',
  '',
  'The watcher reads `src/watch.rs` and writes `src/index.rs`; the run is described in `docs/runbook.md`.',
  '',
  '#### Open questions',
  '',
  '- Should a rename keep the old row until the next scan?',
  '- Does the debounce belong in the watcher or the writer?',
  '',
  '## Next',
  '',
  'Run the check and paste what it prints:',
  '',
  '```sh',
  'cargo test -p indexer',
  '',
].join('\n');
const SIBLINGS = { '/r/notes/docs/index.md': '# docs\n', '/r/notes/src/watch.rs': 'fn main() {}\n', '/r/notes/src/index.rs': 'fn main() {}\n' };

const browser = await launchWebkit();
try {
  for (const id of ['night', 'paper']) {
    for (const more of [false, true]) {
      const theme = THEMES.find((t) => t.id === id);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme.scheme, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const base = await support.harnessBase();
      const { style, body } = support.shippedSkeleton();
      await page.route(`${base}app.html`, async (route) => {
        const response = await route.fetch();
        const html = (await response.text())
          .replace('</head>', `<style>${style}</style></head>`)
          .replace(/<body[^>]*>/, `<body data-marxy-mode="rendered" data-marxy-variant="${theme.scheme}">`)
          .replace('<article id="doc" class="marxy-article"></article>', body);
        await route.fulfill({ response, body: html });
      });
      await page.goto(`${base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      const config = configFor(theme);
      const files = { [PATH]: SOURCE, ...SIBLINGS, ...(config === null ? {} : { '/config': config }) };
      const encoded = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, support.b64(t)]));
      await page.evaluate(
        async ({ encoded, open }) => {
          const bytes = {};
          for (const [path, text] of Object.entries(encoded)) bytes[path] = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
          const { createMemoryShell } = await import('/src/shell/memory.ts');
          const { bootApplication } = await import('/src/main.ts');
          const handle = await bootApplication(createMemoryShell(bytes), { argv: [open] });
          await handle.ready;
          window.__marxyHandle = handle;
          const { commands } = await import('/src/commands/index.ts');
          await commands().find((c) => c.id === 'view.mode-source').run({});
        },
        { encoded, open: PATH },
      );
      if (more) await page.evaluate(() => document.documentElement.setAttribute('data-marxy-contrast', 'more'));
      await page.waitForSelector('#marxy-source .cm-line');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.querySelectorAll('.marxy-source-mark-note').length === 3, null, { timeout: 15000 }).catch(async (e) => {
        console.error(await page.evaluate(() => [...document.querySelectorAll('.marxy-source-mark-note')].map((m) => m.title)));
        throw e;
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT, `02-source-notes-${id}-app${more ? '-more-contrast' : ''}.png`) });
      await context.close();
      console.log(`02-source-notes ${id}${more ? ' more contrast' : ''}`);
    }
  }
} finally {
  await browser.close();
  await support.closeHarness();
}

const figure = (th) => `      <figure>
        <div><a href="02-source-notes-${th.id}-app.png"><img src="02-source-notes-${th.id}-app.png" alt="handoff.md in Source with three note marks, ${th.label}" loading="lazy"></a><a href="02-source-notes-${th.id}-app-more-contrast.png"><img src="02-source-notes-${th.id}-app-more-contrast.png" alt="the same with increase contrast, ${th.label}" loading="lazy"></a><a href="02-source-folded-${th.id}-mock.png"><img src="02-source-folded-${th.id}-mock.png" alt="mock-v2 Source, ${th.label}" loading="lazy"></a></div>
        <figcaption><span>App: three notes (a heading skips a level, a path is not there, a fence is never closed)</span><span>App, increase contrast</span><span>Mock-v2 Source (it has no note marks)</span><b>${th.label}</b></figcaption>
      </figure>`;
writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notes in Source, app beside mock</title>
<style>
  :root { --bg: #f6f5f2; --fg: #1d1d1f; --muted: #5d5f63; --line: #d9d7d2; --card: #ffffff; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111214; --fg: #e3e5e8; --muted: #9a9ea4; --line: #2a2c30; --card: #17181a; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 1700px; margin: 0 auto; padding: 24px 16px 80px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  small { color: var(--muted); font-size: 12.5px; }
  figure { margin: 12px 0 16px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
  figure > div { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  figure > div img { width: 100%; height: auto; display: block; border-radius: 4px; border: 1px solid var(--line); }
  figcaption { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; font-size: 12px; color: var(--muted); padding-top: 6px; }
</style>
</head>
<body>
<main>
  <h1>Notes in Source, app beside mock</h1>
  <p><small>V-04. Made by capture.mjs beside this file; the mock side by mock-pair.mjs 02-source-folded --side mock.</small></p>
${THEMES.filter((t) => ['night', 'paper'].includes(t.id)).map(figure).join('\n')}
</main>
</body>
</html>
`,
);
