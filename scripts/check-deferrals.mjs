// Deferral markers in product source must name a board key that has not landed yet (MARXY-197).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, walk, rel, fail, fix, sh } from './lib/repo.mjs';

export const ALLOWLIST = join(ROOT, 'scripts/allowlists/deferrals.json');

/** Case-insensitive deferral phrases from docs/plan/tasks/MARXY-197.md. */
export const MARKER_RE =
  /placeholder until|until MARXY-\d+|a later story|later story (?:adds|registers|wires)|lights up when|not yet (?:wired|registered|called)/i;

const KEY_RE = /MARXY-\d+/gi;
const SOURCE_RE = /\.(m?[jt]sx?|cjs|rs)$/;

export function isProductSource(file) {
  const p = file.replace(/\\/g, '/');
  if (!/^(apps|packages)\//.test(p)) return false;
  if (/\.test\.(m?[jt]sx?|cjs)$/.test(p)) return false;
  if (/(^|\/)testing\//.test(p)) return false;
  if (/(^|\/)(fixtures|goldens)(\/|$)/.test(p)) return false;
  return SOURCE_RE.test(p);
}

/**
 * Every deferral marker in the given files. Keys are normalised to `MARXY-nnn`.
 */
export function findDeferrals(files) {
  const out = [];
  for (const { file, content } of files) {
    const lines = String(content).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!MARKER_RE.test(lines[i])) continue;
      const keys = [...new Set([...lines[i].matchAll(KEY_RE)].map(m => m[0].toUpperCase()))];
      out.push({ file, line: i + 1, text: lines[i].trim(), keys });
    }
  }
  return out;
}

/** Board keys whose squash commit subject is already an ancestor of HEAD. */
export function landedKeys(git = defaultGit()) {
  const landed = new Set();
  for (const subject of git.logSubjects()) {
    for (const m of subject.matchAll(/\((MARXY-\d+)\)/g)) landed.add(m[1]);
  }
  return landed;
}

function defaultGit() {
  return {
    logSubjects() {
      return sh('git log --format=%s HEAD', { soft: true }).split('\n').filter(Boolean);
    },
  };
}

function normaliseAllowlist(raw) {
  if (!Array.isArray(raw)) throw new Error('deferrals.json must be an array');
  return raw.map((row, i) => {
    if (!row?.file || !row?.marker || !row?.removedBy) {
      throw new Error(`deferrals.json[${i}] needs file, marker, removedBy`);
    }
    return { file: row.file.replace(/\\/g, '/'), marker: row.marker, removedBy: row.removedBy };
  });
}

/** True when an allow-list row covers this hit (same file and marker substring on that line). */
export function isAllowlisted(hit, allowlist) {
  return allowlist.some(
    e => e.file === hit.file && hit.text.includes(e.marker) && e.marker.length > 0,
  );
}

/**
 * Violation lines for stale allow-list rows and deferrals that name no key or a landed key.
 */
export function checkDeferrals({ deferrals, allowlist, landed, readContent }) {
  const problems = [];
  for (const entry of allowlist) {
    const text = readContent(entry.file);
    if (text === undefined) {
      problems.push(
        `${entry.file}: allow-list entry missing file${fix('remove the row or restore the file')}`,
      );
      continue;
    }
    if (!text.includes(entry.marker)) {
      problems.push(
        `${entry.file}: stale allow-list (marker gone)${fix('remove the row from scripts/allowlists/deferrals.json')}`,
      );
    }
  }
  for (const hit of deferrals) {
    if (isAllowlisted(hit, allowlist)) continue;
    if (hit.keys.length === 0) {
      problems.push(
        `${hit.file}:${hit.line}: deferral names no board key${fix('name the story that removes this, or remove it')}`,
      );
      continue;
    }
    const landedNamed = hit.keys.filter(k => landed.has(k));
    if (landedNamed.length > 0) {
      problems.push(
        `${hit.file}:${hit.line}: deferral names landed ${landedNamed.join(', ')}${fix('name the story that removes this, or remove it')}`,
      );
    }
  }
  return problems;
}

function productFiles(root = ROOT) {
  return walk(join(root, 'apps'), p => isProductSource(rel(p)))
    .concat(walk(join(root, 'packages'), p => isProductSource(rel(p))))
    .map(p => rel(p));
}

export function runCheck(root = ROOT, git = defaultGit()) {
  const allowlist = normaliseAllowlist(
    JSON.parse(readFileSync(join(root, 'scripts/allowlists/deferrals.json'), 'utf8')),
  );
  const readContent = file => {
    const path = join(root, file);
    if (!existsSync(path)) return undefined;
    return readFileSync(path, 'utf8');
  };
  const files = productFiles(root).map(file => ({ file, content: readContent(file) }));
  const deferrals = findDeferrals(files);
  const landed = landedKeys(git);
  const problems = checkDeferrals({ deferrals, allowlist, landed, readContent });
  return { problems, deferrals, landed, allowlist };
}

const invoked =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], `file://${process.cwd()}/`));
if (invoked) {
  const { problems, deferrals, allowlist } = runCheck();
  if (fail(problems)) process.exit(1);
  console.log(`deferrals ok (${deferrals.length} marker(s), ${allowlist.length} allow-listed)`);
}
