// Task cards and CSV rows must agree: every card has a row, paths cover card files, deps.json keys
// have rows, and card depends matches deps.json. usage: node scripts/check-cards.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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

/** Paths named in a card's ## Files and signatures section (first backtick per bullet). */
export function filesFromCard(text) {
  const m = /## Files and signatures\r?\n([\s\S]*?)(?:\r?\n## |\r?\n---\r?\n|$)/.exec(text);
  if (!m) return [];
  const files = [];
  for (const line of m[1].split('\n')) {
    const bullet = /^\s*[-*]\s+`([^`]+)`/.exec(line);
    if (!bullet) continue;
    const token = bullet[1];
    if (!token.includes('/') && !token.includes('.')) continue;
    files.push(token);
  }
  return files;
}

export function parseCard(text, keyFromName) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  let key = keyFromName;
  let depends = [];
  if (fm) {
    const keyMatch = /^key:\s*(.+)$/m.exec(fm[1]);
    if (keyMatch) key = keyMatch[1].trim();
    const depMatch = /^depends:\s*\[(.*)\]/m.exec(fm[1]);
    if (depMatch) depends = depMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  }
  return { key, depends, files: filesFromCard(text) };
}

export function loadCards(cardsDir) {
  const cards = {};
  if (!existsSync(cardsDir)) return cards;
  for (const name of readdirSync(cardsDir)) {
    if (!/^MARXY-/.test(name) || !name.endsWith('.md')) continue;
    const keyFromName = name.replace(/\.md$/, '');
    const text = readFileSync(join(cardsDir, name), 'utf8');
    const card = parseCard(text, keyFromName);
    cards[card.key] = { ...card, path: `docs/plan/tasks/${name}` };
  }
  return cards;
}

export function depsKeys(deps) {
  const keys = new Set();
  for (const list of Object.values(deps.phases || {})) for (const k of list) keys.add(k);
  for (const k of Object.keys(deps.deps || {})) keys.add(k);
  return keys;
}

export function cardsAndRows({ cards, rows, deps }) {
  const problems = [];
  const rowByKey = Object.fromEntries(rows.map(r => [r.Key, r]));
  const depMap = deps.deps || {};

  for (const [key, card] of Object.entries(cards)) {
    if (!rowByKey[key]) {
      problems.push(
        `${key}: task card ${card.path} has no row in docs/plan/jira-issues.csv${fix('add a CSV row for the key, or remove the card if the story was dropped')}`,
      );
    }
  }

  for (const [key, card] of Object.entries(cards)) {
    const row = rowByKey[key];
    if (!row) continue;
    const paths = pathsOf(row);
    for (const file of card.files) {
      if (!allowedByPaths(file, paths)) {
        problems.push(
          `${key}: ${file} is named in the task card but not covered by the row's Paths (${paths.join(', ') || 'none'})${fix('widen the CSV Paths to cover every file the card names, or correct the card if the file moved')}`,
        );
      }
    }
  }

  for (const key of depsKeys(deps)) {
    if (!rowByKey[key]) {
      problems.push(
        `${key}: listed in orchestration/deps.json but has no row in docs/plan/jira-issues.csv${fix('add a CSV row for the key')}`,
      );
    }
  }

  for (const [key, card] of Object.entries(cards)) {
    const fromDeps = depMap[key] ?? [];
    const a = [...card.depends].sort().join(',');
    const b = [...fromDeps].sort().join(',');
    if (a !== b) {
      problems.push(
        `${key}: card depends [${card.depends.join(', ')}] but deps.json has [${fromDeps.join(', ')}]${fix('make the card frontmatter depends: and orchestration/deps.json agree')}`,
      );
    }
  }

  return problems;
}

export function loadBoard() {
  const rows = parseCsv(readFileSync(join(ROOT, 'docs/plan/jira-issues.csv'), 'utf8'));
  const deps = JSON.parse(readFileSync(join(ROOT, 'orchestration/deps.json'), 'utf8'));
  const cards = loadCards(join(ROOT, 'docs/plan/tasks'));
  return { cards, rows, deps };
}

const board = loadBoard();
if (fail(cardsAndRows(board))) process.exit(1);
console.log(`cards ok (${Object.keys(board.cards).length} task cards)`);
