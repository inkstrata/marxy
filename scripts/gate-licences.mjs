// Licence audit (ADR-0006): resolves the licence of every package in pnpm-lock.yaml, every crate in
// apps/desktop/src-tauri/Cargo.lock, and every allow-listed grammar and hyphenation pattern, and
// fails on copyleft or on a licence it cannot determine. ADR-0006 forbids copyleft anywhere in the
// tree, which includes the Rust crates linked into the shipped binary, not just node_modules.
// CI runs it twice (MARXY-65): before the Rust build (allow-list fallback) and after, with
// --require-registry, so a stale record cannot hide behind an empty cargo cache.
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
 * Rust side. CI's first run is that case (before the desktop build), so the recorded allow-list
 * is what that run relies on. The second run, after the build, passes --require-registry so a
 * crate that is still missing from the cache is a failure rather than a silent fallback.
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

/** The shape a crate record must have, quoted into the messages that ask for a missing one. */
const CRATE_RECORD_SHAPE = '{ "match": "name@version", "licence": <SPDX expression>, '
  + '"source": <the file you read it from> }';

/**
 * True when a licence passes only because we elect a permissive branch of a disjunction whose other
 * branches are copyleft, as `r-efi`'s `MIT OR Apache-2.0 OR LGPL-2.1-or-later` does. Electing the
 * MIT branch is legitimate, but it is a choice the project is making rather than a crate that is
 * simply permissive, so the gate names it instead of swallowing it (the rule itself: MARXY-58).
 */
export function isElectedOverCopyleft(expression) {
  return classifyLicence(expression) === 'permissive' && COPYLEFT.test(expression);
}

/**
 * Audits the crates linked into the desktop binary. Returns `failures`, one message naming each
 * crate that is copyleft, carries a licence nobody recognises, or has no licence anyone can point
 * at, and `resolved`, one entry per crate saying where its licence came from so the caller can
 * report how much of the run was verified against something and how much was taken on trust.
 * A crate the local registry cache *can* answer for is also checked against the recorded
 * allow-list, so a stale record is a failure rather than a silent wrong answer.
 * Records are matched on the exact `name@version` key, never by pattern: two versions of one crate
 * can carry different licence text, a version bump has to be re-audited rather than inherited, and
 * a pattern is a way for one record to vouch for crates nobody looked at.
 * `requireRegistry` is the post-build mode (MARXY-65): a registry crate that is not in the local
 * cache fails by name instead of falling back to the allow-list, because that fallback is what
 * made the first CI run unable to see a stale record.
 */
export function auditCrates({ crates, registry, recorded, workspace, requireRegistry = false }) {
  const failures = [];
  const resolved = [];
  if (crates.length === 0) failures.push('Cargo.lock lists no crates — parse failed');
  const records = new Map(recorded
    .filter((entry) => typeof entry?.match === 'string')
    .map((entry) => [entry.match, entry]));
  for (const { name, version, source } of crates) {
    const key = `${name}@${version}`;
    if (requireRegistry && source && !registry.has(key)) {
      failures.push(`crate ${key}: not in the local cargo cache — the post-build run must `
        + 're-read every registry crate');
      continue;
    }
    const fromRegistry = source ? registry.get(key) ?? null : null;
    const entry = source ? records.get(key) ?? null : null;
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
          : 'not in the local cargo registry and no record is keyed exactly '
            + `"${key}" in scripts/allowlists/crate-licences.json — read its licence from a local `
            + `copy and add ${CRATE_RECORD_SHAPE}`;
      failures.push(`crate ${key}: licence undetermined — ${why}`);
      continue;
    }
    const where = fromWorkspace ? 'workspace' : fromRegistry ? 'cargo cache' : 'recorded';
    const verdict = classifyLicence(licence);
    if (verdict !== 'permissive') {
      failures.push(`crate ${key}: ${verdict} licence ${licence} (${where})`);
      continue;
    }
    resolved.push({ key, licence, where, elected: isElectedOverCopyleft(licence) });
  }
  return { failures, resolved };
}

