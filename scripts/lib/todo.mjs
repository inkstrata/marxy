// The tracker file: Markdown tables under `##` headings, one row per piece of open work. A row is any table row whose
// first cell is an id (letters, then digits). The tools read three columns by their heading: `#` (the id, always first),
// `What`, and `Branch` (or `Round`), where a name in backticks is the branch taking the row, without its prefix.
// Every other column is the writer's own.

const ID = /^[A-Z]{1,3}\d{1,4}$/;
const BRANCH_COLUMNS = ['branch', 'round'];

/** The cells of one table line. A `\|` is a literal bar, as Markdown has it. */
export function splitRow(line) {
  const cells = [];
  let cur = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (body[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Rows of a tracker: { id, section, line, what, branches, cells }. `cells` is keyed by lower-cased column heading. */
export function parseTodo(text) {
  const rows = [];
  let section = '';
  let header = null;
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    const heading = line.match(/^#{2,}\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      header = null;
      continue;
    }
    if (!line.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = splitRow(line);
    if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue;
    if (!header) {
      header = cells.map(c => c.toLowerCase());
      continue;
    }
    if (!ID.test(cells[0])) continue;
    const byName = Object.fromEntries(header.map((h, n) => [h, cells[n] ?? '']));
    const column = BRANCH_COLUMNS.find(c => c in byName);
    const branches = column ? [...byName[column].matchAll(/`([a-z0-9][a-z0-9-]*)`/g)].map(m => m[1]) : [];
    rows.push({ id: cells[0], section, line: i + 1, what: byName.what ?? cells[1] ?? '', branches, cells: byName });
  }
  return rows;
}

/**
 * What the tracker and the branches say of each other. `stateOf(name)` gives a branch's state against the base
 * ('open', 'merged', 'at-base') or null when there is no such branch.
 * Returns { duplicates, landed, inFlight, waiting }: ids used twice, rows whose every branch is in the base (the row is
 * done and should go), rows with a branch still being worked on, and rows no existing branch has taken.
 */
export function crossCheck(rows, stateOf) {
  const seen = new Map();
  const duplicates = [];
  for (const r of rows) {
    if (seen.has(r.id)) duplicates.push({ id: r.id, lines: [seen.get(r.id), r.line] });
    else seen.set(r.id, r.line);
  }
  const landed = [];
  const inFlight = [];
  const waiting = [];
  for (const r of rows) {
    const states = r.branches.map(b => stateOf(b));
    if (states.length && states.every(s => s === 'merged')) landed.push(r);
    else if (states.some(s => s === 'open' || s === 'at-base')) inFlight.push(r);
    else waiting.push(r);
  }
  return { duplicates, landed, inFlight, waiting };
}

/** A new tracker, as `pnpm work init` writes it. */
export const TEMPLATE = `# Marxy todo

Open work. A row leaves this file when its branch is in main or the work is dropped; \`pnpm work todo --check\` names
the rows whose branch has landed. Ids are for this file only: they never go in code, comments, tests or commits.

## Next

| # | What | Why | Size | Branch |
| --- | --- | --- | --- | --- |

## To try in a real window

| # | What | Branch |
| --- | --- | --- |

## Later

| # | What | Why | Size |
| --- | --- | --- | --- |
`;
