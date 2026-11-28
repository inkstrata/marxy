import { stateFromToml, stateToToml, defaultLookState, addRule } from '/D:/Dev/marxy-wt/hunt-06/packages/theme/src/index.ts';
let s = defaultLookState();
console.log('sample', s.userRules.map(r => r.id).join(','));
s = addRule(s, { label: 'My big', when: { minWidth: 1000 }, set: { size: 22, ink: 12, day: { l: 0.9, c: 0.01, h: 90 }, faces: { article: 'sans' }, lead: 1.4, headFace: 'sans' } });
const mine = s.userRules.at(-1);
const b = stateFromToml(stateToToml(s));
console.log(mine.id, JSON.stringify(mine.set), '=>', JSON.stringify(b.userRules.find(r => r.id === mine.id)?.set));
