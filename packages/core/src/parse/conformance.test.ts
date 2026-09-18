// Conformance: our AST, rendered to HTML, must equal the reference implementation's HTML for every
// input we wrote (testing/cases.ts) and every input the seeded generator composes
// (testing/generate.ts), and every AST_INVARIANTS entry must hold for all of them with GFM on as well
// as off. The specification's own 652 examples are checked by ../../scripts/commonmark-spec.ts, which
// reads a file a developer fetches and is never committed (ADR-0006).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Parser, HtmlRenderer } from 'commonmark';
import { RULE_CASES } from './testing/cases.ts';
import { DEFAULT_SEED, generateCases } from './testing/generate.ts';
import { checkInvariants } from './invariants.ts';
import { parseMarkdown } from './parse.ts';
import { toHtml } from './testing/reference-html.ts';

const reference = (input: string): string => new HtmlRenderer().render(new Parser().parse(input));

const seed = process.env.MARXY_CASE_SEED === undefined ? DEFAULT_SEED : Number(process.env.MARXY_CASE_SEED);
const generated = generateCases(seed);

/** CommonMark only: GFM, frontmatter and math change what these inputs mean, by design. */
const commonmark = (input: string, file: string) =>
  parseMarkdown(new TextEncoder().encode(input), { file, gfm: false, frontmatter: false, math: false });

test('conformance: every rule case renders as the reference implementation does', () => {
  const failures: string[] = [];
  for (const { construct, rule, input } of RULE_CASES) {
    const ours = toHtml(commonmark(input, 'case.md'));
    const theirs = reference(input);
    if (ours !== theirs) {
      failures.push(`[${construct}] ${rule}\n  input:     ${JSON.stringify(input)}\n  ours:      ${JSON.stringify(ours)}\n  reference: ${JSON.stringify(theirs)}`);
    }
  }
  assert.equal(failures.length, 0, `${failures.length}/${RULE_CASES.length} rule cases differ:\n${failures.slice(0, 10).join('\n')}`);
});

test('conformance: every generated case renders as the reference implementation does', () => {
  const failures: string[] = [];
  for (const { index, shape, input } of generated) {
    const ours = toHtml(commonmark(input, `generated-${index}.md`));
    const theirs = reference(input);
    if (ours !== theirs) {
      failures.push(`seed=${seed} index=${index} shape=${shape.join('+')}\n  input:     ${JSON.stringify(input)}\n  ours:      ${JSON.stringify(ours)}\n  reference: ${JSON.stringify(theirs)}`);
    }
  }
  assert.equal(failures.length, 0, `${failures.length}/${generated.length} generated cases differ (reproduce with MARXY_CASE_SEED=${seed}):\n${failures.slice(0, 10).join('\n')}`);
});

// GFM on is the default every reader gets, and it is a different parse: running the invariants only
// with GFM off is how a provenance bug in an autolink-literal candidate survived review once.
for (const [label, options] of [
  ['CommonMark only', { gfm: false, frontmatter: false, math: false }],
  ['GFM, frontmatter and math on', {}],
] as const) {
  test(`conformance: the invariants hold for every rule case (${label})`, () => {
    const failures: string[] = [];
    for (const { construct, rule, input } of RULE_CASES) {
      const bytes = new TextEncoder().encode(input);
      const document = parseMarkdown(bytes, { file: 'case.md', ...options });
      for (const violation of checkInvariants(document, bytes)) {
        failures.push(`[${construct}] ${rule}: ${violation.invariant} — ${violation.detail}`);
      }
    }
    assert.deepEqual(failures.slice(0, 10), []);
  });

  test(`conformance: the invariants hold for every generated case (${label})`, () => {
    const failures: string[] = [];
    for (const { index, shape, input } of generated) {
      const bytes = new TextEncoder().encode(input);
      const document = parseMarkdown(bytes, { file: `generated-${index}.md`, ...options });
      for (const violation of checkInvariants(document, bytes)) {
        failures.push(`seed=${seed} index=${index} shape=${shape.join('+')}: ${violation.invariant} — ${violation.detail}`);
      }
    }
    assert.deepEqual(failures.slice(0, 10), []);
  });
}

/**
 * A floor per construct, so "the suite covers the constructs" means what it says. The numbers are the
 * count below which a construct is too thin to claim, not the count we happen to have: raise one only
 * by writing cases for the rules it is missing.
 */
const FLOORS: Readonly<Record<string, number>> = {
  paragraphs: 10, escapes: 10, entities: 10, 'code spans': 12, emphasis: 28, links: 24, images: 8,
  autolinks: 8, 'raw html': 12, 'hard breaks': 10, 'soft breaks': 2, 'atx headings': 12,
  'setext headings': 12, 'thematic breaks': 8, 'indented code': 10, 'fenced code': 18,
  'block quotes': 14, lists: 24, 'html blocks': 14, tabs: 6, documents: 6,
};

test('conformance: every construct meets its floor of rule cases', () => {
  const counts = new Map<string, number>();
  for (const { construct } of RULE_CASES) counts.set(construct, (counts.get(construct) ?? 0) + 1);
  const thin: string[] = [];
  for (const [construct, floor] of Object.entries(FLOORS)) {
    const count = counts.get(construct) ?? 0;
    if (count < floor) thin.push(`${construct}: ${count} cases, floor is ${floor}`);
  }
  assert.deepEqual(thin, []);
  // A construct with cases but no floor is a construct nobody agreed to keep covered.
  const unfloored = [...counts.keys()].filter((construct) => FLOORS[construct] === undefined);
  assert.deepEqual(unfloored, []);
});

test('conformance: every rule case says which rule it exercises, and no input repeats', () => {
  const inputs = new Set<string>();
  for (const { construct, rule, input } of RULE_CASES) {
    assert.ok(rule.length > 12, `[${construct}] has no rule text: ${JSON.stringify(rule)}`);
    assert.ok(!inputs.has(input), `duplicate input: ${JSON.stringify(input)}`);
    inputs.add(input);
  }
});

test('conformance: the generator is deterministic and its cases are distinct documents', () => {
  assert.deepEqual(generateCases(DEFAULT_SEED, 20), generateCases(DEFAULT_SEED, 20));
  // Case n must not depend on how many cases were asked for, or a printed index would not reproduce.
  assert.deepEqual(generateCases(DEFAULT_SEED, 5)[3], generateCases(DEFAULT_SEED, 500)[3]);
  assert.notDeepEqual(generateCases(DEFAULT_SEED, 5)[0], generateCases(DEFAULT_SEED + 1, 5)[0]);
  const distinct = new Set(generated.map((one) => one.input));
  assert.ok(distinct.size > generated.length * 0.9, `only ${distinct.size} distinct documents of ${generated.length}`);
});
