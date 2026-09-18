// Licence audit (ADR-0006): resolves the licence of every package in pnpm-lock.yaml, every crate in
// apps/desktop/src-tauri/Cargo.lock, and every allow-listed grammar and hyphenation pattern, and
// fails on copyleft or on a licence it cannot determine. ADR-0006 forbids copyleft anywhere in the
// tree, which includes the Rust crates linked into the shipped binary, not just node_modules.
// Its own pass/fail logic is checked against fixtures on every run (see selfCheck).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ALLOWLISTS = join(ROOT, 'scripts/allowlists');

/** Licences that may ship in an MIT tree. Anything absent is unknown, and unknown fails. */
const PERMISSIVE = new Set([
  'MIT', 'MIT-0', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0',
  'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'PSF-2.0', 'OFL-1.1', 'Zlib',
  'FSFAP', 'LicenseRef-TextMate-Bundle', 'Unicode-3.0',
]);

/** Copyleft and non-commercial families ADR-0006 forbids outright, reported as such. */
const COPYLEFT = /\b(AGPL|GPL|LGPL|SSPL|EUPL|OSL|CDDL|CPAL|LPPL|MS-RL|QPL|SISSL|CC-BY-NC|CC-BY-SA)\b/i;

/**
 * Splits an expression on a top-level operator, ignoring operators inside parentheses so that
 * `(MIT OR Apache-2.0) AND Unicode-3.0` splits on the AND and not on the parenthesised OR. Cargo
 * manifests predating SPDX expressions write `MIT/Apache-2.0`, which means the same as OR.
 */
function splitTopLevel(text, operator) {
  const separator = operator === 'OR' ? /^(?:\s+OR\s+|\s*\/\s*)/i : /^\s+AND\s+/i;
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (depth === 0) {
      const match = separator.exec(text.slice(i));
      if (!match) continue;
      parts.push(text.slice(start, i));
      i += match[0].length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Classifies an SPDX licence expression as `permissive`, `copyleft` or `unknown`.
 * A disjunction passes if any choice is permissive, since we may take that choice; a conjunction
 * passes only if every part is. `OR` binds looser than `AND`, so it is split first.
 * An exception (`Apache-2.0 WITH LLVM-exception`) is classified by the licence it modifies, which
 * keeps `GPL-2.0 WITH Classpath-exception-2.0` copyleft.
 */
export function classifyLicence(expression) {
  if (typeof expression !== 'string' || !expression.trim()) return 'unknown';
  const text = expression.trim().replace(/^\((.*)\)$/s, '$1').trim();
  for (const [operator, passes] of [['OR', (r) => r.includes('permissive')],
    ['AND', (r) => r.every((x) => x === 'permissive')]]) {
    const parts = splitTopLevel(text, operator);
    if (parts.length > 1) {
      const results = parts.map(classifyLicence);
      if (passes(results)) return 'permissive';
      return results.includes('copyleft') ? 'copyleft' : 'unknown';
    }
  }
  const id = text.replace(/\s+WITH\s+\S+$/i, '').replace(/\+$/, '').trim();
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

/** Extracts `{ name, version, source }` for every `[[package]]` block in a Cargo.lock. */
export function parseCargoLockCrates(lockfileText) {
  const crates = [];
  let current = null;
  for (const line of lockfileText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '[[package]]') { current = {}; crates.push(current); continue; }
    if (trimmed.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    const field = /^(name|version|source) = "(.*)"$/.exec(trimmed);
    if (field) current[field[1]] = field[2];
  }
  return crates
    .filter(({ name, version }) => name && version)
    .map(({ name, version, source }) => ({ name, version, source: source ?? null }));
}

/**
 * Reads the `license` field from the `[package]` table of a Cargo.toml. A crate that states only
 * `license-file` returns null and so must be recorded in the allow-list with the licence read out
 * of that file by hand, because the file's text is not an SPDX identifier we can classify.
 */
export function licenceFromCargoManifest(manifestText) {
  let inPackage = false;
  let licence = null;
  for (const line of manifestText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) { inPackage = trimmed === '[package]'; continue; }
    if (!inPackage) continue;
    const field = /^license\s*=\s*"([^"]*)"/.exec(trimmed);
    if (field && field[1].trim()) licence = field[1].trim();
  }
  return licence;
}

