// K-10a's pair (ADR-0070): the depth lens, before and after, in Night and Paper. The mock has no JSON page, so the pair is
// the app beside itself: the fixture as Source shows it, then folded to depth 2 by the palette command. scripts/mock-pair.mjs
// has no data screen, and a screen added there would collide with the stories that edit its table; this file borrows its
// themes and its way of booting the app. Local tooling for a human to look at; nothing on the pull-request path runs it.
//   node docs/taste-review/2026-10-12-K-10a/capture.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, configFor } from '../../../scripts/mock-pair.mjs';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import * as support from '../../../apps/desktop/test/support/two-pane.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const PATH = '/Users/reader/proj/bench/results.json';
// The research's fixture (03-structured-output.md): 60 items of { id, name, tags, ok }, 544 lines pretty-printed.
const SOURCE = JSON.stringify(
  { items: Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `run-${String(i + 1).padStart(2, '0')}`, tags: ['cold', 'warm'], ok: i % 7 !== 3 })) },
  null,
  2,
);

const browser = await launchWebkit();
try {
  for (const id of ['night', 'paper']) {
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
    const files = { [PATH]: SOURCE, ...(config === null ? {} : { '/config': config }) };
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
      },
      { encoded, open: PATH },
    );
    await page.waitForSelector('#marxy-source .cm-line');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `10-depth-lens-${id}-before.png`) });
    await page.evaluate(async () => {
      const { commands } = await import('/src/commands/index.ts');
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const ctx = buildAppContext(window.__marxyHandle);
      const cmd = commands().find((c) => c.id === 'source.fold-depth-2');
      if (!cmd.when(ctx)) throw new Error('Fold to depth 2 is not offered');
      await cmd.run(ctx);
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `10-depth-lens-${id}-after.png`) });
    await context.close();
    console.log(`10-depth-lens ${id}`);
  }
} finally {
  await browser.close();
  await support.closeHarness();
}

const figure = (th) => `      <figure>
        <div><a href="10-depth-lens-${th.id}-before.png"><img src="10-depth-lens-${th.id}-before.png" alt="results.json in Source, unfolded, ${th.label}" loading="lazy"></a><a href="10-depth-lens-${th.id}-after.png"><img src="10-depth-lens-${th.id}-after.png" alt="results.json in Source, folded to depth 2, ${th.label}" loading="lazy"></a></div>
        <figcaption><span>Before: 544 lines, nothing folded</span><span>After: Fold to depth 2, each fold says its count</span><b>${th.label}</b></figcaption>
      </figure>`;
writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The depth lens, before and after</title>
<style>
  :root { --bg: #f6f5f2; --fg: #1d1d1f; --muted: #5d5f63; --line: #d9d7d2; --card: #ffffff; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111214; --fg: #e3e5e8; --muted: #9a9ea4; --line: #2a2c30; --card: #17181a; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  main { max-width: 1500px; margin: 0 auto; padding: 24px 16px 80px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  small { color: var(--muted); font-size: 12.5px; }
  figure { margin: 12px 0 16px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
  figure > div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  figure > div img { width: 100%; height: auto; display: block; border-radius: 4px; border: 1px solid var(--line); }
  figcaption { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; font-size: 12px; color: var(--muted); padding-top: 6px; }
</style>
</head>
<body>
<main>
  <h1>The depth lens, before and after</h1>
  <p><small>K-10a. The mock has no JSON page, so there is no mock side: the same file in Source, then folded to depth 2 by the palette command. Made by capture.mjs beside this file.</small></p>
${THEMES.filter((t) => ['night', 'paper'].includes(t.id)).map(figure).join('\n')}
</main>
</body>
</html>
`,
);
console.log('wrote index.html');
