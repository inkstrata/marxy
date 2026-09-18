// No-network assertion (ADR-0009): put every corpus document and every named vector through the
// real @marxy/core parse → render → sanitise pipeline, in a real browser, in both engines, and
// assert that nothing in the result reaches off the machine and nothing outside the allow-list
// reaches the DOM. Nothing here comes from apps/desktop (ADR-0020).
//
// The assertion is a measurement, not a silence. Three controls run first in each engine: a page
// that deliberately fetches, which must be observed; the hostile fixture rendered *without* the
// sanitiser, which must also be observed; and that same unsanitised render checked against the
// allow-list, which must be found to violate it. If any control is quiet then this gate is not
// watching, the passes below would prove nothing, and the gate fails on that alone.
//
// Documents are served from a real origin rather than injected into `about:blank`, so a relative
// reference becomes a same-origin request instead of something each engine invents a scheme for.
// The origin and the directory come from `@marxy/core`, where the assumption they encode is written
// down for MARXY-45 to reconcile with the shell's real scheme; they are not this harness's to pick.
//
// A same-origin request is only allowed if it resolves *inside the document's own directory* and
// the whole reference appears in the document's source. Anything else — including a path that
// climbs out of the directory — fails, because the shell will scope `asset:` to that directory and
// a gate that prints more than it checked is worse than one that prints less.
//
// The harness sets no Content-Security-Policy on purpose. A CSP would suppress these requests before
// the network layer saw them, and the gate would be measuring the CSP the shell will ship (MARXY-45)
// instead of the allow-list this gate exists to check.
import { chromium, webkit } from 'playwright';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { renderSafeHtml, renderToUnsanitisedHtml } from '../packages/core/src/render/index.ts';
import { parseMarkdown } from '../packages/core/src/parse/parse.ts';
import { sanitizeHtml } from '../packages/core/src/sanitize/sanitize-html.ts';
import { BLOCK_ELEMENTS, DEFAULT_POLICY } from '../packages/core/src/sanitize/policy.ts';
import { GATE_DOCUMENT_DIRECTORY, GATE_DOCUMENT_ORIGIN } from '../packages/core/src/sanitize/document-origin.ts';
import { VECTORS } from '../packages/core/src/sanitize/testing/vectors.ts';

