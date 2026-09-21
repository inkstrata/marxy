// The acceptance criterion and its falsifiability (MARXY-12, ADR-0009). Two halves that only mean
// something together: every forbidden vector is absent from the hostile fixture once it has been
// through the pipeline, and every one of those checks fails when the sanitiser is taken out of it.
// A sanitiser suite that passes against a sanitiser that does nothing is the dangerous artifact.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { renderSafeHtml } from '../render/pipeline.ts';
import { renderToUnsanitisedHtml } from '../render/render-html.ts';
import { DEFAULT_POLICY, RENDERED_POLICY, WIDE_POLICY, WIDE_RENDERED_POLICY } from './policy.ts';
import { sanitizeHtml } from './sanitize-html.ts';
import { VECTORS, attributesOf, checkAllVectors, elementsOf } from './testing/vectors.ts';

const hostilePath = new URL('../../../../fixtures/corpus/10-hostile.md', import.meta.url);
const hostile = readFileSync(hostilePath, 'utf8');
const safeHostile = renderSafeHtml(hostile, { file: '10-hostile.md' }).html;
/** What the reader's DOM would receive if the boundary were removed: the render, unsanitised. */
const unsafeHostile = renderToUnsanitisedHtml(parseMarkdown(hostile, { file: '10-hostile.md' }));

test('the hostile fixture, rendered, trips no forbidden vector', () => {
  assert.deepEqual(checkAllVectors(safeHostile, RENDERED_POLICY), []);
});

test('the letter of the criterion: no script, iframe, object, form, meta or link element', () => {
  const forbidden = ['script', 'iframe', 'object', 'form', 'meta', 'link'];
  const present = elementsOf(safeHostile).filter((name) => forbidden.includes(name));
  assert.deepEqual(present, []);
});

test('the letter of the criterion: no javascript: or data: href', () => {
  const hrefs = attributesOf(safeHostile).filter((attribute) => attribute.name === 'href');
  const offenders = hrefs.filter((attribute) => /^\s*(?:javascript|data)\s*:/i.test(attribute.decoded));
  assert.deepEqual(offenders, []);
  // The fixture does carry both, so the check above is looking at something.
  assert.match(hostile, /javascript:/);
  assert.match(hostile, /data:text\/html/);
});

test('the same letter, measured: the unsanitised render carries all of it', () => {
  const forbidden = ['script', 'iframe', 'object', 'form', 'meta', 'link'];
  const present = new Set(elementsOf(unsafeHostile).filter((name) => forbidden.includes(name)));
  assert.deepEqual([...present].sort(), forbidden.sort());
  const hrefs = attributesOf(unsafeHostile).filter((attribute) => attribute.name === 'href');
  assert.ok(
    hrefs.some((attribute) => /^javascript:/i.test(attribute.decoded)),
    'without the sanitiser a javascript: href reaches the DOM, which is what makes the check above a check',
  );
});

test('every vector is enumerated with a reason and a probe', () => {
  const ids = VECTORS.map((vector) => vector.id);
  assert.equal(new Set(ids).size, ids.length, 'vector ids must be unique');
  assert.ok(VECTORS.length >= 20, `expected the enumeration to be broad; it has ${VECTORS.length}`);
  for (const vector of VECTORS) {
    assert.ok(vector.why.length > 20, `${vector.id} must say why it matters`);
    assert.ok(vector.probe.length > 0, `${vector.id} must carry a probe`);
  }
});

for (const [label, checkPolicy, renderPolicy] of [
  ['default', RENDERED_POLICY, DEFAULT_POLICY],
  ['wide', WIDE_RENDERED_POLICY, WIDE_POLICY],
] as const) {
  test(`wide-still-no-script: every vector passes under ${label}`, () => {
    for (const vector of VECTORS) {
      const html = vector.probeHtml === undefined
        ? renderSafeHtml(vector.probe, { file: `probe/${vector.id}.md`, policy: renderPolicy }).html
        : sanitizeHtml(vector.probeHtml, renderPolicy).html;
      vector.check(html, checkPolicy);
    }
  });
}

for (const vector of VECTORS) {
  test(`${vector.id}: the pipeline neutralises its probe`, () => {
    vector.check(renderSafeHtml(vector.probe, { file: `probe/${vector.id}.md` }).html, RENDERED_POLICY);
    if (vector.probeHtml !== undefined) vector.check(sanitizeHtml(vector.probeHtml).html);
  });

  test(`${vector.id}: the check fails against a neutralised sanitiser`, () => {
    // The neutralised pipeline: parse and render, and put the result in the DOM without the
    // allow-list. If a check survives that, it is not checking anything.
    const unsanitised = vector.probeHtml ?? renderToUnsanitisedHtml(parseMarkdown(vector.probe, { file: `probe/${vector.id}.md` }));
    assert.throws(() => vector.check(unsanitised, RENDERED_POLICY), /./, `${vector.id} passed against unsanitised output`);
  });
}

test('the whole enumeration fails against the unsanitised hostile render', () => {
  const failures = checkAllVectors(unsafeHostile, RENDERED_POLICY);
  assert.ok(failures.length >= 14, `expected the fixture to trip most vectors unsanitised; it tripped ${failures.length}`);
});
