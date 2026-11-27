// The parent of a node in a parse, found from one map built per parse. An operation run on every list or table of a
// document asks for each node's parent; a search of the whole tree per node made that quadratic. The AST is read-only,
// so the map built for a parse holds for as long as the parse does. Only blocks are mapped (lists, tables, quotes and the
// rest): what asks needs nothing else, and a page's inline nodes far outnumber its blocks. Pure: no DOM, no I/O.
import type { Document, Node } from '../contracts/ast.ts';
import { BLOCK_TYPES } from './plain-text.ts';

const byParse = new WeakMap<Node, Map<Node, Node>>();

function parentsIn(root: Node): Map<Node, Node> {
  let map = byParse.get(root);
  if (map) return map;
  map = new Map();
  // An explicit stack: a deeply nested parse must not overflow the call stack. Linear in the parse's nodes.
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of (node.children ?? []) as readonly Node[]) {
      if (!BLOCK_TYPES.has(child.type)) continue;
      map.set(child, node);
      stack.push(child);
    }
  }
  byParse.set(root, map);
  return map;
}

/** The node that holds block `target` directly in the tree under `root`; undefined for `root` itself, an inline node or a node not in it. */
export function parentOf(root: Document | Node, target: Node): Node | undefined {
  return parentsIn(root as Node).get(target);
}

/** The nodes holding block `target`, nearest first, up to and including `root`; empty when `target` is not a block under `root`. */
export function ancestorsOf(root: Document | Node, target: Node): Node[] {
  const map = parentsIn(root as Node);
  const out: Node[] = [];
  for (let at = map.get(target); at !== undefined; at = map.get(at)) out.push(at);
  return out;
}
