// No-network assertion (ADR-0009): put every corpus document through the real @marxy/core
// parse → render → sanitise pipeline, in a real browser, in both engines, and assert that nothing in
// the result reaches off the machine. Nothing here comes from apps/desktop (ADR-0020).
//
// The assertion is a measurement, not a silence. Two controls run first in each engine: a page that
// deliberately fetches, which must be observed, and the hostile fixture rendered *without* the
// sanitiser, which must also be observed. If either control is quiet then the interception is not
// watching, the corpus pass would prove nothing, and the gate fails on that alone.
//
// The document is served from an origin of our own rather than injected into `about:blank`, so a
// relative reference in a document becomes a same-origin request instead of something each engine
// invents a different scheme for. A same-origin request is the reader's own directory, which the
// shell resolves through `asset:` and which cannot tell anyone anything (MARXY-26); it is reported,
// and checked against the document's source. Any other origin is a read receipt and fails the gate.
//
// The harness sets no Content-Security-Policy on purpose. A CSP would suppress these requests before
// the network layer saw them, and the gate would be measuring the CSP the shell will ship (MARXY-45)
// instead of the allow-list this gate exists to check.
import { chromium, webkit } from 'playwright';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { renderSafeHtml, renderToUnsanitisedHtml } from '../packages/core/src/render/index.ts';
import { parseMarkdown } from '../packages/core/src/parse/parse.ts';

const corpus = new URL('../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).filter((file) => file.endsWith('.md')).sort();
if (files.length === 0) { console.error('no-network gate failed: the corpus has no markdown files, so this gate would prove nothing'); process.exit(1); }

const ORIGIN = 'https://document.marxy.invalid';
const HARNESS = `${ORIGIN}/harness`;
const CONTROL_HOST = 'no-network-control.invalid';
/** A page that tries every shape of request the corpus pass claims never happens. */
const controlPage = [
  `<link rel="stylesheet" href="https://${CONTROL_HOST}/theme.css">`,
  `<img src="https://${CONTROL_HOST}/pixel.gif" alt="control">`,
  `<script src="https://${CONTROL_HOST}/s.js"></script>`,
  `<script>fetch('https://${CONTROL_HOST}/beacon').catch(() => {});</script>`,
].join('\n');

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body><article id="doc">\n${body}\n</article></body></html>`;

const report = { files: files.length, controls: {}, sameOrigin: [], remote: [], rendered: {} };
const failures = [];

for (const engine of [webkit, chromium]) {
  const name = engine.name();
  const browser = await engine.launch();
  const context = await browser.newContext();
  let body = page('');
  let observed = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url === HARNESS) { route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }); return; }
    observed.push(url);
    route.abort();
  });
  const tab = await context.newPage();
  // A second observer, because a request the router never sees is still a request.
  tab.on('request', (request) => { const url = request.url(); if (url !== HARNESS) observed.push(url); });

  const run = async (html) => {
    body = page(html);
    observed = [];
    await tab.goto(HARNESS, { waitUntil: 'load' });
    await tab.waitForTimeout(150);
    const unique = [...new Set(observed)];
    return {
      sameOrigin: unique.filter((url) => url.startsWith(`${ORIGIN}/`)),
      remote: unique.filter((url) => !url.startsWith(`${ORIGIN}/`)),
    };
  };

  // Control 1: the interception is watching, and can see every shape of request.
  const control = await run(controlPage);
  if (!control.remote.some((url) => url.includes(CONTROL_HOST))) {
    failures.push(`${name}: the control page attempted no observable request, so this gate cannot see one and every result below is vacuous`);
  }
  report.controls[`${name}/interception`] = control.remote.length;

  // Control 2: the hostile fixture, rendered without the sanitiser, is observed reaching out — which
  // is what makes the sanitised pass below a statement about the sanitiser rather than about markdown.
  const hostileSource = readFileSync(new URL('10-hostile.md', corpus), 'utf8');
  const hostile = await run(renderToUnsanitisedHtml(parseMarkdown(hostileSource, { file: '10-hostile.md' })));
  if (hostile.remote.length === 0) {
    failures.push(`${name}: the hostile fixture reached no remote host with the sanitiser removed, so the sanitised pass proves nothing`);
  }
  report.controls[`${name}/unsanitised-hostile`] = hostile.remote.length;

  // The corpus, through the pipeline a reader's DOM is allowed to see.
  for (const file of files) {
    const source = readFileSync(new URL(file, corpus), 'utf8');
    const { html, removed } = renderSafeHtml(source, { file });
    if (html.trim() === '' && source.trim() !== '') {
      failures.push(`${name}: ${file} rendered to nothing, so asserting over it would prove nothing`);
    }
    const { sameOrigin, remote } = await run(html);
    for (const url of remote) report.remote.push(`${name} ${file} ${url.slice(0, 160)}`);
    for (const url of sameOrigin) {
      report.sameOrigin.push(`${name} ${file} ${url.slice(0, 160)}`);
      // A same-origin request may only be a relative reference the document actually contains.
      const reference = url.slice(ORIGIN.length + 1);
      if (reference !== '' && !source.includes(reference.split('/').pop())) {
        failures.push(`${name}: ${file} requested ${url}, which is not a reference in the document`);
      }
    }
    report.rendered[file] = { bytes: html.length, removed: removed.length };
  }
  await browser.close();
}

mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/no-network.json', import.meta.url), JSON.stringify(report, null, 2));

if (report.remote.length > 0) {
  failures.push(`${report.remote.length} request(s) left the document's own directory:\n - ${report.remote.slice(0, 20).join('\n - ')}`);
}
if (failures.length > 0) {
  console.error(`no-network gate failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
const controls = Object.entries(report.controls).map(([key, count]) => `${key}=${count}`).join(', ');
console.log(`no-network gate ok: ${files.length} corpus files × 2 engines through parse→render→sanitise, 0 remote requests attempted, ${report.sameOrigin.length} local reference(s) resolved in the document's own directory; controls observed ${controls}`);
