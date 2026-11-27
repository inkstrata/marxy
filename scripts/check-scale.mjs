// Code shapes that make work grow faster than the file, or fail on a big one, counted per file of the app and the
// packages; the count may not grow. A file of 1 to 5 MB is ordinary for Marxy (docs/big-files.md), and these shapes are
// how a feature that is instant on a 30 KB fixture freezes the window on it:
//
//   spread-call       an array spread into a call's arguments (`push(...xs)`, `append(...nodes)`, `Math.max(...xs)`,
//                     `String.fromCharCode(...codes)`): every element is a stack slot, so a big array throws
//                     "Maximum call stack size exceeded"
//   layout-in-loop    a layout read (`getBoundingClientRect`, `offsetHeight`, `getComputedStyle`, …) inside a loop or
//                     an iteration callback: one forced layout per item, over a page of thousands of blocks
//   query-in-loop     a DOM query (`querySelectorAll`, `querySelector`, `closest`, `getElementsBy…`) inside a loop: a
//                     walk of the page per item
//   queue-in-loop     `shift()`, `unshift()`, `concat()` or a sort inside a loop: each call copies or reorders the
//                     whole array, so the loop is quadratic
//   line-split        a text split into all its lines (`split('\n')`, `split(/\r?\n/)`): an array of every line of
//                     whatever text it is given, which is a whole document more often than it looks
//   dynamic-regexp    `new RegExp(<not a literal>)`: a pattern built at run time, often from what the reader typed,
//                     run by a backtracking engine on the main thread; a worker (`*.worker.ts`) is exempt, since
//                     the page can stop it
//
// A hit is allowed when a comment on its line or the line above says why it is bounded, starting `scale:`
// (`// scale: a heading's text, at most one line`). Hits without one are counted per file and rule against
// `scripts/allowlists/scale.json`, a ratchet: a count may fall (`--write` records it), never rise, and a file with no
// record has none. So a new feature either avoids the shape or says, in the code, why its input is small.
//
// usage: node scripts/check-scale.mjs [--write] [--list] [files...]
//        node scripts/check-scale.mjs --hook        (a Claude Code PostToolUse hook: reads the hook's JSON on stdin)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { ROOT, fail, fix, rel, walk } from './lib/repo.mjs';

const BASELINE = join(ROOT, 'scripts/allowlists/scale.json');
const ROOTS = ['apps/desktop/src', 'packages/core/src', 'packages/typeset/src', 'packages/theme/src'];
const DOC = 'docs/big-files.md';

export const RULES = {
  'spread-call': 'an array spread into call arguments overflows the stack on a big array; loop, or push in chunks',
  'layout-in-loop': 'a layout read per item forces a layout per item; read geometry once (or from a ResizeObserver entry) outside the loop',
  'query-in-loop': 'a DOM query per item walks the page per item; query once outside the loop, or keep a map',
  'queue-in-loop': 'shift, unshift, concat or sort per item copies the array per item; keep an index, push, or sort once',
  'line-split': 'splitting a whole text into lines allocates every line; walk the text, or use the line index (reading/lines.ts)',
  'dynamic-regexp': 'a run-time pattern can backtrack for minutes on a big input; escape it, bound the input, or run it where it can be stopped',
};

