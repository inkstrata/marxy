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
//
// What this gate can and cannot see a document attempt, and why the checks below cannot be deleted
// without something failing, are recorded in ADR-0009 (MARXY-83): the printed observability report
// covers the first, `GATE_ASSERTION_IDS` plus `gate-assertions.test.ts` cover the second.
import { chromium, webkit } from 'playwright';
import { launchBrowser } from './playwright-webkit.mjs';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { renderSafeHtml, renderToUnsanitisedHtml } from '../packages/core/src/render/index.ts';
import { parseMarkdown } from '../packages/core/src/parse/parse.ts';
import { sanitizeHtml } from '../packages/core/src/sanitize/sanitize-html.ts';
import { BLOCK_ELEMENTS, RENDERED_POLICY } from '../packages/core/src/sanitize/policy.ts';
import { GATE_DOCUMENT_DIRECTORY, GATE_DOCUMENT_ORIGIN } from '../packages/core/src/sanitize/document-origin.ts';
import { VECTORS } from '../packages/core/src/sanitize/testing/vectors.ts';
import { formatObservabilityReport } from '../packages/core/scripts/gate-observability.ts';
import { GATE_ASSERTION_IDS } from '../packages/core/scripts/gate-assertions.ts';
import {
  classifyRequestUrl, findAllowListViolations, findContainmentViolations, hasEntries,
  isReferenceInSource, isRenderedBlank, sawHost,
} from '../packages/core/scripts/gate-checks.ts';

// Criterion 1 (MARXY-83): printed every run, pass or fail, before any control has even opened a
// page, because "the gate observed nothing unusual" and "the gate cannot observe this class at all"
// must never look the same in the output.
console.log(formatObservabilityReport());

// Criterion 3 (MARXY-83): the fast half of the mutation-coverage suite runs as part of this gate
// too, not only on demand, so a PR that deletes a covering test (`gate-assertions.test.ts`) or the
// proof that the allow-list refuses each unobservable class (`unobservable-classes.test.ts`) fails
// the same gate the browser checks below fail, rather than a suite nobody remembered to run.
const unitTests = spawnSync(
  process.execPath,
  ['--test', '--experimental-strip-types', 'packages/core/scripts/gate-assertions.test.ts', 'packages/core/scripts/unobservable-classes.test.ts'],
  { cwd: new URL('../', import.meta.url).pathname, encoding: 'utf8' },
);
process.stdout.write(unitTests.stdout ?? '');
if (unitTests.status !== 0) {
  process.stderr.write(unitTests.stderr ?? '');
  console.error('no-network gate failed: the gate\'s own mutation-coverage suite (packages/core/scripts/gate-assertions.test.ts, unobservable-classes.test.ts) did not pass');
  process.exit(1);
}

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

/**
 * The allow-list as two flat lists, for the check that runs inside the browser. The pipeline's
 * output is held to the default list plus the two provenance attributes (ADR-0023).
 */
const allowed = {
  elements: Object.keys(RENDERED_POLICY.elements),
  attributes: Object.fromEntries(Object.entries(RENDERED_POLICY.elements).map(([element, rule]) => [
    element,
    [...Object.keys(RENDERED_POLICY.globalAttributes), ...Object.keys(rule.attributes ?? {}), ...Object.keys(rule.forced ?? {})],
  ])),
  blocks: [...BLOCK_ELEMENTS],
};

const report = {
  files: files.length, vectors: VECTORS.length, controls: {}, contained: [], escaped: [], remote: [],
  violations: [], resurrectedElements: [], resurrectedUrls: [], rendered: {},
};
const failures = [];

