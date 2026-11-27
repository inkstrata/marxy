/**
 * Calls that take a list of arguments (`push(...xs)`, `append(...nodes)`, `Math.max(...ns)`) put one stack slot
 * per item on the call: past about 100,000 items (fewer in some engines) they throw "Maximum call stack size
 * exceeded". These take the list as a list, so a file with a few hundred thousand paragraphs, spans or rows is read
 * as it is read at ten.
 */

/** `target.push(...items)` without the argument limit; returns the new length. */
export function pushAll<T>(target: T[], items: ArrayLike<T> | Iterable<T>): number {
  if (items === target) items = target.slice();
  if ('length' in items) for (let i = 0; i < items.length; i++) target.push(items[i]!);
  else for (const item of items) target.push(item);
  return target.length;
}

/** `Math.max(floor, ...values)` without the argument limit. Unlike Math.max, a NaN in `values` is skipped, not passed on. */
export function maxOf(values: Iterable<number>, floor = -Infinity): number {
  let best = floor;
  for (const v of values) if (v > best) best = v;
  return best;
}

/** `Math.min(ceiling, ...values)` without the argument limit. Unlike Math.min, a NaN in `values` is skipped, not passed on. */
export function minOf(values: Iterable<number>, ceiling = Infinity): number {
  let best = ceiling;
  for (const v of values) if (v < best) best = v;
  return best;
}

/** `parent.append(...nodes)` in chunks, so the call never carries more than `chunk` arguments. A live list (childNodes) is copied first, as moving a node out of it shifts it. */
export function appendAll(parent: ParentNode, nodes: ArrayLike<Node | string>, chunk = 5000): void {
  const list = Array.from(nodes);
  for (let i = 0; i < list.length; i += chunk) parent.append(...list.slice(i, i + chunk));
}
