import { sheetValue } from '../../../../../packages/core/src/viewer/tables.ts';
const t = (v, code) => console.log(JSON.stringify(code).padEnd(22), v, '->', JSON.stringify(sheetValue({ v: { k: 'real', v }, x: 0 }, [code]).text));
t(1500000, '0.0,,"M"'); t(2500, '0.0,"K"'); t(1234567, '#,##0,'); t(1234567, '#,##0');
t(1234.5, '#,##0.##'); t(2, '0.##'); t(3.1, '0.0#'); t(3.14159, '0.##'); t(1234.5, '#,##0.00');
