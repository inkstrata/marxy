// What a table tool says when it declines a table it found under the caret (V-02.1), in the X-21 template
// "what happened · what is unchanged · what to do". Nothing is written on a refusal, so the second clause is always true.
import type { TableRefusal } from '@marxy/core/src/source-edit/index.ts';

export type TableToolName = 'alignTable' | 'addTableRow' | 'addTableColumn' | 'sortTableRows';

const DONE_NOT: Record<TableToolName, string> = {
  alignTable: 'Table not aligned',
  addTableRow: 'Row not added',
  addTableColumn: 'Column not added',
  sortTableRows: 'Table not sorted',
};

const WHY: Record<TableRefusal, (tool: TableToolName) => string> = {
  columns: () => "this table's rows have different column counts · the file is unchanged · give every row the same number of cells first",
  shape: () => "this table's markup is not one Marxy can edit safely · the file is unchanged · edit the table by hand",
  'closing-pipe': () =>
    "this column's last cell has no closing pipe, so a new cell after it would read as the row's end · the file is unchanged · add a closing | to the rows or put the caret in an earlier column",
  rewrite: (tool) =>
    `the result would not read back as the same table · the file is unchanged · ${tool === 'sortTableRows' ? 'sort' : 'edit'} the table by hand`,
};

export function tableRefusalText(tool: TableToolName, reason: TableRefusal): string {
  return `${DONE_NOT[tool]}: ${WHY[reason](tool)}`;
}
