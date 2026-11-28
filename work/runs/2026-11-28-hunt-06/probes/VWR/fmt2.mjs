import { sheetValue } from '../../../../../packages/core/src/viewer/tables.ts';
for (const [n, code] of [[1234.5, '#,##0.##'], [2, '0.##'], [0.1234, '0.##'], [3.1, '0.0#'], [1500000, '0.0,,'], [1234567, '#,##0,"K"'], [999, '#,##0,']]) console.log(n, JSON.stringify(code), '->', sheetValue({ v: { k: 'real', v: n }, x: 0 }, [code]).text);
