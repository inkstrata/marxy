// Optional conformance check against the CommonMark specification's own example set.
//
// The example file is CC-BY-SA-4.0, so it is never committed to this MIT tree (ADR-0006): this script
// reads one a developer fetched for themselves, and skips cleanly when there is none, which is what CI
// does. The committed suite that always runs is `src/parse/conformance.test.ts`, whose inputs are ours.
//
// Fetch the file and run the check, in one command:
//
//   curl -sL https://spec.commonmark.org/0.31.2/spec.json -o "${TMPDIR:-/tmp}/commonmark-spec-0.31.2.json" \
//     && pnpm --filter @marxy/core test:spec
//
// This script never fetches anything itself — nothing in this tree phones home (AGENTS.md) — so the
// download is the developer's own command, above. To use a copy you already have, set
// MARXY_COMMONMARK_SPEC to its path. The default location is outside the repository on purpose, so the
// file cannot be committed by accident.

import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkInvariants } from '../src/parse/invariants.ts';
import { parseMarkdown } from '../src/parse/parse.ts';
import { RULE_CASES } from '../src/parse/testing/cases.ts';
import { generateCases } from '../src/parse/testing/generate.ts';
import { toHtml } from '../src/parse/testing/reference-html.ts';

const SPEC_VERSION = '0.31.2';
const path = process.env.MARXY_COMMONMARK_SPEC ?? join(tmpdir(), `commonmark-spec-${SPEC_VERSION}.json`);

interface SpecExample {
  markdown: string;
  html: string;
  example: number;
  section: string;
}

let examples: SpecExample[];
try {
  examples = JSON.parse(readFileSync(path, 'utf8')) as SpecExample[];
} catch {
  console.log(`spec: no example file at ${path}; skipping (this check is optional and the file is never committed)`);
  console.log(`spec: to run it — curl -sL https://spec.commonmark.org/${SPEC_VERSION}/spec.json -o "${path}" && pnpm --filter @marxy/core test:spec`);
  process.exit(0);
}

const htmlFailures: string[] = [];
const invariantFailures: string[] = [];
for (const example of examples) {
  const bytes = new TextEncoder().encode(example.markdown);
  // CommonMark only: GFM, frontmatter and math change what these inputs mean, by design.
  const document = parseMarkdown(bytes, { file: `spec-${example.example}.md`, gfm: false, frontmatter: false, math: false });
  const ours = toHtml(document);
  if (ours !== example.html) {
    htmlFailures.push(`example ${example.example} (${example.section})\n  input:     ${JSON.stringify(example.markdown)}\n  ours:      ${JSON.stringify(ours)}\n  spec:      ${JSON.stringify(example.html)}`);
  }
  for (const violation of checkInvariants(document, bytes)) {
    invariantFailures.push(`example ${example.example} (${example.section}) CommonMark only: ${violation.invariant} — ${violation.detail}`);
  }
  // And again with everything on, which is what a reader gets: GFM changes the parse, so it changes
  // what provenance has to survive.
  const withGfm = parseMarkdown(bytes, { file: `spec-${example.example}.md` });
  for (const violation of checkInvariants(withGfm, bytes)) {
    invariantFailures.push(`example ${example.example} (${example.section}) GFM on: ${violation.invariant} — ${violation.detail}`);
  }
}

for (const failure of [...htmlFailures.slice(0, 20), ...invariantFailures.slice(0, 20)]) console.error(failure);
if (htmlFailures.length > 0 || invariantFailures.length > 0) {
  console.error(`spec: ${htmlFailures.length} HTML divergences and ${invariantFailures.length} invariant violations over ${examples.length} examples (CommonMark ${SPEC_VERSION})`);
  process.exit(1);
}
console.log(`spec: ${examples.length} CommonMark ${SPEC_VERSION} examples, 0 HTML divergences, 0 invariant violations`);

// With the example file to hand, report how much of the committed suite coincides with it. This is the
// honesty check on cases.ts: a rule with one minimal form (an empty block quote is `>`) converges on the
// specification's spelling of it, and anything beyond a handful of those would mean transcription.
const specInputs = new Set(examples.map((example) => example.markdown));
const coinciding = RULE_CASES.filter((one) => specInputs.has(one.input));
const coincidingGenerated = generateCases().filter((one) => specInputs.has(one.input));
console.log(
  `spec: of our ${RULE_CASES.length} rule cases, ${coinciding.length} coincide with a spec example (minimal forms); of the generated cases, ${coincidingGenerated.length}`,
);
for (const one of coinciding) console.log(`spec:   ${JSON.stringify(one.input)} — [${one.construct}] ${one.rule}`);