const SPREAD_SINKS = new Set(['push', 'unshift', 'append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith', 'splice']);
const ITERATION = new Set(['forEach', 'map', 'flatMap', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex']);
const LAYOUT_CALLS = new Set(['getBoundingClientRect', 'getClientRects', 'getComputedStyle', 'getBBox', 'scrollIntoView', 'checkVisibility']);
const LAYOUT_PROPS = new Set(['offsetTop', 'offsetLeft', 'offsetWidth', 'offsetHeight', 'offsetParent', 'clientTop', 'clientLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'innerText']);
// `closest` is left out: it walks an element's ancestors, not the page.
const QUERY_CALLS = new Set(['querySelectorAll', 'querySelector', 'getElementsByClassName', 'getElementsByTagName', 'getElementsByName']);
const QUEUE_CALLS = new Set(['shift', 'unshift', 'concat', 'sort', 'toSorted']);

const kindFor = (f) => (/\.tsx$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const nameOf = (expr) => (ts.isPropertyAccessExpression(expr) ? expr.name.text : ts.isIdentifier(expr) ? expr.text : null);
const receiverName = (expr) => (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) ? expr.expression.text : null);
const isLoop = (n) => ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n);
const isLineSeparator = (arg) => {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text === '\n' || arg.text === '\r\n';
  if (ts.isRegularExpressionLiteral(arg)) return /^\/(?:\\r\?|\(\?:\\r\?\)|\\r\\n\|\\n|\(\?:\\r\\n\|\\n\)|\(\?:\\r\\n\|\\r\|\\n\)|\\r\\n\|\\r\|\\n|\[\\r\\n\]\+?)?\\n\/[a-z]*$/.test(arg.text);
  return false;
};

/**
 * A pattern fixed when the code is written: a literal, another pattern's `.source`, or a template whose parts are
 * all constants named in capitals (`\\S{${RUN_CHARS + 1},}`).
 */
function fixedPattern(a) {
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isRegularExpressionLiteral(a)) return true;
  if (ts.isPropertyAccessExpression(a) && a.name.text === 'source') return true;
  if (ts.isTemplateExpression(a)) return a.templateSpans.every((s) => constantExpr(s.expression));
  return false;
}
const constantExpr = (e) => ts.isNumericLiteral(e) || ts.isStringLiteral(e) || (ts.isIdentifier(e) && /^[A-Z][A-Z0-9_]*$/.test(e.text))
  || (ts.isPropertyAccessExpression(e) && e.name.text === 'source') || (ts.isBinaryExpression(e) && constantExpr(e.left) && constantExpr(e.right))
  || (ts.isParenthesizedExpression(e) && constantExpr(e.expression));

/** True when `node` sits in the body of a loop, or of a callback passed to an iteration method, within its own function. */
function inLoop(node) {
  for (let child = node, p = node.parent; p; child = p, p = p.parent) {
    if (isLoop(p) && child === p.statement) return true;
    if (ts.isFunctionLike(p)) {
      const call = p.parent;
      if (call && ts.isCallExpression(call) && call.arguments.includes(p) && ITERATION.has(nameOf(call.expression) ?? '')) return true;
      return false;
    }
  }
  return false;
}

/** Every hit in one file's text, as { rule, line } (1-based), with `bounded` true when a `scale:` comment covers it. */
export function hitsIn(text, fileName = 'file.ts') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kindFor(fileName));
  const lines = text.split('\n'); // scale: one source file of this repository
  const bounded = (line) => {
    if (/\bscale:/.test(lines[line - 1] ?? '')) return true;
    for (let i = line - 2; i >= 0 && i >= line - 4; i--) {
      const l = (lines[i] ?? '').trim();
      if (!l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*')) break;
      if (/\bscale:/.test(l)) return true;
    }
    return false;
  };
  // A pattern in a worker cannot freeze the page, and the page can terminate it: that is the remedy, not the risk.
  const inWorker = /\.worker\.[cm]?[jt]s$/.test(fileName);
  const out = [];
  const add = (rule, node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    // In a chain over several lines the comment may sit on the call's own line (`.push(...rows) // scale: ...`).
    const callee = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression.name : null;
    const at = callee ? sf.getLineAndCharacterOfPosition(callee.getStart(sf)).line + 1 : line;
    out.push({ rule, line: at, bounded: bounded(line) || bounded(at) });
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = nameOf(node.expression);
      const recv = receiverName(node.expression);
      const spread = node.arguments.some((a) => ts.isSpreadElement(a) && !ts.isArrayLiteralExpression(a.expression));
      if (spread && name && ((SPREAD_SINKS.has(name) && ts.isPropertyAccessExpression(node.expression)) || ((name === 'max' || name === 'min') && recv === 'Math') || ((name === 'fromCharCode' || name === 'fromCodePoint') && recv === 'String'))) add('spread-call', node);
      if (name && LAYOUT_CALLS.has(name) && inLoop(node)) add('layout-in-loop', node);
      if (name && QUERY_CALLS.has(name) && ts.isPropertyAccessExpression(node.expression) && inLoop(node)) add('query-in-loop', node);
      if (name && QUEUE_CALLS.has(name) && ts.isPropertyAccessExpression(node.expression) && inLoop(node)) add('queue-in-loop', node);
      // A limit (`split('\n', 40)`) bounds what it makes.
      if (name === 'split' && ts.isPropertyAccessExpression(node.expression) && node.arguments.length === 1 && isLineSeparator(node.arguments[0])) add('line-split', node);
    } else if (ts.isPropertyAccessExpression(node) && LAYOUT_PROPS.has(node.name.text)) {
      const p = node.parent;
      const written = p && ts.isBinaryExpression(p) && p.left === node && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
      if (!written && !ts.isCallExpression(p) && inLoop(node)) add('layout-in-loop', node);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp') {
      const a = node.arguments?.[0];
      if (a && !inWorker && !fixedPattern(a)) add('dynamic-regexp', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Unbounded hits per file and rule: { path: { rule: n } }, sorted. */
export function countHits(files) {
  const counts = {};
  for (const { path, text } of files) {
    for (const h of hitsIn(text, path)) {
      if (h.bounded) continue;
      counts[path] ??= {};
      counts[path][h.rule] = (counts[path][h.rule] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.keys(counts).sort().map((p) => [p, Object.fromEntries(Object.entries(counts[p]).sort())]));
}

/** Files and rules over their record, as { path, rule, count, recorded }. A file or rule with no record has a count of 0. */
export function grown(counts, baseline) {
  const out = [];
  for (const [path, rules] of Object.entries(counts)) {
    for (const [rule, n] of Object.entries(rules)) {
      const recorded = baseline[path]?.[rule] ?? 0;
      if (n > recorded) out.push({ path, rule, count: n, recorded });
    }
  }
  return out;
}

const inScope = (path) => ROOTS.some((r) => path.startsWith(`${r}/`)) && /\.tsx?$/.test(path) && !/\.test\.|\.d\.ts$|\/testing\//.test(path);
const sourceFiles = () => ROOTS.flatMap((r) => walk(join(ROOT, r), (p) => inScope(rel(p))));
const readBaseline = () => (existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).files : {});
const toRel = (p) => (isAbsolute(p) ? relative(ROOT, p) : p).split('\\').join('/');

/** The lines a reader of one over-grown file and rule needs: where the unbounded hits are, and what to do. */
function explain(g, text) {
  const at = hitsIn(text, g.path).filter((h) => h.rule === g.rule && !h.bounded).map((h) => h.line);
  return `${g.path}: ${g.rule} ${g.count} (recorded ${g.recorded}) at line ${at.join(', ')}: ${RULES[g.rule]}`;
}

/** The short form of the rules for big files, for an agent that has just started editing the app. */
export const DIGEST = `Marxy's rules for big files (${DOC}; files of 1 to 5 MB are ordinary):
1. Work for a key, a scroll, a hover or a panel is bounded by what is on screen or by the change, never by the file.
2. Whole-file work (parse, index, search, colour, export) yields to input, can be cancelled, and runs once per version of the bytes, not once per feature: reuse the store's parse, line index and readings.
3. No array spread into call arguments, no DOM query or layout read per item, no shift/concat/sort in a loop, no split of a whole text into lines (check-scale).
4. Patterns typed by the reader never run unbounded on the main thread; caps on matches and results say what they leave out.
5. Every cap and fallback says so to the reader (as the size limits in docs/file-kinds.md do); none fails the page.
6. A feature that takes a whole document gets a growth case in packages/core/src/scale.test.ts or a doubling probe with the big-file generator (scripts/lib/big-files.mjs), at 1 MB and 4 MB.
A hit that is bounded is allowed with a comment on its line or the line above: // scale: <why the input is small>.`;

/**
 * The checkout a file belongs to: the nearest folder above it holding this script. A session started in the main
 * checkout often edits files in a worktree beside it, which has its own record.
 */
function checkoutOf(file) {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) if (existsSync(join(dir, 'scripts/check-scale.mjs'))) return dir;
  return ROOT;
}

function hook() {
  try {
    hookOnce();
  } catch {
    // A hook that cannot read its record or the file says nothing rather than failing the edit.
  }
}

function hookOnce() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return; }
  const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
  if (!file || !existsSync(file)) return;
  const root = checkoutOf(resolve(file));
  const path = relative(root, resolve(file)).split('\\').join('/');
  if (!inScope(path)) return;
  const text = readFileSync(file, 'utf8');
  const record = join(root, 'scripts/allowlists/scale.json');
  const baseline = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')).files : readBaseline();
  const over = grown(countHits([{ path, text }]), baseline);
  const marker = join(tmpdir(), `marxy-scale-digest-${String(input.session_id ?? 'none').replace(/[^\w-]/g, '')}`);
  const first = !existsSync(marker);
  if (!over.length && !first) return;
  const parts = [];
  if (over.length) parts.push(`check-scale: this edit adds a shape that grows with the file or fails on a big one:\n${over.map((g) => `- ${explain(g, text)}`).join('\n')}\nAvoid it, or if the input is bounded say why on that line: // scale: <why>. \`node scripts/check-scale.mjs\` fails in \`pnpm check\` until then.`);
  if (first) {
    parts.push(DIGEST);
    try { writeFileSync(marker, ''); } catch { /* the digest is shown again next time, which is harmless */ }
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: parts.join('\n\n') } }));
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes('--hook')) {
    hook();
    process.exit(0);
  }
  const named = argv.filter((a) => !a.startsWith('--')).map(toRel);
  const paths = named.length ? named.filter(inScope) : sourceFiles().map(rel);
  const files = paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));
  if (argv.includes('--list')) {
    for (const { path, text } of files) for (const h of hitsIn(text, path)) if (!h.bounded) console.log(`${path}:${h.line} ${h.rule}`);
    process.exit(0);
  }
  const counts = countHits(files);
  const total = Object.values(counts).reduce((a, r) => a + Object.values(r).reduce((x, y) => x + y, 0), 0);
  if (argv.includes('--write')) {
    if (named.length) { console.error('check-scale: --write records the whole tree; run it with no files'); process.exit(2); }
    writeFileSync(BASELINE, `${JSON.stringify({ about: 'Shapes that grow with the file or fail on a big one, with no `scale:` comment, per file and rule of the app and the packages: may shrink, never grow (scripts/check-scale.mjs, docs/big-files.md).', files: counts }, null, 2)}\n`);
    console.log(`check-scale: recorded ${total} in ${Object.keys(counts).length} files`);
    process.exit(0);
  }
  const baseline = readBaseline();
  const over = grown(counts, baseline);
  if (over.length) {
    const text = new Map(files.map((f) => [f.path, f.text]));
    fail([
      `check-scale: shapes that grow with the file grew:\n  ${over.map((g) => explain(g, text.get(g.path))).join('\n  ')}${fix(`avoid the shape (${DOC}), or if its input is bounded say why on its line: // scale: <why>`)}`,
    ]);
    process.exit(1);
  }
  const recorded = Object.values(baseline).reduce((a, r) => a + Object.values(r).reduce((x, y) => x + y, 0), 0);
  console.log(`check-scale: ${total} unbounded shapes in ${Object.keys(counts).length} files${!named.length && total < recorded ? ` (recorded ${recorded}: node scripts/check-scale.mjs --write lowers it)` : ''}`);
}
