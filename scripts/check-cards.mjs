// CSV rows, task cards and orchestration/deps.json must agree (MARXY-126).
// usage: node scripts/check-cards.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, pathsOf, allowedByPaths, fail, fix } from './lib/repo.mjs';

function parseCsv(t) {
  const rows = [];
  let row = [],
    cell = '',
    q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [h, ...rest] = rows;
  return rest.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

/** First backticked path token on each bullet under ## Files and signatures. */
export function filePathsFromCard(body) {
  const m = body.match(/^## Files and signatures\r?\n([\s\S]*?)(?=^## |\Z)/m);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split('\n')) {
    if (!line.startsWith('-')) continue;
    const tok = /^-\s+`([^`]+)`/.exec(line)?.[1];
    if (!tok || (!tok.includes('/') && !tok.includes('.'))) continue;
    out.push(tok.trim());
  }
  return out;
}

export function parseCardMarkdown(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const key = /^key:\s*(MARXY-\S+)/m.exec(fm[1])?.[1]?.trim();
  if (!key) return null;
  const depLine = /^depends:\s*\[([^\]]*)\]/m.exec(fm[1]);
  const depends = depLine ? [...depLine[1].matchAll(/MARXY-\d+/g)].map(x => x[0]) : [];
  const body = text.slice(fm[0].length);
  return { key, depends, files: filePathsFromCard(body) };
}

export function depsKeys(deps) {
  const keys = new Set();
  for (const list of Object.values(deps.phases ?? {})) for (const k of list) keys.add(k);
  for (const k of Object.keys(deps.deps ?? {})) keys.add(k);
  return keys;
}

/**
 * @param {{ cards: Record<string, { depends: string[], files: string[] }>, rows: Record<string, { Paths?: string }>, deps: object }} input
 * @returns {string[]} problem lines for fail()
 */
export function cardsAndRows({ cards, rows, deps }) {
  const problems = [];
  const rowKeys = new Set(Object.keys(rows));

  for (const [key, card] of Object.entries(cards)) {
    if (!rowKeys.has(key)) {
      problems.push(
        `${key}: task card docs/plan/tasks/${key}.md has no row in docs/plan/jira-issues.csv${fix(`add a CSV row for ${key} or remove the card`)}`,
      );
      continue;
    }
    const paths = pathsOf(rows[key]);
    for (const file of card.files) {
      if (!allowedByPaths(file, paths)) {
        problems.push(
          `${key}: ${file} from the task card is not covered by the row Paths${fix(`widen ${key}'s Paths in jira-issues.csv to include ${file}, or fix the card if the path moved`)}`,
        );
      }
    }
    const fromDeps = [...(deps.deps?.[key] ?? [])].sort();
    const fromCard = [...card.depends].sort();
    if (fromDeps.join('\0') !== fromCard.join('\0')) {
      problems.push(
        `${key}: card depends [${fromCard.join(', ')}] ≠ deps.json [${fromDeps.join(', ')}]${fix(`make docs/plan/tasks/${key}.md frontmatter and orchestration/deps.json agree`)}`,
      );
    }
  }

  for (const key of depsKeys(deps)) {
    if (!rowKeys.has(key)) {
      problems.push(
        `${key}: orchestration/deps.json lists ${key} but docs/plan/jira-issues.csv has no row${fix(`add a CSV row for ${key} or remove it from deps.json`)}`,
      );
    }
  }

  return problems;
}

export function loadBoardInput(root = ROOT) {
  const cards = {};
  const tasksDir = join(root, 'docs/plan/tasks');
  if (existsSync(tasksDir)) {
    for (const name of readdirSync(tasksDir)) {
      if (!/^MARXY-.*\.md$/.test(name)) continue;
      const parsed = parseCardMarkdown(readFileSync(join(tasksDir, name), 'utf8'));
      if (parsed) cards[parsed.key] = { depends: parsed.depends, files: parsed.files };
    }
  }
  const csvRows = parseCsv(readFileSync(join(root, 'docs/plan/jira-issues.csv'), 'utf8'));
  const rows = Object.fromEntries(csvRows.map(r => [r.Key, r]));
  const deps = JSON.parse(readFileSync(join(root, 'orchestration/deps.json'), 'utf8'));
  return { cards, rows, deps };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const input = loadBoardInput();
  const problems = cardsAndRows(input);
  if (fail(problems)) process.exit(1);
  console.log(`check-cards ok (${Object.keys(input.cards).length} cards)`);
}
