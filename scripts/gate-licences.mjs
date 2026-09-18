// Licence audit (ADR-0006): resolves the licence of every package in pnpm-lock.yaml and of every
// allow-listed grammar and hyphenation pattern, and fails on copyleft or on a licence it cannot
// determine. Its own pass/fail logic is checked against fixtures on every run (see selfCheck).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ALLOWLISTS = join(ROOT, 'scripts/allowlists');

/** Licences that may ship in an MIT tree. Anything absent is unknown, and unknown fails. */
const PERMISSIVE = new Set([
  'MIT', 'MIT-0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0',
  'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'PSF-2.0', 'OFL-1.1', 'Zlib',
  'FSFAP', 'LicenseRef-TextMate-Bundle',
]);

/** Copyleft and non-commercial families ADR-0006 forbids outright, reported as such. */
const COPYLEFT = /\b(AGPL|GPL|LGPL|SSPL|EUPL|OSL|CDDL|CPAL|LPPL|MS-RL|QPL|SISSL|CC-BY-NC|CC-BY-SA)\b/i;

/**
 * Classifies an SPDX licence expression as `permissive`, `copyleft` or `unknown`.
 * A disjunction passes if any choice is permissive, since we may take that choice; a conjunction
 * passes only if every part is.
 */
export function classifyLicence(expression) {
  if (typeof expression !== 'string' || !expression.trim()) return 'unknown';
  const text = expression.trim().replace(/^\((.*)\)$/s, '$1').trim();
  for (const [operator, passes] of [['OR', (r) => r.includes('permissive')],
    ['AND', (r) => r.every((x) => x === 'permissive')]]) {
    const parts = text.split(new RegExp(`\\s+${operator}\\s+`, 'i'));
    if (parts.length > 1) {
      const results = parts.map(classifyLicence);
      if (passes(results)) return 'permissive';
      return results.includes('copyleft') ? 'copyleft' : 'unknown';
    }
  }
  const id = text.replace(/\+$/, '');
  if (PERMISSIVE.has(id)) return 'permissive';
  return COPYLEFT.test(id) ? 'copyleft' : 'unknown';
}

/**
 * Reads a package.json `license`/`licenses` field, in any of the shapes npm has used, and returns
 * an SPDX expression or `null` when the manifest does not state one.
 */
export function licenceFromManifest(manifest) {
  const field = manifest?.license ?? manifest?.licenses;
  const one = (value) => (typeof value === 'string' ? value : value?.type ?? null);
  const expression = Array.isArray(field)
    ? field.map(one).filter(Boolean).join(' OR ')
    : one(field);
  if (!expression) return null;
  return /^(UNLICENSED|SEE LICENSE)/i.test(expression) ? null : expression;
}

/** Extracts `name@version` for every package resolved in a pnpm lockfile's `packages:` section. */
export function parseLockfilePackages(lockfileText) {
  const packages = [];
  let inPackages = false;
  for (const line of lockfileText.split('\n')) {
    if (/^\S/.test(line)) { inPackages = line.startsWith('packages:'); continue; }
    if (!inPackages) continue;
    const key = /^ {2}'?([^'\s]+)'?:\s*$/.exec(line)?.[1];
    if (!key) continue;
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    packages.push({ name: key.slice(0, at), version: key.slice(at + 1).replace(/\(.*\)$/, '') });
  }
  return packages;
}

/** Builds `name@version` → SPDX expression (or null) from every package.json in the pnpm store. */
export function resolveInstalledLicences(virtualStore) {
  const licences = new Map();
  if (!existsSync(virtualStore)) return licences;
  for (const entry of readdirSync(virtualStore)) {
    const base = join(virtualStore, entry, 'node_modules');
    if (!existsSync(base)) continue;
    for (const top of readdirSync(base)) {
      const names = top.startsWith('@')
        ? readdirSync(join(base, top)).map((scoped) => join(top, scoped))
        : [top];
      for (const name of names) {
        const manifestPath = join(base, name, 'package.json');
        if (!existsSync(manifestPath)) continue;
        let manifest;
        try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { continue; }
        if (!manifest.name || !manifest.version) continue;
        licences.set(`${manifest.name}@${manifest.version}`, licenceFromManifest(manifest));
      }
    }
  }
  return licences;
}

