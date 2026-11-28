import { defaultLookState, LOOKS, resolve, FLOOR } from '/D:/Dev/marxy-wt/hunt-06/packages/theme/src/index.ts';
const hex = (c) => { c = c.trim(); const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c); if (!m) return null; let h = m[1]; if (h.length === 3) h = [...h].map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
const lin = (v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
console.log('FLOOR', FLOOR);
const r0 = resolve(defaultLookState(), { systemDark: false, hour: 12, more: false, kind: null, path: '/a.md', width: 800, scheme: 'day' });
console.log(Object.keys(r0.tokens).filter(k => /color/.test(k)).join(' '));
const pairs = [['text', 'bg', 7], ['text-strong', 'bg', 7], ['text-secondary', 'bg', 4.5], ['text-faint', 'bg', 3], ['link', 'bg', 4.5], ['accent', 'bg', 3], ['code-text', 'code-bg', 4.5], ['status-ok', 'bg', 3], ['status-warn', 'bg', 3], ['status-err', 'bg', 3], ['notice', 'bg', 3], ['accent-fg', 'accent-strong', 4.5]];
const fails = new Map();
for (const look of LOOKS) for (const scheme of ['day', 'night']) for (const more of [false, true]) {
  for (const tw of [{}, { ink: 7 }, { day: { l: 0.5, c: 0.1, h: 30 }, night: { l: 0.7, c: 0.1, h: 30 } }, { accent: 60 }, { code: 1 }]) {
    const s = { ...defaultLookState(), id: look.id, tweaks: { [look.id]: tw } };
    const r = resolve(s, { systemDark: false, hour: 12, more, kind: null, path: '/a.md', width: 800, scheme });
    for (const [a, b, min] of pairs) {
      const ca = hex(r.tokens['--marxy-color-' + a] ?? ''), cb = hex(r.tokens['--marxy-color-' + b] ?? '');
      if (!ca || !cb) continue;
      const v = cr(ca, cb);
      if (v < min) { const key = `${a}/${b}`; const e = fails.get(key) ?? []; e.push(`${look.id}/${r.scheme}${more ? '/more' : ''}/${JSON.stringify(tw).slice(0, 30)}=${v.toFixed(2)}`); fails.set(key, e); }
    }
  }
}
for (const [k, v] of fails) console.log(k, v.length, v.slice(0, 4).join(' ; '));
if (!fails.size) console.log('no failures');
