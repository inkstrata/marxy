// An optional taste-review entry is its own file, one queue table row per story, so pull requests
// stop conflicting on docs/taste-review/queue.md (MARXY-324). The entry is voluntary: nothing
// requires one. `docs/taste-review/queue.d/README.md` states the rule for a human; this module is
// the one place that knows the format, so a script and a prompt cannot drift on it.
export const QUEUE_DIR = 'docs/taste-review/queue.d';
export const QUEUE_FILE = 'docs/taste-review/queue.md';

/** The columns of the queue table, in order — the same header queue.md carries. */
export const QUEUE_COLUMNS = ['Date', 'PR / story', 'What the reader would notice', 'Artifacts', 'Question for the reviewer', 'Decision'];

/** The fragment path a story's own optional entry lives at. */
export function queueFragmentPath(key) {
  return `${QUEUE_DIR}/${key}.md`;
}

const FRAGMENT_RE = new RegExp(`^${QUEUE_DIR}/([^/]+)\\.md$`);

/** Whether a changed path is a queue fragment for any story. `README.md` is not one. */
export function isQueueFragmentPath(file) {
  const m = String(file ?? '').match(FRAGMENT_RE);
  return !!m && m[1] !== 'README';
}

/** The key a fragment names, from its path, or null. */
export function queueFragmentKey(file) {
  return isQueueFragmentPath(file) ? String(file).match(FRAGMENT_RE)[1] : null;
}

/** Split a table row into its trimmed cells (`\|` does not split). */
export function rowCells(line) {
  return String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());
}

/** A fragment is exactly one table row with the queue's columns, whose story cell is `key`. */
export function validQueueFragment(text, key) {
  if (!key) return false;
  const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length !== 1) return false;
  const [line] = lines;
  if (!line.startsWith('|') || !line.endsWith('|')) return false;
  const cells = rowCells(line);
  return cells.length === QUEUE_COLUMNS.length && cells[1] === key && !cells.every(c => /^:?-+:?$/.test(c));
}

/** Fragment file names in `files` (a directory listing), README excluded, sorted by key number. */
export function sortFragmentNames(names) {
  const num = n => Number(n.match(/\d+/)?.[0] ?? 0);
  return names.filter(n => n !== 'README.md' && n.endsWith('.md')).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}

/**
 * queue.md with every row appended after the last row of its first table, leaving every other byte
 * untouched. Throws if there is no table.
 */
export function foldRows(queue, rows) {
  const text = String(queue ?? '');
  if (!rows.length) return text;
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.startsWith('| Date |'));
  if (start < 0) throw new Error(`${QUEUE_FILE} has no queue table (a "| Date |" header)`);
  let end = start + 1;
  while (end + 1 < lines.length && lines[end + 1].startsWith('|')) end++;
  lines.splice(end + 1, 0, ...rows);
  return lines.join('\n');
}