/** Finds the recorded licence for a package the store cannot answer for, by publisher pattern. */
export function recordedLicence(recorded, name) {
  const entry = recorded.find(({ match }) => (match.endsWith('*')
    ? name.startsWith(match.slice(0, -1))
    : match === name));
  return entry ?? null;
}

/**
 * Audits resolved dependencies. Returns one message per package that is copyleft, has a licence
 * nobody recognises, or has no licence anyone can point at; an empty array means the tree is clean.
 */
export function auditDependencies({ packages, installed, recorded }) {
  const failures = [];
  if (packages.length === 0) failures.push('pnpm-lock.yaml lists no packages — parse failed');
  for (const { name, version } of packages) {
    const key = `${name}@${version}`;
    let licence = installed.get(key) ?? null;
    let where = 'node_modules';
    if (!licence) {
      const entry = recordedLicence(recorded, name);
      if (entry) { licence = entry.licence; where = 'scripts/allowlists/dependency-licences.json'; }
    }
    if (!licence) {
      failures.push(`${key}: licence undetermined — not installed and not recorded in `
        + 'scripts/allowlists/dependency-licences.json');
      continue;
    }
    const verdict = classifyLicence(licence);
    if (verdict !== 'permissive') failures.push(`${key}: ${verdict} licence ${licence} (${where})`);
  }
  return failures;
}

/**
 * Audits one allow-list file: every entry must be an object carrying an `id`, a `licence` and a
 * `source`, the licence must be permissive, and no forbidden id may appear.
 */
export function auditAllowlist(label, allowlist) {
  const failures = [];
  const entries = allowlist?.languages;
  if (!Array.isArray(entries) || entries.length === 0) return [`${label}: no entries`];
  const forbidden = new Set(allowlist.forbiddenGrammars ?? []);
  for (const entry of entries) {
    const id = entry?.id ?? JSON.stringify(entry);
    if (typeof entry !== 'object' || !entry.id) { failures.push(`${label}: ${id} is not an entry with an id`); continue; }
    if (!entry.licence) { failures.push(`${label}: ${id} records no licence`); continue; }
    if (!entry.source) failures.push(`${label}: ${id} records no licence source`);
    if (forbidden.has(entry.id) || forbidden.has(entry.grammar)) {
      failures.push(`${label}: ${id} is on the forbidden list`);
      continue;
    }
    const verdict = classifyLicence(entry.licence);
    if (verdict !== 'permissive') failures.push(`${label}: ${id} is ${verdict} (${entry.licence})`);
  }
  return failures;
}

/**
 * Proves the gate fails in the cases ADR-0006 exists to catch, without any of them ever entering
 * the real lockfile: a GPL dependency, a licence-less dependency, an unrecognised licence, a
 * grammar with no licence recorded, and a GPL grammar. Throws on the first case that misbehaves.
 */
