// Test support for the transform library (J-03): E-01's `tableTest` takes an `Operation` and rows, so a transform
// is seen as the operation "replace the whole document with fn(text)" and each group's table runs through the
// kit unchanged (as written, CRLF, lone CR, no trailing newline, and behind a BOM for an `edit`).
import type { Operation } from '../../contracts/operation.ts';
import { tableTest, type Row } from '../../operations/testing/test-kit.ts';
import { transformById, type Transform } from '../registry.ts';

export function asOperation(t: Transform): Operation {
  return {
    id: t.id,
    title: t.name,
    appliesTo: ['document'],
    canApply: () => true,
    run: (input) => ({ replacement: t.fn(input.text) }),
  };
}

/** One row: the transform `id`, a name, the document as written (LF), and the whole text it must become. */
export type Case = readonly [id: string, name: string, source: string, expect: string];

export function tableOf(cases: readonly Case[]): void {
  for (const [id, name, source, expect] of cases) {
    const t = transformById(id);
    if (!t) throw new Error(`${id} is not implemented`);
    const row: Row = { name, source, expect, pick: (doc) => doc };
    tableTest(asOperation(t), [row], { bom: t.kind === 'edit' });
  }
}