/**
 * Builds `name@version` → SPDX expression from the crate sources cargo has already unpacked under
 * `<cargoHome>/registry/src/<index>/`. Directory names are built from the lockfile entry rather
 * than split back apart, because `md-5-0.10.6` and `foo-1.0.0-alpha.1` cannot be split reliably.
 * This is a local read of the cache only; it comes back empty on a machine that has not built the
 * Rust side — CI runs this gate before the desktop build — which is why the recorded allow-list,
 * not the cache, is what the audit relies on.
 */
export function resolveRegistryCrateLicences(cargoHome, crates) {
  const licences = new Map();
  const root = join(cargoHome, 'registry/src');
  if (!existsSync(root)) return licences;
  const indexes = readdirSync(root);
  for (const { name, version } of crates) {
    for (const index of indexes) {
      const manifestPath = join(root, index, `${name}-${version}`, 'Cargo.toml');
      if (!existsSync(manifestPath)) continue;
      licences.set(`${name}@${version}`,
        licenceFromCargoManifest(readFileSync(manifestPath, 'utf8')));
    }
  }
  return licences;
}

/**
 * Audits the crates linked into the desktop binary. Returns one message naming each crate that is
 * copyleft, carries a licence nobody recognises, or has no licence anyone can point at; an empty
 * array means the Rust tree is clean. A crate the local registry cache *can* answer for is also
 * checked against the recorded allow-list, so a stale record is a failure rather than a silent
 * wrong answer.
 * Records are keyed by `name@version`, not by name: two versions of one crate can carry different
 * licence text, and a version bump is a thing that has to be re-audited rather than inherited.
 */
export function auditCrates({ crates, registry, recorded, workspace }) {
  const failures = [];
  if (crates.length === 0) failures.push('Cargo.lock lists no crates — parse failed');
  for (const { name, version, source } of crates) {
    const key = `${name}@${version}`;
    const fromRegistry = source ? registry.get(key) ?? null : null;
    const entry = source ? recordedLicence(recorded, key) : null;
    const fromWorkspace = source ? null : workspace.get(name) ?? null;
    if (fromRegistry && entry && fromRegistry !== entry.licence) {
      failures.push(`crate ${key}: recorded licence ${entry.licence} disagrees with the registry `
        + `copy's ${fromRegistry} — re-audit scripts/allowlists/crate-licences.json`);
      continue;
    }
    const licence = fromWorkspace ?? fromRegistry ?? entry?.licence ?? null;
    if (!licence) {
      const why = !source ? 'workspace crate whose manifest states no licence'
        : registry.has(key) ? 'its Cargo.toml states no license field, and it is not recorded in '
          + 'scripts/allowlists/crate-licences.json'
          : `not in the local cargo registry and no record matches ${key} in `
            + 'scripts/allowlists/crate-licences.json — read its licence from a local copy '
            + 'and record it there with the source';
      failures.push(`crate ${key}: licence undetermined — ${why}`);
      continue;
    }
    const where = fromWorkspace ? 'workspace manifest'
      : fromRegistry ? 'local cargo registry' : 'scripts/allowlists/crate-licences.json';
    const verdict = classifyLicence(licence);
    if (verdict !== 'permissive') failures.push(`crate ${key}: ${verdict} licence ${licence} (${where})`);
  }
  return failures;
}

/**
 * Audits a recorded-licence allow-list itself: a record with no `source` is a guess, and a guess is
 * what this gate exists to prevent, so it fails the same way an unknown licence does.
 */