export function selfCheck() {
  const cases = [];
  const check = (name, condition) => { cases.push(name); assert.ok(condition, `self-check failed: ${name}`); };

  check('MIT is permissive', classifyLicence('MIT') === 'permissive');
  check('dual MIT/Apache is permissive', classifyLicence('(MIT OR Apache-2.0)') === 'permissive');
  check('GPL-3.0-only is copyleft', classifyLicence('GPL-3.0-only') === 'copyleft');
  check('LGPL-3.0 is copyleft', classifyLicence('LGPL-3.0') === 'copyleft');
  check('MIT AND GPL-2.0 is copyleft', classifyLicence('MIT AND GPL-2.0') === 'copyleft');
  check('an invented licence is unknown', classifyLicence('Totally-Free-1.0') === 'unknown');
  check('no licence is unknown', classifyLicence(undefined) === 'unknown');
  check('SEE LICENSE IN is no licence', licenceFromManifest({ license: 'SEE LICENSE IN LICENSE' }) === null);
  check('legacy licenses array reads', licenceFromManifest({ licenses: [{ type: 'MIT' }] }) === 'MIT');

  const lockfileWithGpl = [
    'lockfileVersion: \'9.0\'', '', 'packages:', '',
    '  clean-pkg@1.0.0:', '    resolution: {integrity: sha512-fixture}', '',
    '  \'@fixture/gpl-pkg@2.0.0\':', '    resolution: {integrity: sha512-fixture}', '',
    'snapshots:', '', '  clean-pkg@1.0.0: {}',
  ].join('\n');
  const parsed = parseLockfilePackages(lockfileWithGpl);
  check('lockfile parse finds both packages', parsed.length === 2);
  check('lockfile parse unquotes scoped names',
    parsed.some((p) => p.name === '@fixture/gpl-pkg' && p.version === '2.0.0'));

  const installed = new Map([['clean-pkg@1.0.0', 'MIT'], ['@fixture/gpl-pkg@2.0.0', 'GPL-3.0-only']]);
  const gplFailures = auditDependencies({ packages: parsed, installed, recorded: [] });
  check('a GPL dependency in the lockfile fails the gate',
    gplFailures.length === 1 && /@fixture\/gpl-pkg@2\.0\.0: copyleft/.test(gplFailures[0]));
  check('the same lockfile without the GPL package passes',
    auditDependencies({ packages: [parsed[0]], installed, recorded: [] }).length === 0);
  check('a dependency with no licence fails rather than passing',
    auditDependencies({ packages: [parsed[0]], installed: new Map([['clean-pkg@1.0.0', null]]), recorded: [] })
      .some((f) => /licence undetermined/.test(f)));
  check('an uninstalled, unrecorded dependency fails',
    auditDependencies({ packages: [parsed[0]], installed: new Map(), recorded: [] }).length === 1);
  check('an uninstalled dependency with a recorded permissive licence passes',
    auditDependencies({
      packages: [parsed[0]], installed: new Map(),
      recorded: [{ match: 'clean-*', licence: 'MIT', source: 'fixture' }],
    }).length === 0);
  check('a recorded copyleft licence still fails',
    auditDependencies({
      packages: [parsed[0]], installed: new Map(),
      recorded: [{ match: 'clean-pkg', licence: 'GPL-2.0-or-later', source: 'fixture' }],
    }).length === 1);

  const grammars = { languages: [{ id: 'ok', licence: 'MIT', source: 'fixture' }], forbiddenGrammars: ['ada'] };
  check('a fully recorded grammar passes', auditAllowlist('fixture', grammars).length === 0);
  check('a grammar with no licence fails',
    auditAllowlist('fixture', { languages: [{ id: 'bare', source: 'fixture' }] })
      .some((f) => /records no licence$/.test(f)));
  check('a bare string entry fails',
    auditAllowlist('fixture', { languages: ['bash'] }).length === 1);
  check('a GPL grammar fails',
    auditAllowlist('fixture', { languages: [{ id: 'gnuplot', licence: 'GPL-3.0', source: 'fixture' }] })
      .some((f) => /copyleft/.test(f)));
  check('a forbidden grammar fails even if it claims MIT',
    auditAllowlist('fixture', { ...grammars, languages: [{ id: 'ada', licence: 'MIT', source: 'fixture' }] })
      .some((f) => /forbidden/.test(f)));
  check('an empty allow-list fails', auditAllowlist('fixture', { languages: [] }).length === 1);

  return cases.length;
}

function main() {
  const cases = selfCheck();
  console.log(`licence gate self-check ok (${cases} cases, including a GPL dependency fixture)`);

  const failures = [];
  const lockfile = join(ROOT, 'pnpm-lock.yaml');
  if (!existsSync(lockfile)) failures.push('pnpm-lock.yaml is missing');
  const virtualStore = join(ROOT, 'node_modules/.pnpm');
  if (!existsSync(virtualStore)) failures.push('node_modules/.pnpm is missing — run pnpm install');

  let packages = [];
  if (failures.length === 0) {
    packages = parseLockfilePackages(readFileSync(lockfile, 'utf8'));
    const recorded = JSON.parse(readFileSync(join(ALLOWLISTS, 'dependency-licences.json'), 'utf8')).packages;
    failures.push(...auditDependencies({
      packages, installed: resolveInstalledLicences(virtualStore), recorded,
    }));
  }

  const grammars = JSON.parse(readFileSync(join(ALLOWLISTS, 'shiki-languages.json'), 'utf8'));
  const patterns = JSON.parse(readFileSync(join(ALLOWLISTS, 'hyphenation-patterns.json'), 'utf8'));
  failures.push(...auditAllowlist('grammar allow-list', grammars));
  failures.push(...auditAllowlist('hyphenation allow-list', patterns));

  if (failures.length) {
    console.error(`licence gate failed:\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log(`licence gate ok (${packages.length} lockfile packages, `
    + `${grammars.languages.length} grammars, ${patterns.languages.length} hyphenation patterns)`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
