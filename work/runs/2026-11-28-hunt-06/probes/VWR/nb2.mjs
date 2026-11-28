import { notebookReading } from '../../../../../packages/core/src/reading/notebook.ts';
import { byteOffsets } from '../../../../../packages/core/src/parse/byte-offsets.ts';
const text='{"nbformat":4,"cells":[{"cell_type":"code","source":"a\u00e9\n\\"q\\"\ud83d\ude00","outputs":[]}]}';
console.log(text);
try{JSON.parse(text);console.log('json ok')}catch(e){console.log('json err',e.message)}
const r=notebookReading('a.ipynb',text,byteOffsets(text),()=>1);
console.log(r.failed? JSON.stringify(r.failed): r.html.replace(/<[^>]+>/g,'|').slice(-120));
// single-line with escapes only \n
for (const s of ['{"nbformat":4,"cells":[{"cell_type":"code","source":"a\nb","outputs":[]}]}','{"nbformat":4,"cells":[{"cell_type":"code","source":"\\"q\\"","outputs":[]}]}','{"nbformat":4,"cells":[{"cell_type":"code","source":"\u00e9","outputs":[]}]}']){
 const r=notebookReading('a.ipynb',s,byteOffsets(s),()=>1); console.log(r.failed? 'FAIL '+JSON.stringify(r.failed): 'ok');}