/**
 * Audits the crate allow-list against the lockfile it speaks for. `auditRecordedLicences` checks
 * that each record is well formed; this checks that the set of records is exactly the set of
 * registry crates in Cargo.lock, with no pattern among them.
 *
 * Both halves exist because the file is self-attested: on a machine with no cargo cache — CI's
 * first run, before the Rust build — a record is simply believed. Without this, one
 * `{ "match": "*", "licence": "MIT" }` record silently vouches for the whole tree and the gate
 * still prints a crate count and exits 0, which is worse than no gate, because it is believed.
 * The second CI run, after the desktop build, passes --require-registry so the crates are
 * actually re-read (MARXY-65).
 */
export function auditCrateRecords(label, recorded, crates) {
  const failures = [];
  const expected = new Set(crates.filter(({ source }) => source)
    .map(({ name, version }) => `${name}@${version}`));
  const seen = new Set();
  for (const entry of Array.isArray(recorded) ? recorded : []) {
    const match = entry?.match;
    if (typeof match !== 'string' || !match) continue;
    if (match.includes('*')) {
      failures.push(`${label}: "${match}" is a pattern — a crate record must name one crate `
        + `exactly as ${CRATE_RECORD_SHAPE}, or one record can vouch for crates nobody read`);
      continue;
    }
    if (seen.has(match)) { failures.push(`${label}: ${match} is recorded twice`); continue; }
    seen.add(match);
    if (!expected.has(match)) {
      failures.push(`${label}: ${match} is recorded but is not a registry crate in Cargo.lock — `
        + 'delete the record rather than leaving a licence nothing accounts for');
    }
  }
  for (const key of expected) {
    if (!seen.has(key)) {
      failures.push(`${label}: ${key} is in Cargo.lock with no record — read its licence from a `
        + `local copy and add ${CRATE_RECORD_SHAPE}`);
    }
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
 * Reads argv for the post-build flag. Unknown dashed options fail rather than being ignored,
 * because a typo on --require-registry would otherwise silently run the pre-build mode in CI.
 */
export function parseGateOptions(argv) {
  const flags = argv.filter((arg, i) => i >= 2 && arg.startsWith('-'));
  return {
    requireRegistry: flags.includes('--require-registry'),
    unknown: flags.filter((arg) => arg !== '--require-registry'),
  };
}

/**
 * The two CI runs are only worth anything if both are required on both runners, the second
 * happens after the desktop build (so the cargo cache is populated), and they have different
 * names in the log. A step that can be skipped or forced green is the same as no second run.
 */
export function checkLicenceWorkflow(text) {
  const errors = [];
  const gatesStart = text.indexOf('\n  gates:');
  if (gatesStart < 0) return ['.github/workflows/ci.yml: no gates job'];
  const gates = text.slice(gatesStart);
  for (const os of ['macos-latest', 'ubuntu-latest']) {
    if (!new RegExp(`os:.*${os}`).test(gates)) {
      errors.push(`.github/workflows/ci.yml: the gates matrix does not include ${os}`);
    }
  }
  const steps = gates.split(/\n      - /).slice(1);
  const licenceIdxs = steps
    .map((s, i) => (/gate:licences/.test(s) ? i : -1))
    .filter((i) => i >= 0);
  const licenceSteps = licenceIdxs.map((i) => steps[i]);
  if (licenceSteps.length < 2) {
    errors.push('.github/workflows/ci.yml: gate:licences must run twice '
      + '(pre-build and post-build)');
  }
  const names = licenceSteps.map((s) => /^name:\s*(.+)$/m.exec(s)?.[1]?.trim() ?? null);
  if (names.some((n) => !n)) {
    errors.push('.github/workflows/ci.yml: each licence-gate step must have a name so the two '
      + 'runs are distinguishable in the log');
  } else if (names.length >= 2 && new Set(names).size < 2) {
    errors.push('.github/workflows/ci.yml: the two licence-gate steps must have different names');
  }
  const buildIdx = steps.findIndex((s) => /@marxy\/desktop build/.test(s));
  if (buildIdx < 0) {
    errors.push('.github/workflows/ci.yml: no desktop build step');
  } else if (licenceIdxs.length >= 2) {
    if (!(licenceIdxs[0] < buildIdx)) {
      errors.push('.github/workflows/ci.yml: the first licence gate must run before the desktop '
        + 'build so a lockfile-only change still fails fast');
    }
    if (!licenceIdxs.some((i) => i > buildIdx)) {
      errors.push('.github/workflows/ci.yml: a licence gate must run after the desktop build, '
        + 'when the cargo cache is populated');
    }
  }
  const post = licenceIdxs.filter((i) => i > buildIdx).map((i) => steps[i])[0];
  if (post && !/--require-registry/.test(post)) {
    errors.push('.github/workflows/ci.yml: the post-build licence gate must pass '
      + '--require-registry so it reads every crate from the cache rather than the allow-list');
  }
  for (const s of licenceSteps) {
    const head = (/^name:\s*(.+)$/m.exec(s)?.[1] ?? s.split('\n')[0]).trim();
    if (/continue-on-error/.test(s)) {
      errors.push(`.github/workflows/ci.yml: "${head}" carries continue-on-error`);
    }
    if (/\|\|\s*true/.test(s)) {
      errors.push(`.github/workflows/ci.yml: "${head}" swallows its exit code with || true`);
    }
    if (/^\s*if:/m.test(s)) {
      errors.push(`.github/workflows/ci.yml: "${head}" is conditional, so it is not required `
        + 'on both runners');
    }
  }
  return errors;
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

  const cleanRecord = { match: 'clean-crate@1.0.0', licence: 'MIT', source: 'fixture' };
  const gplCrateFailures = auditCrates({
    crates: lockCrates, workspace, recorded: [],
    registry: new Map([['clean-crate@1.0.0', 'MIT'], ['gpl-crate@2.0.0', 'GPL-3.0-only']]),
  }).failures;
  check('a GPL crate in Cargo.lock fails the gate, naming the crate',
    gplCrateFailures.length === 1 && /^crate gpl-crate@2\.0\.0: copyleft licence GPL-3\.0-only/.test(gplCrateFailures[0]));
  check('the same Cargo.lock without the GPL crate passes',
    auditCrates({
      crates: [lockCrates[0], cleanCrate], workspace, recorded: [],
      registry: new Map([['clean-crate@1.0.0', 'MIT']]),
    }).failures.length === 0);
  check('a crate whose manifest has no licence field fails rather than passing',
    auditCrates({ crates: [cleanCrate], workspace, recorded: [], registry: new Map([['clean-crate@1.0.0', null]]) })
      .failures.some((f) => /^crate clean-crate@1\.0\.0: licence undetermined — its Cargo\.toml states no license field/.test(f)));
  check('an unaudited crate, absent from the registry cache and from every allow-list, fails',
    auditCrates({ crates: [cleanCrate], workspace, recorded: [], registry: new Map() })
      .failures.some((f) => /^crate clean-crate@1\.0\.0: licence undetermined — not in the local cargo registry/.test(f)));
  check('the message for a missing record names the key format and all three required fields',
    auditCrates({ crates: [cleanCrate], workspace, recorded: [], registry: new Map() })
      .failures.some((f) => /"match": "name@version"/.test(f) && /"licence"/.test(f) && /"source"/.test(f)));
  check('a crate with a recorded permissive licence passes with no registry cache at all',
    auditCrates({ crates: [cleanCrate], workspace, registry: new Map(), recorded: [cleanRecord] })
      .failures.length === 0);
  check('a record for one version does not vouch for another version of the same crate',
    auditCrates({
      crates: [{ name: 'clean-crate', version: '2.0.0', source: cleanCrate.source }],
      workspace, registry: new Map(), recorded: [cleanRecord],
    }).failures.length === 1);
  check('a recorded copyleft crate licence still fails',
    auditCrates({
      crates: [cleanCrate], workspace, registry: new Map(),
      recorded: [{ ...cleanRecord, licence: 'LGPL-3.0-only' }],
    }).failures.some((f) => /copyleft/.test(f)));
  check('a record that disagrees with the registry copy fails as stale',
    auditCrates({
      crates: [cleanCrate], workspace, registry: new Map([['clean-crate@1.0.0', 'MPL-2.0']]),
      recorded: [cleanRecord],
    }).failures.some((f) => /disagrees with the registry copy/.test(f)));
  // The same stale record is invisible when the cache is empty, which is every pre-build CI run.
  // That is why the post-build run exists: without it, a PR can rewrite the allow-list and pass.
  check('a disagreeing record is invisible with an empty cache (why the post-build run exists)',
    auditCrates({
      crates: [cleanCrate], workspace, registry: new Map(),
      recorded: [{ ...cleanRecord, licence: 'ISC' }],
    }).failures.length === 0);
  check('the same disagreeing record fails the post-build run, naming the crate',
    auditCrates({
      crates: [cleanCrate], workspace, registry: new Map([['clean-crate@1.0.0', 'MIT']]),
      recorded: [{ ...cleanRecord, licence: 'ISC' }], requireRegistry: true,
    }).failures.some((f) => /^crate clean-crate@1\.0\.0: recorded licence ISC disagrees/.test(f)));
  check('require-registry with an empty cache fails, naming the crate',
    auditCrates({
      crates: [cleanCrate], workspace, recorded: [cleanRecord], registry: new Map(),
      requireRegistry: true,
    }).failures.some((f) => /^crate clean-crate@1\.0\.0: not in the local cargo cache/.test(f)));
  check('require-registry with a populated cache and matching record passes',
    auditCrates({
      crates: [cleanCrate], workspace, recorded: [cleanRecord],
      registry: new Map([['clean-crate@1.0.0', 'MIT']]), requireRegistry: true,
    }).failures.length === 0);
  check('without require-registry, an empty cache still accepts a recorded licence',
    auditCrates({ crates: [cleanCrate], workspace, recorded: [cleanRecord], registry: new Map() })
      .failures.length === 0);
  check('a lockfile crate with no record fails with an empty cache (lockfile-only still fails fast)',
    auditCrateRecords('fixture', [], [cleanCrate])
      .some((f) => /clean-crate@1\.0\.0 is in Cargo.lock with no record/.test(f)));
  check('a workspace crate whose manifest states no licence fails',
    auditCrates({ crates: [lockCrates[0]], workspace: new Map(), recorded: [], registry: new Map() })
      .failures.some((f) => /^crate marxy@0\.0\.1: licence undetermined/.test(f)));
  check('an unparseable Cargo.lock fails rather than reporting a clean tree',
    auditCrates({ crates: [], workspace, recorded: [], registry: new Map() })
      .failures.some((f) => /Cargo\.lock lists no crates/.test(f)));

  // The file is believed wherever there is no cargo cache, so a pattern in it is a way to vouch for
  // crates nobody read. It must not resolve a crate, and its mere presence must fail the gate.
  const wildcardFile = [{ match: '*', licence: 'MIT', source: 'trust me' }];
  check('a wildcard record resolves no crate, so the gate cannot be neutered by replacing the file',
    auditCrates({ crates: [cleanCrate], workspace, registry: new Map(), recorded: wildcardFile })
      .failures.some((f) => /^crate clean-crate@1\.0\.0: licence undetermined/.test(f)));
  check('a wildcard record fails the record audit outright, naming the pattern',
    auditCrateRecords('fixture', wildcardFile, [cleanCrate])
      .some((f) => /"\*" is a pattern/.test(f)));
  check('a narrower pattern is rejected too, since any pattern covers crates nobody read',
    auditCrateRecords('fixture', [{ match: 'clean-crate@1.*', licence: 'MIT', source: 'fixture' }], [cleanCrate])
      .some((f) => /is a pattern/.test(f)));
  check('a record set that matches the lockfile exactly passes',
    auditCrateRecords('fixture', [cleanRecord], [lockCrates[0], cleanCrate]).length === 0);
  check('one record too many fails, naming the crate nothing accounts for',
    auditCrateRecords('fixture', [cleanRecord, { match: 'ghost-crate@9.9.9', licence: 'MIT', source: 'fixture' }], [cleanCrate])
      .some((f) => /^fixture: ghost-crate@9\.9\.9 is recorded but is not a registry crate in Cargo\.lock/.test(f)));
  check('one record missing fails, naming the crate and the shape to add',
    auditCrateRecords('fixture', [cleanRecord], [cleanCrate, { name: 'gpl-crate', version: '2.0.0', source: cleanCrate.source }])
      .some((f) => /^fixture: gpl-crate@2\.0\.0 is in Cargo\.lock with no record/.test(f)));
  check('a duplicated record fails', auditCrateRecords('fixture', [cleanRecord, cleanRecord], [cleanCrate])
    .some((f) => /is recorded twice$/.test(f)));
  check('the workspace crate needs no record, since it is not a registry crate',
    auditCrateRecords('fixture', [cleanRecord], [lockCrates[0], cleanCrate]).length === 0);

  check('a licence elected over a copyleft branch passes but is reported, not swallowed',
    isElectedOverCopyleft('MIT OR Apache-2.0 OR LGPL-2.1-or-later')
    && !isElectedOverCopyleft('MIT OR Apache-2.0')
    && auditCrates({
      crates: [cleanCrate], workspace, registry: new Map(),
      recorded: [{ ...cleanRecord, licence: 'MIT OR LGPL-2.1-or-later' }],
    }).resolved.some((r) => r.key === 'clean-crate@1.0.0' && r.elected));
  check('the audit says where each licence came from, so a run that verified nothing cannot hide',
    auditCrates({
      crates: [lockCrates[0], cleanCrate, { name: 'gpl-crate', version: '2.0.0', source: cleanCrate.source }],
      workspace, registry: new Map([['gpl-crate@2.0.0', 'MIT']]), recorded: [cleanRecord],
    }).resolved.map((r) => r.where).sort().join(',') === 'cargo cache,recorded,workspace');

  check('an absent cargo registry cache resolves nothing rather than throwing',
    resolveRegistryCrateLicences(join(ROOT, 'scripts/allowlists/no-such-cargo-home'), cratesOnly).size === 0);

  check('a fully recorded crate licence passes the record audit',
    auditRecordedLicences('fixture', [{ match: 'a', licence: 'MIT', source: 'fixture' }]).length === 0);
  check('a recorded licence with no source fails, because a record with no source is a guess',
    auditRecordedLicences('fixture', [{ match: 'a', licence: 'MIT' }])
      .some((f) => /records no licence source$/.test(f)));
  check('an empty recorded-licence list fails',
    auditRecordedLicences('fixture', []).length === 1);

  // A tripwire, not a proof. It catches the accidental import; it cannot catch a deliberate one,
  // and a helper module doing `await import('node:' + 'htt' + 'ps')` would walk straight past it.
  // What makes the no-network property real is that nothing here needs the network to do its job.
  // Patterns are assembled from fragments so that the scan does not match itself.
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

  check('parseGateOptions sees --require-registry',
    parseGateOptions(['node', 'gate-licences.mjs', '--require-registry']).requireRegistry
    && parseGateOptions(['node', 'gate-licences.mjs']).unknown.length === 0);
  check('parseGateOptions rejects an unknown dashed option rather than ignoring it',
    parseGateOptions(['node', 'gate-licences.mjs', '--require-registy']).unknown.length === 1);

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  check('package.json still exposes the pre-build licence gate',
    pkg.scripts['gate:licences'] === 'node scripts/gate-licences.mjs');
  check('package.json exposes the post-build licence gate as a named script that requires the registry',
    typeof pkg.scripts['gate:licences:registry'] === 'string'
    && pkg.scripts['gate:licences:registry'].includes('--require-registry'));

  const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const workflowErrors = checkLicenceWorkflow(workflow);
  cases.push('ci.yml runs the licence gate twice, named, required, post-build requiring the registry');
  assert.ok(workflowErrors.length === 0,
    `self-check failed: ci.yml wiring — ${workflowErrors.join('; ')}`);
  const PRE = 'Licence gate (pre-build, empty cargo cache)';
  const POST = 'Licence gate (post-build, populated cargo cache)';
  for (const [what, mutated] of [
    ['continue-on-error on the post-build licence gate',
      workflow.replace(`      - name: ${POST}\n`, `      - name: ${POST}\n        continue-on-error: true\n`)],
    ['|| true on the post-build licence gate',
      workflow.replace(
        '        run: pnpm gate:licences -- --require-registry\n',
        '        run: pnpm gate:licences -- --require-registry || true\n',
      )],
    ['the post-build licence gate skipped on one runner',
      workflow.replace(
        `      - name: ${POST}\n        run:`,
        `      - name: ${POST}\n        if: runner.os == 'Linux'\n        run:`,
      )],
    ['the post-build licence gate dropped',
      workflow.replace(
        `\n      - name: ${POST}\n        run: pnpm gate:licences -- --require-registry`,
        '',
      )],
    ['--require-registry dropped from the post-build run',
      workflow.replace(
        '        run: pnpm gate:licences -- --require-registry\n',
        '        run: pnpm gate:licences\n',
      )],
    ['both licence-gate steps given the same name',
      workflow.replace(`      - name: ${POST}\n`, `      - name: ${PRE}\n`)],
    ['the post-build step moved before the desktop build',
      workflow
        .replace(`\n      - name: ${POST}\n        run: pnpm gate:licences -- --require-registry`, '')
        .replace(
          '      - name: Build the frontend\n',
          `      - name: ${POST}\n        run: pnpm gate:licences -- --require-registry\n      - name: Build the frontend\n`,
        )],
    ['macos-latest dropped from the matrix',
      workflow.replace('os: [macos-latest, ubuntu-latest]', 'os: [ubuntu-latest]')],
  ]) {
    check(`workflow: ${what} is rejected`, checkLicenceWorkflow(mutated).length > 0);
  }

  return cases.length;
}

function main() {
  const options = parseGateOptions(process.argv);
  if (options.unknown.length) {
    console.error(`licence gate: unknown option ${options.unknown.join(', ')}`);
    process.exit(1);
  }
  const cases = selfCheck();
  console.log(`licence gate self-check ok (${cases} cases, including a GPL npm dependency, a GPL, `
    + 'licence-less and unaudited crate, an allow-list neutered by a wildcard, and the '
    + 'pre-build / post-build split)');
  console.log(options.requireRegistry
    ? 'licence gate: post-build mode (every registry crate must be re-read from the cargo cache)'
    : 'licence gate: pre-build mode (allow-list fallback; empty cargo cache is ok)');

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
  let resolvedCrates = [];
  if (!existsSync(cargoLock)) {
    failures.push('apps/desktop/src-tauri/Cargo.lock is missing');
  } else {
    crates = parseCargoLockCrates(readFileSync(cargoLock, 'utf8'));
    const recordedCrates = JSON.parse(readFileSync(join(ALLOWLISTS, 'crate-licences.json'), 'utf8')).packages;
    failures.push(...auditRecordedLicences('crate licence records', recordedCrates));
    failures.push(...auditCrateRecords('crate licence records', recordedCrates, crates));
    const audit = auditCrates({
      crates,
      registry: resolveRegistryCrateLicences(
        process.env.CARGO_HOME ?? join(homedir(), '.cargo'), crates.filter((c) => c.source),
      ),
      recorded: recordedCrates,
      workspace: new Map([['marxy', licenceFromCargoManifest(
        readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8'),
      )]].filter(([, licence]) => licence)),
      requireRegistry: options.requireRegistry,
    });
    failures.push(...audit.failures);
    resolvedCrates = audit.resolved;
  }

  const grammars = JSON.parse(readFileSync(join(ALLOWLISTS, 'shiki-languages.json'), 'utf8'));
  const patterns = JSON.parse(readFileSync(join(ALLOWLISTS, 'hyphenation-patterns.json'), 'utf8'));
  failures.push(...auditAllowlist('grammar allow-list', grammars));
  failures.push(...auditAllowlist('hyphenation allow-list', patterns));

  if (failures.length) {
    // Capped the way gate-no-network caps: a neutered allow-list fails once per crate, and 400
    // identical lines bury the one at the top that says why.
    const shown = failures.slice(0, 20);
    console.error(`licence gate failed (${failures.length}):\n - ${shown.join('\n - ')}`
      + (failures.length > shown.length ? `\n - … and ${failures.length - shown.length} more` : ''));
    process.exit(1);
  }
  const from = (where) => resolvedCrates.filter((crate) => crate.where === where).length;
  const elected = resolvedCrates.filter((crate) => crate.elected);
  console.log(`licence gate ok (${packages.length} lockfile packages, ${crates.length} Cargo.lock `
    + `crates, ${grammars.languages.length} grammars, `
    + `${patterns.languages.length} hyphenation patterns)`);
  // How each crate licence was resolved, because a run that re-read nothing must not be able to
  // look like a run that re-read everything. The pre-build CI run reports 0 re-read and believes
  // the records; the post-build run must re-read them (MARXY-65).
  console.log(`crate licences: ${from('cargo cache')} re-read from the local cargo cache, `
    + `${from('recorded')} taken as recorded in scripts/allowlists/crate-licences.json and `
    + `re-read by nothing on this run, ${from('workspace')} from the workspace manifest`);
  if (elected.length) {
    console.log(`crate licences accepted by electing a permissive branch of a disjunction that `
      + `also offers copyleft (${elected.length}): `
      + elected.map(({ key, licence }) => `${key} (${licence})`).join(', '));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