for (const engine of [webkit, chromium]) {
  const name = engine.name();
  // Criterion 3 (MARXY-83): every named check this run is supposed to make, recorded as it runs, so
  // the gate can fail on its own silence — a `check(...)` call deleted from below without also being
  // deleted from `GATE_ASSERTION_IDS` shrinks `ran` and the comparison at the end of this engine's
  // pass catches it, the same run that lost the check.
  const ran = new Set();
  // `message` is `null` for the three final aggregate checks: they still have to be seen to *run*
  // every engine (recorded in `ran`), but their user-facing failure is the one formatted message
  // printed once at the very end, over both engines' combined findings, not a duplicate per engine.
  const check = (id, ok, message) => {
    ran.add(id);
    if (!ok && message !== null) failures.push(message);
  };
  const browser = await launchBrowser(engine);
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
  // The witness for navigation. `tab.url()` is not one: an aborted navigation leaves it unchanged
  // in WebKit, and a page that reloads itself ends up back at the URL it started from. Every
  // navigation fires this, including the one `goto` performs, which is why the count is compared
  // against one rather than against zero.
  let navigations = 0;
  tab.on('framenavigated', (frame) => { if (frame === tab.mainFrame()) navigations += 1; });

  /**
   * Does the engine build anything from the sanitised output that it did not build from the
   * sanitiser's own input? The parse is the engine's, through `DOMParser`, which runs no script,
   * navigates nowhere and fetches nothing, so the question can be asked of a hostile document
   * safely. A yes means the sanitiser turned text a parser keeps inert into markup — how a
   * `<plaintext>`-smuggled image made a reader fetch a file its document never asked for.
   *
   * `noscript` is outside what this can measure, and is skipped by name rather than by accident.
   * `DOMParser` parses with scripting *disabled* and a reader's DOM has it enabled; `noscript` is
   * the one name whose parsing depends on that flag, so the two parsers genuinely disagree in both
   * directions — measured in WebKit and Chromium. With scripting off, the content of a `<noscript>`
   * is markup, so this reference parse would both excuse a real resurrection out of one and call a
   * correct removal a resurrection. The sanitiser matches the reader's parser, not this one. For
   * that name the detector is the vector's own check, which forbids the element in the output at
   * all: if you are adding a `noscript` case, that is the assertion to write, and loosening
   * anything here to make a failure go away would be fixing the wrong parser.
   *
   * Names are compared as a set over the whole document, so a legitimate `<b>` anywhere excuses a
   * resurrected `<b>` anywhere else. The URL half is what localises a finding, which is why every
   * case in `no-resurrected-raw-text` carries a URL-bearing element with a sentinel of its own.
   *
   * `PARITY_URL_ATTRIBUTES` (`gate-checks.ts`) names the same five attributes read below; kept
   * inline here too (`boundary.test.ts` pins this exact literal) rather than passed in, and
   * `gate-assertions.test.ts` asserts the two lists agree, so the two cannot drift against each
   * other unnoticed.
   */
  const parity = async (unsanitised, sanitised) => tab.evaluate(([before, after]) => {
    const read = (html) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const names = new Set();
      const urls = new Set();
      for (const element of parsed.querySelectorAll('*')) {
        const tag = element.tagName.toLowerCase();
        if (tag === 'html' || tag === 'head' || tag === 'body') continue;
        // Scripting is off in here and on in a reader's DOM, so this parser's idea of what is
        // inside a noscript is not the reader's. Dropped from both sides, or the comparison would
        // excuse a resurrection in one direction and invent one in the other.
        if (tag !== 'noscript' && element.closest('noscript') !== null) continue;
        names.add(tag);
        for (const attribute of ['src', 'href', 'poster', 'data', 'srcset']) {
          if (!element.hasAttribute(attribute)) continue;
          // Normalised, because the sanitiser emits an absolute URL in the form the browser will
          // use — a host in punycode is the same host, not a resurrected one.
          const value = element.getAttribute(attribute);
          let resolved = value;
          try { resolved = new URL(value, 'https://parity.invalid/directory/').href; } catch { /* keep the raw value */ }
          urls.add(resolved);
        }
      }
      return { names, urls };
    };
    const input = read(before);
    const output = read(after);
    return [
      ...[...output.names].filter((name) => !input.names.has(name)).map((name) => `<${name}> built from text the parser keeps inert`),
      ...[...output.urls].filter((url) => !input.urls.has(url)).map((url) => `${url.slice(0, 80)} fetched from text the parser keeps inert`),
    ];
  }, [unsanitised, sanitised]).catch((error) => [`#parity-unreadable (${String(error).slice(0, 60)})`]);

  /** Loads a document at its own path in the corpus directory and reports what it attempted. */
  const run = async (html, where = 'document.html') => {
    body = page(html);
    documentUrl = new URL(where, GATE_DOCUMENT_DIRECTORY).href;
    observed = [];
    navigations = 0;
    let loaded = true;
    // A page that navigates while loading makes `goto` time out. That fails closed either way, but
    // recording it keeps the failure legible instead of an unhandled rejection with a stack trace.
    try {
      await tab.goto(documentUrl, { waitUntil: 'load', timeout: 15_000 });
    } catch (error) {
      loaded = false;
      observed.push(`#navigation-during-load (${String(error).slice(0, 60)})`);
    }
    await tab.waitForTimeout(150);
    const unique = [...new Set(observed)];
    const directory = new URL('./', documentUrl).href;
    // A document that takes the reader somewhere has already done the harm; it is also why the DOM
    // below may be unreadable, so both are recorded as what they are rather than as a quiet zero.
    // The `.catch` is load-bearing: a page that reloads itself destroys the execution context, and
    // this is the only thing that turns that into a failure rather than a skipped check. Only
    // *collection* happens in the browser; deciding whether what it collected is a violation is
    // `findAllowListViolations`/`findContainmentViolations` (`gate-checks.ts`), run here in Node.
    const collected = loaded && navigations <= 1
      ? await tab.evaluate(() => {
        // The host node is held, not looked up again: `id` is an allow-listed attribute, so a
        // document may call itself `doc`, and a walk that stops at the *name* would stop inside
        // the document and report nothing.
        const host = document.getElementById('doc');
        if (host === null) return null;
        const elements = [];
        for (const element of host.querySelectorAll('*')) {
          const ancestorTags = [];
          for (let parent = element.parentElement; parent !== null && parent !== host; parent = parent.parentElement) {
            ancestorTags.push(parent.tagName.toLowerCase());
          }
          elements.push({
            tag: element.tagName.toLowerCase(),
            attributes: element.getAttributeNames().map((attribute) => attribute.toLowerCase()),
            ancestorTags,
          });
        }
        return elements;
      }).catch((error) => `#dom-unreadable (${String(error).slice(0, 60)})`)
      : `#navigated (${navigations} navigations, now at ${tab.url().slice(0, 60)})`;
    const live = typeof collected === 'string'
      ? [collected]
      : collected === null
        ? ['#host-missing']
        : [
          ...findAllowListViolations(collected, allowed.elements, allowed.attributes),
          ...findContainmentViolations(collected, allowed.blocks),
        ];
    const classified = unique.map((url) => ({ url, kind: classifyRequestUrl(url, GATE_DOCUMENT_ORIGIN, directory) }));
    return {
      // Inside the document's own directory: what the shell will serve through `asset:`.
      contained: classified.filter((c) => c.kind === 'contained').map((c) => c.url),
      // Same origin but out of the directory, e.g. `../../../../etc/passwd`: not the reader's file.
      escaped: classified.filter((c) => c.kind === 'escaped').map((c) => c.url),
      remote: classified.filter((c) => c.kind === 'remote').map((c) => c.url),
      violations: [...new Set(live)],
      directory,
    };
  };

  // Control 1: the interception is watching, and can see a request of every shape it covers.
  const control = await run(controlPage);
  check('control-interception', sawHost(control.remote, CONTROL_HOST),
    `${name}: the control page attempted no observable request, so this gate cannot see one and every result below is vacuous`);
  report.controls[`${name}/interception`] = control.remote.length;

  // Control 2: the hostile fixture, rendered without the sanitiser, is observed reaching out — which
  // is what makes the sanitised pass below a statement about the sanitiser rather than about markdown.
  const hostileSource = readFileSync(new URL('10-hostile.md', corpus), 'utf8');
  const hostile = await run(renderToUnsanitisedHtml(parseMarkdown(hostileSource, { file: '10-hostile.md' })), '10-hostile.md.html');
  check('control-hostile-unsanitised', hasEntries(hostile.remote),
    `${name}: the hostile fixture reached no remote host with the sanitiser removed, so the sanitised pass proves nothing`);
  report.controls[`${name}/unsanitised-hostile`] = hostile.remote.length;

  // Control 3: a page that breaks the allow-list in two ways and does *not* navigate, so both
  // halves of the live-DOM check are shown to work in both engines. The unsanitised hostile render
  // leaves the page in Chromium, where it therefore only ever proved that navigation is recorded.
  // The anchor calls itself `doc` because a document legally may: `id` is allow-listed, so a walk
  // that stopped at the *name* of the wrapper rather than at the wrapper itself would stop here,
  // inside the document, and report nothing. This control fails if that ever comes back.
  const dirty = await run('<marquee behavior="scroll">a marquee is not on the list</marquee>\n<a id="doc" href="https://control.invalid/"><p>a block inside a formatting element</p></a>', 'control-dirty.html');
  // Kept as literal `.includes(...)` calls, not `mentionsTag(...)`, because `boundary.test.ts` pins
  // these two exact substrings against a revert that quietly drops either half.
  check('control-dirty-element', dirty.violations.some((violation) => violation.includes('<marquee>')),
    `${name}: the control page's un-allow-listed element was not seen in the live DOM, so the element half of the allow-list check cannot fail and proves nothing`);
  check('control-dirty-containment', dirty.violations.some((violation) => violation.includes('inside <a>')),
    `${name}: the control page's block inside an anchor was not seen in the live DOM, so the containment half of the check cannot fail and proves nothing`);
  report.controls[`${name}/dirty-dom-violations`] = dirty.violations.length;
  report.controls[`${name}/unsanitised-dom-violations`] = hostile.violations.length;

  // Control 4: a reference that climbs out of the document's directory is *seen* to leave it. This
  // is what pins the directory itself: served from the origin root, `../../../../etc/passwd`
  // resolves inside the root, every request is "contained" by construction, and the containment
  // check below becomes the tautology it was in round 1.
  const traversal = await run(sanitizeHtml('<img src="../../../../../../etc/passwd" alt="traversal">').html, 'control-traversal.html');
  // Kept as the literal `traversal.escaped.length === 0` comparison, not `hasEntries(...)`, because
  // `boundary.test.ts` pins this exact substring against a revert that quietly drops this control.
  check('control-traversal-escaped', !(traversal.escaped.length === 0),
    `${name}: a reference six levels above the document was not seen to leave its directory, so the containment check cannot fail and proves nothing`);
  report.controls[`${name}/traversal-escaped`] = traversal.escaped.length;

  const sweep = async (label, html, source, where, unsanitised) => {
    const result = await run(html, where);
    for (const url of result.remote) report.remote.push(`${name} ${label} ${url.slice(0, 160)}`);
    for (const url of result.escaped) report.escaped.push(`${name} ${label} ${url.slice(0, 160)}`);
    for (const violation of result.violations) report.violations.push(`${name} ${label} ${violation}`);
    // The two named checks (`parity-element-names`, `parity-attribute-urls`) split `parity`'s one
    // combined list back apart by the marker each of its two branches always ends its message with,
    // so the gate can fail on either half independently without changing what `parity` itself does.
    for (const item of await parity(unsanitised, html)) {
      const bucket = item.endsWith('built from text the parser keeps inert') ? report.resurrectedElements : report.resurrectedUrls;
      bucket.push(`${name} ${label} ${item}`);
    }
    for (const url of result.contained) {
      report.contained.push(`${name} ${label} ${url.slice(0, 160)}`);
      // The whole reference, not its last segment: `../../x/passwd` and `passwd` are different
      // requests and only one of them is in the document.
      check('reference-contained', isReferenceInSource(url, result.directory, source),
        `${name}: ${label} requested ${url}, which is not a reference the document contains`);
    }
  };

  // The corpus, through the pipeline a reader's DOM is allowed to see.
  for (const file of files) {
    const source = readFileSync(new URL(file, corpus), 'utf8');
    const { html, removed } = renderSafeHtml(source, { file });
    check('rendered-not-empty', !isRenderedBlank(html, source),
      `${name}: ${file} rendered to nothing, so asserting over it would prove nothing`);
    await sweep(file, html, source, `${file}.html`, renderToUnsanitisedHtml(parseMarkdown(source, { file })));
    report.rendered[file] = { bytes: html.length, removed: removed.length };
  }

  // Every named vector, in a real browser. The two exploits that reached `evil.example` from a
  // sanitised document were both invisible to this gate only because the fixture did not contain
  // them; a vector is a document too, and the corpus cannot be the only thing an engine sees.
  for (const vector of VECTORS) {
    const source = vector.probeHtml ?? vector.probe;
    const unsanitised = vector.probeHtml ?? renderToUnsanitisedHtml(parseMarkdown(vector.probe, { file: `${vector.id}.md` }));
    const html = vector.probeHtml === undefined ? renderSafeHtml(vector.probe).html : sanitizeHtml(vector.probeHtml).html;
    await sweep(`vector:${vector.id}`, html, source, `vector-${vector.id}.html`, unsanitised);
  }

  // The two final aggregate checks that are not "did a control prove the mechanism works" but "did
  // the mechanism find anything, this run, over the whole corpus and every vector" — named the same
  // as the failures printed below, so a reader can trace one back to the other.
  check('no-remote-requests', !hasEntries(report.remote.filter((entry) => entry.startsWith(`${name} `))), null);
  check('no-escaped-requests', !hasEntries(report.escaped.filter((entry) => entry.startsWith(`${name} `))), null);
  check('no-live-dom-violations', !hasEntries(report.violations.filter((entry) => entry.startsWith(`${name} `))), null);
  check('parity-element-names', !hasEntries(report.resurrectedElements.filter((entry) => entry.startsWith(`${name} `))), null);
  check('parity-attribute-urls', !hasEntries(report.resurrectedUrls.filter((entry) => entry.startsWith(`${name} `))), null);

  // Criterion 3 (MARXY-83): the gate fails on its own silence. A `check(id, ...)` call deleted from
  // this file without `id` also being deleted from `GATE_ASSERTION_IDS` shrinks `ran` below the
  // declared list, and this is where that shows up — the same run that lost the check, not a
  // property someone has to remember to test for separately.
  const declared = new Set(GATE_ASSERTION_IDS);
  const missing = [...declared].filter((id) => !ran.has(id));
  const extra = [...ran].filter((id) => !declared.has(id));
  if (missing.length > 0 || extra.length > 0) {
    failures.push(`${name}: ran ${ran.size} of ${declared.size} declared gate assertions (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}) — GATE_ASSERTION_IDS and the checks this file makes have drifted apart`);
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
if (report.resurrectedElements.length > 0) {
  failures.push(`${report.resurrectedElements.length} element(s) the sanitiser built out of text a parser keeps inert:\n - ${report.resurrectedElements.slice(0, 20).join('\n - ')}`);
}
if (report.resurrectedUrls.length > 0) {
  failures.push(`${report.resurrectedUrls.length} URL(s) the sanitiser built out of text a parser keeps inert:\n - ${report.resurrectedUrls.slice(0, 20).join('\n - ')}`);
}
if (failures.length > 0) {
  console.error(`no-network gate failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
const controls = Object.entries(report.controls).map(([key, count]) => `${key}=${count}`).join(', ');
console.log(`no-network gate ok: ${files.length} corpus files and ${VECTORS.length} vectors × 2 engines through parse→render→sanitise, 0 remote requests, 0 requests outside the document's directory, 0 elements or attributes outside the allow-list in the live DOM, 0 elements or URLs built out of text a parser keeps inert, ${report.contained.length} reference(s) resolved inside the document's own directory; controls observed ${controls}; ${GATE_ASSERTION_IDS.length} named assertions ran in each engine`);
