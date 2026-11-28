// prints a compact table from one or more probe JSON files
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const rs = JSON.parse(readFileSync(f, 'utf8'));
  console.log(`\n${f}`);
  for (const r of rs) {
    if (r.n) { console.log(`ro n=${r.n} obs=${r.observed} layout ${r.layoutOnly.med}/${r.layoutOnly.min} frameEnd ${r.toNextFrameEnd.med}/${r.toNextFrameEnd.min} cb ${r.roCallbackMs.med} notified ${r.notifiedPerChange.med} init ${r.initMs}`); continue; }
    const i = r.interactions ?? {}; const m = (k, f2 = 'total') => i[k]?.[f2] ? `${i[k][f2].med}/${i[k][f2].min}` : '-';
    console.log(`${r.size.padEnd(5)} has=${r.has} nodes ${r.nodes?.articleAll} el ${r.nodes?.article} blocks ${r.nodes?.blocks} | key tot ${m('key')} sync ${m('key', 'sync')} frame ${m('key', 'frame')} | scroll tot ${m('scroll')} frame ${m('scroll', 'frame')} | layout1 ${m('forcedLayoutOneBlock', 'sync')} layoutW ${m('forcedLayoutArticleWidth', 'sync')} | append ${m('appendOneBlock', 'sync')} | width tot ${m('widthChange')} frame ${m('widthChange', 'frame')} | open ${r.openWallS}s settle ${r.settleS}s${r.typesetQuiet === false ? ' NOTQUIET' : ''}`);
  }
}
