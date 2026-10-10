/* Marxy rendering: Markdown with source-line mapping, highlighting, kind detection,
   document views per content kind, the source editor, and selection tools. */
(function () {
  const G = window.Marxy;
  const { $, $$, esc, el, ic, fmt } = G;

  /* ---------- Highlighter ---------- */

  const KW = {
    rust: 'as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|type|unsafe|use|where|while',
    ts: 'as|async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|interface|let|new|of|return|switch|this|throw|try|type|typeof|var|void|while|yield',
    python: 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield',
    bash: 'if|then|else|elif|fi|for|in|do|done|while|case|esac|function|return|export|local|set|sudo|cd|echo',
    sql: 'select|from|where|order|by|group|having|limit|offset|join|left|right|inner|outer|on|as|and|or|not|insert|into|values|update|set|delete|create|table|index|alter|drop|desc|asc|distinct|with|case|when|then|else|end|null|is|in'
  };
  const LANG_ALIAS = { js: 'ts', javascript: 'ts', typescript: 'ts', tsx: 'ts', jsx: 'ts', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', rs: 'rust', yml: 'yaml', jsonc: 'json', md: 'markdown', toml: 'yaml' };
  const STR = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/;
  const rules = {
    rust: [[/\/\/[^\n]*/, 'c'], [/"(?:\\.|[^"\\])*"/, 's'], [/'(?:\\.|[^'\\])'/, 's'], [/#!?\[[^\]\n]*\]/, 'm'], [/\b\d[\d_]*(?:\.\d+)?(?:[iu]\d+|f\d+)?\b/, 'n'], [/\b(?:true|false|None|Some|Ok|Err)\b/, 'n'], [/(?<=\b(?:fn|struct|enum|trait|mod|type)\s+)[A-Za-z_]\w*/, 'd'], [new RegExp('\\b(?:' + KW.rust + ')\\b'), 'k'], [/\b[A-Z][A-Za-z0-9_]*\b/, 't'], [/\b[a-z_]\w*!/, 'k']],
    ts: [[/\/\/[^\n]*|\/\*[\s\S]*?\*\//, 'c'], [STR, 's'], [/`(?:\\.|[^`\\])*`/, 's'], [/\b\d[\d_]*(?:\.\d+)?\b/, 'n'], [/\b(?:true|false|null|undefined)\b/, 'n'], [/(?<=\b(?:function|class|interface|type|enum)\s+)[A-Za-z_$][\w$]*/, 'd'], [new RegExp('\\b(?:' + KW.ts + ')\\b'), 'k'], [/\b[A-Z][A-Za-z0-9_]*\b/, 't']],
    python: [[/#[^\n]*/, 'c'], [/"""[\s\S]*?"""|'''[\s\S]*?'''/, 's'], [STR, 's'], [/\b\d[\d_]*(?:\.\d+)?\b/, 'n'], [/\b(?:True|False|None)\b/, 'n'], [/(?<=\b(?:def|class)\s+)[A-Za-z_]\w*/, 'd'], [new RegExp('\\b(?:' + KW.python + ')\\b'), 'k'], [/@\w+/, 'm']],
    bash: [[/(?<=^|\s)#[^\n]*/, 'c'], [STR, 's'], [/^\$ /m, 'm'], [/\$\{[^}\n]*\}|\$\w+/, 'n'], [/(?<=\s)--?[\w-]+(?:=[^\s\\]*)?/, 't'], [/(?<=^|[|;&]\s*|^\$ )[\w./-]+/m, 'd'], [new RegExp('\\b(?:' + KW.bash + ')\\b'), 'k']],
    sql: [[/--[^\n]*/, 'c'], [/'(?:''|[^'])*'/, 's'], [/\b\d+(?:\.\d+)?\b/, 'n'], [new RegExp('\\b(?:' + KW.sql + ')\\b', 'i'), 'k']],
    json: [[/"(?:\\.|[^"\\])*"(?=\s*:)/, 'd'], [/"(?:\\.|[^"\\])*"/, 's'], [/-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'n'], [/\b(?:true|false|null)\b/, 'n']],
    yaml: [[/(?<=^|\s)#[^\n]*/, 'c'], [/^[ \t]*[\w.-]+(?=\s*[:=])/m, 'd'], [STR, 's'], [/\b\d+(?:\.\d+)?\b/, 'n'], [/\b(?:true|false|null)\b/, 'n'], [/^\[[^\]\n]*\]/m, 'k']],
    css: [[/\/\*[\s\S]*?\*\//, 'c'], [STR, 's'], [/--[\w-]+/, 'd'], [/#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|ch|vh|vw)?\b/, 'n'], [/[\w-]+(?=\s*:)/, 'k']],
    csv: [[/^[^\n]*/, '']],
    log: [[/^\d{4}-\d\d-\d\d[T ][\d:.,]+(?:Z|[+-]\d\d:?\d\d)?/, 'c'], [/\b(?:TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\b/, 'd'], [/\u001b\[[0-9;]*m/, 'm']]
  };
  // A shell prompt line: up to two words, then $ or %, then the command ("ian@eris ~/Code % cargo test", "$ ls").
  const PROMPT_RE = /^((?:\S+[ \t]){0,2}[$%])(?:([ \t]+)(.*))?$/;
  const LOG_RE = /^(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?)([ \t]+)(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|CRITICAL)\b([ \t]*)(.*)$/;
  const termHl = (code) => code.split('\n').map((l) => { const m = l.match(PROMPT_RE); return m ? `<span class="tk-p">${esc(m[1])}</span>${esc(m[2] || '')}<span class="tm-cm">${esc(m[3] || '')}</span>` : esc(l); }).join('\n');
  const compiled = {};
  function compile(lang) {
    if (compiled[lang]) return compiled[lang];
    const rs = rules[lang]; if (!rs) return null;
    const flags = new Set(['g', 'm']); rs.forEach(([r]) => r.flags.includes('i') && flags.add('i'));
    return (compiled[lang] = { re: new RegExp(rs.map(([r]) => '(' + r.source + ')').join('|'), Array.from(flags).join('')), cls: rs.map(([, c]) => c) });
  }
  G.hl = (code, lang) => {
    if (/^(console|shellsession|term|terminal)$/i.test(lang || '')) return termHl(code);
    lang = (LANG_ALIAS[lang] || lang || '').toLowerCase();
    if (lang === 'diff') return code.split('\n').map((l) => (/^\+/.test(l) ? `<span class="tk-add"><span class="tk-m">+</span>${esc(l.slice(1))}</span>` : /^-/.test(l) ? `<span class="tk-del"><span class="tk-m">−</span>${esc(l.slice(1))}</span>` : /^@@/.test(l) ? `<span class="tk-m">${esc(l)}</span>` : esc(l))).join('\n');
    if (lang === 'markdown') return mdSourceHtml(code).join('\n');
    const c = compile(lang);
    if (!c) return esc(code); // unknown language: plain monospace, never guessed colour
    let out = '', last = 0;
    code.replace(c.re, (...m) => {
      const off = m[m.length - 2]; const whole = m[0];
      if (!whole) return whole;
      const gi = m.slice(1, c.cls.length + 1).findIndex((x) => x !== undefined);
      out += esc(code.slice(last, off)) + (c.cls[gi] ? `<span class="tk-${c.cls[gi]}">${esc(whole)}</span>` : esc(whole));
      last = off + whole.length; return whole;
    });
    return out + esc(code.slice(last));
  };

  /* Markdown source highlighting, line by line, for the editor */
  function mdInlineSrc(s) {
    const parts = []; let rest = s;
    const re = /(`+)(.+?)\1|\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)(.+?)\*(?!\w)|!?\[([^\]]*)\]\(([^)]*)\)|\[\^([^\]]+)\]|<(https?:[^>]+)>/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      parts.push(esc(s.slice(last, m.index)));
      if (m[1]) parts.push(`<span class="tk-m">${esc(m[1])}</span><span class="tk-s">${esc(m[2])}</span><span class="tk-m">${esc(m[1])}</span>`);
      else if (m[3] !== undefined) parts.push(`<span class="tk-m">**</span><span class="tk-b">${esc(m[3])}</span><span class="tk-m">**</span>`);
      else if (m[4] !== undefined) parts.push(`<span class="tk-m">*</span><span class="tk-i">${esc(m[4])}</span><span class="tk-m">*</span>`);
      else if (m[5] !== undefined) parts.push(`<span class="tk-m">${m[0][0] === '!' ? '![' : '['}</span><span class="tk-l">${esc(m[5])}</span><span class="tk-m">](${esc(m[6])})</span>`);
      else if (m[7] !== undefined) parts.push(`<span class="tk-k">[^${esc(m[7])}]</span>`);
      else if (m[8] !== undefined) parts.push(`<span class="tk-m">&lt;</span><span class="tk-l">${esc(m[8])}</span><span class="tk-m">&gt;</span>`);
      last = m.index + m[0].length;
    }
    parts.push(esc(s.slice(last)));
    return parts.join('');
  }
  function mdSourceHtml(src) {
    const lines = src.split('\n'); const out = [];
    let fm = lines[0] === '---', fence = null;
    lines.forEach((l, i) => {
      if (fm) {
        if (i > 0 && l === '---') { fm = false; out.push(`<span class="tk-m">---</span>`); return; }
        if (i === 0) { out.push(`<span class="tk-m">---</span>`); return; }
        const kv = l.match(/^([\w-]+)(:)(.*)$/);
        out.push(kv ? `<span class="tk-d">${esc(kv[1])}</span><span class="tk-m">:</span><span class="tk-s">${esc(kv[3])}</span>` : esc(l)); return;
      }
      const f = l.match(/^(\s*)(```+|~~~+)(.*)$/);
      if (fence) {
        if (f && f[2][0] === fence.ch && f[2].length >= fence.len && !f[3].trim()) { fence = null; out.push(`<span class="tk-m">${esc(l)}</span>`); }
        else out.push(G.hl(l, fence.lang) || ' ');
        return;
      }
      if (f) { fence = { ch: f[2][0], len: f[2].length, lang: f[3].trim().split(/\s+/)[0] }; out.push(`<span class="tk-m">${esc(f[1] + f[2])}</span><span class="tk-k">${esc(f[3])}</span>`); return; }
      let m;
      if ((m = l.match(/^(#{1,6})(\s+)(.*)$/))) return out.push(`<span class="tk-m">${m[1]}</span>${m[2]}<span class="tk-h">${mdInlineSrc(m[3])}</span>`);
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) return out.push(`<span class="tk-m">${esc(l)}</span>`);
      if ((m = l.match(/^(\s*>\s?)(\[!\w+\])?(.*)$/))) return out.push(`<span class="tk-m">${esc(m[1])}</span>${m[2] ? `<span class="tk-k">${esc(m[2])}</span>` : ''}${mdInlineSrc(m[3])}`);
      if ((m = l.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s)?(.*)$/))) return out.push(`${m[1]}<span class="tk-m">${esc(m[2])}</span>${m[3]}${m[4] ? `<span class="tk-k">${esc(m[4])}</span>` : ''}${mdInlineSrc(m[5])}`);
      if ((m = l.match(/^(\[\^[^\]]+\]:)(.*)$/))) return out.push(`<span class="tk-k">${esc(m[1])}</span>${mdInlineSrc(m[2])}`);
      if (/^\s*\|/.test(l)) return out.push(/^\s*\|?\s*:?-{2,}/.test(l) ? `<span class="tk-m">${esc(l)}</span>` : l.split(/(\|)/).map((p) => (p === '|' ? '<span class="tk-m">|</span>' : mdInlineSrc(p))).join(''));
      out.push(mdInlineSrc(l));
    });
    return out;
  }
  G.mdSourceLines = mdSourceHtml;

  /* ---------- Markdown → HTML with data-line on every block ---------- */

  const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const FENCE_RE = /^(\s{0,3})(```+|~~~+)\s*(.*)$/;
  const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const ADM = { NOTE: ['note', 'info', 'Note'], TIP: ['tip', 'lightbulb', 'Tip'], IMPORTANT: ['important', 'message-square-warning', 'Important'], WARNING: ['warning', 'triangle-alert', 'Warning'], CAUTION: ['caution', 'octagon-alert', 'Caution'] };

  function pathStatus(p) {
    if (/^~\//.test(p)) return G.library.some((d) => d.path === p) ? 'ok' : 'missing';
    return G.fs.has(p.replace(/^\.\//, '')) ? 'ok' : 'missing';
  }
  const looksLikePath = (c) => /^[~.\w-]*\/[\w.\/-]+\.\w{1,6}$/.test(c) && !/^https?:/.test(c) && !/\s/.test(c);

  function inline(s, ctx) {
    const keep = [];
    const hold = (html) => '\u0000' + (keep.push(html) - 1) + '\u0000';
    s = s.replace(/(`+)(.+?)\1(?!`)/g, (m, t, c) => {
      const code = c.replace(/^ (.*) $/, '$1');
      if (ctx.checkPaths && looksLikePath(code)) {
        const st = pathStatus(code);
        return hold(`<code class="path ${st}" title="${st === 'ok' ? 'Exists' : 'Not found'} · resolved against ${esc(ctx.resolveAgainst || 'the collection root')}" data-path="${esc(code)}">${esc(code)}</code>`);
      }
      return hold(`<code>${esc(code)}</code>`);
    });
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (m, u) => hold(`<a href="${esc(u)}" rel="noreferrer">${esc(u)}</a>`));
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
      const b = url.match(/img\.shields\.io\/badge\/([^-]+)-(.+)-(\w+)$/);
      if (b) return hold(`<span class="badge" title="Rendered locally; no request to shields.io"><span>${esc(decodeURIComponent(b[1]))}</span><span data-c="${esc(b[3])}">${esc(decodeURIComponent(b[2]).replace(/--/g, '-'))}</span></span>`);
      return hold(`<span class="img-ph">${ic('image')}${esc(alt)}</span>`);
    });
    s = s.replace(/\[\^([^\]]+)\]/g, (m, id) => {
      const n = ctx.fnOrder.indexOf(id) >= 0 ? ctx.fnOrder.indexOf(id) + 1 : ctx.fnOrder.push(id);
      return hold(`<sup class="fnref"><a href="#fn-${esc(id)}" data-fn="${esc(id)}">${n}</a></sup>`);
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => hold(`<a href="${u}" data-href="${u}"${/^https?:/.test(u) ? ' rel="noreferrer"' : ''}>${t}</a>`));
    s = s.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*(?=\S)(.+?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^\w])_(?=\S)(.+?)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>').replace(/==(.+?)==/g, '<mark>$1</mark>');
    s = s.replace(/ {2,}\n|\\\n/g, '<br>');
    for (let i = 0; i < 3; i++) s = s.replace(/\u0000(\d+)\u0000/g, (m, n) => keep[n]);
    return s;
  }

  function splitRow(line) {
    const parts = []; let cur = '', code = false;
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('').forEach((ch, i, a) => {
      if (ch === '`') code = !code;
      if (ch === '|' && !code && a[i - 1] !== '\\') { parts.push(cur.trim()); cur = ''; } else cur += ch;
    });
    parts.push(cur.trim()); return parts;
  }

  function parseBlocks(lines, base, ctx) {
    const out = []; let i = 0; const n = lines.length;
    const attrs = (a, b) => ` data-line="${base + a + 1}" data-end="${base + b + 1}"`;
    const isStart = (l, next) => FENCE_RE.test(l) || /^#{1,6}\s/.test(l) || HR_RE.test(l) || /^\s*>/.test(l) || LIST_RE.test(l) || (/\|/.test(l) && next !== undefined && TABLE_SEP.test(next)) || /^\[\^[^\]]+\]:/.test(l);
    while (i < n) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = l.match(FENCE_RE))) {
        const mark = m[2]; const info = m[3].trim(); const start = i; const code = []; i++;
        while (i < n && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && !lines[i].trim().slice(mark.length).trim())) code.push(lines[i++]);
        const end = Math.min(i, n - 1); i++;
        const lang = (info.split(/\s+/)[0] || '').toLowerCase();
        const title = (info.match(/title="([^"]+)"/) || [])[1] || '';
        const src = code.join('\n');
        ctx.code.push({ lang, src, line: base + start + 1 });
        const langLabel = lang || 'text';
        out.push(`<div class="cb"${G.langId(lang) ? ` data-lang="${G.langId(lang)}"` : ''} data-fence="${esc(lang)}" data-code-index="${ctx.code.length - 1}"${attrs(start, end)}><div class="cb-head"><span class="lang">${esc(langLabel)}</span>${title ? `<span class="title">${esc(title)}</span>` : ''}</div>${ctx.bare ? '' : `<button class="cb-copy" data-cb="copy" title="Copy code" aria-label="Copy code">${ic('copy')}</button>`}<pre tabindex="0" aria-label="${esc(langLabel)} code">${G.hl(src, lang)}</pre></div>`);
        continue;
      }
      if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        const lv = m[1].length; const text = m[2]; let id = slug(text); while (ctx.ids[id]) id += '-1'; ctx.ids[id] = 1;
        ctx.headings.push({ level: lv, text: text.replace(/[`*_]/g, ''), id, line: base + i + 1 });
        out.push(`<h${lv} id="${id}"${attrs(i, i)}>${inline(text, ctx)}</h${lv}>`); i++; continue;
      }
      if (HR_RE.test(l)) { out.push(`<hr${attrs(i, i)}>`); i++; continue; }
      if (/\|/.test(l) && i + 1 < n && TABLE_SEP.test(lines[i + 1])) {
        const start = i; const head = splitRow(l); const al = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'c' : /-:$/.test(c) ? 'r' : '')); i += 2;
        const rows = []; while (i < n && /\|/.test(lines[i]) && lines[i].trim()) rows.push(splitRow(lines[i++]));
        // Right-align numeric columns even when the author forgot the colon (handbook ch. 7).
        const num = head.map((_, c) => rows.length && rows.every((r) => /^[-–\s]*$|^[~≈]?-?[\d.,:]+\s?(ms|s|MB|GB|%|k)?$/.test((r[c] || '').trim())) && rows.some((r) => /\d/.test(r[c] || '')));
        const cls = (c) => al[c] || (num[c] ? 'r' : '');
        ctx.tables.push({ head, rows, line: base + start + 1 });
        out.push(`<div class="tbl" data-table-index="${ctx.tables.length - 1}"${attrs(start, i - 1)}><table><thead><tr>${head.map((h, c) => `<th class="${cls(c)}">${inline(h, ctx)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, c) => `<td class="${cls(c)}">${inline(r[c] || '', ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*>/.test(l)) {
        const start = i; const inner = [];
        while (i < n && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ''));
        const a = inner[0].match(/^\[!(\w+)\]\s*(.*)$/);
        if (a && ADM[a[1].toUpperCase()]) {
          const [cls, icon, label] = ADM[a[1].toUpperCase()];
          const body = parseBlocks([a[2]].concat(inner.slice(1)).filter((x, k) => k > 0 || x), base + start + (a[2] ? 0 : 1), ctx);
          out.push(`<div class="adm ${cls}" role="note"${attrs(start, i - 1)}><div class="adm-h">${ic(icon)}${label}</div>${body}</div>`);
        } else out.push(`<blockquote${attrs(start, i - 1)}>${parseBlocks(inner, base + start, ctx)}</blockquote>`);
        continue;
      }
      if ((m = l.match(/^\[\^([^\]]+)\]:\s*(.*)$/))) { ctx.fnDefs[m[1]] = { html: inline(m[2], ctx), line: base + i + 1 }; i++; continue; }
      if ((m = l.match(LIST_RE))) {
        const start = i; const ind = m[1].length; const ordered = /\d/.test(m[2]); const items = [];
        while (i < n) {
          const li = lines[i];
          if (!li.trim()) {
            let j = i + 1; while (j < n && !lines[j].trim()) j++;
            if (j < n && ((lines[j].match(LIST_RE) || [])[1] || '').length >= ind && (LIST_RE.test(lines[j]) || /^\s+/.test(lines[j])) && (lines[j].match(/^\s*/)[0].length >= ind)) { if (items.length) items[items.length - 1].body.push(''); i = j; continue; }
            break;
          }
          const lm = li.match(LIST_RE); const lind = li.match(/^\s*/)[0].length;
          if (lm && lind === ind) { items.push({ line: i, first: lm[3], body: [] }); i++; continue; }
          if (lind > ind && items.length) { items[items.length - 1].body.push(li); i++; continue; }
          if (!lm && lind <= ind && items.length && !isStart(li, lines[i + 1]) && lines[i - 1] && lines[i - 1].trim()) { items[items.length - 1].first += '\n' + li.trim(); i++; continue; }
          break;
        }
        const tag = ordered ? 'ol' : 'ul';
        const startNum = ordered ? parseInt(m[2], 10) : 1;
        out.push(`<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ''}${attrs(start, i - 1)}>${items.map((it) => {
          const t = it.first.match(/^\[([ xX])\]\s+(.*)$/s);
          const minInd = Math.min(...it.body.filter((x) => x.trim()).map((x) => x.match(/^\s*/)[0].length), 99);
          const sub = it.body.length ? parseBlocks(it.body.map((x) => x.slice(Math.min(minInd, x.match(/^\s*/)[0].length))), base + it.line + 1, ctx) : '';
          if (t) { ctx.tasks.push({ done: t[1] !== ' ', text: t[2], line: base + it.line + 1 }); return `<li class="task${t[1] !== ' ' ? ' done' : ''}" data-line="${base + it.line + 1}"><input type="checkbox"${t[1] !== ' ' ? ' checked' : ''} aria-label="Done"><span>${inline(t[2], ctx)}${sub}</span></li>`; }
          return `<li data-line="${base + it.line + 1}">${inline(it.first, ctx)}${sub}</li>`;
        }).join('')}</${tag}>`);
        continue;
      }
      const start = i; const para = [];
      while (i < n && lines[i].trim() && !(i > start && isStart(lines[i], lines[i + 1]))) para.push(lines[i++]);
      out.push(`<p${attrs(start, i - 1)}>${inline(para.join('\n'), ctx)}</p>`);
    }
    return out.join('\n');
  }

  G.md = {
    render(src, opts = {}) {
      const ctx = { headings: [], tasks: [], code: [], tables: [], fnDefs: {}, fnOrder: [], ids: {}, bare: !!opts.bare, checkPaths: !!opts.checkPaths, resolveAgainst: opts.resolveAgainst };
      let lines = src.replace(/\r/g, '').split('\n'); let base = 0; const meta = {};
      if (lines[0] === '---') {
        const end = lines.indexOf('---', 1);
        if (end > 0) { lines.slice(1, end).forEach((l) => { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) meta[m[1]] = m[2].replace(/^\[|\]$/g, ''); }); base = end + 1; lines = lines.slice(end + 1); }
      }
      let html = parseBlocks(lines, base, ctx);
      const fnIds = ctx.fnOrder.filter((id) => ctx.fnDefs[id]);
      if (fnIds.length) html += `<section class="footnotes" aria-label="Notes" data-line="${ctx.fnDefs[fnIds[0]].line}"><hr><ol>${fnIds.map((id) => `<li id="fn-${esc(id)}" data-line="${ctx.fnDefs[id].line}">${ctx.fnDefs[id].html}</li>`).join('')}</ol></section>`;
      return { html, meta, headings: ctx.headings, tasks: ctx.tasks, code: ctx.code, tables: ctx.tables, footnotes: ctx.fnDefs, fmLines: base };
    }
  };

  /* ---------- Stats and kind detection ---------- */

  G.stats = (src) => {
    const body = src.replace(/^---\n[\s\S]*?\n---\n/, '');
    const words = (body.replace(/```[\s\S]*?```/g, '').match(/[\p{L}\p{N}'’-]+/gu) || []).length;
    const tasks = body.match(/^\s*[-*+]\s+\[[ xX]\]/gm) || [];
    return {
      words, chars: src.length, lines: src.split('\n').length,
      readMin: Math.max(1, Math.round(words / 230)),
      tasksTotal: tasks.length, tasksDone: tasks.filter((t) => /\[[xX]\]/.test(t)).length,
      codeBlocks: (body.match(/^```/gm) || []).length / 2 | 0,
      links: (body.match(/\]\(|<https?:/g) || []).length,
      headings: (body.match(/^#{1,6}\s/gm) || []).length
    };
  };

  G.detect = (doc) => {
    const r = [], p = doc.path || '', s = doc.src || '';
    const score = {};
    const add = (k, w, why) => { score[k] = (score[k] || 0) + w; r.push({ k, w, why }); };
    if (/\.(rs|ts|tsx|js|py|go|rb|java|c|cpp|swift|kt|sh|css|sql|toml)$/.test(p)) add('code', 10, 'source file extension');
    if (/\.(csv|tsv|json|ya?ml|jsonl)$/.test(p)) add('data', 10, 'data file extension');
    // Logs and terminal captures: by extension, then by what the lines look like.
    const head = s.split('\n').slice(0, 60);
    if (/\.(log|out)$/i.test(p)) add('log', 10, 'log file extension');
    if (head.filter((l) => LOG_RE.test(l)).length >= 3) add('log', 8, 'ISO timestamps followed by level words');
    if (/\.(term|session)$/i.test(p)) add('terminal', 10, 'terminal capture extension');
    if (/\.txt$/i.test(p) && head.filter((l) => PROMPT_RE.test(l) && /[$%]\s+\S/.test(l)).length >= 2) add('terminal', 9, 'shell prompt lines');
    { const fenced = (s.match(/^(```|~~~)(?:console|shellsession)[^\n]*\n[\s\S]*?^\1\s*$/gm) || []).join('\n'); const nonEmpty = s.split('\n').filter((l) => l.trim()).length; if (fenced && fenced.split('\n').filter((l) => l.trim()).length > 0.6 * nonEmpty) add('terminal', 8, 'console fences make up most of the text'); }
    if (/readme\.md$/i.test(p)) add('readme', 8, 'named README');
    if (/changelog\.md$/i.test(p)) add('changelog', 8, 'named CHANGELOG');
    if (/^##\s+(TL;DR|Summary|Next steps|Open questions|Risks|Verified|Not verified|Recommendation|State)\s*$/im.test(s)) add('report', 3, 'report-shaped headings');
    if (/^\s*[-*]\s+\[[ xX]\]/m.test(s)) add('report', 1, 'task checklist');
    if (/^##\s+(You|User|Assistant|Human|System)\s*$/m.test(s)) add('transcript', 9, 'speaker headings');
    if (/^#\s+Chapter\b/im.test(s) || /\/\d{2}-[\w-]+\.md$/.test(p) && /\n\n[^\n#>|-]{400,}/.test(s)) add('book', 7, 'chapter heading and long paragraphs');
    if (/^author:/m.test(s) && /^(published|source):/m.test(s)) add('article', 7, 'byline front matter');
    if (/^>\s?\[!(NOTE|TIP|CAUTION|WARNING)\]/m.test(s) && /^##\s+(Parameters|Returns|Errors|Example)/m.test(s)) add('docs', 8, 'API reference sections');
    if (/notes?\//i.test(p) || /\/\d{4}-\d{2}-\d{2}\.md$/.test(p)) add('notes', 6, 'dated note path');
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    if (!best) return { kind: 'article', conf: 0.4, reasons: ['no strong signals; prose default'] };
    const total = Object.values(score).reduce((a, b) => a + b, 0);
    return { kind: best[0], conf: Math.min(0.99, 0.55 + 0.45 * (best[1] / (total + 2))), reasons: r.filter((x) => x.k === best[0]).map((x) => x.why) };
  };

  /* ---------- Measure: the column holds a character count whatever the face (handbook ch. 3) ---------- */

  const SAMPLE = 'The quick brown fox jumps over the lazy dog, then reads a long paragraph of ordinary English text with commas, periods and the occasional number like 1,204.';
  const avgCache = {};
  G.measureDoc = (docEl) => {
    // Probe at the real size: optical-size axes (Literata, Source Serif) narrow the face at display sizes.
    const cs = getComputedStyle(docEl); const fam = cs.fontFamily; const w = cs.fontWeight; const px = parseFloat(cs.fontSize) || 16;
    const key = fam + w + px;
    const loaded = !document.fonts || document.fonts.status === 'loaded';
    if (!avgCache[key] || !loaded) {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:${fam};font-size:${px}px;font-weight:${w};font-kerning:normal;font-optical-sizing:auto`;
      probe.textContent = SAMPLE; document.body.appendChild(probe);
      const v = probe.getBoundingClientRect().width / SAMPLE.length / px; probe.remove();
      if (!loaded) { docEl.style.setProperty('--avg-char', v.toFixed(3)); return v; } // provisional until web fonts finish
      avgCache[key] = v;
    }
    docEl.style.setProperty('--avg-char', avgCache[key].toFixed(3));
    return avgCache[key];
  };
  G.measureAll = () => $$('.doc').forEach((d) => G.measureDoc(d));
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => { Object.keys(avgCache).forEach((k) => delete avgCache[k]); G.measureAll(); G.emit('measured'); });
  G.on('theme', () => setTimeout(() => { Object.keys(avgCache).forEach((k) => delete avgCache[k]); document.fonts.ready.then(G.measureAll); }, 30));
  // Live colophon: what the reader is actually getting.
  G.colophon = (docEl) => {
    // Average characters per full line of running prose, measured per character like the handbook's lab:
    // last lines and inline code are excluded so the number reflects the measure, not the paragraph.
    const ps = $$('p', docEl).filter((x) => x.offsetParent && !x.closest('.blk-handle, .sidenote, .tldr, .recap'));
    const pick = ps.filter((x) => !x.querySelector('code')).sort((x, y) => y.textContent.length - x.textContent.length)[0] || ps[0];
    const cs = getComputedStyle(docEl);
    let cpl = null;
    if (pick) {
      const lh = parseFloat(getComputedStyle(pick).lineHeight) || 1; const top0 = pick.getBoundingClientRect().top;
      const lines = new Map(); const w = document.createTreeWalker(pick, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('.blk-handle, .sidenote, sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const r = document.createRange(); let n;
      while ((n = w.nextNode())) for (let i = 0; i < n.data.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect(); if (!b.width && !b.height) continue; const k = Math.round((b.top - top0) / lh); lines.set(k, (lines.get(k) || 0) + 1); }
      const counts = Array.from(lines.entries()).sort((x, y) => x[0] - y[0]).map((e) => e[1]);
      const full = counts.length > 1 ? counts.slice(0, -1) : counts;
      if (full.length) cpl = Math.round(full.reduce((x, y) => x + y, 0) / full.length);
    }
    return { face: cs.fontFamily.split(',')[0].replace(/"/g, ''), size: parseFloat(cs.fontSize), leading: (parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2), cpl, avg: parseFloat(cs.getPropertyValue('--avg-char')) };
  };

  /* ---------- Document views ---------- */

  // Tool strips hold what changes the view or finds something. Copy and export live in Share (⌘C, ⇧⌘C, ⇧⌘E); the few copy tools that
  // belong to one kind (Copy commands only, Copy install, Copy section…) are listed in G.kindOverflow and shown only in the strip's … menu.
  G.kindTools = {
    report: [['verify', 'Paths', 'folder-check'], ['diff', 'Changes', 'git-compare'], ['split-h2', 'Split by H2', 'split']],
    article: [['focus', 'Focus', 'focus'], ['highlight', 'Highlight', 'highlighter'], ['notes-margin', 'Margin notes', 'panel-right'], ['speak', 'Read aloud', 'audio-lines']],
    book: [['paged', 'Paged', 'book-open'], ['contents', 'Contents', 'list-tree'], ['justify', 'Justify', 'align-justify'], ['bookmark', 'Bookmark', 'bookmark']],
    readme: [['outline', 'Outline', 'list-tree'], ['x-config', 'Config table', 'table'], ['open-repo', 'Open repo', 'external-link'], ['copy-install', 'Copy install command', 'terminal']],
    docs: [['on-page', 'On this page', 'list-tree'], ['examples', 'Examples only', 'square-code'], ['docset', 'Search docs set', 'search'], ['prev-next', 'Prev / next', 'arrow-left-right']],
    code: [['wrap', 'Wrap', 'wrap-text'], ['literate', 'Literate', 'book-text'], ['symbols', 'Symbols', 'braces'], ['goto-line', 'Go to line', 'arrow-right-to-line'], ['copy-fenced', 'Copy with path', 'copy']],
    transcript: [['collapse-tools', 'Collapse tools', 'chevrons-down-up'], ['only-prompts', 'Only you', 'user'], ['only-answers', 'Only assistant', 'message-square']],
    data: [['col-stats', 'Column stats', 'sigma'], ['filter', 'Filter', 'list-filter'], ['transpose', 'Transpose', 'rotate-ccw-square'], ['chart', 'Chart', 'chart-column']],
    notes: [['backlinks', 'Backlinks', 'link'], ['append-clip', 'Append clipboard', 'clipboard-paste'], ['daily', 'Daily', 'calendar']],
    changelog: [['versions', 'Versions', 'tag'], ['diff', 'Compare', 'git-compare']],
    log: [['level', 'Filter by level', 'list-filter'], ['wrap', 'Wrap', 'wrap-text'], ['first-error', 'Jump to first error', 'circle-alert'], ['tail', 'Follow tail', 'arrow-down-to-line']],
    terminal: [['wrap', 'Wrap', 'wrap-text'], ['copy-cmds', 'Copy commands only', 'terminal']]
  };
  // The only copy tools a kind keeps, and they sit in the strip's … menu, not as buttons.
  G.kindOverflow = new Set(['copy-install', 'copy-fenced', 'copy-cmds']);


  function sectionRange(src, line) {
    const lines = src.split('\n'); const h = (lines[line - 1] || '').match(/^(#{1,6})\s/);
    if (!h) return [line, line];
    let end = lines.length;
    for (let i = line; i < lines.length; i++) { const m = lines[i].match(/^(#{1,6})\s/); if (m && m[1].length <= h[1].length) { end = i; break; } }
    return [line, end];
  }
  G.sourceSlice = (src, a, b) => src.split('\n').slice(a - 1, b).join('\n');
  G.sectionOf = (src, line) => { const [a, b] = sectionRange(src, line); return G.sourceSlice(src, a, b).replace(/\n+$/, ''); };

  function renderCodeView(doc, opts) {
    const lines = doc.src.replace(/\n$/, '').split('\n');
    if (opts.literate) {
      // Docco-style: doc comments become prose beside the code they introduce.
      const groups = []; let cur = { prose: [], code: [], line: 1 };
      lines.forEach((l, i) => {
        const m = l.match(/^\s*\/\/[\/!]\s?(.*)$/);
        if (m) { if (cur.code.length) { groups.push(cur); cur = { prose: [], code: [], line: i + 1 }; } cur.prose.push(m[1]); }
        else { if (!cur.code.length && !cur.prose.length) cur.line = i + 1; cur.code.push(l); }
      });
      groups.push(cur);
      return `<div class="literate"${G.langId(doc.lang) ? ` data-lang="${G.langId(doc.lang)}"` : ''}>${groups.map((g) => `<div class="lit-row" data-line="${g.line}"><div class="lit-prose doc" data-kind="docs">${g.prose.length ? G.md.render(g.prose.join('\n'), { bare: true }).html : ''}</div><pre class="lit-code" tabindex="0">${G.hl(g.code.join('\n').replace(/^\n+|\n+$/g, ''), doc.lang)}</pre></div>`).join('')}</div>`;
    }
    const hl = G.hl(doc.src.replace(/\n$/, ''), doc.lang).split('\n');
    return `<div class="codeview${opts.wrap ? ' wrap' : ''}"${G.langId(doc.lang) ? ` data-lang="${G.langId(doc.lang)}"` : ''}><div class="cv-gutter" aria-hidden="true">${lines.map((_, i) => `<div>${i + 1}</div>`).join('')}</div><pre class="cv-code" tabindex="0" aria-label="${esc(doc.title)}">${hl.map((l, i) => `<span class="cv-line" data-line="${i + 1}">${l || ' '}</span>`).join('\n')}</pre></div>`;
  }

  // The ESC byte is shown as a visible glyph, never dropped or interpreted.
  const withEsc = (t) => esc(t).replace(/\u001b/g, '<span class="esc" title="ESC (0x1B): an ANSI escape, shown, not applied">\u241b</span>');
  const LV_RANK = { trace: 0, debug: 1, info: 2, notice: 2, warn: 3, warning: 3, error: 4, fatal: 5, critical: 5 };
  G.logLevels = [['all', 'All lines'], ['info', 'Info and above'], ['warn', 'Warnings and errors'], ['error', 'Errors only']];

  // A log, as written: timestamp muted, the level word in bold (weight, not hue), stack traces kept, line numbers hung in the margin.
  function renderLogView(doc, opts, res) {
    const lines = doc.src.replace(/\n$/, '').split('\n');
    const min = { all: 0, info: 2, warn: 3, error: 4 }[opts.level || 'all'] || 0;
    let lv = 'info', hidden = 0; const rows = [];
    const flush = () => { if (hidden) { rows.push(`<div class="lg-gap" aria-label="${hidden} lines hidden by the level filter">${hidden} line${hidden === 1 ? '' : 's'} hidden by the level filter</div>`); hidden = 0; } };
    lines.forEach((l, i) => {
      const m = l.match(LOG_RE); const n = i + 1;
      if (m) {
        lv = m[3].toLowerCase(); if (lv === 'warning') lv = 'warn'; if (lv === 'critical' || lv === 'notice') lv = lv === 'notice' ? 'info' : 'fatal';
        if ((LV_RANK[lv] || 0) >= 3) res.headings.push({ level: 2, text: m[3] + ' ' + m[5].slice(0, 90), id: 'ln-' + n, line: n });
      }
      if ((LV_RANK[lv] || 0) < min) { hidden++; return; }
      flush();
      rows.push(m
        ? `<div class="lg lv-${lv}" id="ln-${n}" data-line="${n}" data-lv="${lv}"><span class="ln">${n}</span><span class="ts">${esc(m[1])}</span>${esc(m[2])}<span class="lvl">${esc(m[3])}</span>${esc(m[4])}<span class="msg">${withEsc(m[5])}</span></div>`
        : `<div class="lg cont lv-${lv}" id="ln-${n}" data-line="${n}" data-lv="${lv}"><span class="ln">${n}</span><span class="msg">${withEsc(l) || ' '}</span></div>`);
    });
    flush();
    return `<div class="logview wide${opts.wrap ? ' wrap' : ''}" data-line="1" data-end="${lines.length}" role="log" aria-label="${esc(doc.title)}">${rows.join('')}</div>`;
  }
  // A shell session: prompt in the punctuation colour, the command strong, output as it came; a half line between each command and its output group.
  function renderTermView(doc, opts, res) {
    const lines = doc.src.replace(/\n$/, '').split('\n'); const groups = []; let g = null;
    lines.forEach((l, i) => {
      const m = l.match(PROMPT_RE);
      if (m) { g = { line: i + 1, prompt: m[1], gap: m[2] || '', cmd: m[3] || '', out: [] }; groups.push(g); if (g.cmd.trim()) res.headings.push({ level: 2, text: g.cmd.trim().slice(0, 90), id: 'ln-' + (i + 1), line: i + 1 }); }
      else { if (!g) { g = { line: i + 1, prompt: '', gap: '', cmd: '', out: [], pre: true }; groups.push(g); } g.out.push({ l, n: i + 1 }); }
    });
    const html = groups.map((x) => {
      return `<div class="tg" data-line="${x.line}" data-end="${x.pre ? x.line + x.out.length - 1 : x.line + x.out.length}">${x.prompt ? `<div class="tl cmd" id="ln-${x.line}" data-line="${x.line}"><span class="pr">${esc(x.prompt)}</span>${esc(x.gap)}<span class="cm">${withEsc(x.cmd)}</span></div>` : ''}${x.out.map((o) => `<div class="tl out" data-line="${o.n}">${withEsc(o.l) || ' '}</div>`).join('')}</div>`;
    }).join('');
    return `<div class="termview wide${opts.wrap ? ' wrap' : ''}" data-line="1" data-end="${lines.length}" aria-label="${esc(doc.title)}">${html}</div>`;
  }
  // The text of a terminal session by part: what was typed, or what came back.
  G.termParts = (src) => {
    const cmds = [], outs = [];
    src.replace(/\n$/, '').split('\n').forEach((l) => { const m = l.match(PROMPT_RE); if (m) { if ((m[3] || '').trim()) cmds.push(m[3].trim()); } else outs.push(l); });
    return { commands: cmds.join('\n'), output: outs.join('\n').replace(/^\n+|\n+$/g, '') };
  };

  function renderDataView(doc) {
    const rows = doc.src.trim().split('\n').map((l) => l.split(','));
    const head = rows[0], body = rows.slice(1);
    const num = head.map((_, c) => body.every((r) => /^-?[\d.]+$/.test(r[c])));
    const stats = head.map((_, c) => { if (!num[c]) return null; const v = body.map((r) => +r[c]); return { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length }; });
    return `<div class="dataview"><div class="tbl wide" data-line="1"><table><thead><tr><th class="rn">#</th>${head.map((h, c) => `<th class="${num[c] ? 'r' : ''}" data-col="${c}"><button class="th-sort">${esc(h)}${ic('arrow-up-down', 'ic-sm')}</button><div class="th-type">${num[c] ? 'number' : 'text'}</div></th>`).join('')}</tr></thead><tbody>${body.map((r, i) => `<tr data-line="${i + 2}"><td class="rn">${i + 1}</td>${head.map((_, c) => `<td class="${num[c] ? 'r' : 'mono'}">${num[c] ? fmt(+r[c]) : esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><td class="rn">Σ</td>${stats.map((s) => `<td class="r">${s ? `<span class="faint">min</span> ${fmt(s.min)}<br><span class="faint">max</span> ${fmt(s.max)}<br><span class="faint">mean</span> ${fmt(Math.round(s.mean))}` : ''}</td>`).join('')}</tr></tfoot></table></div></div>`;
  }

  // Wrap transcript turns and collapse tool calls.
  function decorateTranscript(root) {
    const kids = Array.from(root.children); let turn = null;
    kids.forEach((k) => {
      const role = k.tagName === 'H2' && /^(You|User|Assistant|Human|System)$/i.test(k.textContent.trim()) ? k.textContent.trim().toLowerCase().replace(/^(you|human)$/, 'user') : null;
      if (role) {
        turn = el(`<section class="turn ${role}" data-line="${k.dataset.line}"><div class="turn-who"><span>${role === 'you' || role === 'user' || role === 'human' ? 'You' : role === 'assistant' ? 'Assistant' : 'System'}</span></div><div class="turn-body"></div></section>`);
        k.replaceWith(turn); return;
      }
      if (turn) turn.querySelector('.turn-body').appendChild(k);
    });
    $$('.turn-body h3', root).forEach((h) => {
      const m = h.textContent.match(/^Tool\s*·\s*(\w+)/i); if (!m) return;
      const next = h.nextElementSibling;
      const lines = next && next.classList.contains('cb') ? next.querySelector('pre').textContent.split('\n').length : 0;
      const d = el(`<details class="toolcall" data-line="${h.dataset.line}"><summary>${ic('wrench')}<span>Tool · <b>${esc(m[1])}</b></span><span class="faint">${lines} line${lines === 1 ? '' : 's'}</span></summary></details>`);
      h.replaceWith(d); if (next && next.classList.contains('cb')) d.appendChild(next);
    });
  }

  // Render a document into a .doc element. Returns the parse result for outline/inspector use.
  G.renderDoc = (host, doc, opts = {}) => {
    const kind = opts.kind || doc.kind;
    host.dataset.kind = kind;
    host.classList.add('doc');
    // Per-type theme and type set (Themes › Per type); opt-in so side-by-side previews keep their own theme.
    if (opts.kindTheme) {
      const kt = (G.prefs.kindThemes || {})[kind], ks = (G.prefs.kindTypesets || {})[kind];
      if (kt && G.resolvedTheme().indexOf('hc-') !== 0) host.dataset.theme = kt; else delete host.dataset.theme;
      if (ks) host.dataset.typeset = ks; else delete host.dataset.typeset;
    }
    host.classList.toggle('justify', !!opts.justify);
    host.classList.toggle('focus-mode', !!opts.focus);
    let res = { headings: [], tasks: [], code: [], tables: [], meta: {} };
    let html = '';
    const coll = G.collections.find((c) => c.id === doc.collection) || {};
    if (G.langId(doc.lang) && kind === 'code') host.dataset.lang = G.langId(doc.lang); else delete host.dataset.lang;
    if (kind === 'code') html = renderCodeView(doc, opts);
    else if (kind === 'data') html = renderDataView(doc);
    else if (kind === 'log') html = renderLogView(doc, opts, res);
    else if (kind === 'terminal') html = renderTermView(doc, opts, res);
    else {
      res = G.md.render(doc.src, { checkPaths: opts.checkPaths !== false && G.prefs.checkPaths && kind === 'report', resolveAgainst: coll.resolveAgainst || coll.path });
      html = res.html;
    }
    const st = G.stats(doc.src);
    let pre = '';
    if (kind === 'article' && res.meta.author) pre += `<div class="byline"><span>${esc(res.meta.author)}</span><span>${esc(res.meta.published || '')}</span><span>${st.readMin} min read</span>${res.meta.source ? `<a href="${esc(res.meta.source)}" rel="noreferrer">${ic('external-link')}${esc(res.meta.source.replace(/^https?:\/\//, '').split('/')[0])}</a>` : ''}</div>`;
    if (kind === 'book' && doc.book) pre += `<div class="book-run"><span>${esc(doc.book.title)}</span><span>Chapter ${doc.book.chapter} of ${doc.book.chapters}</span></div>`;
    host.innerHTML = pre + html;
    if (kind === 'transcript') decorateTranscript(host);
    if (kind === 'article') { const first = $('h1 + p', host); if (first && /^<em>[\s\S]*<\/em>$/.test(first.innerHTML.trim())) first.classList.add('dek'); }
    if (kind === 'readme') { const b = $$('p', host).find((p) => p.querySelector('.badge') && !p.textContent.replace(/\s/g, '').replace(/[\w.-]/g, '').length > 20); if (b) b.classList.add('badges'); }
    if (kind === 'docs') { const sig = $('h1 ~ .cb', host); if (sig && sig.previousElementSibling && sig.previousElementSibling.tagName === 'P') sig.classList.add('signature'); }
    decorate(host, doc, res, opts);
    G.icons(host);
    G.applyReadingPrefs(host, kind, opts);
    return Object.assign(res, { stats: st, kind });
  };

  // Reader settings and per-type overrides (Settings › Reading, › Content types), with the spec's coupling rules.
  G.applyReadingPrefs = (host, kind, opts = {}) => {
    const P = G.prefs, o = (P.kindOverrides || {})[kind] || {};
    const set = (v) => v != null && v !== '' && v !== 'auto';
    // Only clear what this function set last time, so a page's own inline styles survive.
    (host.dataset.rp || '').split(' ').filter(Boolean).forEach((k) => host.style.removeProperty(k));
    const mine = [];
    const st = { setProperty: (k, v) => { host.style.setProperty(k, v); mine.push(k); } };
    ['fontSize', 'fontWeight', 'letterSpacing', 'wordSpacing'].forEach((js) => {
      const css = js.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      Object.defineProperty(st, js, { set: (v) => st.setProperty(css, v) });
    });
    const done = () => { host.dataset.rp = mine.join(' '); };
    if (set(o.face)) st.setProperty('--k-face', `var(--face-${o.face})`);
    if (set(o.size)) st.fontSize = `calc(var(--k-size) * var(--user-scale) * ${+o.size / 100})`;
    const adj = (P.weightAdjust || 0) + (/ink|dusk|night|fjord|hc-dark/.test(G.resolvedTheme()) && P.darkLighter === false ? 20 : 0);
    if (adj) st.fontWeight = `calc(var(--text-wght) + ${adj})`;
    host.classList.toggle('ul-off', P.underlineLinks === false);
    // Rule 6: code and data take size and face only.
    if (kind === 'code' || kind === 'data' || kind === 'log' || kind === 'terminal') { done(); G.measureDoc(host); return; }
    if (set(o.measure)) st.setProperty('--k-measure', o.measure); else if (set(P.measure)) st.setProperty('--k-measure', P.measure);
    if (set(o.leading)) st.setProperty('--k-leading', o.leading); else if (set(P.leading)) st.setProperty('--k-leading', P.leading);
    const para = set(o.para) ? o.para : P.paraStyle;
    if (para === 'indent') { st.setProperty('--k-indent', P.paraIndent + 'em'); st.setProperty('--k-para-space', '0'); }
    else if (para === 'space') { st.setProperty('--k-indent', '0'); st.setProperty('--k-para-space', P.paraSpace + 'em'); }
    if (P.hyphenate === false) st.setProperty('--k-hyphens', 'manual');
    // Rule 3: word spacing rises with letter spacing.
    const L = +P.letterSpacing || 0, W = (+P.wordSpacing || 0) + L;
    if (L) st.letterSpacing = L + 'em';
    if (W) st.wordSpacing = W + 'em';
    done();
    const avg = G.measureDoc(host);
    // Rule 1: spacing widens every character, so widen the column with it and the character count holds.
    if (L || W) st.setProperty('--avg-char', (avg + L + W / 6).toFixed(3));
    // Rule 2: justify only where the column holds 45 characters or more.
    const want = opts.justify !== undefined ? !!opts.justify : o.align === 'justify' || P.justify === 'on';
    // Gate on the measured count of the justified text itself; a width estimate runs a few characters optimistic.
    if (want) { host.classList.add('justify'); const c = G.colophon(host); if (c.cpl && c.cpl < 45) host.classList.remove('justify'); }
  };
  G.on('pref', ({ key }) => {
    if (/^(measure|leading|paraStyle|paraIndent|paraSpace|hyphenate|letterSpacing|wordSpacing|weightAdjust|darkLighter|underlineLinks|justify|kindOverrides|kindThemes|kindTypesets)$/.test(key)) G.emit('reading-prefs');
  });

  // Copying in the reading view is by keys (⌘C, ⇧⌘C), the selection toolbar, right-click, and one hover button on code blocks.
  function decorate(host, doc, res, opts) {
    host._ctx = { doc, res };
    if (!host._bound) { host._bound = true; bindHost(host); }
    $$('[data-fn]', host).forEach((a) => a.addEventListener('mouseenter', () => G.prefs.footnotes === 'popover' && showFootnote(a, host._ctx.res.footnotes[a.dataset.fn])));
  }
  const codeMenu = (anchor, info, cb, doc) => G.menu(anchor, [
    { header: info.lang ? info.lang + ' block' : 'Code block' },
    { label: 'Copy code', icon: 'copy', kbd: '⌘C', run: () => G.copy(info.src, { as: 'Code', lang: info.lang, clean: false }) },
    { label: 'Copy without prompts ($ / >)', icon: 'terminal', run: () => G.copy(info.src.replace(/^\s*[$>] /gm, ''), { as: 'Code', clean: false }) },
    { label: 'Copy as one line', icon: 'between-horizontal-start', run: () => G.copy(info.src.replace(/\\\n\s*/g, ' '), { as: 'Code', clean: false }) },
    { label: 'Copy fenced, with source path', icon: 'square-code', run: () => G.copy(`<!-- ${doc.path}:${info.line} -->\n\`\`\`${info.lang}\n${info.src}\n\`\`\``, { as: 'Markdown' }) },
    { sep: true },
    { label: 'Wrap lines', icon: 'wrap-text', checked: cb.classList.contains('wrap'), run: () => cb.classList.toggle('wrap') },
    { label: 'Save as file…', icon: 'save', run: () => G.toast(`Save panel: ${info.lang === 'bash' ? 'script.sh' : info.lang === 'sql' ? 'query.sql' : 'snippet.' + (info.lang || 'txt')}`, { icon: 'save' }) },
    { label: 'Open in scratch editor', icon: 'square-pen', run: () => G.toast('Opened as an untitled scratch buffer', { icon: 'square-pen' }) },
    { label: 'Send to Terminal (paste, not run)', icon: 'square-terminal', run: () => G.toast('Pasted into Terminal; nothing executed', { icon: 'square-terminal' }) }
  ], { width: 260 });
  // The verb menu: what you can do with a selection (right-click, or Enter). Extract lives here and in the palette, not on a key or a button.
  G.verbMenu = (at, text, doc, o = {}) => G.menu(at, [
    { label: 'Copy', icon: 'copy', kbd: '⌘C', run: () => G.copy(text, { as: 'Markdown', line: o.line }) },
    { label: 'Copy as', icon: 'clipboard-copy', kbd: '⇧⌘C', sub: G.copyFormats.filter((f) => ['markdown', 'plain', 'rich', 'html', 'codeblock'].includes(f.id)).map((f) => ({ label: f.name, icon: f.icon, desc: f.desc, run: () => G.copyAs(f.id, text) })) },
    { label: 'Transform…', icon: 'wand-sparkles', kbd: '⌘/', run: () => G.palette.open('>Transform: ') },
    { label: 'Extract', icon: 'scissors', sub: G.extractItems(text) }
  ].concat(o.extra || []), { width: 240 });
  function bindHost(host) {
    host.addEventListener('click', (e) => {
      const { doc, res } = host._ctx;
      const cbb = e.target.closest('[data-cb]');
      if (cbb) { const cb = cbb.closest('.cb'); const info = res.code[+cb.dataset.codeIndex]; G.copy(info.src, { as: 'Code', lang: info.lang, line: info.line, clean: false }); return; }
      const fn = e.target.closest('[data-fn]');
      if (fn) { e.preventDefault(); showFootnote(fn, res.footnotes[fn.dataset.fn]); return; }
      // A link in a document never leaves the page: a file opens through G.openDoc, a web address in the browser, an anchor scrolls.
      const lk = e.target.closest('a[href]');
      if (lk && host.contains(lk)) {
        e.preventDefault(); const href = lk.getAttribute('href') || '';
        if (href.startsWith('#')) { const t = document.getElementById(decodeURIComponent(href.slice(1))); t && t.scrollIntoView({ block: 'start' }); return; }
        if (/^https?:/i.test(href)) { window.open(href, '_blank', 'noopener'); G.toast(`Opened ${esc(href.replace(/^https?:\/\//, '').split('/')[0])} in your browser`, { icon: 'external-link', quiet: true }); return; }
        const id = G.resolveLink(href, doc);
        if (id && G.openDoc) G.openDoc(id); else G.toast(`${esc(href)} is not in the library`, { icon: 'info', quiet: true });
        return;
      }
      const th = e.target.closest('.th-sort');
      if (th) { sortTable(th); return; }
      const pc = e.target.closest('code.path');
      if (pc) G.menu(pc, [{ header: pc.dataset.path }, { label: 'Open', icon: 'file', run: () => G.toast('Opened in a new tab', { icon: 'file' }) }, { label: 'Copy path', icon: 'copy', run: () => G.copy(pc.dataset.path, { as: 'path' }) }, { label: 'Reveal in Finder', icon: 'folder-open', run: () => G.toast('Revealed in Finder', { icon: 'folder-open' }) }, { label: 'Open in editor', icon: 'square-code', run: () => G.toast('Opened in your editor (Settings › Integrations)', { icon: 'square-code' }) }, { sep: true }, { label: 'Change path base…', icon: 'folder-cog', run: () => (location.href = G.page('collections')) }]);
      if (e.altKey) { const b = e.target.closest('[data-line]'); if (b) G.emit('reveal-line', +b.dataset.line); }
    });
    // Right-click a block: copy it (as Markdown, or as a format), its section, a link to it; or reveal it in the source.
    host.addEventListener('contextmenu', (e) => {
      const { doc, res } = host._ctx;
      if (e.target.closest('a, input, textarea')) return;
      const at = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
      if (window.getSelection().toString()) { const sr = G.renderSelection ? G.renderSelection() : null; e.preventDefault(); return G.verbMenu(at, (sr && sr.md) || window.getSelection().toString(), doc, { line: sr && sr.lines && sr.lines[0] }); }
      const cb = e.target.closest('.cb');
      if (cb) { e.preventDefault(); return codeMenu(at, res.code[+cb.dataset.codeIndex], cb, doc); }
      const blk = topBlock(e.target); if (!blk || !blk.dataset.line) return;
      e.preventDefault();
      const a = +blk.dataset.line, z = +(blk.dataset.end || a); const text = () => G.sourceSlice(doc.src, a, z); const isH = /^H[1-6]$/.test(blk.tagName);
      G.menu(at, [
        { label: 'Copy', icon: 'copy', kbd: '⌘C', run: () => G.copy(text(), { as: 'Markdown', line: a }) },
        { label: 'Copy as', icon: 'clipboard-copy', kbd: '⇧⌘C', sub: G.copyFormats.filter((f) => ['markdown', 'plain', 'rich', 'html', 'codeblock'].includes(f.id)).map((f) => ({ label: f.name, icon: f.icon, desc: f.desc, run: () => G.copyAs(f.id, text()) })) },
        { label: 'Transform…', icon: 'wand-sparkles', kbd: '⌘/', run: () => G.palette.open('>Transform: ') },
        { label: 'Extract', icon: 'scissors', sub: G.extractItems(text()) }
      ].concat(isH ? [{ label: 'Copy section', icon: 'copy', run: () => G.copy(G.sectionOf(doc.src, a), { as: 'Markdown section', line: a }) }, { label: 'Copy link to heading', icon: 'link', run: () => G.copy(`${doc.path}#${blk.id}`, { as: 'link' }) }] : [])
        .concat([{ sep: true }, { label: 'Reveal in source', icon: 'square-code', kbd: '⌥click', run: () => G.emit('reveal-line', a) }]), { width: 240 });
    });
    host.addEventListener('change', (e) => {
      if (e.target.matches('li.task > input')) {
        const li = e.target.closest('li'); li.classList.toggle('done', e.target.checked);
        G.emit('task-toggle', { line: +li.dataset.line, done: e.target.checked });
      }
    });
  }

  function showFootnote(a, def) {
    $$('.fn-pop').forEach((x) => x.remove()); if (!def) return;
    const p = el(`<div class="fn-pop" role="tooltip">${def.html}</div>`); document.body.appendChild(p);
    const r = a.getBoundingClientRect(); p.style.left = Math.min(innerWidth - p.offsetWidth - 12, Math.max(12, r.left - 40)) + 'px'; p.style.top = (r.bottom + 8) + 'px';
    const off = (e) => { if (!p.contains(e.target) && e.target !== a) { p.remove(); document.removeEventListener('mousemove', off); } };
    setTimeout(() => document.addEventListener('mousemove', off), 200);
  }
  function sortTable(btn) {
    const th = btn.closest('th'); const table = th.closest('table'); const c = +th.dataset.col + 1;
    const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc'; $$('th', table).forEach((x) => delete x.dataset.dir); th.dataset.dir = dir;
    const rows = $$('tbody tr', table); const num = th.classList.contains('r');
    rows.sort((a, b) => { const x = a.children[c].textContent.replace(/,/g, ''), y = b.children[c].textContent.replace(/,/g, ''); const r = num ? x - y : x.localeCompare(y); return dir === 'asc' ? r : -r; });
    rows.forEach((r) => table.tBodies[0].appendChild(r));
  }

  /* ---------- Selection toolbar over rendered text ---------- */

  G.selectionText = () => (G.editor && G.editor.hasSelection && G.editor.hasSelection() ? G.editor.getSelection() : (G.renderSelection ? G.renderSelection().md : ''));
  G.attachSelectionToolbar = (host, getDoc) => {
    let bar = null;
    const kill = () => { if (bar) { bar.remove(); bar = null; } };
    G.renderSelection = () => {
      const sel = window.getSelection(); if (!sel.rangeCount || sel.isCollapsed) return { text: '', md: '' };
      const r = sel.getRangeAt(0); if (!host.contains(r.commonAncestorContainer)) return { text: '', md: '' };
      const a = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('[data-line]');
      const b = (r.endContainer.nodeType === 1 ? r.endContainer : r.endContainer.parentElement).closest('[data-line]');
      const text = sel.toString();
      // A selection that spans blocks copies as the blocks' Markdown source; inside one block, as typed text.
      if (a && b && a !== b) return { text, md: G.sourceSlice(getDoc().src, +a.dataset.line, +(b.dataset.end || b.dataset.line)), lines: [+a.dataset.line, +(b.dataset.end || b.dataset.line)] };
      return { text, md: text, lines: a ? [+a.dataset.line, +a.dataset.line] : null };
    };
    host.addEventListener('mouseup', () => setTimeout(() => {
      kill(); if (!G.prefs.selectionToolbar) return;
      const s = G.renderSelection(); if (!s.text.trim()) return;
      const rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
      bar = el(`<div class="seltb" role="toolbar" aria-label="Selection">
        <button data-s="copy" title="Copy as Markdown (⌘C)">${ic('copy')}Copy</button>
        <button data-s="copyas" title="Copy as… (⇧⌘C)" aria-label="Copy as" style="padding:0 5px">${ic('chevron-down')}</button>
        <span class="sep"></span>
        <button data-s="mark" title="Highlight">${ic('highlighter')}</button>
        <button data-s="xf" title="Transform (⌘/)">${ic('wand-sparkles')}${ic('chevron-down')}</button>
        <span class="faint" style="padding:0 6px;font-size:11px">${esc(G.measure(s.text, { kind: (G.current && G.current.kind) || undefined, keys: G.measureKeys(G.current && G.current.kind).slice(0, 2) }))}</span>
      </div>`);
      document.body.appendChild(bar); G.icons(bar);
      bar.style.left = Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, rect.left + rect.width / 2 - bar.offsetWidth / 2)) + 'px';
      bar.style.top = (rect.top > 60 ? rect.top - bar.offsetHeight - 8 : rect.bottom + 8) + 'px';
      bar.addEventListener('mousedown', (e) => e.preventDefault());
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-s]'); if (!b) return; const cur = G.renderSelection(); const d = getDoc();
        const act = b.dataset.s;
        if (act === 'copy') G.copy(cur.md, { as: 'Markdown', line: cur.lines && cur.lines[0] });
        else if (act === 'copyas') return G.copyMenu(b, () => cur.md, { header: 'Copy selection as' });
        else if (act === 'mark') { try { const r = window.getSelection().getRangeAt(0); const m = document.createElement('mark'); r.surroundContents(m); G.toast('Highlighted · saved as an annotation, the file is not modified', { icon: 'highlighter' }); } catch (err) { G.toast('Highlights span one block at a time', { icon: 'info' }); } }
        else if (act === 'xf') { kill(); return G.palette.open('>Transform: '); }
        kill();
      });
    }, 10));
    document.addEventListener('mousedown', (e) => { if (bar && !bar.contains(e.target)) kill(); });
    // Enter on a selection in the reading view opens the verb menu at the selection.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || G.menuOpen() || G.palette.el) return;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
      const s = G.renderSelection(); if (!s.text.trim()) return;
      e.preventDefault(); kill(); const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      G.verbMenu({ left: r.left, right: r.left, top: r.bottom, bottom: r.bottom }, s.md, getDoc(), { line: s.lines && s.lines[0] });
    });
    host.addEventListener('scroll', kill, { passive: true });
  };

  /* ---------- Copy scope: selection, else the block under the pointer, else the document ---------- */

  const topBlock = (n) => {
    n = n && n.closest ? n.closest('.doc [data-line]') : null;
    while (n && !(n.parentElement.classList.contains('doc') || n.parentElement.classList.contains('turn-body'))) n = n.parentElement.closest('[data-line]');
    return n && !n.classList.contains('footnotes') ? n : null;
  };
  G.hoveredBlock = () => topBlock(G.pointer && G.pointer.target);
  G.copyScope = (only) => {
    const doc = G.current ? G.current.src : '';
    const ed = G.editor; const inEd = ed && document.activeElement === ed.ta;
    if (!only || only === 'selection') {
      if (ed && ed.hasSelection && ed.hasSelection()) return { text: ed.getSelection(), label: 'selection', lines: ed.selectionLines() };
      const rs = G.renderSelection && G.renderSelection(); if (rs && rs.text.trim()) return { text: rs.md, label: 'selection', lines: rs.lines };
    }
    if ((!only || only === 'block') && !inEd) {
      const b = G.hoveredBlock();
      if (b) return { text: G.sourceSlice(doc, +b.dataset.line, +(b.dataset.end || b.dataset.line)), label: 'block', lines: [+b.dataset.line, +(b.dataset.end || b.dataset.line)] };
    }
    return { text: doc, label: 'document', lines: null };
  };
  // ⌘C with nothing selected, a toolbar Copy: Markdown of the scope.
  G.copyScoped = (only) => { const sc = G.copyScope(only); G.copy(sc.text, { as: 'Markdown', line: sc.lines && sc.lines[0] }); return sc; };
  // ⇧⌘C and the "Copy as" buttons: the format menu for the scope, at the anchor or where the pointer is.
  G.copyAsScoped = (anchor) => {
    const sc = G.copyScope(); const at = anchor || { left: G.pointer.x, right: G.pointer.x, top: G.pointer.y, bottom: G.pointer.y };
    return G.copyMenu(at, () => sc.text, { header: 'Copy ' + sc.label + ' as' });
  };

  /* ---------- Source editor ---------- */

  G.lint = (src) => {
    const out = []; const lines = src.split('\n'); let lastH = 0, inFence = false;
    lines.forEach((l, i) => {
      if (/^(```|~~~)/.test(l)) inFence = !inFence;
      if (inFence) return;
      const h = l.match(/^(#{1,6})\s/);
      if (h) { if (lastH && h[1].length > lastH + 1) out.push({ line: i + 1, sev: 'warn', msg: `Heading jumps from H${lastH} to H${h[1].length}` }); lastH = h[1].length; }
      if (/[ \t]+$/.test(l) && !/ {2}$/.test(l)) out.push({ line: i + 1, sev: 'info', msg: 'Trailing whitespace' });
      if (/\p{Extended_Pictographic}/u.test(l)) out.push({ line: i + 1, sev: 'info', msg: 'Emoji in prose' });
      const p = l.match(/`([~.\w-]*\/[\w.\/-]+\.\w{1,6})`/g);
      if (p) p.forEach((x) => { const path = x.replace(/`/g, ''); if (!/^~/.test(path) && !G.fs.has(path)) out.push({ line: i + 1, sev: 'warn', msg: `Path not found: ${path}` }); });
    });
    if (inFence) out.push({ line: lines.length, sev: 'error', msg: 'Unclosed code fence' });
    return out;
  };

  /* ---------- Bytes: what the file holds, and where ----------
     Everything the Source frame shows is read from the text itself: line numbers, columns, byte offsets, code points,
     encoding, line endings, indentation. Nothing is interpreted. */

  const INV_SRC = '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00A0\\u00AD\\u061C\\u1680\\u180E\\u2000-\\u200F\\u2028-\\u202F\\u205F-\\u206F\\u3000\\uFEFF\\uFFF9-\\uFFFB]';
  const INV_G = new RegExp(INV_SRC, 'g');
  const C0 = ['NULL', 'START OF HEADING', 'START OF TEXT', 'END OF TEXT', 'END OF TRANSMISSION', 'ENQUIRY', 'ACKNOWLEDGE', 'BELL', 'BACKSPACE', 'CHARACTER TABULATION', 'LINE FEED', 'LINE TABULATION', 'FORM FEED', 'CARRIAGE RETURN', 'SHIFT OUT', 'SHIFT IN', 'DATA LINK ESCAPE', 'DEVICE CONTROL ONE', 'DEVICE CONTROL TWO', 'DEVICE CONTROL THREE', 'DEVICE CONTROL FOUR', 'NEGATIVE ACKNOWLEDGE', 'SYNCHRONOUS IDLE', 'END OF TRANSMISSION BLOCK', 'CANCEL', 'END OF MEDIUM', 'SUBSTITUTE', 'ESCAPE', 'INFORMATION SEPARATOR FOUR', 'INFORMATION SEPARATOR THREE', 'INFORMATION SEPARATOR TWO', 'INFORMATION SEPARATOR ONE', 'SPACE'];
  const CP_NAME = { 0x7f: 'DELETE', 0xa0: 'NO-BREAK SPACE', 0xad: 'SOFT HYPHEN', 0x61c: 'ARABIC LETTER MARK', 0x1680: 'OGHAM SPACE MARK', 0x180e: 'MONGOLIAN VOWEL SEPARATOR', 0x200b: 'ZERO WIDTH SPACE', 0x200c: 'ZERO WIDTH NON-JOINER', 0x200d: 'ZERO WIDTH JOINER', 0x200e: 'LEFT-TO-RIGHT MARK', 0x200f: 'RIGHT-TO-LEFT MARK', 0x2028: 'LINE SEPARATOR', 0x2029: 'PARAGRAPH SEPARATOR', 0x202a: 'LEFT-TO-RIGHT EMBEDDING', 0x202b: 'RIGHT-TO-LEFT EMBEDDING', 0x202c: 'POP DIRECTIONAL FORMATTING', 0x202d: 'LEFT-TO-RIGHT OVERRIDE', 0x202e: 'RIGHT-TO-LEFT OVERRIDE', 0x202f: 'NARROW NO-BREAK SPACE', 0x205f: 'MEDIUM MATHEMATICAL SPACE', 0x2060: 'WORD JOINER', 0x2061: 'FUNCTION APPLICATION', 0x2062: 'INVISIBLE TIMES', 0x2063: 'INVISIBLE SEPARATOR', 0x2064: 'INVISIBLE PLUS', 0x2066: 'LEFT-TO-RIGHT ISOLATE', 0x2067: 'RIGHT-TO-LEFT ISOLATE', 0x2068: 'FIRST STRONG ISOLATE', 0x2069: 'POP DIRECTIONAL ISOLATE', 0x3000: 'IDEOGRAPHIC SPACE', 0xfeff: 'ZERO WIDTH NO-BREAK SPACE', 0xfff9: 'INTERLINEAR ANNOTATION ANCHOR', 0xfffa: 'INTERLINEAR ANNOTATION SEPARATOR', 0xfffb: 'INTERLINEAR ANNOTATION TERMINATOR' };
  ['EN QUAD', 'EM QUAD', 'EN SPACE', 'EM SPACE', 'THREE-PER-EM SPACE', 'FOUR-PER-EM SPACE', 'SIX-PER-EM SPACE', 'FIGURE SPACE', 'PUNCTUATION SPACE', 'THIN SPACE', 'HAIR SPACE'].forEach((n, i) => { CP_NAME[0x2000 + i] = n; });
  const cpHex = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  const cpName = (cp) => (cp <= 0x20 ? C0[cp] : CP_NAME[cp] || (cp >= 0x80 && cp <= 0x9f ? 'CONTROL' : null));
  // "U+00E9 é", or the name for control and invisible characters: "U+200B ZERO WIDTH SPACE".
  G.cpLabel = (ch) => { const cp = ch.codePointAt(0); const n = cpName(cp); return cpHex(cp) + ' ' + (n || ch); };
  G.cpHex = cpHex; G.cpName = cpName;
  const utf8 = (s) => new TextEncoder().encode(s).length;
  // Line endings of a raw string: the list of breaks (one per line but the last) and what the file is.
  const breaksOf = (raw) => { const out = []; raw.replace(/\r\n|\n|\r/g, (m) => { out.push(m); return m; }); return out; };
  const eolSummary = (breaks) => {
    const n = { lf: 0, crlf: 0, cr: 0 }; breaks.forEach((b) => { n[b === '\n' ? 'lf' : b === '\r\n' ? 'crlf' : 'cr']++; });
    const kinds = Object.keys(n).filter((k) => n[k]); const dom = kinds.sort((a, b) => n[b] - n[a])[0] || 'lf';
    const label = !kinds.length ? 'LF' : kinds.length > 1 ? 'Mixed' : { lf: 'LF', crlf: 'CRLF', cr: 'CR' }[dom];
    return { n, dom, mixed: kinds.length > 1, label, domBreak: { lf: '\n', crlf: '\r\n', cr: '\r' }[dom] };
  };
  // Indentation as written: tabs, or the most common step between indented lines.
  const indentOf = (text) => {
    let tabs = 0, spaces = 0, prev = 0; const hist = {};
    text.split('\n').forEach((l) => {
      if (!l.trim()) return; const m = l.match(/^[ \t]*/)[0];
      if (m.includes('\t')) { tabs++; prev = 0; return; }
      if (m.length) spaces++; const d = m.length - prev; if (d > 0) hist[d] = (hist[d] || 0) + 1; prev = m.length;
    });
    if (!tabs && !spaces) return { label: 'no indentation', tabs, spaces };
    if (tabs && spaces && Math.min(tabs, spaces) >= 0.2 * Math.max(tabs, spaces)) return { label: 'mixed indentation', tabs, spaces };
    if (tabs > spaces) return { label: 'tabs', tabs, spaces };
    const step = Object.keys(hist).sort((a, b) => hist[b] - hist[a])[0] || 2;
    return { label: step + ' spaces', tabs, spaces };
  };
  G.srcInfo = (raw) => {
    const breaks = breaksOf(raw); const text = raw.replace(/\r\n?/g, '\n'); const eol = eolSummary(breaks);
    const endsNl = text.endsWith('\n');
    return { text, breaks, eol, indent: indentOf(text), bytes: utf8(raw), endsNl, lines: raw ? text.split('\n').length - (endsNl ? 1 : 0) : 0, bom: raw.charCodeAt(0) === 0xfeff, enc: raw.charCodeAt(0) === 0xfeff ? 'UTF-8 with BOM' : 'UTF-8' };
  };
  G.scanInvisible = (text) => { const out = []; text.split('\n').forEach((l, i) => { let m; INV_G.lastIndex = 0; while ((m = INV_G.exec(l))) out.push({ line: i + 1, col: m.index + 1, cp: m[0].codePointAt(0), at: m.index }); }); return out; };
  const LANG_LABEL = { markdown: 'Markdown', csv: 'CSV', log: 'Log', term: 'Terminal', text: 'Plain text', rust: 'Rust', typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python', shell: 'Shell', toml: 'TOML', yaml: 'YAML', json: 'JSON', css: 'CSS', html: 'HTML', sql: 'SQL', go: 'Go', swift: 'Swift', c: 'C', cpp: 'C++', java: 'Java', ruby: 'Ruby' };
  G.langLabel = (l) => LANG_LABEL[l] || (l ? l[0].toUpperCase() + l.slice(1) : 'Plain text');
  const lineDiff = (a, b) => {
    const A = a.split('\n'), B = b.split('\n'); const n = A.length, m = B.length; if (n * m > 4e6) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['-', j + 1]); i++; } else { out.push(['+', j + 1]); j++; } }
    while (i < n) { out.push(['-', m]); i++; } while (j < m) { out.push(['+', j + 1]); j++; }
    return out;
  };

  /* ---------- The Source frame ----------
     A framed text editor: a top bar (path; encoding, line endings, indentation, size, lines; copy), a column ruler on the
     character grid, a gutter of line numbers, the text, a right strip of marks at exact bytes, and a bottom bar
     (position, byte offset, selection, the character under the caret, language). One textarea over a highlighted layer. */

  G.Editor = function (host, opts = {}) {
    const lang = opts.lang || 'markdown';
    const ed = el(`<div class="ed${opts.wrap ? ' wrap' : ''}" role="group" aria-label="Source">
      <div class="ed-top"><div class="ed-path"></div><div class="ed-meta"></div></div>
      <div class="ed-body">
        <div class="ed-scroll"><div class="ed-inner">
          <div class="ed-corner"></div><div class="ed-ruler" aria-hidden="true"><div class="rsel"></div><div class="rcar"></div><div class="rticks"></div></div>
          <div class="ed-gutter" aria-hidden="true"></div>
          <div class="ed-code"><div class="ed-deco" aria-hidden="true"></div><i class="ed-guide" aria-hidden="true"></i><pre class="ed-hl" aria-hidden="true"></pre><textarea class="ed-ta" spellcheck="false" wrap="${opts.wrap ? 'soft' : 'off'}" aria-label="Source text" autocapitalize="off" autocomplete="off"></textarea></div>
        </div></div>
        <div class="ed-strip" aria-label="Marks at exact bytes"></div>
      </div>
      <div class="ed-bot"></div><div class="ed-tip" hidden></div></div>`);
    host.appendChild(ed);
    { const lid = G.langId(lang === 'markdown' ? 'markdown' : lang); if (lid) ed.dataset.lang = lid; }
    const applyEdPrefs = () => { ed.style.setProperty('--ed-size', (+G.prefs.edFontSize || 13) + 'px'); ed.style.setProperty('--ed-lh', +G.prefs.edLineHeight || 1.65); ed.style.fontFeatureSettings = G.prefs.edLigatures ? 'normal' : ''; };
    applyEdPrefs();
    const ta = $('.ed-ta', ed), pre = $('.ed-hl', ed), gut = $('.ed-gutter', ed), scroller = $('.ed-scroll', ed), strip = $('.ed-strip', ed), deco = $('.ed-deco', ed), rticks = $('.rticks', ed), rcar = $('.rcar', ed), rsel = $('.rsel', ed), tip = $('.ed-tip', ed);
    const api = { el: ed, ta, scroller, markers: opts.markers || {}, diags: [], hits: [], listeners: { change: [], cursor: [], scroll: [] }, path: opts.path || '' };
    let cur = 1, history = [], lineEls = [], starts = [0], marks = [], rulerCols = 0, base = opts.base != null ? String(opts.base).replace(/\r\n?/g, '\n') : null, diff = [], info = null;
    const emit = (k, v) => api.listeners[k].forEach((f) => f(v));
    api.on = (k, f) => api.listeners[k].push(f);

    // The text the textarea holds never carries a CR; the line breaks the file really has are kept beside it.
    let breaks = breaksOf(opts.value || '');
    ta.value = String(opts.value || '').replace(/\r\n?/g, '\n');
    const domBreak = () => eolSummary(breaks).domBreak;
    const raw = () => { const ls = ta.value.split('\n'); return ls.map((l, i) => l + (i < ls.length - 1 ? breaks[i] || domBreak() : '')).join(''); };
    api.getRaw = raw;
    const syncBreaks = (oldCount, caretLine) => {
      const n = ta.value.split('\n').length - 1; const d = n - (breaks.length);
      if (d > 0) breaks.splice(Math.max(0, caretLine - 1 - d), 0, ...Array(d).fill(domBreak())); else if (d < 0) breaks.splice(Math.max(0, caretLine - 1), -d);
    };
    const lineOf = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };
    const vis = (line, n) => { let v = 0; for (let k = 0; k < n; k++) v += line[k] === '\t' ? 4 - (v % 4) : 1; return v; };
    const fmtN = (n) => n.toLocaleString('en-US');
    const showWs = () => !!G.prefs.edShowWs;
    const guideOn = () => (G.prefs.edGuide === 'on' || (G.prefs.edGuide !== 'off' && lang !== 'markdown'));

    // ---- one line of highlighted text, with the bytes made visible
    const decorate = (html, i, eolMark, eofNote) => {
      const parts = html.split(/(<[^>]+>)/); const ws = showWs();
      const body = (t) => { t = t.replace(INV_G, (c) => c + `<span class="inv" data-cp="${cpHex(c.codePointAt(0))}"><b>${c.codePointAt(0).toString(16).toUpperCase().padStart(c.codePointAt(0) > 0xff ? 4 : 2, '0')}</b></span>`); return ws ? t.replace(/\t/g, '<span class="wt">\t</span>') : t; };
      let last = -1; for (let k = parts.length - 1; k >= 0; k -= 2) if (parts[k]) { last = k; break; }
      for (let k = 0; k < parts.length; k += 2) {
        let t = parts[k]; if (!t) continue;
        if (ws && k === last) { const m = t.match(/[ \t]+$/); if (m) { const trail = m[0].replace(/\t/g, '<span class="wt">\t</span>'); parts[k] = body(t.slice(0, -m[0].length)) + `<span class="wtr">${trail}</span>`; continue; } }
        parts[k] = body(t);
      }
      return parts.join('') + (eolMark ? `<span class="eol-mark" title="${eolMark === '␍' ? 'This line ends in CR LF' : 'This line ends in LF'}">${eolMark}</span>` : '') + (eofNote ? '<span class="eof-note">no newline at end of file</span>' : '');
    };

    function paint() {
      const src = ta.value;
      const lines = (lang === 'markdown' || !opts.lang) ? mdSourceHtml(src) : G.hl(src, opts.lang).split('\n');
      const texts = src.split('\n');
      info = G.srcInfo(raw());
      api.diags = G.prefs.edLint && opts.lint !== false ? G.lint(src) : [];
      starts = [0]; texts.forEach((l) => starts.push(starts[starts.length - 1] + l.length + 1));
      const eol = info.eol; const ends = breaks;
      pre.innerHTML = lines.map((h, i) => {
        const b = ends[i]; const minority = eol.mixed && b && b !== eol.domBreak;
        const mark = minority ? (b === '\n' ? '␊' : '␍') : '';
        const eof = i === lines.length - 1 && !info.endsNl && texts[i] !== '';
        return `<span class="line${i + 1 === cur ? ' cur' : ''}" data-l="${i + 1}">${decorate(h, i, mark, eof) || ' '}</span>`;
      }).join('');
      lineEls = Array.from(pre.children);
      const folds = new Set(); if (lang === 'markdown') texts.forEach((l, i) => { if (/^#{1,6}\s|^(```|~~~)\w/.test(l)) folds.add(i + 1); });
      gut.innerHTML = lines.map((_, i) => { const n = i + 1; return `<div class="${n === cur ? 'cur' : ''}" style="height:${lineEls[i] ? lineEls[i].offsetHeight : 21}px">${folds.has(n) ? '<span class="fold">▾</span>' : ''}${G.prefs.edLineNumbers ? n : ''}</div>`; }).join('');
      gut.style.setProperty('--gd', Math.max(3, String(lines.length).length));
      ed.classList.toggle('guide', guideOn());
      ed.classList.toggle('show-ws', showWs());
      drawMeta(); drawRuler(); drawDeco(); scheduleDiff(); drawStrip(); drawBottom();
    }

    // ---- top bar
    const pathParts = () => (api.path ? api.path.split('/') : []);
    function drawMeta() {
      const p = pathParts();
      $('.ed-path', ed).innerHTML = p.length ? p.map((s, i) => `<span class="seg${i === p.length - 1 ? ' last' : ''}">${esc(s)}</span>`).join('<i class="sl">›</i>') : '<span class="seg last">Unsaved</span>';
      const eol = info.eol;
      $('.ed-meta', ed).innerHTML = [
        `<span class="opt" title="Encoding${info.bom ? ': the file starts with a byte order mark (EF BB BF)' : ''}">${esc(info.enc)}</span>`,
        `<button data-m="menu" title="${eol.mixed ? `Mixed line endings: ${eol.n.lf} LF, ${eol.n.crlf} CRLF, ${eol.n.cr} CR` : 'Line endings'}${info.endsNl ? '' : '. No newline at the end of the file'}">${eol.label}</button>`,
        `<button data-m="menu" title="Indentation as written: ${info.indent.tabs} lines start with tabs, ${info.indent.spaces} with spaces">${esc(info.indent.label)}</button>`,
        `<span class="opt" title="Size of the file in bytes">${fmtN(info.bytes)} bytes</span>`,
        `<span class="opt" title="Lines">${fmtN(info.lines)} line${info.lines === 1 ? '' : 's'}</span>`
      ].join('<i class="dot">·</i>');
    }
    $('.ed-meta', ed).addEventListener('click', (e) => { const b = e.target.closest('[data-m="menu"]'); if (b) editorMenu(b); });
    function editorMenu(anchor) {
      const set = (k, v) => { G.setPref(k, v); };
      G.menu(anchor, [
        { header: 'Read from the bytes' },
        { label: `Line endings: ${info.eol.label} (${fmtN(info.eol.n.lf)} LF, ${fmtN(info.eol.n.crlf)} CRLF)`, icon: 'corner-down-left', disabled: true },
        { label: `Indentation: ${info.indent.label}`, icon: 'indent-increase', disabled: true },
        { label: info.endsNl ? 'Ends with a newline' : 'No newline at the end of the file', icon: 'pilcrow', disabled: true },
        { sep: true },
        { label: 'Show whitespace', kbd: '⌥⌘W', checked: showWs(), run: () => set('edShowWs', !showWs()) },
        { label: 'Column guide at 80', checked: guideOn(), run: () => set('edGuide', guideOn() ? 'off' : 'on') },
        { label: 'Soft wrap', kbd: '⌥Z', checked: ed.classList.contains('wrap'), run: () => { G.setPref('edWrap', !ed.classList.contains('wrap')); api.setWrap(G.prefs.edWrap); } },
        { label: 'Line numbers', checked: G.prefs.edLineNumbers, run: () => set('edLineNumbers', !G.prefs.edLineNumbers) }
      ].concat(opts.menuItems ? [{ sep: true }].concat(opts.menuItems()) : []), { width: 290, align: 'end' });
    }
    api.menu = editorMenu;

    // ---- column ruler: ticks on the character grid, in the editor's own ch units
    const probe = el('<span class="ed-probe" aria-hidden="true"></span>'); $('.ed-ruler', ed).appendChild(probe);
    api.cw = () => probe.getBoundingClientRect().width;
    function drawRuler() {
      const cw = api.cw() || 8; const maxLen = texts_max();
      const cols = Math.min(1200, Math.max(maxLen + 24, Math.ceil((scroller.clientWidth || 800) / cw) + 4, 100));
      if (cols === rulerCols) return; rulerCols = cols;
      // A minor tick every 5 columns, a major tick with its number every 10, centred on the column's character.
      let h = ''; for (let n = 5; n <= cols; n += 5) h += `<i class="rt${n % 10 === 0 ? ' t10' : ''}" style="--n:${n}"></i>` + (n % 10 === 0 ? `<span class="rl" style="--n:${n}"><b>${n}</b></span>` : '');
      rticks.innerHTML = h; updateLabels();
    }
    // Numbers are set from column 10 on, and none sits closer than 3ch to the frame's edge (as the text scrolls under it).
    function updateLabels() {
      const cw = api.cw() || 8; const gw = $('.ed-corner', ed).offsetWidth; const left = scroller.scrollLeft + 3 * cw, right = scroller.scrollLeft + scroller.clientWidth - gw - 3 * cw;
      $$('.rl', rticks).forEach((l) => { const x = parseFloat(getComputedStyle(l).left); l.classList.toggle('hide', x < left || x + l.offsetWidth > right); });
    }
    api.updateLabels = updateLabels;
    const texts_max = () => { let m = 0; ta.value.split('\n').forEach((l) => { const v = vis(l, l.length); if (v > m) m = v; }); return m; };
    function drawCaret() {
      const a = ta.selectionStart, b = ta.selectionEnd; const v = ta.value; const head = ta.selectionDirection === 'backward' ? a : b;
      const li = lineOf(head); const ls = v.slice(starts[li], starts[li] + 400).split('\n')[0];
      rcar.style.setProperty('--v', vis(ls, head - starts[li])); rcar.hidden = false;
      if (a === b) { rsel.hidden = true; return; }
      const la = lineOf(a), lb = lineOf(b); let s0 = Infinity, e0 = 0; const all = v.split('\n');
      for (let k = la; k <= lb; k++) { const t = all[k]; const from = k === la ? vis(t, a - starts[k]) : 0; const to = k === lb ? vis(t, b - starts[k]) : vis(t, t.length); s0 = Math.min(s0, from); e0 = Math.max(e0, to); }
      rsel.style.setProperty('--v', s0); rsel.style.setProperty('--w', Math.max(1, e0 - s0)); rsel.hidden = false;
    }

    // ---- find hits and the column guide sit under the text
    function drawDeco() {
      if (ed.classList.contains('wrap') || !api.hits.length) { deco.innerHTML = ''; return; }
      const v = ta.value; const all = v.split('\n');
      deco.innerHTML = api.hits.slice(0, 500).map(([s, e], k) => { const li = lineOf(s); const t = all[li]; const el2 = lineEls[li]; if (!el2) return ''; const v0 = vis(t, s - starts[li]), v1 = vis(t, Math.min(e, starts[li] + t.length) - starts[li]); return `<i class="fh${k === api.hitCur ? ' cur' : ''}" style="top:${el2.offsetTop}px;height:${el2.offsetHeight}px;left:calc(var(--ed-padx) + ${v0}ch);width:${v1 - v0}ch"></i>`; }).join('');
    }
    api.setFindHits = (ranges, curIdx) => { api.hits = ranges || []; api.hitCur = curIdx; drawDeco(); drawStrip(); };

    // ---- changes since the base text, for the strip
    let dt = null;
    function scheduleDiff() { if (base == null) { diff = Object.entries(api.markers).map(([l, k]) => ['+', +l]); return; } clearTimeout(dt); dt = setTimeout(() => { diff = lineDiff(base, ta.value) || []; drawStrip(); }, 60); }
    api.setBase = (t) => { base = t == null ? null : String(t).replace(/\r\n?/g, '\n'); scheduleDiff(); };

    // ---- right strip: marks at the vertical position of things that sit at exact bytes
    function drawStrip() {
      if (!lineEls.length) return; const H = strip.clientHeight; if (!H) return;
      const last = lineEls[lineEls.length - 1]; const total = Math.max(last.offsetTop + last.offsetHeight + 12, scroller.clientHeight);
      const y = (line) => ((lineEls[Math.min(line, lineEls.length) - 1] || last).offsetTop / total) * H;
      const hh = (n) => Math.max(2, (n * 21 / total) * H);
      marks = [];
      const text = ta.value;
      G.scanInvisible(text).slice(0, 300).forEach((m) => marks.push({ kind: 'inv', line: m.line, col: m.col, y: y(m.line), h: 3, tip: `${cpHex(m.cp)}${cpName(m.cp) ? ' ' + cpName(m.cp) : ''} at ${m.line}:${m.col}`, off: starts[m.line - 1] + m.at }));
      api.hits.slice(0, 300).forEach(([s, e]) => { const li = lineOf(s); marks.push({ kind: 'find', line: li + 1, col: s - starts[li] + 1, y: y(li + 1), h: 3, tip: `Match at ${li + 1}:${s - starts[li] + 1}`, off: s, end: e }); });
      api.diags.filter((d) => d.sev !== 'info').forEach((d) => marks.push({ kind: 'warn', line: d.line, col: 1, y: y(d.line), h: 3, tip: `${d.msg} · line ${d.line}` }));
      // lines changed since the base text: runs of added lines, and where lines were removed
      const add = diff.filter((d) => d[0] === '+').map((d) => d[1]); let s = 0;
      while (s < add.length) { let e = s; while (e + 1 < add.length && add[e + 1] === add[e] + 1) e++; marks.push({ kind: 'add', line: add[s], col: 1, y: y(add[s]), h: hh(add[e] - add[s] + 1), tip: add[s] === add[e] ? `Line ${add[s]} changed since you read` : `Lines ${add[s]} to ${add[e]} changed since you read` }); s = e + 1; }
      diff.filter((d) => d[0] === '-').forEach((d) => { if (!add.includes(d[1])) marks.push({ kind: 'del', line: d[1], col: 1, y: y(d[1]), h: 3, tip: `Lines removed before line ${d[1]}` }); });
      strip.innerHTML = marks.map((m, k) => `<i class="sm ${m.kind}" data-k="${k}" style="top:${m.y.toFixed(1)}px;height:${m.h.toFixed(1)}px"></i>`).join('');
    }
    strip.addEventListener('mouseover', (e) => { const i = e.target.closest('.sm'); if (!i) return; const m = marks[+i.dataset.k]; tip.textContent = m.tip; tip.hidden = false; const r = i.getBoundingClientRect(), er = ed.getBoundingClientRect(); tip.style.top = Math.max(4, r.top - er.top - 4) + 'px'; tip.style.right = er.right - r.left + 6 + 'px'; });
    strip.addEventListener('mouseout', () => { tip.hidden = true; });
    strip.addEventListener('click', (e) => {
      const i = e.target.closest('.sm'); if (!i) return; const m = marks[+i.dataset.k];
      api.reveal(m.line); ta.focus();
      if (m.off != null) ta.setSelectionRange(m.off, m.end != null ? m.end : m.off + 1); else { const s = starts[m.line - 1]; ta.setSelectionRange(s, s); }
      setCur(); drawBottom();
    });

    // ---- bottom bar
    const pos = () => { const head = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd; const li = lineOf(head); const col = [...ta.value.slice(starts[li], head)].length + 1; const crs = breaks.slice(0, li).reduce((n, b) => n + (b === '\r\n' ? 1 : 0), 0); return { line: li + 1, col, head, byte: utf8(ta.value.slice(0, head)) + crs }; };
    function drawBottom() {
      const p = pos(); const a = ta.selectionStart, b = ta.selectionEnd; const v = ta.value;
      let sel = ''; if (b > a) { const t = v.slice(a, b); const nl = (t.match(/\n/g) || []).length; sel = G.measureSel(t, { kind: opts.kind, bytes: utf8(t) + nl * (domBreak() === '\r\n' ? 1 : 0) }); }
      const docm = b > a ? '' : G.measure(v, { kind: opts.kind, bytes: info.bytes });
      const ch = v.codePointAt(p.head); const under = ch === undefined ? 'end of file' : G.cpLabel(String.fromCodePoint(ch));
      const lid = G.langId(lang); const notes = api.notes();
      $('.ed-bot', ed).innerHTML = `<span title="Line, column (characters) and byte offset of the caret">Ln ${fmtN(p.line)}, Col ${fmtN(p.col)} · byte ${fmtN(p.byte)}</span>${sel ? `<span class="sel"><i class="dot">·</i>${esc(sel)}</span>` : docm ? `<span class="docm"><i class="dot">·</i>${esc(docm)}</span>` : ''}<span class="chr" title="The character under the caret"><i class="dot">·</i>${esc(under)}</span><span class="grow"></span>${notes.length ? `<button class="notes" data-notes title="${notes.length === 1 ? 'A note' : notes.length + ' notes'} marked on the right strip. Click to step through them.">${notes.length} note${notes.length === 1 ? '' : 's'}</button>` : ''}<span class="lng"${lid ? ` data-lang="${lid}"` : ''}>${lid ? '<i class="ld"></i>' : ''}${esc(G.langLabel(lang))}</span>`;
      drawCaret();
    }
    api.statusText = () => { const p = pos(); return p; };
    // Notes are never drawn on the text: they are marks on the right strip, a count in the bottom bar, and this stepper.
    api.notes = () => api.diags.filter((d) => d.sev !== 'info');
    let noteI = -1;
    api.nextNote = () => { const n = api.notes(); if (!n.length) return null; noteI = (noteI + 1) % n.length; const d = n[noteI]; api.reveal(d.line); ta.focus(); const st = starts[d.line - 1]; ta.setSelectionRange(st, st); setCur(); drawBottom(); G.toast(`${esc(d.msg)} · line ${d.line} · note ${noteI + 1} of ${n.length}`, { icon: 'info', quiet: true, ms: 2600 }); return d; };
    $('.ed-bot', ed).addEventListener('click', (e) => { if (e.target.closest('[data-notes]')) api.nextNote(); });

    const lineAt = (pos2) => lineOf(pos2) + 1;
    function setCur() {
      const n = lineAt(ta.selectionStart); if (n === cur) return;
      const o = lineEls[cur - 1]; o && o.classList.remove('cur'); gut.children[cur - 1] && gut.children[cur - 1].classList.remove('cur');
      cur = n; const e2 = lineEls[cur - 1]; e2 && e2.classList.add('cur'); gut.children[cur - 1] && gut.children[cur - 1].classList.add('cur');
      emit('cursor', cur);
    }
    let t = null;
    ta.addEventListener('input', () => { syncBreaks(0, lineAt(ta.selectionStart)); paint(); clearTimeout(t); t = setTimeout(() => emit('change', ta.value), 120); });
    ['keyup', 'click', 'select', 'focus', 'mouseup'].forEach((ev) => ta.addEventListener(ev, () => { setCur(); drawBottom(); }));
    document.addEventListener('selectionchange', () => { if (document.activeElement === ta) { setCur(); drawBottom(); } });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); api.insert(e.shiftKey ? '' : ' '.repeat(G.prefs.edTabSize)); }
      // Toggle a task checkbox on the current line.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); const ls = ta.value.split('\n'); const l = ls[cur - 1]; if (/\[[ xX]\]/.test(l)) { ls[cur - 1] = l.replace(/\[([ xX])\]/, (m, c) => (c === ' ' ? '[x]' : '[ ]')); api.setValue(ls.join('\n'), true); emit('change', ta.value); } }
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyW') { e.preventDefault(); G.setPref('edShowWs', !showWs()); }
    });
    scroller.addEventListener('scroll', () => { emit('scroll', api.topLine()); updateLabels(); }, { passive: true });
    new ResizeObserver(() => { rulerCols = 0; drawRuler(); drawStrip(); }).observe(ed);

    api.getValue = () => ta.value;
    api.setValue = (v, keepCursor) => { const s = ta.selectionStart; history.push(ta.value); ta.value = String(v).replace(/\r\n?/g, '\n'); syncBreaks(0, lineAt(s)); paint(); if (keepCursor) ta.selectionStart = ta.selectionEnd = Math.min(s, ta.value.length); };
    api.undo = () => { if (history.length) { ta.value = history.pop(); syncBreaks(0, cur); paint(); emit('change', ta.value); } };
    api.hasSelection = () => ta.selectionStart !== ta.selectionEnd && document.activeElement === ta;
    api.getSelection = () => ta.value.slice(ta.selectionStart, ta.selectionEnd);
    api.selectionLines = () => [lineAt(ta.selectionStart), lineAt(ta.selectionEnd)];
    api.replaceSelection = (txt) => { const a = ta.selectionStart, b = ta.selectionEnd; history.push(ta.value); ta.setRangeText(txt, a, b, 'select'); syncBreaks(0, lineAt(ta.selectionEnd)); paint(); emit('change', ta.value); };
    api.insert = (txt) => { history.push(ta.value); ta.setRangeText(txt, ta.selectionStart, ta.selectionEnd, 'end'); syncBreaks(0, lineAt(ta.selectionEnd)); paint(); emit('change', ta.value); };
    api.lineTop = (n) => { const e2 = lineEls[Math.max(0, Math.min(lineEls.length - 1, n - 1))]; return e2 ? e2.offsetTop : 0; };
    api.topLine = () => { const y2 = scroller.scrollTop + 28; let lo = 0, hi = lineEls.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineEls[mid].offsetTop <= y2) lo = mid; else hi = mid - 1; } return lo + 1; };
    api.scrollToLine = (n, smooth) => scroller.scrollTo({ top: Math.max(0, api.lineTop(n) - 12), behavior: smooth ? 'smooth' : 'auto' });
    api.flash = (a, b = a) => { for (let i = a; i <= b; i++) { const e2 = lineEls[i - 1]; if (e2) { e2.classList.add('flash'); setTimeout(() => e2.classList.remove('flash'), 900); } } };
    api.reveal = (a, b) => { const top = api.lineTop(a); if (top < scroller.scrollTop || top > scroller.scrollTop + scroller.clientHeight - 60) api.scrollToLine(a - 3, true); api.flash(a, b || a); };
    api.select = (a, b) => { const ls = ta.value.split('\n'); const s = ls.slice(0, a - 1).join('\n').length + (a > 1 ? 1 : 0); const e2 = ls.slice(0, b).join('\n').length; ta.focus(); ta.setSelectionRange(s, e2); setCur(); drawBottom(); };
    api.setWrap = (w) => { ed.classList.toggle('wrap', w); ta.setAttribute('wrap', w ? 'soft' : 'off'); paint(); };
    api.setMarkers = (m) => { api.markers = m; scheduleDiff(); drawStrip(); };
    api.setPath = (p) => { api.path = p || ''; drawMeta(); };
    api.refresh = paint;
    api.info = () => info;
    // Gutter right-click: copy a line, or lines with their path and line number.
    gut.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const row = e.target.closest('.ed-gutter > div'); const n = row ? Array.from(gut.children).indexOf(row) + 1 : cur;
      let [a, b] = api.hasSelection() || ta.selectionStart !== ta.selectionEnd ? api.selectionLines() : [n, n];
      if (n < a || n > b) a = b = n;
      const all = ta.value.split('\n'); const picked = all.slice(a - 1, b); const path = api.path || (G.current && G.current.path) || 'untitled';
      const at = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
      const one = a === b; const ref = one ? `${path}:${a}` : `${path}:${a}-${b}`;
      G.menu(at, [
        { header: one ? `Line ${a}` : `Lines ${a} to ${b}` },
        { label: one ? 'Copy line' : `Copy ${b - a + 1} lines`, icon: 'copy', run: () => G.copy(picked.join('\n'), { as: one ? 'line' : 'lines', clean: false, line: a }) },
        { label: 'Copy lines with path:line', icon: 'text-quote', desc: 'One line per source line, as path:line: text', run: () => G.copy(picked.map((l, i) => `${path}:${a + i}: ${l}`).join('\n'), { as: 'lines with path:line', clean: false, line: a }) },
        { label: 'Copy path:line', icon: 'link', run: () => G.copy(ref, { as: 'path:line', clean: false }) },
        { sep: true },
        { label: 'Copy as…', icon: 'clipboard-copy', kbd: '⇧⌘C', run: () => G.copyMenu(at, () => picked.join('\n'), { header: 'Copy lines as' }) }
      ], { width: 260 });
    });
    G.on('pref', ({ key }) => { if (!ed.isConnected) return; if (/^ed(FontSize|LineHeight|Ligatures)$/.test(key)) { applyEdPrefs(); rulerCols = 0; paint(); } else if (/^(edShowWs|edGuide|edLineNumbers|edLint)$/.test(key)) paint(); else if (/^(measures|measuresMode|tokenizer|kindMeasures)$/.test(key)) drawBottom(); });
    if (document.fonts) document.fonts.addEventListener('loadingdone', () => { rulerCols = 0; if (ed.isConnected) { drawRuler(); } });
    ta.setSelectionRange(0, 0);
    paint();
    return api;
  };
  /* ---------- In-page document view ----------
     The workspace's reading and Source panes as a panel a page can show in place (the Library's results area, the palette
     guide). Opening a file never navigates away: the page defines G.openDoc to call dv.open. History (⌘[ and ⌘]) is the view's own. */

  G.docView = function (host, opts = {}) {
    const dv = { doc: null, hist: [], fwd: [], view: 'split', editor: null };
    host.classList.add('dv'); host.hidden = true;
    host.innerHTML = `<div class="dv-bar" role="toolbar" aria-label="Document">
        <button class="tb-btn lbl-btn" data-dv="back" title="${esc(opts.backTitle || 'Back')}">${ic('chevron-left')}<span>${esc(opts.backLabel || 'Back')}</span></button>
        <div class="tb-group"><button class="tb-btn" data-dv="prev" title="Previous document (⌘[)" aria-label="Previous document">${ic('arrow-left')}</button><button class="tb-btn" data-dv="next" title="Next document (⌘])" aria-label="Next document">${ic('arrow-right')}</button></div>
        <div class="tb-title"><b data-dv="title"></b><small data-dv="path"></small></div>
        <div class="seg" role="group" aria-label="View"><button data-view="render" title="Read (⌘1)">${ic('book-open-text')}Read</button><button data-view="split" title="Read and Source (⌘2)">${ic('columns-2')}Split</button><button data-view="source" title="Source (⌘3)">${ic('square-code')}Source</button></div>
        <span class="tb-space"></span>
        <span data-dv="share"></span>
      </div>
      <div class="panes" data-view="split"><section class="pane pane-render" aria-label="Rendered document"><div class="pane-scroll"><article class="doc"></article></div></section><section class="pane pane-source" aria-label="Source"><div class="dv-edhost" style="flex:1;display:flex;min-height:0;min-width:0"></div></section></div>`;
    const $q = (s) => host.querySelector(s); const docEl = $q('article.doc'), panes = $q('.panes'), edhost = $q('.dv-edhost'), scroll = $q('.pane-scroll');
    $q('[data-dv="share"]').replaceWith(G.copyExport(() => ({ doc: dv.doc, text: dv.doc ? dv.doc.src : '' })));
    const setView = (v) => { dv.view = v; panes.dataset.view = v; $$('[data-view]', host).forEach((b) => { if (b.matches('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.view === v)); }); if (v !== 'source') G.measureDoc(docEl); };
    const render = () => { G.renderDoc(docEl, dv.doc, { kindTheme: true, kind: dv.doc.kind }); G.current.headings = []; };
    G.attachSelectionToolbar(docEl, () => dv.doc);
    dv.open = (id, mods = {}) => {
      const d = G.docById(id); if (!d) { G.toast(`${esc(id)} is not in this prototype`, { icon: 'info' }); return null; }
      if (dv.doc && dv.doc.id !== d.id && !mods.noHist) { dv.hist.push(dv.doc.id); dv.fwd = []; }
      dv.doc = d; host.hidden = false;
      G.current = { id: d.id, title: d.title, path: d.path, lang: d.lang, src: d.src, collection: d.collection, kind: d.kind, headings: [] };
      G.recent.push(d.id);
      $q('[data-dv="title"]').textContent = d.title; $q('[data-dv="path"]').textContent = d.path || 'Unsaved';
      const lang = d.kind === 'code' ? (d.lang || 'text') : d.kind === 'data' ? (d.lang && d.lang !== 'csv' ? d.lang : 'csv') : d.kind === 'log' ? 'log' : d.kind === 'terminal' ? 'term' : 'markdown';
      edhost.innerHTML = '';
      dv.editor = G.editor = G.Editor(edhost, { value: d.src, lang, path: d.path, kind: d.kind, base: (G.prevVersions[d.id] || {}).src != null ? G.prevVersions[d.id].src : d.src, lint: lang === 'markdown' });
      let t = null; dv.editor.on('change', (v) => { d.src = v; G.current.src = v; clearTimeout(t); t = setTimeout(render, 80); });
      render(); scroll.scrollTop = 0; setView(['code', 'data', 'log', 'terminal'].includes(d.kind) ? 'render' : 'split');
      $q('[data-dv="prev"]').disabled = !dv.hist.length; $q('[data-dv="next"]').disabled = !dv.fwd.length;
      if (mods.line) setTimeout(() => { setView('split'); dv.editor.reveal(mods.line); }, 40);
      if (opts.onOpen) opts.onOpen(d);
      return d;
    };
    dv.back = () => { if (dv.hist.length) { dv.fwd.push(dv.doc.id); dv.open(dv.hist.pop(), { noHist: true }); } };
    dv.forward = () => { if (dv.fwd.length) { dv.hist.push(dv.doc.id); dv.open(dv.fwd.pop(), { noHist: true }); } };
    dv.close = () => { host.hidden = true; if (opts.onClose) opts.onClose(); };
    dv.isOpen = () => !host.hidden;
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dv]'); if (b) { const a = b.dataset.dv; if (a === 'back') dv.close(); else if (a === 'prev') dv.back(); else if (a === 'next') dv.forward(); return; }
      const v = e.target.closest('.seg button'); if (v) setView(v.dataset.view);
    });
    // Keys while the view is open: history, view, copy the document. Captured so the page's own list keys do not also fire.
    document.addEventListener('keydown', (e) => {
      if (host.hidden) return; const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'BracketLeft') { e.preventDefault(); e.stopPropagation(); dv.back(); }
      else if (mod && e.code === 'BracketRight') { e.preventDefault(); e.stopPropagation(); dv.forward(); }
      else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') { e.preventDefault(); e.stopPropagation(); setView(dv.view === 'source' ? 'render' : 'source'); }
      else if (mod && ['1', '2', '3'].includes(e.key) && !e.altKey) { e.preventDefault(); e.stopPropagation(); setView(['render', 'split', 'source'][+e.key - 1]); }
      else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c' && !window.getSelection().toString() && document.activeElement !== (dv.editor && dv.editor.ta)) { e.preventDefault(); e.stopPropagation(); G.copy(dv.doc.src, { as: 'Markdown' }); }
      else if (e.key === 'Escape' && !G.menuOpen() && !G.palette.el && document.activeElement !== (dv.editor && dv.editor.ta)) { e.stopPropagation(); dv.close(); }
    }, true);
    G.on('reading-prefs', () => { if (!host.hidden && dv.doc) render(); });
    G.icons(host);
    return dv;
  };
})();
