import { stateFromToml, stateToToml, defaultLookState, tweak, LOOKS, saveAs, toFile, fromFile, addRule, lookById, merged, resolve } from '/D:/Dev/marxy-wt/hunt-06/packages/theme/src/index.ts';
const diff = (a, b, path = '') => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (typeof a === 'object' && a && typeof b === 'object' && b) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => diff(a[k], b[k], path + '.' + k));
  return [`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
};
let bad = 0;
for (const look of LOOKS) {
  let s = { ...defaultLookState(), id: look.id };
  const tw = {
    day: { l: 0.9123456, c: 0.0123456, h: 123.7 }, night: { l: 0.1234567, c: 0.0256789, h: 250.4 },
    ink: 11.37, inkNight: 12.55, accent: 200.6, code: 0.4567, size: 21.5, lead: 1.5555, measure: 63.5, weight: 405.5, headWeight: 650, scale: 1.2345,
    headTracking: -0.0123, tint: { h: 33.3, c: 0.0456 }, para: 'indent', align: 'justify', caps: true, figures: 'old', headStyle: 'italic',
  };
  for (const [k, v] of Object.entries(tw)) s = tweak(s, k, v);
  const back = stateFromToml(stateToToml(s, true));
  const d = diff(s.tweaks[look.id], back.tweaks[look.id]);
  if (d.length) { bad++; if (bad < 4) console.log(look.id, d.join(' | ')); }
}
console.log('looks with a lossy round trip:', bad, 'of', LOOKS.length);
// a rule with a faces/langs set
let s = defaultLookState();
s = addRule(s, { label: 'Wide', when: { minWidth: 1000 }, set: { size: 22, ink: 12, day: { l: 0.9, c: 0.01, h: 90 }, faces: { article: 'sans' } } });
const b = stateFromToml(stateToToml(s));
console.log('rule set', JSON.stringify(s.userRules.at(-1).set), '=>', JSON.stringify(b.userRules.find(r => r.id === 'wide')?.set));
