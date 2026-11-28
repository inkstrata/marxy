import { presence } from '../../../../../scripts/auto/lib/presence.mjs';
const boom = () => { throw new Error('timed out'); };
for (const platform of ['win32', 'darwin', 'linux']) console.log(platform, 'every probe fails ->', JSON.stringify(presence({ platform, run: boom })));
// KDE reports 5 s since last input, in ms
const kde = (cmd) => cmd === 'qdbus' ? '5000' : 'steam';
console.log('linux, 5000 (ms) idle ->', JSON.stringify(presence({ platform: 'linux', run: (c) => kde(c) })));
