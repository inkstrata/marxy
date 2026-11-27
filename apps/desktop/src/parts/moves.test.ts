import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { PartUnit } from '../viewers/types.ts';
import { extendUnit, moveUnit, runUnits, topStep, treeParts } from './moves.ts';

const unit = (id: string, children?: PartUnit[]): PartUnit => ({ id, label: id, address: `#${id}`, el: () => null, stored: () => id, children });

// Two rows of two cells, then a third row with none.
const tree = treeParts([unit('r1', [unit('r1c1'), unit('r1c2')]), unit('r2', [unit('r2c1'), unit('r2c2')]), unit('r3')], { readOnly: true });
const at = (id: string): PartUnit => tree.find(id)!;

test('j and k step siblings, and from the end of a holder the step is the holder\'s', () => {
  assert.equal(moveUnit(tree, at('r1'), 'next')?.id, 'r2');
  assert.equal(moveUnit(tree, at('r1c1'), 'next')?.id, 'r1c2');
  assert.equal(moveUnit(tree, at('r1c2'), 'next')?.id, 'r2', 'past the last cell: the next row');
  assert.equal(moveUnit(tree, at('r2c1'), 'prev')?.id, 'r1', 'before the first cell: the row before');
  assert.equal(moveUnit(tree, at('r3'), 'next'), null, 'at the edge');
});

test('l goes into the first part held, h out to the holder; g g and G the edges; no cursor starts at the start', () => {
  assert.equal(moveUnit(tree, at('r2'), 'in')?.id, 'r2c1');
  assert.equal(moveUnit(tree, at('r3'), 'in'), null);
  assert.equal(moveUnit(tree, at('r2c2'), 'out')?.id, 'r2');
  assert.equal(moveUnit(tree, at('r2'), 'out'), null);
  assert.equal(moveUnit(tree, null, 'first')?.id, 'r1');
  assert.equal(moveUnit(tree, null, 'last')?.id, 'r3');
  assert.equal(moveUnit(tree, null, 'next')?.id, 'r1');
  assert.equal(moveUnit(tree, null, 'out'), null);
});

test('J and K grow and shrink a run along one holder; ] and [ step the top level', () => {
  assert.equal(extendUnit(tree, at('r1c1'), at('r1c1'), 1)?.id, 'r1c2');
  assert.equal(extendUnit(tree, at('r1c1'), at('r1c2'), 1), null, 'not past the holder');
  assert.equal(extendUnit(tree, at('r1c1'), at('r2c1'), 1), null, 'not across holders');
  assert.deepEqual(runUnits(tree, at('r3'), at('r1')).map((u) => u.id), ['r1', 'r2', 'r3']);
  assert.equal(topStep(tree, at('r1c2'), 1)?.id, 'r2');
  assert.equal(topStep(tree, at('r2c2'), -1)?.id, 'r2', '[ from inside a part goes to its top first');
  assert.equal(topStep(tree, at('r2'), -1)?.id, 'r1');
  assert.equal(topStep(tree, null, 1)?.id, 'r1');
});

test('a page drawn a window at a time: units made as they are asked for', () => {
  const row = (n: number): PartUnit => ({ id: `@${n}`, label: 'row', address: `@${n}`, at: n * 16, el: () => null, stored: () => '' });
  const virtual = {
    top: () => [row(0)],
    find: (id: string) => row(Number(id.slice(1))),
    start: () => row(0),
    parent: () => null,
    readOnly: true,
    sibling: (u: PartUnit, dir: 1 | -1) => {
      const n = Number(u.id.slice(1)) + dir;
      return n < 0 || n > 999 ? null : row(n);
    },
    edge: (e: 'first' | 'last') => row(e === 'first' ? 0 : 999),
  };
  assert.equal(moveUnit(virtual, row(5), 'next')?.id, '@6');
  assert.equal(moveUnit(virtual, row(0), 'prev'), null);
  assert.equal(moveUnit(virtual, null, 'last')?.id, '@999');
  assert.deepEqual(runUnits(virtual, row(7), row(4)).map((u) => u.id), ['@4', '@5', '@6', '@7']);
});

test('a run on a window-at-a-time page walks only its own length, toward the head', () => {
  let asked = 0;
  const row = (n: number, at = true): PartUnit => ({ id: `@${n}`, label: 'row', address: `@${n}`, at: at ? n * 16 : undefined, el: () => null, stored: () => '' });
  const big = (at: boolean) => ({
    top: () => [row(0, at)],
    find: (id: string) => row(Number(id.slice(1)), at),
    start: () => row(0, at),
    parent: () => null,
    readOnly: true,
    sibling: (u: PartUnit, dir: 1 | -1) => {
      asked++;
      const n = Number(u.id.slice(1)) + dir;
      return n < 0 || n >= 20_000 ? null : row(n, at);
    },
  });
  assert.deepEqual(runUnits(big(true), row(500), row(498)).map((u) => u.id), ['@498', '@499', '@500']);
  assert.ok(asked <= 3, `with bytes: walked ${asked} steps`);
  asked = 0;
  // A sheet's rows own no bytes: both ways in step.
  assert.deepEqual(runUnits(big(false), row(500, false), row(498, false)).map((u) => u.id), ['@498', '@499', '@500']);
  assert.ok(asked <= 6, `without bytes: walked ${asked} steps`);
});
