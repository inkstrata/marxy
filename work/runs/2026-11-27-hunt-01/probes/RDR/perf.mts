import { parseMarkdown } from '/Users/<user>/Dev/marxy-wt/hunt-01/packages/core/src/index.ts';
import { renderDocumentSafeHtml } from '/Users/<user>/Dev/marxy-wt/hunt-01/packages/core/src/render/index.ts';
const cases: Record<string,string> = {
 bq: '> '.repeat(3000)+'x',
 list: Array.from({length:2000},(_,i)=>' '.repeat(i%200)+'- a').join('\n'),
 brackets: '['.repeat(20000),
 bracketsClose: '[a]('.repeat(10000),
 emph: '*a '.repeat(20000),
 emph2: '_a*'.repeat(20000),
 backticks: '`'.repeat(1)+'a``'.repeat(15000),
 tableWide: '|'+'a|'.repeat(3000)+'\n|'+'-|'.repeat(3000)+'\n'+('|'+'b|'.repeat(3000)+'\n').repeat(50),
 html: '<div>'.repeat(5000),
 htmlspan: '<span>'.repeat(20000)+'x',
 autolink: 'http://a.b/'.repeat(20000)+' www.'.repeat(5000),
 math: '$'.repeat(30000),
 math2: '$a '.repeat(20000),
 ref: Array.from({length:5000},(_,i)=>`[a${i}]: http://x/${i}`).join('\n')+'\n'+Array.from({length:5000},(_,i)=>`[a${i}]`).join(' '),
 fn: Array.from({length:3000},(_,i)=>`x[^${i}]`).join(' ')+'\n'+Array.from({length:3000},(_,i)=>`[^${i}]: n`).join('\n'),
 setext: ('a\n'.repeat(20000))+'---',
 lt: '<'.repeat(30000),
 ent: '&'.repeat(30000),
 hdr: Array.from({length:20000},()=>'# same').join('\n'),
 fm: '---\n'+'a: b\n'.repeat(20000),
 alert: Array.from({length:3000},()=>'> [!NOTE]\n> x\n').join('\n'),
};
for (const [k,v] of Object.entries(cases)) {
  const t=performance.now();
  try { const d=parseMarkdown(v); const t1=performance.now()-t; renderDocumentSafeHtml(d); console.log(k, Math.round(t1), Math.round(performance.now()-t)); } catch(e){ console.log(k,'ERR',String(e).slice(0,100), Math.round(performance.now()-t)); }
}
