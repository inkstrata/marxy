import { stateFromToml, fromFile, resolve, defaultLookState, stateToToml, toFile, saveAs, LOOKS } from '/D:/Dev/marxy-wt/hunt-06/packages/theme/src/index.ts';
const ctx = { systemDark: false, hour: 12, more: false, kind: null, path: '/a.md', width: 800 };
const cases = {
  unknownRuleLook: `look = "paper"\n[[rule]]\nid="x"\nlabel="x"\n[rule.set]\nlook = "nonexistent"\n`,
  badWhen: `[[rule]]\nid="x"\nlabel="x"\n[rule.when]\npath = "[unclosed"\nkinds = [1,2]\n`,
  hugeTweak: `look="paper"\n[tweaks.paper.type]\nsize = 1e308\nleading = 1e-9\n[tweaks.paper.tone]\nink = 1e9\n`,
  nanLike: `look="paper"\n[tweaks.paper.tone]\nday = { l = nan, c = inf, h = -inf }\n`,
  modeBad: `mode = 5\nlook = 7\nlean = "yes"\n`,
  ruleNotArray: `rule = "x"\n`,
  ruleAsTable: `[rule]\nid="a"\nlabel="b"\n`,
};
for (const [n, t] of Object.entries(cases)) {
  try {
    const s = stateFromToml(t);
    const r = resolve(s, ctx);
    console.log(n, 'ok', r.look.id, JSON.stringify(Object.keys(r)));
    stateToToml(s);
  } catch (e) { console.log(n, 'THROW', e.message.split('\n')[0]); }
}
// name round trip
const odd = ['a\u007fb', 'x\ud800y', 'tab\there', 'quote"s', 'new\nline', '\u2028'];
for (const name of odd) {
  try {
    const { state, look } = saveAs(defaultLookState(), name);
    const f = toFile(state, state.id);
    const back = fromFile(look.id, f);
    console.log(JSON.stringify(name), back ? JSON.stringify(back.name) : 'UNPARSEABLE (file ignored)');
  } catch (e) { console.log(JSON.stringify(name), 'THROW', e.message.split('\n')[0]); }
}
