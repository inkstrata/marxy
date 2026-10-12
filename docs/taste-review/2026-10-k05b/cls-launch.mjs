// K-05b: what the reader sees when a launch document's kind profile changes the face, size or column. This boots each
// page as the launch document, records the page's block rects every frame from before boot (the aesthetics gate's own
// `snapshotBlocks` and `movedFraction`), and prints the layout shift from the first frame with text on: the sum of the
// moved fraction across every consecutive pair of frames (the layout-shift score; the gate fails any value above 0).
// On a head that decides the kind before first paint (K-05a.1) the attribute is on in the first frame with text and
// the score is 0; on a head that decides it just after first text (K-05a), the attribute lands in a later frame and the
// page moves (worst frame 0.24 readme, 0.38 article, 0.45 report; summed over the launch 0.43, 0.38, 0.75, measured on
// K-05b's first head, before K-05a.1). The gate itself starts measuring after
// `ready`, when the attribute is already on, so it cannot see either.
//
//   node docs/taste-review/2026-10-k05b/cls-launch.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { serve, corpus, repo } from '../2026-10-walk/capture.mjs';

const pages = { readme: ['/w/README.md', '02-readme-real-world.md'], article: ['/w/essay.md', '01-long-technical.md'], report: ['/w/plan.md', '03-ai-plan.md'] };
const srv = await serve(repo);
const html = readFileSync(join(srv.desktop, 'index.html'), 'utf8');
const style = html.match(/<!-- marxy:default-theme -->\s*<style>([\s\S]*?)<\/style>/)[1];
const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const browser = await launchWebkit();
try {
  for (const variant of ['dark', 'light']) {
    for (const [key, [path, file]] of Object.entries(pages)) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.route(`${srv.base}app.html`, async (route) => {
        const response = await route.fetch();
        const text = (await response.text())
          .replace('</head>', `<style>${style}</style></head>`)
          .replace(/<body[^>]*>/, `<body data-marxy-mode="rendered" data-marxy-variant="${variant}">`)
          .replace('<article id="doc" class="marxy-article"></article>', body);
        await route.fulfill({ response, body: text });
      });
      await page.goto(`${srv.base}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      const files = { [path]: b64(corpus(file)), '/config': b64(`variant = "${variant}"\n`) };
      const result = await page.evaluate(async ({ files, path }) => {
        const { snapshotBlocks, movedFraction } = await import('/src/harness/layout-shift.ts');
        const bytes = Object.fromEntries(Object.entries(files).map(([p, t]) => [p, Uint8Array.from(atob(t), (c) => c.charCodeAt(0))]));
        const { createMemoryShell } = await import('/src/shell/memory.ts');
        const { bootApplication } = await import('/src/main.ts');
        const pane = document.querySelector('section.marxy-pane');
        const doc = document.getElementById('doc');
        const frames = [];
        let stop = false;
        const tick = () => {
          frames.push({ kind: pane.getAttribute('data-marxy-kind'), blocks: doc.childElementCount ? snapshotBlocks(doc) : [], t: performance.now() });
          if (!stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const handle = await bootApplication(createMemoryShell(bytes), { argv: [path] });
        await handle.ready;
        await new Promise((r) => setTimeout(r, 600));
        stop = true;
        // K-05a.1 decides the kind before the first paint, so the attribute is on in the first frame that has text.
        // The shift is then the sum of the moved fraction across every consecutive pair of frames from first text
        // on (the layout-shift score), which is 0 when nothing moves after first text, whatever the cause.
        const withText = frames.findIndex((f) => f.blocks.length > 0);
        if (withText < 0) return { error: 'no frame ever had text' };
        let cls = 0;
        let worst = 0;
        for (let i = withText + 1; i < frames.length; i += 1) {
          const m = movedFraction(frames[i - 1].blocks, frames[i].blocks);
          cls += m;
          worst = Math.max(worst, m);
        }
        return {
          kind: frames[withText].kind,
          kindOnAtFirstText: frames[withText].kind !== null,
          cls: Number(cls.toFixed(4)),
          worstFrame: Number(worst.toFixed(4)),
          frames: frames.length - withText,
        };
      }, { files, path });
      console.log(`${variant} ${key}: ${JSON.stringify(result)}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await srv.close();
}
