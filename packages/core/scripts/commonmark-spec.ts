// CommonMark spec-suite check: HTML equivalence and AST invariants over examples that are fetched,
// digest-checked, and never committed (ADR-0021, ADR-0006). The script does not fetch; CI does.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInvariants } from '../src/parse/invariants.ts';
import { parseMarkdown } from '../src/parse/parse.ts';
import { RULE_CASES } from '../src/parse/testing/cases.ts';
import { generateCases } from '../src/parse/testing/generate.ts';
import { toHtml } from '../src/parse/testing/reference-html.ts';

// The version lives here and only here. CI reads it through --print-url / --print-dest.
const SPEC_VERSION = '0.31.2';
const SPEC_SHA256 = 'd431b29d97b6f73e69d547109cf5081578fac931e72afe95639ebe766c1b2a20';
const SPEC_URL = `https://spec.commonmark.org/${SPEC_VERSION}/spec.json`;

const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const THIS_FILE = fileURLToPath(import.meta.url);

interface SpecExample {
  markdown: string;
  html: string;
  example: number;
  section: string;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isInsideRepo(path: string): boolean {
  const resolved = resolve(path);
  const root = resolve(REPO_ROOT);
  return resolved === root || resolved.startsWith(root.endsWith(sep) ? root : root + sep);
}

function specPath(): string {
  return resolve(process.env.MARXY_COMMONMARK_SPEC ?? join(tmpdir(), `commonmark-spec-${SPEC_VERSION}.json`));
}

function refuseIfInsideRepo(path: string): void {
  if (isInsideRepo(path)) {
    console.error(`spec: refusing ${path}; the example file must stay outside ${REPO_ROOT} (ADR-0006)`);
    process.exit(1);
  }
}

function specSuiteStep(workflow: string): string | undefined {
  return workflow.split(/\n      - /).slice(1).find((step) => /curl/.test(step) && /test:spec/.test(step));
}

function specRelatedSteps(workflow: string): string[] {
  return workflow.split(/\n      - /).slice(1).filter((step) => /commonmark-spec|test:spec/.test(step));
}

/** The spec CI step must stay required: no continue-on-error, no || true, no per-step if. */
function checkWorkflow(workflow: string): string[] {
  const errors: string[] = [];
  const suite = specSuiteStep(workflow);
  if (!suite) {
    errors.push('.github/workflows/ci.yml: no step fetches spec.json and runs test:spec');
    return errors;
  }
  if (!/--print-dest/.test(suite) || !/--print-url/.test(suite)) {
    errors.push(
      '.github/workflows/ci.yml: the spec suite step must take dest and url from the script (--print-dest / --print-url)',
    );
  }
  if (!/git status --porcelain/.test(suite)) {
    errors.push('.github/workflows/ci.yml: the spec suite step must assert git status --porcelain is empty');
  }
  if (workflow.includes(SPEC_VERSION)) {
    errors.push(
      `.github/workflows/ci.yml: pins CommonMark ${SPEC_VERSION}; the version lives only in packages/core/scripts/commonmark-spec.ts`,
    );
  }
  for (const step of specRelatedSteps(workflow)) {
    const head = step.split('\n')[0].trim();
    if (/continue-on-error/.test(step)) {
      errors.push(`.github/workflows/ci.yml: "${head}" carries continue-on-error`);
    }
    if (/\|\|\s*true/.test(step)) {
      errors.push(`.github/workflows/ci.yml: "${head}" swallows its exit code with || true`);
    }
    if (/^\s*if:/m.test(step)) {
      errors.push(`.github/workflows/ci.yml: "${head}" is conditional, so it is not required`);
    }
  }
  return errors;
}

function runScript(args: string[], env: NodeJS.ProcessEnv = {}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', THIS_FILE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function selftest(): void {
  let bad = 0;
  const report = (ok: boolean, name: string, detail?: string) => {
    if (ok) console.log(`selftest ok: ${name}`);
    else {
      bad++;
      console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const dest = specPath();
  report(!isInsideRepo(dest), 'fetch path resolves outside the repository root', dest);
  report(dest.startsWith(sep), 'fetch path is absolute', dest);

  const printed = runScript(['--print-dest']);
  report(printed.status === 0 && !isInsideRepo(printed.stdout.trim()), '--print-dest is outside the repository root', printed.stdout.trim());
  const printedUrl = runScript(['--print-url']);
  report(printedUrl.status === 0 && printedUrl.stdout.trim() === SPEC_URL, '--print-url is derived from the single version pin');

  const assignments = readFileSync(THIS_FILE, 'utf8').split('\n').filter((line) => /^const SPEC_VERSION =/.test(line));
  report(assignments.length === 1, 'CommonMark version is pinned in exactly one assignment');

  const work = mkdtempSync(join(tmpdir(), 'marxy-spec-'));
  const wrong = join(work, 'spec.json');
  writeFileSync(wrong, '{"not":"the CommonMark spec"}\n');
  const mismatch = runScript([], { MARXY_COMMONMARK_SPEC: wrong });
  report(mismatch.status === 1, 'a file with the wrong digest exits 1', `exit ${mismatch.status}`);
  report(/SHA-256 mismatch/.test(mismatch.stderr), 'a wrong digest names the mismatch', mismatch.stderr.trim());

  const inside = join(REPO_ROOT, 'would-vendor-spec.json');
  const refused = runScript([], { MARXY_COMMONMARK_SPEC: inside });
  report(refused.status === 1, 'a path inside the repository is refused', `exit ${refused.status}`);
  report(/refusing/.test(refused.stderr), 'an in-tree path says why it was refused', refused.stderr.trim());

  const missing = join(work, 'absent.json');
  const absent = runScript([], { MARXY_COMMONMARK_SPEC: missing });
  report(absent.status === 1, 'a missing example file exits 1 rather than skipping', `exit ${absent.status}`);

  const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
  report(checkWorkflow(workflow).length === 0, 'workflow: the spec suite step is required, with no continue-on-error and no || true', checkWorkflow(workflow).join('; '));
  for (const [what, mutated] of [
    ['continue-on-error on the spec suite step', workflow.replace('      - name: CommonMark spec suite', '      - name: CommonMark spec suite\n        continue-on-error: true')],
    ['|| true on test:spec', workflow.replace('pnpm --filter @marxy/core test:spec', 'pnpm --filter @marxy/core test:spec || true')],
    ['porcelain assertion removed', workflow.replace('\n          test -z "$(git status --porcelain)"', '')],
    ['spec suite step removed', workflow.replace(/      - name: CommonMark spec suite\n(?:(?:        |          ).*\n)+/, '')],
  ] as const) {
    report(checkWorkflow(mutated).length > 0, `workflow: ${what} is rejected`);
  }

  const adr = readFileSync(join(REPO_ROOT, 'docs/adr/0021-parser-mdast-micromark.md'), 'utf8');
  report(adr.includes(SPEC_VERSION), 'ADR-0021 names the pinned CommonMark version');
  report(adr.includes(SPEC_SHA256), 'ADR-0021 names the committed digest');
  report(/never vendored|never committed|stays out of the tree/.test(adr), 'ADR-0021 records that the examples are never vendored');
  report(/CI fetches|fails the build/.test(adr), 'ADR-0021 records that the examples are checked in CI');

  const readme = readFileSync(join(REPO_ROOT, 'docs/adr/README.md'), 'utf8');
  report(
    readme.includes('| [0021](0021-parser-mdast-micromark.md) | The parser is mdast/micromark, not markdown-it | accepted |'),
    'docs/adr/README.md still names ADR-0021 with its title and accepted status',
  );

  if (bad) {
    console.error(`spec selftest failed: ${bad} case(s)`);
    process.exit(1);
  }
  console.log('spec selftest ok');
  process.exit(0);
}

function runSuite(): void {
  const path = specPath();
  refuseIfInsideRepo(path);

  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    console.error(`spec: no example file at ${path}`);
    console.error(`spec: fetch it with — curl -fsSL "$(node --experimental-strip-types ${THIS_FILE} --print-url)" -o "$(node --experimental-strip-types ${THIS_FILE} --print-dest)"`);
    process.exit(1);
  }

  const got = sha256(bytes);
  if (got !== SPEC_SHA256) {
    console.error(`spec: SHA-256 mismatch for CommonMark ${SPEC_VERSION}: got ${got}, want ${SPEC_SHA256}`);
    process.exit(1);
  }

  const examples = JSON.parse(bytes.toString('utf8')) as SpecExample[];
  const htmlFailures: string[] = [];
  const invariantFailures: string[] = [];
  for (const example of examples) {
    const input = new TextEncoder().encode(example.markdown);
    // CommonMark only: GFM, frontmatter and math change what these inputs mean, by design.
    const document = parseMarkdown(input, { file: `spec-${example.example}.md`, gfm: false, frontmatter: false, math: false });
    const ours = toHtml(document);
    if (ours !== example.html) {
      htmlFailures.push(`example ${example.example} (${example.section})\n  input:     ${JSON.stringify(example.markdown)}\n  ours:      ${JSON.stringify(ours)}\n  spec:      ${JSON.stringify(example.html)}`);
    }
    for (const violation of checkInvariants(document, input)) {
      invariantFailures.push(`example ${example.example} (${example.section}) CommonMark only: ${violation.invariant} — ${violation.detail}`);
    }
    // And again with everything on, which is what a reader gets: GFM changes the parse, so it changes
    // what provenance has to survive.
    const withGfm = parseMarkdown(input, { file: `spec-${example.example}.md` });
    for (const violation of checkInvariants(withGfm, input)) {
      invariantFailures.push(`example ${example.example} (${example.section}) GFM on: ${violation.invariant} — ${violation.detail}`);
    }
  }

  for (const failure of [...htmlFailures.slice(0, 20), ...invariantFailures.slice(0, 20)]) console.error(failure);
  if (htmlFailures.length > 0 || invariantFailures.length > 0) {
    console.error(`spec: ${htmlFailures.length} HTML divergences and ${invariantFailures.length} invariant violations over ${examples.length} examples (CommonMark ${SPEC_VERSION})`);
    process.exit(1);
  }
  console.log(`spec: ${examples.length} CommonMark ${SPEC_VERSION} examples, 0 HTML divergences, 0 invariant violations`);

  // Honesty check on cases.ts: a rule with one minimal form converges on the specification's spelling
  // of it, and anything beyond a handful of those would mean transcription.
  const specInputs = new Set(examples.map((example) => example.markdown));
  const coinciding = RULE_CASES.filter((one) => specInputs.has(one.input));
  const coincidingGenerated = generateCases().filter((one) => specInputs.has(one.input));
  console.log(
    `spec: of our ${RULE_CASES.length} rule cases, ${coinciding.length} coincide with a spec example (minimal forms); of the generated cases, ${coincidingGenerated.length}`,
  );
  for (const one of coinciding) console.log(`spec:   ${JSON.stringify(one.input)} — [${one.construct}] ${one.rule}`);
}

const argv = process.argv;
if (argv.includes('--selftest')) selftest();
else if (argv.includes('--print-dest')) {
  const path = specPath();
  refuseIfInsideRepo(path);
  console.log(path);
} else if (argv.includes('--print-url')) {
  console.log(SPEC_URL);
} else {
  runSuite();
}