export function auditRecordedLicences(label, packages) {
  const failures = [];
  if (!Array.isArray(packages) || packages.length === 0) return [`${label}: no entries`];
  for (const entry of packages) {
    const id = entry?.match ?? JSON.stringify(entry);
    if (!entry?.match) { failures.push(`${label}: ${id} records no match pattern`); continue; }
    if (!entry.licence) { failures.push(`${label}: ${id} records no licence`); continue; }
    if (!entry.source) failures.push(`${label}: ${id} records no licence source`);
    const verdict = classifyLicence(entry.licence);
    if (verdict !== 'permissive') failures.push(`${label}: ${id} is ${verdict} (${entry.licence})`);
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

  const cargoLock = [
    '# This file is automatically @generated by Cargo.', 'version = 4', '',
    '[[package]]', 'name = "marxy"', 'version = "0.0.1"', '',
    '[[package]]', 'name = "clean-crate"', 'version = "1.0.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    'checksum = "abc"', 'dependencies = [', ' "gpl-crate",', ']', '',
    '[[package]]', 'name = "gpl-crate"', 'version = "2.0.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    'checksum = "def"', '',
    '[[patch.unused]]', 'name = "not-a-package"', 'version = "9.9.9"',
  ].join('\n');
  const lockCrates = parseCargoLockCrates(cargoLock);
  const workspace = new Map([['marxy', 'MIT']]);
  check('Cargo.lock parse finds every package block and ignores other tables',
    lockCrates.length === 3 && !lockCrates.some((c) => c.name === 'not-a-package'));
  check('Cargo.lock parse marks the workspace crate as sourceless',
    lockCrates.find((c) => c.name === 'marxy')?.source === null);
  check('dependencies lists are not mistaken for crates',
    lockCrates.filter((c) => c.name === 'gpl-crate').length === 1);

  const cratesOnly = lockCrates.filter((c) => c.source);
  const cleanCrate = cratesOnly.find((c) => c.name === 'clean-crate');
  const cargoManifest = (body) => `[package]\nname = "x"\n${body}\n\n[dependencies]\nlicense = "GPL-3.0"\n`;
  check('a Cargo.toml licence reads', licenceFromCargoManifest(cargoManifest('license = "MIT OR Apache-2.0"')) === 'MIT OR Apache-2.0');
  check('a Cargo.toml with only license-file states no licence',
    licenceFromCargoManifest(cargoManifest('license-file = "COPYING"')) === null);
  check('a licence outside the [package] table is not read',
    licenceFromCargoManifest('[dependencies]\nlicense = "GPL-3.0"\n') === null);
  check('cargo slash-separated dual licences are permissive', classifyLicence('MIT/Apache-2.0') === 'permissive');
  check('an exception is classified by the licence it modifies',
    classifyLicence('Apache-2.0 WITH LLVM-exception') === 'permissive'
    && classifyLicence('GPL-2.0 WITH Classpath-exception-2.0') === 'copyleft');
  check('a parenthesised choice inside a conjunction is not mis-split',
    classifyLicence('(MIT OR Apache-2.0) AND Unicode-3.0') === 'permissive'
    && classifyLicence('(MIT OR Apache-2.0) AND GPL-3.0-only') === 'copyleft');

  const gplCrateFailures = auditCrates({
    crates: lockCrates, workspace, recorded: [],
    registry: new Map([['clean-crate@1.0.0', 'MIT'], ['gpl-crate@2.0.0', 'GPL-3.0-only']]),
  });
  check('a GPL crate in Cargo.lock fails the gate, naming the crate',
    gplCrateFailures.length === 1 && /^crate gpl-crate@2\.0\.0: copyleft licence GPL-3\.0-only/.test(gplCrateFailures[0]));
  check('the same Cargo.lock without the GPL crate passes',
    auditCrates({
      crates: [lockCrates[0], cleanCrate], workspace, recorded: [],
      registry: new Map([['clean-crate@1.0.0', 'MIT']]),
    }).length === 0);
  check('a crate whose manifest has no licence field fails rather than passing',
    auditCrates({ crates: [cleanCrate], workspace, recorded: [], registry: new Map([['clean-crate@1.0.0', null]]) })
      .some((f) => /^crate clean-crate@1\.0\.0: licence undetermined — its Cargo\.toml states no license field/.test(f)));
  check('an unaudited crate, absent from the registry cache and from every allow-list, fails',
    auditCrates({ crates: [cleanCrate], workspace, recorded: [], registry: new Map() })
      .some((f) => /^crate clean-crate@1\.0\.0: licence undetermined — not in the local cargo registry/.test(f)));
  check('a crate with a recorded permissive licence passes with no registry cache at all',
    auditCrates({
      crates: [cleanCrate], workspace, registry: new Map(),
      recorded: [{ match: 'clean-crate@1.0.0', licence: 'MIT', source: 'fixture' }],
    }).length === 0);
  check('a record for one version does not vouch for another version of the same crate',
    auditCrates({
      crates: [{ name: 'clean-crate', version: '2.0.0', source: cleanCrate.source }],
      workspace, registry: new Map(),
      recorded: [{ match: 'clean-crate@1.0.0', licence: 'MIT', source: 'fixture' }],
    }).length === 1);
  check('a recorded copyleft crate licence still fails',
    auditCrates({
      crates: [cleanCrate], workspace, registry: new Map(),
      recorded: [{ match: 'clean-crate@1.*', licence: 'LGPL-3.0-only', source: 'fixture' }],
    }).some((f) => /copyleft/.test(f)));
  check('a record that disagrees with the registry copy fails as stale',
    auditCrates({
      crates: [cleanCrate], workspace, registry: new Map([['clean-crate@1.0.0', 'MPL-2.0']]),
      recorded: [{ match: 'clean-crate@1.0.0', licence: 'MIT', source: 'fixture' }],
    }).some((f) => /disagrees with the registry copy/.test(f)));
  check('a workspace crate whose manifest states no licence fails',
    auditCrates({ crates: [lockCrates[0]], workspace: new Map(), recorded: [], registry: new Map() })
      .some((f) => /^crate marxy@0\.0\.1: licence undetermined/.test(f)));
  check('an unparseable Cargo.lock fails rather than reporting a clean tree',
    auditCrates({ crates: [], workspace, recorded: [], registry: new Map() })
      .some((f) => /Cargo\.lock lists no crates/.test(f)));

  check('an absent cargo registry cache resolves nothing rather than throwing',
    resolveRegistryCrateLicences(join(ROOT, 'scripts/allowlists/no-such-cargo-home'), cratesOnly).size === 0);

  check('a fully recorded crate licence passes the record audit',
    auditRecordedLicences('fixture', [{ match: 'a', licence: 'MIT', source: 'fixture' }]).length === 0);
  check('a recorded licence with no source fails, because a record with no source is a guess',
    auditRecordedLicences('fixture', [{ match: 'a', licence: 'MIT' }])
      .some((f) => /records no licence source$/.test(f)));
  check('an empty recorded-licence list fails',
    auditRecordedLicences('fixture', []).length === 1);

  // Assembled from fragments so that this assertion cannot match itself: the gate must reach the
  // network never, so that what it reports is what is on this disk (ADR-0006, ADR-0009).
  const networkPrimitives = [`fet${'ch('}`, `node:ht${'tp'}`, `XMLHttp${'Request'}`, `child_${'process'}`,
    `require('ht${'tps'}`, `${'exec'}Sync(`];
  const ownSource = readFileSync(new URL(import.meta.url), 'utf8');
  for (const primitive of networkPrimitives) {
    check(`the gate contains no ${primitive}`, !ownSource.includes(primitive));
  }

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
  console.log(`licence gate self-check ok (${cases} cases, including a GPL npm dependency and a `
    + 'GPL, licence-less and unaudited crate fixture)');

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

  const cargoLock = join(ROOT, 'apps/desktop/src-tauri/Cargo.lock');
  let crates = [];
  if (!existsSync(cargoLock)) {
    failures.push('apps/desktop/src-tauri/Cargo.lock is missing');
  } else {
    crates = parseCargoLockCrates(readFileSync(cargoLock, 'utf8'));
    const recordedCrates = JSON.parse(readFileSync(join(ALLOWLISTS, 'crate-licences.json'), 'utf8')).packages;
    failures.push(...auditRecordedLicences('crate licence records', recordedCrates));
    failures.push(...auditCrates({
      crates,
      registry: resolveRegistryCrateLicences(
        process.env.CARGO_HOME ?? join(homedir(), '.cargo'), crates.filter((c) => c.source),
      ),
      recorded: recordedCrates,
      workspace: new Map([['marxy', licenceFromCargoManifest(
        readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8'),
      )]].filter(([, licence]) => licence)),
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
  console.log(`licence gate ok (${packages.length} lockfile packages, ${crates.length} Cargo.lock `
    + `crates, ${grammars.languages.length} grammars, `
    + `${patterns.languages.length} hyphenation patterns)`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
