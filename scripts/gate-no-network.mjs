// No-network assertion (ADR-0009): render every corpus file through the sanitising pipeline in a real
// browser with all network access denied, and assert that zero requests were even attempted.
// Until apps/desktop's renderer is importable (MARXY-012) this uses the same parse→sanitise stage
// (markdown-it + DOMPurify) in a harness page, which is the stage that must already hold.
import { chromium, webkit } from 'playwright';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const corpus = new URL('../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).filter(f => f.endsWith('.md'));
const md = readFileSync(new URL('../node_modules/markdown-it/dist/browser/markdown-it.umd.min.js', import.meta.url), 'utf8');
const purify = readFileSync(new URL('../node_modules/dompurify/dist/purify.min.js', import.meta.url), 'utf8');
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
let total = 0; const attempted = [];
for (const engine of [webkit, chromium]) {
  const browser = await engine.launch(); const ctx = await browser.newContext();
  await ctx.route('**/*', route => { const u = route.request().url(); if (!u.startsWith('about:') && !u.startsWith('data:text/html')) attempted.push(`${engine.name()} ${u.slice(0, 120)}`); route.abort(); });
  const page = await ctx.newPage();
  for (const f of files) {
    const src = readFileSync(new URL(f, corpus), 'utf8');
    const html = `<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"><body><article id=a></article><script>${md}</script><script>${purify}</script><script>
      const out = markdownit({ html: true, linkify: false }).render(${JSON.stringify(src)});
      document.getElementById('a').innerHTML = DOMPurify.sanitize(out, { USE_PROFILES: { html: true }, FORBID_TAGS: ['img','iframe','object','embed','form','meta','link','svg','style'], ALLOWED_URI_REGEXP: /^(?:https?|mailto|#|\\/)/i });
    </script>`;
    await page.setContent(html, { waitUntil: 'load' });
    total++;
  }
  await browser.close();
}
writeFileSync(new URL('../results/no-network.json', import.meta.url), JSON.stringify({ files: total, attempted }, null, 2));
if (attempted.length) { console.error(`no-network gate failed: ${attempted.length} requests attempted\n - ` + attempted.slice(0, 20).join('\n - ')); process.exit(1); }
console.log(`no-network gate ok: ${files.length} corpus files × 2 engines, 0 requests attempted`);
