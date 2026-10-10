// The desktop app has no static import cycle, and the selection controller keeps no module state (B-12).
// A cycle of value imports works only while every use sits inside a function; the seven-module one the
// audit found ([C6]: commands/document → edits → render/tasks → selection/bind → commands/index, with
// registry and save) was the shape of document state held in modules rather than in the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { valueImportSpecs } from '../../../scripts/lib/imports.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const entry = join(src, 'main.ts');

/** A relative specifier resolved to a file under `src`; packages and anything else are not followed. */
function resolveLocal(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (candidate.startsWith(src) && /\.[mc]?[tj]s$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every module reachable from `main.ts` through static value imports, with its edges. */
function graphFrom(root) {
  const edges = new Map();
  const stack = [root];
  while (stack.length > 0) {
    const file = stack.pop();
    if (edges.has(file)) continue;
    const next = [];
    for (const spec of valueImportSpecs(readFileSync(file, 'utf8'), file)) {
      const target = resolveLocal(file, spec);
      if (target) next.push(target);
    }
    edges.set(file, next);
    stack.push(...next);
  }
  return edges;
}

/** Tarjan's strongly connected components; a component of more than one module is a cycle. */
function cycles(edges) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  const strong = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), idx.get(w)));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      const selfLoop = component.length === 1 && (edges.get(v) ?? []).includes(v);
      if (component.length > 1 || selfLoop) out.push(component.map((f) => relative(src, f)).sort());
    }
  };
  for (const v of edges.keys()) if (!idx.has(v)) strong(v);
  return out;
}

test('the graph walk reaches the modules the app is made of', () => {
  const edges = graphFrom(entry);
  const reached = [...edges.keys()].map((f) => relative(src, f));
  for (const f of ['app.ts', 'selection/view.ts', 'selection/bind.ts', 'commands/index.ts', 'document/store.ts']) {
    assert.ok(reached.includes(f), `${f} is reachable from main.ts`);
  }
});

test('the cycle finder finds a cycle when there is one', () => {
  const a = '/a.ts';
  const b = '/b.ts';
  const c = '/c.ts';
  assert.equal(cycles(new Map([[a, [b]], [b, [c]], [c, []]])).length, 0);
  assert.equal(cycles(new Map([[a, [b]], [b, [c]], [c, [a]]])).length, 1);
});

test('no static value import cycle is reachable from main.ts', () => {
  const found = cycles(graphFrom(entry));
  assert.deepEqual(found, [], `import cycles:\n${found.map((c) => `  [${c.length}] ${c.join(', ')}`).join('\n')}`);
});

test('selection/view.ts keeps no module-level let: the selection lives in its controller', () => {
  const file = join(src, 'selection/view.ts');
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lets = [];
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0) {
      for (const d of stmt.declarationList.declarations) lets.push(d.name.getText(sf));
    }
  }
  assert.deepEqual(lets, [], `module-level let in selection/view.ts: ${lets.join(', ')}`);
});
