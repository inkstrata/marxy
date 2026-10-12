// A count of work, not a clock (F-58). scaling.test.ts times the transforms, and a timer has to leave room for noise: at
// the sizes it can afford, a step that is quadratic only in the top-level blocks (`siblings.indexOf(list)` once per list,
// `inside.includes(block)` once per block) hid under its bar until a loaded machine flagged it. Here every element an
// array search may walk is counted instead, so ten times the text must cost about ten times the walking (at most
// twenty), where a quadratic step costs a hundred times as much.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseText } from './prose.ts';
import { runTransform } from './registry.ts';

const BLOCK = '* one\n* two\n\n+ three\n\npara\n\n- a\n- b\n\n***\n\n';
const textOf = (blocks: number): string => BLOCK.repeat(blocks);

/** The most elements the array searches (`indexOf`, `includes`) could have walked while `f` ran. */
function walked(f: () => void): number {
  const { indexOf, includes } = Array.prototype;
  let total = 0;
  Array.prototype.indexOf = function (this: unknown[], ...args: [unknown, number?]) {
    total += this.length;
    return indexOf.apply(this, args);
  } as typeof indexOf;
  Array.prototype.includes = function (this: unknown[], ...args: [unknown, number?]) {
    total += this.length;
    return includes.apply(this, args);
  } as typeof includes;
  try {
    f();
  } finally {
    Array.prototype.indexOf = indexOf;
    Array.prototype.includes = includes;
  }
  return total;
}

for (const id of ['to-plain', 'normalize-bullets']) {
  test(`${id}: ten times the blocks walk at most twenty times the array elements`, () => {
    const count = (blocks: number): number => {
      const text = textOf(blocks);
      parseText(text); // the parse is checked elsewhere, and its own searches are not this transform's
      return walked(() => runTransform(id, text, {}));
    };
    const small = count(300);
    const large = count(3000);
    assert.ok(large <= 20 * Math.max(small, 1000), `${id}: ${small} elements walked at 300 blocks, ${large} at 3000`);
  });
}
