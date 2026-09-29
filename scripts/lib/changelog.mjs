// One changelog fragment per story instead of one shared CHANGELOG.md section, so pull
// requests stop conflicting on the same line (MARXY-315). `changelog.d/README.md` states the
// rule for a human; this module is the one place that reads or checks it, so a gate, a script
// and a prompt cannot drift on what counts as an entry.
export const FRAGMENT_DIR = 'changelog.d';

/** The fragment path a story's own entry lives at. */
export function fragmentPath(key) {
  return `${FRAGMENT_DIR}/${key}.md`;
}

const FRAGMENT_RE = new RegExp(`^${FRAGMENT_DIR}/([^/]+)\\.md$`);

/** Whether a changed path is a changelog fragment, for any story. */
export function isFragmentPath(file) {
  return FRAGMENT_RE.test(String(file ?? ''));
}

/** The key a fragment file names, from its path (`changelog.d/MARXY-1.md` → `MARXY-1`), or null. */
export function fragmentKey(file) {
  return String(file ?? '').match(FRAGMENT_RE)?.[1] ?? null;
}

/** A fragment is one reader-facing line that ends in `(KEY)`. `README.md` is not a fragment. */
export function validFragment(text, key) {
  if (!key) return false;
  const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length === 1 && lines[0].endsWith(`(${key})`);
}

/** The `## Unreleased` section of a CHANGELOG.md body, or '' if there is none. */
function unreleasedSection(text) {
  const body = String(text ?? '');
  const start = body.indexOf('## Unreleased');
  if (start < 0) return '';
  const rest = body.slice(start);
  const next = rest.indexOf('\n## ', 1);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Whether the `## Unreleased` section carries a line for this key. */
export function changelogHasUnreleasedLine(text, key) {
  if (!key) return false;
  return new RegExp(`\\(${key}\\)\\s*$`, 'm').test(unreleasedSection(text));
}

/**
 * Whether a story's changelog entry is present in a changed-file list.
 *
 * `files` is the branch's changed-file list. Without `readFile`, presence in that list is enough
 * — the same fidelity the old `files.includes('CHANGELOG.md')` check had, and what a caller with
 * only a GitHub file list (readiness.mjs, merge-bar.mjs from the cycle) can offer.
 *
 * With `readFile(path) => string | null | undefined`, the content is checked too: a fragment
 * must be a single line ending in `(key)`, and a CHANGELOG.md line must sit inside `##
 * Unreleased` and name `key`. `readFile` returning `null`/`undefined` (path not found, or the
 * caller could not read it — a fake rev in a test, for instance) falls back to presence-only for
 * that path, so a caller that cannot fetch content never over-reports a hold.
 *
 * Without `key`, the check cannot look for one particular fragment, so it accepts either
 * CHANGELOG.md or any fragment at all — the loosest read, used only where the caller truly has no
 * key to check against.
 */
export function hasEntry(files = [], key, readFile) {
  const list = files ?? [];
  if (list.includes('CHANGELOG.md')) {
    if (key && typeof readFile === 'function') {
      const content = readFile('CHANGELOG.md');
      if (content != null) return changelogHasUnreleasedLine(content, key);
    }
    return true;
  }
  if (key) {
    const frag = fragmentPath(key);
    if (list.includes(frag)) {
      if (typeof readFile === 'function') {
        const content = readFile(frag);
        if (content != null) return validFragment(content, key);
      }
      return true;
    }
    return false;
  }
  return list.some(isFragmentPath);
}
