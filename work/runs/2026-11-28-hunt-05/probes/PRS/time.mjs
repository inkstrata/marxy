import { parseMarkdown } from '../../../../../packages/core/src/index.ts';
import { pathMentions } from '../../../../../packages/core/src/transforms/extract.ts';
const enc = new TextEncoder();
function mk(kind){
  let s='# Changelog\n\n';
  let i=0;
  while(s.length<2_000_000){ i++;
    if(kind==='cl') s+=`## ${i}.0.0\n\n- fixed \`src/a${i}.ts\` thing *x* and [l](http://x/${i})\n- more **bold** text\n\n`;
    else s+=`## Section ${i}\n\nParagraph with \`src/file${i}.ts\` and *em* [link](http://x/${i}).\n\n\`\`\`js\nlet a=${i};\n\`\`\`\n\n`;
  } return s;
}
for (const k of ['cl','doc']) {
  const t=mk(k); const b=enc.encode(t);
  let a=performance.now(); const d=parseMarkdown(b,{file:'x.md'}); console.log(k,'parseMarkdown',Math.round(performance.now()-a),'ms');
  a=performance.now(); pathMentions(t); console.log(k,'pathMentions(text) no doc',Math.round(performance.now()-a),'ms');
  a=performance.now(); pathMentions(t,d); console.log(k,'pathMentions with doc',Math.round(performance.now()-a),'ms');
  const tc=t.replace(/\n/g,'\r\n'); a=performance.now(); parseMarkdown(enc.encode(tc)); console.log(k,'CRLF parse',Math.round(performance.now()-a),'ms');
}