const corpus = new URL('../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).filter((file) => file.endsWith('.md')).sort();
if (files.length === 0) { console.error('no-network gate failed: the corpus has no markdown files, so this gate would prove nothing'); process.exit(1); }

const CONTROL_HOST = 'no-network-control.invalid';
/**
 * A page that fetches in four ways the allow-list would have to fail for a document to reach: a
 * stylesheet, an image, a script and `fetch`. It is here to prove the interception sees a request,
 * not to enumerate every way one can be made — WebSocket, `sendBeacon`, a service worker and
 * dynamic import all need script or a `link`/`meta` element first, and none of those survive.
 */
const controlPage = [
  `<link rel="stylesheet" href="https://${CONTROL_HOST}/theme.css">`,
  `<img src="https://${CONTROL_HOST}/pixel.gif" alt="control">`,
  `<script src="https://${CONTROL_HOST}/s.js"></script>`,
  `<script>fetch('https://${CONTROL_HOST}/beacon').catch(() => {});</script>`,
].join('\n');

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body><article id="doc">\n${body}\n</article></body></html>`;

/** The allow-list as two flat lists, for the check that runs inside the browser. */
const allowed = {
  elements: Object.keys(DEFAULT_POLICY.elements),
  attributes: Object.fromEntries(Object.entries(DEFAULT_POLICY.elements).map(([element, rule]) => [
    element,
    [...Object.keys(DEFAULT_POLICY.globalAttributes), ...Object.keys(rule.attributes ?? {}), ...Object.keys(rule.forced ?? {})],
  ])),
  blocks: [...BLOCK_ELEMENTS],
};

const report = { files: files.length, vectors: VECTORS.length, controls: {}, contained: [], escaped: [], remote: [], violations: [], rendered: {} };
const failures = [];

for (const engine of [webkit, chromium]) {
  const name = engine.name();
  const browser = await engine.launch();
  const context = await browser.newContext();
  let body = page('');
  let documentUrl = `${GATE_DOCUMENT_DIRECTORY}document.html`;
  let observed = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url === documentUrl) { route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }); return; }
    observed.push(url);
    route.abort();
  });
  const tab = await context.newPage();
  // A second observer, because a request the router never sees is still a request.
  tab.on('request', (request) => { const url = request.url(); if (url !== documentUrl) observed.push(url); });

  /** Loads a document at its own path in the corpus directory and reports what it attempted. */
  const run = async (html, where = 'document.html') => {
    body = page(html);
    documentUrl = new URL(where, GATE_DOCUMENT_DIRECTORY).href;
    observed = [];
    await tab.goto(documentUrl, { waitUntil: 'load' });
    await tab.waitForTimeout(150);
    const unique = [...new Set(observed)];
    const directory = new URL('./', documentUrl).href;
    // A document that takes the reader somewhere has already done the harm; it is also why the DOM
    // below may be unreadable, so both are recorded as what they are rather than as a quiet zero.
    const live = tab.url() === documentUrl
      ? await tab.evaluate(({ elements, attributes, blocks }) => {
        const found = [];
        for (const element of document.querySelectorAll('#doc *')) {
          const tag = element.tagName.toLowerCase();
          if (!elements.includes(tag)) { found.push(`<${tag}>`); continue; }
          for (const attribute of element.getAttributeNames()) {
            if (!attributes[tag].includes(attribute.toLowerCase())) found.push(`${tag}[${attribute}]`);
          }
          // The tree the engine built, not the one the sanitiser meant to emit: a block inside a
          // formatting element is what an unclosed `<a>` looks like once a parser has had it, and
          // it means every click in that block goes wherever the anchor points.
          if (!blocks.includes(tag)) continue;
          for (let parent = element.parentElement; parent !== null && parent.id !== 'doc'; parent = parent.parentElement) {
            const name = parent.tagName.toLowerCase();
            if (!blocks.includes(name)) found.push(`<${tag}> inside <${name}>`);
          }
        }
        return found;
      }, allowed).catch((error) => [`#dom-unreadable (${String(error).slice(0, 60)})`])
      : [`#navigated-away to ${tab.url().slice(0, 80)}`];
    return {
      // Inside the document's own directory: what the shell will serve through `asset:`.
      contained: unique.filter((url) => url.startsWith(directory)),
      // Same origin but out of the directory, e.g. `../../../../etc/passwd`: not the reader's file.
      escaped: unique.filter((url) => url.startsWith(`${GATE_DOCUMENT_ORIGIN}/`) && !url.startsWith(directory)),
      remote: unique.filter((url) => !url.startsWith(`${GATE_DOCUMENT_ORIGIN}/`)),
      violations: [...new Set(live)],
      directory,
    };
  };

  // Control 1: the interception is watching, and can see a request of every shape it covers.
  const control = await run(controlPage);
  if (!control.remote.some((url) => url.includes(CONTROL_HOST))) {
    failures.push(`${name}: the control page attempted no observable request, so this gate cannot see one and every result below is vacuous`);
  }
  report.controls[`${name}/interception`] = control.remote.length;

  // Control 2: the hostile fixture, rendered without the sanitiser, is observed reaching out — which
  // is what makes the sanitised pass below a statement about the sanitiser rather than about markdown.
  const hostileSource = readFileSync(new URL('10-hostile.md', corpus), 'utf8');
  const hostile = await run(renderToUnsanitisedHtml(parseMarkdown(hostileSource, { file: '10-hostile.md' })), '10-hostile.md.html');
  if (hostile.remote.length === 0) {
    failures.push(`${name}: the hostile fixture reached no remote host with the sanitiser removed, so the sanitised pass proves nothing`);
  }
  report.controls[`${name}/unsanitised-hostile`] = hostile.remote.length;

  // Control 3: the same unsanitised render is *seen* to break the allow-list in the live DOM, so the
  // allow-list check below is a measurement of the output and not of an empty query selector.
  if (hostile.violations.length === 0) {
    failures.push(`${name}: the unsanitised hostile render broke no allow-list rule in the live DOM, so the allow-list check cannot fail and proves nothing`);
  }
  report.controls[`${name}/unsanitised-dom-violations`] = hostile.violations.length;

  const sweep = async (label, html, source, where) => {
    const result = await run(html, where);
    for (const url of result.remote) report.remote.push(`${name} ${label} ${url.slice(0, 160)}`);
    for (const url of result.escaped) report.escaped.push(`${name} ${label} ${url.slice(0, 160)}`);
    for (const violation of result.violations) report.violations.push(`${name} ${label} ${violation}`);
    for (const url of result.contained) {
      report.contained.push(`${name} ${label} ${url.slice(0, 160)}`);
      // The whole reference, not its last segment: `../../x/passwd` and `passwd` are different
      // requests and only one of them is in the document.
      const reference = decodeURIComponent(url.slice(result.directory.length));
      if (reference !== '' && !source.includes(reference)) {
        failures.push(`${name}: ${label} requested ${url}, which is not a reference the document contains`);
      }
    }
  };

  // The corpus, through the pipeline a reader's DOM is allowed to see.
  for (const file of files) {
    const source = readFileSync(new URL(file, corpus), 'utf8');
    const { html, removed } = renderSafeHtml(source, { file });
    if (html.trim() === '' && source.trim() !== '') {
      failures.push(`${name}: ${file} rendered to nothing, so asserting over it would prove nothing`);
    }
    await sweep(file, html, source, `${file}.html`);
    report.rendered[file] = { bytes: html.length, removed: removed.length };
  }

  // Every named vector, in a real browser. The two exploits that reached `evil.example` from a
  // sanitised document were both invisible to this gate only because the fixture did not contain
  // them; a vector is a document too, and the corpus cannot be the only thing an engine sees.
  for (const vector of VECTORS) {
    const source = vector.probeHtml ?? vector.probe;
    const html = vector.probeHtml === undefined ? renderSafeHtml(vector.probe).html : sanitizeHtml(vector.probeHtml).html;
    await sweep(`vector:${vector.id}`, html, source, `vector-${vector.id}.html`);
  }

  await browser.close();
}

mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
writeFileSync(new URL('../results/no-network.json', import.meta.url), JSON.stringify(report, null, 2));

if (report.remote.length > 0) {
  failures.push(`${report.remote.length} request(s) reached a host other than the document's own:\n - ${report.remote.slice(0, 20).join('\n - ')}`);
}
if (report.escaped.length > 0) {
  failures.push(`${report.escaped.length} request(s) resolved outside the document's own directory:\n - ${report.escaped.slice(0, 20).join('\n - ')}`);
}
if (report.violations.length > 0) {
  failures.push(`${report.violations.length} element(s) or attribute(s) outside the allow-list reached the live DOM:\n - ${report.violations.slice(0, 20).join('\n - ')}`);
}
if (failures.length > 0) {
  console.error(`no-network gate failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
const controls = Object.entries(report.controls).map(([key, count]) => `${key}=${count}`).join(', ');
console.log(`no-network gate ok: ${files.length} corpus files and ${VECTORS.length} vectors × 2 engines through parse→render→sanitise, 0 remote requests, 0 requests outside the document's directory, 0 elements or attributes outside the allow-list in the live DOM, ${report.contained.length} reference(s) resolved inside the document's own directory; controls observed ${controls}`);
