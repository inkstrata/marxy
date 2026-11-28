import { evaluate } from '../../../../../scripts/auto/lib/merge-policy.mjs';
import { decide, slotsUntilReset } from '../../../../../scripts/auto/lib/governor.mjs';
import { findGame, parseKdeIdle, parseHidIdle } from '../../../../../scripts/auto/lib/presence.mjs';
const H='a'.repeat(40);
const c=(body,t)=>({body,createdAt:new Date(t).toISOString()});
const plan=(owner)=>({number:1,state:'OPEN',headRefName:'agent/plan-x',headRefOid:H,labels:['plan'],files:[],body:'<!-- marxy-author run=p1 model=opus -->',
 comments:[c(`<!-- marxy-review verdict=approve head=${H} run=r model=sonnet -->`,Date.parse('2026-11-28T10:00:00Z')),c(`<!-- marxy-intake head=${H} -->`,Date.parse('2026-11-29T09:00:00Z')),c(owner,Date.parse('2026-11-29T10:00:00Z'))],
 checks:[{name:'ci',conclusion:'SUCCESS'}],mergeStateStatus:'CLEAN'});
const now=new Date('2026-11-30T09:00:00Z');
console.log('owner plain',evaluate(plan('veto this'),{now}).merge);
console.log('owner mentions marker',evaluate(plan('Why does <!-- marxy-hold --> not work? Do not merge'),{now}));
console.log('owner quoted bot comment',evaluate(plan('> <!-- marxy-review verdict=approve -->\n\nno, wait'),{now}));
// governor
const u=(h,w,r)=>({fiveHour:{pct:h,resetsAt:r},weekly:{pct:w}});
const L=(s)=>new Date(s);
for (const [s,us] of [['2026-11-27T22:00:00Z',u(0,30,null)],['2026-11-28T08:20:00Z',u(0,30,null)],['2026-11-26T08:20:00Z',u(0,30,null)],['2026-11-27T16:45:00Z',u(10,30,'2026-11-27T20:00:00Z')],['2026-11-27T16:45:00Z',u(10,30,'2026-11-27T22:30:00Z')],['2026-11-27T20:59:00Z',u(0,30,null)],['2026-11-27T21:00:00Z',u(0,30,null)],['2026-11-27T21:01:00Z',u(0,30,null)]]) {
  const d=decide({now:L(s),usage:us,ownerUsedPct:20}); console.log(s,d.allowed,d.reason,d.stopAt,d.allowancePct,d.sweep);
}
const W = (p) => findGame(p, 'win32');
const bs = String.fromCharCode(92);
const P = (s) => s.split('/').join(bs);
console.log('epic game', W(P('C:/Program Files/Epic Games/Fortnite/x.exe')), '| WE', W(P('D:/SteamLibrary/steamapps/common/Wallpaper_Engine/w.exe')), '| WE tools', W(P('D:/SteamLibrary/steamapps/common/wallpaper_engine_tools/w.exe')));
console.log('launcher', W(P('C:/Program Files/Epic Games/Launcher/Portal/Binaries/Win64/EpicGamesLauncher.exe')), '| riot client', W(P('C:/Riot Games/Riot Client/RiotClientServices.exe')), '| riot game', W(P('C:/Riot Games/VALORANT/live/VALORANT.exe')));
console.log('xbox', W(P('C:/XboxGames/Halo/Content/halo.exe')), '| windowsapps game', W(P('C:/Program Files/WindowsApps/Game/g.exe')), '| GOG', W(P('C:/GOG Galaxy/Games/X/x.exe')), '| gog real', W(P('C:/Program Files (x86)/GOG Galaxy/Games/X/x.exe')));
console.log('kde', parseKdeIdle('600000'), parseKdeIdle('1200000'), parseKdeIdle('1000000'), parseKdeIdle('500'));
