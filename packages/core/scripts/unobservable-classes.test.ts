// Criteria 1 and 2 of MARXY-83: the gate's printed report names every request class it cannot
// observe, and each of those classes is safe because the allow-list refuses the element or API it
// needs, not merely because nobody has demonstrated otherwise.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RENDERED_POLICY } from '../src/sanitize/policy.ts';
import { sanitizeHtml } from '../src/sanitize/sanitize-html.ts';
import {
  OBSERVED_REQUEST_CLASSES, UNOBSERVABLE_REQUEST_CLASSES, formatObservabilityReport,
} from './gate-observability.ts';

const gateSource = readFileSync(new URL('../../../scripts/gate-no-network.mjs', import.meta.url), 'utf8');

test('the observability report names every request class the gate cannot see', () => {
  const report = formatObservabilityReport();
  for (const name of ['WebSocket', 'dns-prefetch', 'service worker registration']) {
    assert.ok(report.includes(name), `report is missing "${name}":\n${report}`);
  }
  assert.equal(UNOBSERVABLE_REQUEST_CLASSES.length, 3);
  assert.ok(OBSERVED_REQUEST_CLASSES.length > 0, 'the report should also say what the gate does see');
});

test('WebSocket needs a script element, and script is refused by the allow-list', () => {
  const probe = '<p>hello</p><script>new WebSocket("wss://evil.invalid");</script>';
  const { html, removed } = sanitizeHtml(probe, RENDERED_POLICY);
  assert.ok(!/<script/i.test(html), `script survived sanitisation:\n${html}`);
  assert.ok(!/websocket/i.test(html), `the WebSocket call text survived sanitisation:\n${html}`);
  assert.ok(
    removed.some((r) => r.what === 'element' && r.name === 'script'),
    'sanitizeHtml did not record refusing <script>, so the reason WebSocket is unreachable is unproven',
  );
});

test('dns-prefetch needs a link element, and link is refused by the allow-list', () => {
  const probe = '<p>hello</p><link rel="dns-prefetch" href="https://evil.invalid">';
  const { html, removed } = sanitizeHtml(probe, RENDERED_POLICY);
  assert.ok(!/<link/i.test(html), `link survived sanitisation:\n${html}`);
  assert.ok(
    removed.some((r) => r.what === 'element' && r.name === 'link'),
    'sanitizeHtml did not record refusing <link>, so the reason dns-prefetch is unreachable is unproven',
  );
});

test('a service worker registration needs a script element, and script is refused by the allow-list', () => {
  const probe = '<p>hello</p><script>navigator.serviceWorker.register("/sw.js");</script>';
  const { html, removed } = sanitizeHtml(probe, RENDERED_POLICY);
  assert.ok(!/<script/i.test(html), `script survived sanitisation:\n${html}`);
  assert.ok(!/serviceworker/i.test(html), `the registration call text survived sanitisation:\n${html}`);
  assert.ok(
    removed.some((r) => r.what === 'element' && r.name === 'script'),
    'sanitizeHtml did not record refusing <script>, so the reason a service worker is unreachable is unproven',
  );
});

test('criterion 1: the gate prints the observability report unconditionally, every run', () => {
  assert.match(gateSource, /import\s*\{\s*formatObservabilityReport\s*\}\s*from\s*['"][^'"]*gate-observability\.ts['"]/, 'the gate must import formatObservabilityReport');
  // Must appear before either browser engine is launched, so it runs on every invocation, not only
  // on a passing one — a check fails here if the print is missing or made conditional.
  const printedAt = gateSource.indexOf('console.log(formatObservabilityReport())');
  const enginesLaunchAt = gateSource.indexOf("for (const engine of [webkit, chromium])");
  assert.ok(printedAt !== -1, 'the gate must call console.log(formatObservabilityReport()) unconditionally');
  assert.ok(enginesLaunchAt !== -1 && printedAt < enginesLaunchAt, 'the report must print before any engine runs, so it is never skipped by an early failure');
});

test('every unobservable class names an element or API that is not in the rendered allow-list', () => {
  for (const cls of UNOBSERVABLE_REQUEST_CLASSES) {
    const tag = /^<([a-z-]+)/.exec(cls.requires)?.[1];
    assert.ok(tag, `could not read an element name out of "${cls.requires}"`);
    assert.equal(
      RENDERED_POLICY.elements[tag as string],
      undefined,
      `${cls.requires} names <${tag}>, which is unexpectedly allow-listed`,
    );
  }
});
