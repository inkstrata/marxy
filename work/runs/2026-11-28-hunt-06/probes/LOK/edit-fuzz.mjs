import { setTopLevelKey, removeTopLevelKey, parseConfig } from '/D:/Dev/marxy-wt/hunt-06/packages/theme/src/index.ts';
import { parse } from '/D:/Dev/marxy-wt/hunt-06/packages/theme/node_modules/smol-toml/dist/index.js';
const enc = (s) => new TextEncoder().encode(s), dec = (b) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
const cases = {
  noeol: 'variant = "light"', crlf: 'variant = "light"\r\n[linux]\r\nweight_offset = 5\r\n', bom: '\ufeffvariant = "light"\n',
  dotted: 'size.x = 1\n', dottedOwn: 'a.b = 1\nsize = 3\n', quotedKey: '"size" = 3\nvariant="light"\n', spacedKey: 'size   =   3  # c\n',
  inlineTable: 'proposals = { minimap = false }\nsize = 3\n', tableFirst: '[linux]\nweight_offset = 1\n', multiline: 'external_editor = """\nsize = 99\n"""\n',
  arrayOfTables: '[[kind]]\nglob = "/a/**"\nis = "code"\n', comment: '# size = 5\n', literalKey: "'size' = 3\n",
  dupAfterTable: 'size = 3\n[x]\nsize = 4\n', trailingWs: 'size = 3   \n\n\n', onlyComment: '# hi', cr: 'size = 3\rvariant = "light"\r', tabs: '\tsize\t=\t3\n',
  unicode: 'external_editor = "é"\n', crlfMulti: 'external_editor = """a\r\nb"""\r\n', emptyBom: '\ufeff',
};
let bad = 0;
for (const [n, t] of Object.entries(cases)) {
  for (const [key, val, want] of [['size', '30', 30], ['variant', '"light"', 'light']]) {
    let note;
    try {
      const before = (() => { try { return parse(t.replace(/^\ufeff/, '')); } catch { return null; } })();
      const out = setTopLevelKey(enc(t), key, val);
      const after = parse(dec(out).replace(/^\ufeff/, ''));
      if (after[key] !== want) note = `value ${JSON.stringify(after[key])}`;
      if (before) for (const k of Object.keys(before)) if (k !== key && JSON.stringify(before[k]) !== JSON.stringify(after[k])) note = `changed ${k}`;
      if (t.startsWith('\ufeff') && !dec(out).startsWith('\ufeff')) note = 'BOM lost';
      if (/\r\n/.test(t) && /[^\r]\n/.test(dec(out))) note = (note ?? '') + ' mixed EOL';
      // remove
      const rm = removeTopLevelKey(out, key);
      const after2 = parse(dec(rm).replace(/^\ufeff/, ''));
      if (key in after2) note = (note ?? '') + ' remove failed';
      if (dec(rm).replace(/^\ufeff/, '') !== t.replace(/^\ufeff/, '') && !(t === '' )) note = (note ?? '') + ` remove-not-inverse(${JSON.stringify(dec(rm)).slice(0, 60)})`;
    } catch (e) { note = 'THROW ' + e.constructor.name + ' ' + e.message.slice(0, 50); }
    if (note) { bad++; console.log(n, key, '->', note); }
  }
}
console.log('issues', bad);
