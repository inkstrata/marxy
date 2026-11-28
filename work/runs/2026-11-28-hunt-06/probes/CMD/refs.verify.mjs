export {};
const { lineQuery, referenceQuery } = await import('file:///D:/Dev/marxy-wt/hunt-06/apps/desktop/src/line/refs.ts');
for (const q of ['5-3', '9-5', '5-9', '7-7']) console.log('LINE', q, JSON.stringify(lineQuery(q)));
for (const q of ['src/a.ts:12', 'src/a.ts:12:5', 'a.ts:9-5']) console.log('REF', q, JSON.stringify(referenceQuery(q)));
