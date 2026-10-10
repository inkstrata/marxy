/* Marxy core: prefs, themes, icons, menus, toasts, clipboard ring, transforms, palette, chrome.
   Rendering (markdown, highlighting, editor, document views) is in render.js. */
(function () {
  const G = (window.Marxy = window.Marxy || {});

  /* ---------- Utilities ---------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  // Source-kind glyphs: one distinctive mark each, drawn for 14 to 16 px (1.5 px stroke, round caps, no page outline).
  // Names are g-*; ic() returns inline SVG for these and a Lucide placeholder for everything else.
  const GL = {
    'g-prose': '<path d="M2 4h12M2 8h12M2 12h7"/>',
    'g-report': '<path d="M2 4h8" stroke-width="3"/><path d="M2 8.8h12M2 12.4h9"/>',
    'g-readme': '<path d="M8 4.2C6.6 3 4.4 2.7 2 3v8.6c2.4-.3 4.6 0 6 1.2 1.4-1.2 3.6-1.5 6-1.2V3c-2.4-.3-4.6 0-6 1.2zM8 4.2v8.6"/>',
    'g-docs': '<path d="M4.5 2.5h7v11L8 10.6l-3.5 2.9z"/>',
    'g-code': '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10"/>',
    'g-data': '<path d="M6 2.5c-1.6 0-2 .9-2 2v1.6c0 1-.5 1.9-1.8 1.9 1.3 0 1.8.9 1.8 1.9v1.6c0 1.1.4 2 2 2M10 2.5c1.6 0 2 .9 2 2v1.6c0 1 .5 1.9 1.8 1.9-1.3 0-1.8.9-1.8 1.9v1.6c0 1.1-.4 2-2 2"/>',
    'g-log': '<path d="M2 4h1.6M2 8h1.6M2 12h1.6M6 4h8M6 8h8M6 12h5.5"/>',
    'g-terminal': '<path d="m3 4.5 4 3.5-4 3.5M8.5 12h5"/>',
    'g-transcript': '<path d="M3.5 1.8h4A1.5 1.5 0 0 1 9 3.3v1.5a1.5 1.5 0 0 1-1.5 1.5H5.5L3.5 8V6.3A1.5 1.5 0 0 1 2 4.8V3.3a1.5 1.5 0 0 1 1.5-1.5zM8.5 8.8h4a1.5 1.5 0 0 1 1.5 1.5v1.4a1.5 1.5 0 0 1-1.5 1.5H12v1.6l-1.8-1.6H8.5A1.5 1.5 0 0 1 7 11.7v-1.4a1.5 1.5 0 0 1 1.5-1.5z"/>',
    'g-diff': '<path d="M8 2.5v6M5 5.5h6M5 12.5h6"/>',
    'g-changelog': '<path d="M3 4h.01M3 8h.01M3 12h.01" stroke-width="2.4"/><path d="M6.5 4H13M6.5 8H14M6.5 12h4.5"/>',
    'g-notes': '<path d="m10.8 2.8 2.4 2.4-7.7 7.7-3 .6.6-3zM9.2 4.4l2.4 2.4"/>',
    'g-book': '<path d="M4.5 2.5H12a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H4.5A1.5 1.5 0 0 1 3 12.5V4a1.5 1.5 0 0 1 1.5-1.5zM3 12.5A1.5 1.5 0 0 1 4.5 11H13"/>',
    'g-folder': '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.7H13a1 1 0 0 1 1 1v5.3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
    'g-repo': '<circle cx="5" cy="3.8" r="1.7"/><circle cx="5" cy="12.2" r="1.7"/><circle cx="11" cy="6" r="1.7"/><path d="M5 5.5v5M11 7.7c0 2.6-2.8 2.4-5 3.6"/>',
    'g-chev': '<path d="m6 4 4 4-4 4"/>'
  };
  const ic = (name, cls = '') => (GL[name]
    ? `<svg class="mxg${cls ? ' ' + cls : ''}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GL[name]}</svg>`
    : `<i data-lucide="${name}"${cls ? ` class="${cls}"` : ''}></i>`);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || true; // prototype targets macOS; keycaps shown as Mac
  const fmt = (n) => n.toLocaleString('en-US');
  Object.assign(G, { $, $$, esc, el, ic, fmt, isMac });

  const store = {
    get(k, d) { try { const v = localStorage.getItem('marxy.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('marxy.' + k, JSON.stringify(v)); } catch (e) { /* private mode: in-memory only */ } }
  };
  G.store = store;

  /* ---------- Events ---------- */

  const handlers = {};
  G.on = (ev, fn) => ((handlers[ev] = handlers[ev] || []).push(fn), fn);
  G.emit = (ev, data) => (handlers[ev] || []).forEach((fn) => fn(data));

  /* ---------- Preferences: every setting in 08-settings binds to one of these keys ---------- */

  G.prefDefaults = {
    theme: 'system', themeLight: 'paper', themeDark: 'night', typeset: 'classic', scale: 1,
    accent: 'theme', followSystemContrast: true,
    view: 'split', syncScroll: true, sidebar: true, inspector: 'auto', tabs: true, statusbar: true,
    checkPaths: true, blockHandles: true, selectionToolbar: true,
    footnotes: 'popover', autoReload: true, detectKind: true,
    measure: 'auto', leading: 'auto', justify: 'auto', hyphenate: true, paraStyle: 'auto',
    letterSpacing: 0, wordSpacing: 0, bookPaged: true, focusMode: false,
    paraIndent: 1, paraSpace: 0.75, weightAdjust: 0, darkLighter: true, underlineLinks: true, kindOverrides: {},
    edFontSize: 13, edLineHeight: 1.65, edLigatures: false,
    dockShow: 'always', dockMenu: true,
    finderActionList: { open: true, rich: true, combine: true, addFolder: true },
    servicesList: { openMd: true, table: false },
    quicklookTheme: true, shareExt: true, openAtLogin: false, loginHidden: true,
    edShowWs: false, edGuide: 'auto',
    measuresMode: 'contextual', measures: ['chars', 'tokens'], tokenizer: 'estimate', kindMeasures: {}, showMetadata: false,
    edLineNumbers: true, edMinimap: true, edWrap: false, edTabSize: 4, edLint: true, edFont: 'theme',
    edCurrentLine: true, edWhitespace: 'boundary', edBracketPairs: true, edAutosave: 'off',
    copyDefault: 'markdown', stripEmoji: false, smartPunctOnCopy: false,
    clipHistory: true, clipLimit: 500, clipIgnoreApps: '1Password, Keychain Access', clipExpireDays: 30,
    indexHidden: false, indexMaxMb: 8, indexExclude: 'node_modules, .git, dist, target', indexContent: true,
    menubarExtra: true, finderActions: true, servicesMenu: true, quicklook: true,
    spotlight: true
  };
  G.prefs = Object.assign({}, G.prefDefaults, store.get('prefs', {}));
  // Write only this key over the latest stored copy, so two open windows never overwrite each other's settings.
  G.setPref = (k, v) => { const saved = store.get('prefs', {}); saved[k] = v; store.set('prefs', saved); G.prefs[k] = v; G.emit('pref', { key: k, value: v }); G.emit('pref:' + k, v); };

  /* ---------- Measures: how big a text is, in the units the reader chose ----------
     Pref measuresMode: 'contextual' (a set per kind), 'all', or 'custom' (the ordered pref measures); kindMeasures[kind]
     overrides. Tokens are a local estimate (about chars / 3.8, shown with ≈); nothing is sent anywhere. */

  const MEASURE_CTX = { code: ['lines', 'chars', 'tokens', 'bytes'], data: ['lines', 'bytes', 'chars'], log: ['lines', 'bytes'], terminal: ['lines', 'bytes'] };
  const MEASURE_PROSE = ['words', 'chars', 'tokens', 'lines'];
  const MEASURE_ALL = ['lines', 'words', 'chars', 'tokens', 'bytes', 'readTime'];
  G.measureNames = { lines: 'Lines', words: 'Words', chars: 'Characters', tokens: 'Tokens (estimate)', bytes: 'Bytes', readTime: 'Reading time' };
  G.measureKeys = (kind) => {
    const o = (G.prefs.kindMeasures || {})[kind]; if (Array.isArray(o) && o.length) return o.filter((k) => MEASURE_ALL.includes(k));
    const mode = G.prefs.measuresMode || 'contextual';
    if (mode === 'all') return MEASURE_ALL.slice();
    if (mode === 'custom') { const m = (G.prefs.measures || []).filter((k) => MEASURE_ALL.includes(k)); return m.length ? m : ['chars', 'tokens']; }
    return (MEASURE_CTX[kind] || MEASURE_PROSE).slice();
  };
  const u8len = (t) => new TextEncoder().encode(t).length;
  // The numbers for a text (or for a library row's known figures: pass an object {words, chars, bytes, lines}).
  G.measureStats = (src) => {
    if (src && typeof src === 'object') { const o = Object.assign({}, src); o.chars = o.chars != null ? o.chars : o.bytes || 0; o.bytes = o.bytes != null ? o.bytes : o.chars; o.words = o.words != null ? o.words : Math.round(o.chars / 6); o.lines = o.lines != null ? o.lines : Math.max(1, Math.round(o.words / 9)); return o; }
    const t = String(src || ''); const body = t.replace(/^---\n[\s\S]*?\n---\n/, '');
    return { chars: t.length > 2e5 ? t.length : [...t].length, bytes: u8len(t), lines: t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0, words: (body.replace(/```[\s\S]*?```/g, '').match(/[\p{L}\p{N}'’-]+/gu) || []).length };
  };
  const plural1 = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  // Individual items: [{key, value, text, estimate}], in the order the reader set (or the kind's set).
  G.measureParts = (src, o = {}) => {
    const opts = Array.isArray(o) ? { keys: o } : o; const st = G.measureStats(src); if (opts.bytes != null) st.bytes = opts.bytes;
    const keys = opts.keys || G.measureKeys(opts.kind);
    const f = {
      lines: () => [st.lines, plural1(st.lines, 'line')], words: () => [st.words, plural1(st.words, 'word')], chars: () => [st.chars, plural1(st.chars, 'char')],
      tokens: () => { const n = Math.round(st.chars / (G.prefs.tokenizer === 'cl100k-like' ? 3.8 : 3.8)); return [n, '≈' + plural1(n, 'token')]; },
      bytes: () => [st.bytes, plural1(st.bytes, 'byte')], readTime: () => { const m = Math.max(1, Math.round(st.words / 230)); return [m, m + ' min read']; }
    };
    return keys.filter((k) => f[k]).map((k) => { const [value, text] = f[k](); return { key: k, value, text, estimate: k === 'tokens' }; });
  };
  G.measure = (src, o) => G.measureParts(src, o).map((p) => p.text).join(' · ');
  G.measureFirst = (src, o) => { const p = G.measureParts(src, o)[0]; return p ? p.text : ''; };
  // A selection in Source: the chosen measures, and bytes always, since a byte count is provenance.
  G.measureSel = (src, o = {}) => { const keys = G.measureKeys(o.kind); if (!keys.includes('bytes')) keys.push('bytes'); return G.measure(src, { keys, bytes: o.bytes }); };

  /* ---------- Themes and type sets ---------- */

  G.themes = [
    { id: 'paper', name: 'Paper', mode: 'light', desc: 'Warm off-white, the default light theme' },
    { id: 'ink', name: 'Ink', mode: 'dark', desc: 'Off-black and off-white, lighter text weight' },
    { id: 'sepia', name: 'Sepia', mode: 'light', desc: 'Warm paper tone; a preference, not a remedy' },
    { id: 'dusk', name: 'Dusk', mode: 'dark', desc: 'Warm dark with amber accents' },
    { id: 'fjord', name: 'Fjord', mode: 'dark', desc: 'Cool blue-grey, Nord-like, audited' },
    { id: 'night', name: 'Night', mode: 'dark', desc: 'True black for OLED, text kept off-white' },
    { id: 'hc-light', name: 'High contrast light', mode: 'light', desc: 'Black on white, heavy edges' },
    { id: 'hc-dark', name: 'High contrast dark', mode: 'dark', desc: 'White on black, yellow accent' }
  ];
  G.typesets = [
    { id: 'classic', name: 'Classic', desc: 'Literata · Source Serif 4 · Atkinson Hyperlegible Next · JetBrains Mono' },
    { id: 'plex', name: 'Plex', desc: 'IBM Plex Serif · Plex Sans · Plex Mono, one family' },
    { id: 'hyperlegible', name: 'Hyperlegible', desc: 'Atkinson Hyperlegible Next and Mono everywhere, for low vision' },
    { id: 'system', name: 'System', desc: 'New York · SF Pro · SF Mono (macOS faces)' },
    { id: 'typewriter', name: 'Typewriter', desc: 'IBM Plex Mono for everything, for drafting' }
  ];
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const mqContrast = window.matchMedia('(prefers-contrast: more)');
  const mqTrans = window.matchMedia('(prefers-reduced-transparency: reduce)');
  // Custom themes are saved by 07-themes; their tokens arrive in the compiled stylesheet (themeCss).
  G.customThemes = (store.get('customThemes', []) || []).filter((c) => c && c.id && c.tokens).map((c) => ({ id: c.id, name: c.name, mode: c.mode, desc: c.desc || 'Custom', custom: true, base: c.base }));
  G.themeById = (id) => G.themes.find((t) => t.id === id) || G.customThemes.find((t) => t.id === id) || { id, name: id, mode: 'light' };

  // Sunrise and sunset by the standard solar-position approximation (as in SunCalc); good to a minute or two.
  function sunTimes(date, lat, lng) {
    const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397, J0 = 0.0009;
    const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
    const lw = rad * -lng, phi = rad * lat, d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
    const n = Math.round(d - J0 - lw / (2 * Math.PI)), ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    const Jset = J2000 + J0 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
  }
  const minsOf = (x) => { const [h, m] = String(x || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  G.scheduleMode = () => { const v = G.prefs.themeSchedule; return (v && typeof v === 'object' ? v.mode : v) || 'off'; };
  // Whether the dark slot applies now: by schedule (set times or sunset) when one is chosen, else by macOS.
  G.wantsDark = () => {
    const m = G.scheduleMode();
    if (m === 'custom') { const d = new Date(), n = d.getHours() * 60 + d.getMinutes(), a = minsOf(G.prefs.themeScheduleDark || '21:00'), b = minsOf(G.prefs.themeScheduleLight || '07:00'); return a > b ? n >= a || n < b : n >= a && n < b; }
    if (m === 'sun') { const [lat, lng] = store.get('sunCoords', [37.77, -122.42]); const st = sunTimes(new Date(), lat, lng); if (!isNaN(st.rise)) { const now = Date.now(); return now < st.rise || now > st.set; } }
    return mq.matches;
  };
  // theme, themeLight and themeDark may hold a built-in id or the id of a theme the reader made (customThemes).
  // A custom id that no longer exists (deleted) falls back to the built-in default of that mode, silently.
  const isTheme = (id) => G.themes.some((t) => t.id === id) || G.customThemes.some((t) => t.id === id);
  const slotChoice = () => {
    const sys = G.prefs.theme === 'system', dark = sys && G.wantsDark();
    const v = sys ? (dark ? G.prefs.themeDark : G.prefs.themeLight) : G.prefs.theme;
    return isTheme(v) ? v : (sys && dark ? 'night' : 'paper');
  };
  // Always a built-in id (a custom theme resolves to its built-in base), so callers that look it up in G.themes keep working.
  G.resolvedTheme = () => {
    // macOS Increase contrast switches to the high-contrast pair when the reader follows the system.
    if (G.prefs.theme === 'system' && G.prefs.followSystemContrast && mqContrast.matches) return G.wantsDark() ? 'hc-dark' : 'hc-light';
    const v = slotChoice(); const c = G.customThemes.find((t) => t.id === v);
    return c ? (G.themes.some((t) => t.id === c.base) ? c.base : c.mode === 'dark' ? 'night' : 'paper') : v;
  };
  // The theme actually applied: the custom theme itself when one is chosen, else the built-in. (customThemeActive is the older way of saying the same.)
  G.appliedTheme = () => {
    const r = G.resolvedTheme(); if (/^hc-/.test(r) && G.prefs.theme === 'system' && G.prefs.followSystemContrast && mqContrast.matches) return r;
    const v = slotChoice(); if (G.customThemes.some((t) => t.id === v)) return v;
    const c = G.customThemes.find((t) => t.id === G.prefs.customThemeActive); return c && c.base === r ? c.id : r;
  };
  setInterval(() => { if (G.prefs.theme === 'system' && G.scheduleMode() !== 'off' && document.documentElement.dataset.theme !== G.appliedTheme()) G.applyTheme(); }, 60000);
  mqContrast.addEventListener('change', () => G.prefs.theme === 'system' && G.applyTheme());
  mqTrans.addEventListener('change', () => G.applyTheme());
  // Another window changed a setting: adopt it and announce each changed key.
  window.addEventListener('storage', (e) => {
    if (e.key === 'marxy.themeCss' || e.key === 'marxy.customThemes') { G.customThemes = (store.get('customThemes', []) || []).filter((c) => c && c.id && c.tokens).map((c) => ({ id: c.id, name: c.name, mode: c.mode, desc: c.desc || 'Custom', custom: true, base: c.base })); return G.applyTheme(); }
    if (e.key === 'marxy.langCss') { const st = document.getElementById('lang-overrides'); if (st) st.textContent = store.get('langCss', '') || ''; return; }
    if (e.key !== 'marxy.prefs') return;
    const next = Object.assign({}, G.prefDefaults, store.get('prefs', {}));
    Object.keys(next).forEach((k) => { if (JSON.stringify(next[k]) !== JSON.stringify(G.prefs[k])) { G.prefs[k] = next[k]; G.emit('pref', { key: k, value: next[k] }); G.emit('pref:' + k, next[k]); } });
  });
  G.applyTheme = () => {
    const root = document.documentElement;
    let css = document.getElementById('theme-compiled');
    if (!css) { css = document.createElement('style'); css.id = 'theme-compiled'; document.head.appendChild(css); }
    css.textContent = store.get('themeCss', '');
    root.dataset.theme = G.appliedTheme();
    root.dataset.typeset = G.prefs.typeset;
    const hl = G.prefs.codeHighlight || 'full', rt = G.prefs.reduceTransparency;
    root.classList.toggle('hl-minimal', hl === 'minimal'); root.classList.toggle('hl-off', hl === 'off');
    root.classList.toggle('cm-upright', G.prefs.codeComments === 'upright');
    root.classList.toggle('defs-plain', G.prefs.codeDefsBold === false);
    root.classList.toggle('solid', rt === true || rt === 'on' || ((!rt || rt === 'auto' || rt === 'system') && mqTrans.matches));
    // Light text on dark costs more as it shrinks, so dark themes may carry a size boost (spec rule 7).
    const boost = G.themeById(G.resolvedTheme()).mode === 'dark' ? 1 + (+G.prefs.darkSizeBoost || 0) / 100 : 1;
    root.style.setProperty('--user-scale', (G.prefs.scale * boost).toFixed(3));
    G.emit('theme', root.dataset.theme);
  };
  mq.addEventListener('change', () => G.prefs.theme === 'system' && G.applyTheme());
  G.on('pref', ({ key }) => { if (/^(theme|themeLight|themeDark|typeset|scale|themeSchedule\w*|customThemeActive|codeHighlight|codeComments|codeDefsBold|reduceTransparency|darkSizeBoost|followSystemContrast|themeTweaks)$/.test(key)) G.applyTheme(); });
  G.applyTheme();

  /* ---------- Icons ---------- */

  G.icons = (root) => { if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 }, nameAttr: 'data-lucide', root }); };
  // lucide.createIcons scans the whole document; root is honoured in newer builds and ignored in older ones.

  /* ---------- Toasts ---------- */

  G.toast = (msg, opts = {}) => {
    let host = $('.toasts');
    if (!host) { host = el('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(host); }
    const t = el(`<div class="toast${opts.quiet ? ' quiet' : ''}">${opts.icon !== false ? ic(opts.icon || 'check') : ''}<span>${msg}</span>${opts.action ? `<button>${esc(opts.action.label)}</button>` : ''}</div>`);
    if (opts.action) t.querySelector('button').onclick = () => { opts.action.run(); t.remove(); };
    host.appendChild(t); G.icons(t);
    setTimeout(() => t.remove(), opts.ms || 2600);
  };

  /* ---------- Menus ---------- */

  // Open menus, outermost first; a submenu sits beside its parent rather than replacing it.
  const menus = [];
  const closeFrom = (level) => { while (menus.length > level) menus.pop().remove(); };
  G.closeMenu = () => closeFrom(0);
  G.menuOpen = () => menus.length > 0;
  // items: {label, icon, kbd, run, desc, checked, disabled, sub:[...]} | {sep:true} | {header:'...'} | {html}
  G.menu = (anchor, items, opts = {}) => {
    const level = opts.level || 0;
    closeFrom(level);
    const m = el('<div class="menu" role="menu"></div>');
    if (opts.width) m.style.minWidth = opts.width + 'px';
    const flat = []; let hot = -1, hoverTimer = null;
    const setHot = (i) => { flat.forEach((b) => b.classList.remove('hot')); hot = (i + flat.length) % flat.length; if (flat[hot]) { flat[hot].classList.add('hot'); flat[hot].scrollIntoView({ block: 'nearest' }); } };
    const openSub = (b, it, focus) => { const sub = G.menu(b, it.sub, { side: 'right', level: level + 1, width: 220, parentEl: m }); if (focus) sub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); return sub; };
    items.forEach((it) => {
      if (it.sep) return m.appendChild(el('<hr>'));
      if (it.header) return m.appendChild(el(`<div class="mh">${esc(it.header)}</div>`));
      if (it.html) return m.appendChild(el(it.html));
      const b = el(`<button class="mi" role="menuitem"${it.sub ? ' aria-haspopup="menu"' : ''}${it.disabled ? ' disabled' : ''}>${it.checked != null ? `<span class="mck">${it.checked ? ic('check') : ''}</span>` : it.icon ? ic(it.icon) : ''}<span>${esc(it.label)}</span>${it.kbd ? `<span class="k">${esc(it.kbd)}</span>` : ''}${it.sub ? ic('chevron-right') : ''}</button>`);
      b._item = it;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.sub) return openSub(b, it, false);
        G.closeMenu(); it.run && it.run();
      });
      b.addEventListener('mouseenter', () => {
        setHot(flat.indexOf(b)); clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => (it.sub ? openSub(b, it, false) : closeFrom(level + 1)), 140);
      });
      if (it.desc) b.title = it.desc;
      m.appendChild(b); flat.push(b);
    });
    document.body.appendChild(m); menus.push(m); G.icons(m);
    // Place: below the anchor (or beside it for a submenu), flipped or clamped to stay on screen; tall menus scroll.
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
    m.style.maxHeight = innerHeight - 16 + 'px'; m.style.overflowY = 'auto';
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x, y;
    if (opts.side === 'right') {
      x = r.right + 2; if (x + mw > innerWidth - 8) x = r.left - mw - 2;
      y = Math.min(r.top - 5, innerHeight - mh - 8);
    } else {
      x = opts.align === 'end' ? r.right - mw : r.left;
      const below = innerHeight - r.bottom - 14, above = r.top - 14;
      y = mh <= below || below >= above ? r.bottom + 6 : r.top - mh - 6;
      if (y + mh > innerHeight - 8) { m.style.maxHeight = Math.max(160, innerHeight - y - 8) + 'px'; }
    }
    m.style.left = Math.max(8, Math.min(x, innerWidth - mw - 8)) + 'px'; m.style.top = Math.max(8, y) + 'px';
    m.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { setHot(hot + 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { setHot(hot - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight' && flat[hot] && flat[hot]._item.sub) { openSub(flat[hot], flat[hot]._item, true); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && level > 0) { closeFrom(level); opts.parentEl && opts.parentEl.focus({ preventScroll: true }); e.preventDefault(); }
      else if (e.key === 'Enter' && flat[hot]) { flat[hot].click(); e.preventDefault(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (level > 0) { closeFrom(level); opts.parentEl && opts.parentEl.focus({ preventScroll: true }); } else { G.closeMenu(); anchor.focus && anchor.focus(); } }
      else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        // Type-ahead: jump to the next item starting with that letter.
        const k = e.key.toLowerCase(), n = flat.length;
        for (let i = 1; i <= n; i++) { const j = (hot + i) % n; if (flat[j].textContent.trim().toLowerCase().startsWith(k)) { setHot(j); break; } }
      }
    });
    m.tabIndex = -1; m.focus({ preventScroll: true });
    return m;
  };
  document.addEventListener('mousedown', (e) => { if (menus.length && !menus.some((m) => m.contains(e.target))) G.closeMenu(); });

  /* ---------- Clipboard ring ---------- */

  const seedClips = [
    { text: 'pg_upgrade --link --check', as: 'Plain', source: { title: 'Postgres 14 → 16 upgrade plan', path: '~/Work/plans/plans/pg16-upgrade-plan.md', line: 38 }, at: Date.now() - 1000 * 60 * 4, app: 'Marxy', pinned: false },
    { text: '| Store | Embeds in | Index |\n|---|---|---|\n| sqlite-vec | SQLite | Brute force, IVF |\n| usearch | C++ / Rust | HNSW |', as: 'Markdown', source: { title: 'Research: embedded vector stores', path: '~/Work/plans/research/vector-store-comparison.md', line: 13 }, at: Date.now() - 1000 * 60 * 31, app: 'Marxy', pinned: true },
    { text: 'https://www.postgresql.org/support/versioning/', as: 'URL', source: null, at: Date.now() - 1000 * 60 * 55, app: 'Safari', pinned: false },
    { text: 'Decide whether to keep the 30-day expiry or match the old 14 days.', as: 'Plain', source: { title: 'Handoff: session token refactor', path: '~/Work/plans/handoffs/auth-refactor-handoff.md', line: 34 }, at: Date.now() - 1000 * 60 * 90, app: 'Marxy', pinned: false },
    { text: 'let html = cache.get_or_insert(hash(&src), || highlight(&src, lang))?;', as: 'Code', lang: 'rust', source: { title: 'Why is the indexer slow?', path: '~/Work/plans/transcripts/2026-10-07-indexer-perf.md', line: 41 }, at: Date.now() - 1000 * 60 * 60 * 20, app: 'Marxy', pinned: false },
    { text: 'Standup moved to 9:45 tomorrow, rehearsal still Thursday.', as: 'Plain', source: null, at: Date.now() - 1000 * 60 * 60 * 26, app: 'Slack', pinned: false }
  ];
  G.clips = {
    items: store.get('clips', null) || seedClips,
    // Pinned clips never expire and never count toward the history limit.
    save() {
      const cutoff = Date.now() - G.prefs.clipExpireDays * 864e5; let kept = 0;
      this.items = this.items.filter((x) => x.pinned || (x.at >= cutoff && kept++ < G.prefs.clipLimit));
      store.set('clips', this.items);
    },
    add(c) {
      // Re-copying existing text moves it to the top and keeps its pin and history fields.
      const old = this.items.find((x) => x.text === c.text);
      const item = Object.assign({ app: 'Marxy', pinned: false }, old || {}, c, { at: Date.now(), pinned: old ? old.pinned : !!c.pinned });
      this.items = [item].concat(this.items.filter((x) => x !== old));
      this.save(); G.emit('clips', this.items); return item;
    },
    remove(i) { this.items.splice(i, 1); this.save(); G.emit('clips', this.items); },
    togglePin(i) { this.items[i].pinned = !this.items[i].pinned; this.save(); G.emit('clips', this.items); }
  };
  // Collect mode: copies append to a stack, copied out in one go.
  G.stack = {
    on: false, items: [],
    toggle() { this.on = !this.on; G.emit('stack', this); G.toast(this.on ? 'Collecting: copies now stack up' : `Collect off · ${this.items.length} item${this.items.length === 1 ? '' : 's'} in the stack`, { icon: 'layers' }); },
    joined(sep = '\n\n') { return this.items.map((x) => x.text).join(sep); },
    remove(i) { this.items.splice(i, 1); G.emit('stack', this); },
    move(i, d) { const j = i + d; if (j < 0 || j >= this.items.length) return; [this.items[i], this.items[j]] = [this.items[j], this.items[i]]; G.emit('stack', this); },
    clear() { this.items = []; G.emit('stack', this); }
  };

  G.writeClipboard = async (text, html) => {
    try {
      if (html && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      } else await navigator.clipboard.writeText(text);
      return true;
    } catch (e) { return false; }
  };
  G.copy = (text, opts = {}) => {
    let out = text;
    const prose = opts.clean !== false && opts.as !== 'Code';
    if (prose && G.prefs.stripEmoji) out = G.transform('strip-emoji', out);
    if (prose && G.prefs.smartPunctOnCopy) out = G.transform('smart-punct', out);
    G.writeClipboard(out, opts.html);
    if (G.prefs.clipHistory) G.clips.add({ text: out, as: opts.as || 'Markdown', source: opts.source || (G.current ? { title: G.current.title, path: G.current.path, line: opts.line } : null), lang: opts.lang });
    if (G.stack.on) { G.stack.items.push({ text: out }); G.emit('stack', G.stack); }
    const chars = out.length;
    // A quiet confirmation: what was copied, in which format, how much.
    const rk = G.measureKeys(G.current && G.current.kind); const tk = rk.includes('chars') ? ['chars'].concat(rk.includes('tokens') ? ['tokens'] : rk.filter((k) => k !== 'chars').slice(0, 1)) : rk.slice(0, 2);
    G.toast(`${G.stack.on ? 'Stacked' : 'Copied'} as ${esc(opts.as || 'text')} · ${G.measure(out, { keys: tk })}`, { icon: G.stack.on ? 'layers' : 'check', quiet: true, ms: 2200, action: opts.undo ? { label: 'Undo', run: opts.undo } : null });
    return out;
  };

  /* ---------- Transforms ---------- */

  const EMOJI = /(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s?/gu;
  const PREAMBLE = /^(?:sure|certainly|absolutely|of course|great question|happy to help|okay|ok|alright)\b[^\n]*(?:\n(?!\n)[^\n]*)*/i;
  const HERE = /^(?:here(?:'s| is| are)\b)[^\n]*:\s*$/i;
  const CLOSER = /(?:i hope (?:this|that) helps|let me know if|feel free to|hope (?:this|that) helps|happy to (?:help|adjust)|don't hesitate)/i;

  const splitBlocks = (s) => s.split(/\n{2,}/);
  const mapProse = (s, fn) => {
    // Apply fn to text outside fenced code blocks only.
    const parts = s.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[^\n]*$)/m);
    return parts.map((p, i) => (i % 2 ? p : fn(p))).join('');
  };
  const mdToPlain = (s) => mapProse(s, (p) => p
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?\[!(\w+)\]\s*$/gim, '$1:')
    .replace(/^>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '- ')
    .replace(/^\|?\s*:?-{2,}.*$/gm, '')
    .replace(/^\|(.*)\|\s*$/gm, (m, row) => row.split('|').map((c) => c.trim()).join('\t'))
  ).replace(/^(```|~~~)[^\n]*\n/gm, '').replace(/\n{3,}/g, '\n\n').trim();

  const cellsOf = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const tableBlocks = (s) => {
    const out = []; const lines = s.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/\|/.test(lines[i]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const rows = [cellsOf(lines[i])]; let j = i + 2;
        while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim()) rows.push(cellsOf(lines[j++]));
        out.push(rows); i = j;
      }
    }
    return out;
  };
  const csvCell = (c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
  const titleCase = (t) => t.replace(/\w\S*/g, (w, i) => (i > 0 && /^(a|an|and|as|at|but|by|for|in|of|on|or|the|to|vs|via)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)));
  const fences = (s) => Array.from(s.matchAll(/^(```|~~~)([^\n]*)\n([\s\S]*?)^\1\s*$/gm)).map((m) => ({ lang: m[2].trim().split(/\s+/)[0] || '', code: m[3].replace(/\n$/, '') }));
  const sectionsOf = (s) => {
    const out = []; let cur = null; let fence = false;
    s.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n').forEach((l) => {
      if (/^(```|~~~)/.test(l)) fence = !fence;
      const h = !fence && l.match(/^(#{1,3})\s+(.*)/);
      if (h) { cur = { level: h[1].length, title: h[2], body: [] }; out.push(cur); } else if (cur) cur.body.push(l);
    });
    return out;
  };
  const firstSentence = (t) => {
    const p = mdToPlain(t).split(/\n{2,}/).find((x) => x.trim() && !/^(- |\d+\.)/.test(x.trim()) && !/\t/.test(x)) || '';
    const m = p.replace(/\s+/g, ' ').match(/^.*?[.!?](?=\s|$)/);
    return (m ? m[0] : p).trim();
  };

  G.transforms = [
    // Clean
    { id: 'strip-emoji', group: 'Clean', icon: 'smile', name: 'Remove emoji', desc: 'Outside code blocks', fn: (s) => mapProse(s, (p) => p.replace(EMOJI, '')) },
    { id: 'strip-frontmatter', group: 'Clean', icon: 'file-minus', name: 'Remove front matter', fn: (s) => s.replace(/^---\n[\s\S]*?\n---\n+/, '') },
    { id: 'strip-citations', group: 'Clean', icon: 'quote', name: 'Remove citation markers', desc: '[1], [^note], 【1】', fn: (s) => mapProse(s, (p) => p.replace(/\s?\[\d+\]|\s?【[^】]*】/g, '').replace(/\[\^[^\]]+\](?!:)/g, '').replace(/^\[\^[^\]]+\]:.*$/gm, '')) },
    { id: 'strip-bold', group: 'Clean', icon: 'bold', name: 'Remove bold', desc: 'Keep the words', fn: (s) => mapProse(s, (p) => p.replace(/(\*\*|__)(.+?)\1/g, '$2')) },
    { id: 'strip-hr', group: 'Clean', icon: 'separator-horizontal', name: 'Remove horizontal rules', fn: (s) => mapProse(s, (p) => p.replace(/^\s*([-*_])(\s*\1){2,}\s*$\n?/gm, '')) },
    { id: 'collapse-blank', group: 'Clean', icon: 'fold-vertical', name: 'Collapse blank lines', fn: (s) => s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n') },
    { id: 'normalize-bullets', group: 'Clean', icon: 'list', name: 'Normalise list markers', desc: '* and + become -', fn: (s) => mapProse(s, (p) => p.replace(/^(\s*)[*+]\s+/gm, '$1- ')) },
    { id: 'normalize-headings', group: 'Clean', icon: 'heading', name: 'Normalise heading levels', desc: 'Start at H1, no skipped levels', fn: (s) => {
      let last = 0; const min = Math.min(...(s.match(/^#{1,6}(?=\s)/gm) || ['#']).map((h) => h.length));
      return mapProse(s, (p) => p.replace(/^(#{1,6})(?=\s)/gm, (h) => { let lv = h.length - min + 1; if (lv > last + 1) lv = last + 1; last = lv; return '#'.repeat(lv); }));
    } },
    { id: 'demote', group: 'Clean', icon: 'arrow-down-right', name: 'Demote headings', fn: (s) => mapProse(s, (p) => p.replace(/^(#{1,5})(?=\s)/gm, '#$1')) },
    { id: 'promote', group: 'Clean', icon: 'arrow-up-left', name: 'Promote headings', fn: (s) => mapProse(s, (p) => p.replace(/^#(#{1,5})(?=\s)/gm, '$1')) },
    { id: 'unwrap', group: 'Clean', icon: 'wrap-text', name: 'Unwrap hard-wrapped lines', desc: 'Join lines inside paragraphs; lists, tables, code untouched', fn: (s) => mapProse(s, (p) => p.split(/\n{2,}/).map((b) => (/^(\s*[-*+]|\s*\d+\.|\s*\||\s*>|#)/m.test(b) ? b : b.replace(/\n(?!\n)/g, ' '))).join('\n\n')) },
    { id: 'wrap-80', group: 'Clean', icon: 'ruler', name: 'Hard-wrap at 80', fn: (s) => mapProse(s, (p) => p.split('\n').map((l) => {
      if (l.length <= 80 || /^\s*\|/.test(l)) return l;
      const ind = l.match(/^\s*(?:[-*+]\s+|\d+\.\s+)?/)[0]; const pad = ' '.repeat(ind.length); const out = []; let line = '';
      l.slice(ind.length).split(' ').forEach((w) => { if ((line + ' ' + w).trim().length + ind.length > 80) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; });
      out.push(line); return out.map((x, i) => (i ? pad : ind) + x).join('\n');
    }).join('\n')) },
    { id: 'smart-punct', group: 'Clean', icon: 'quote', name: 'Smart punctuation', desc: 'Curly quotes, en/em dashes, ellipses; skips code', fn: (s) => mapProse(s, (p) => p.split(/(`[^`]*`)/).map((t, i) => (i % 2 ? t : t
      .replace(/(^|[\s(\[{"])'(?=\d0s)/g, '$1’').replace(/(^|[\s(\[{])"/g, '$1“').replace(/"/g, '”')
      .replace(/(^|[\s(\[{])'/g, '$1‘').replace(/'/g, '’').replace(/(\d)\s?-\s?(\d)/g, '$1–$2').replace(/ -- | --(?=\w)/g, '—').replace(/\.\.\./g, '…'))).join('')) },
    { id: 'straight-punct', group: 'Clean', icon: 'quote', name: 'Straight punctuation', fn: (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, '--').replace(/–/g, '-').replace(/…/g, '...') },
    // Convert
    { id: 'to-plain', group: 'Convert', icon: 'type', name: 'Markdown → plain text', fn: mdToPlain },
    { id: 'to-slack', group: 'Convert', icon: 'message-circle', name: 'Markdown → Slack', desc: 'mrkdwn: *bold*, _italic_, <url|text>', fn: (s) => mapProse(s.replace(/^---\n[\s\S]*?\n---\n+/, ''), (p) => p
      .replace(/^#{1,6}\s+(.*)$/gm, '\u0001$1\u0001').replace(/(\*\*|__)(.+?)\1/g, '\u0001$2\u0001').replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1_$2_')
      .replace(/\u0001/g, '*').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>').replace(/^(\s*)[-*+]\s+\[x\]\s+/gim, '$1• [x] ').replace(/^(\s*)[-*+]\s+\[ \]\s+/gm, '$1• [ ] ').replace(/^(\s*)[-*+]\s+/gm, '$1• ')
      .replace(/^>\s?\[!(\w+)\]\s*$/gim, (m, t) => '> *' + t[0] + t.slice(1).toLowerCase() + '*')) },
    { id: 'to-jira', group: 'Convert', icon: 'square-kanban', name: 'Markdown → Jira wiki', fn: (s) => {
      let out = s.replace(/^---\n[\s\S]*?\n---\n+/, '');
      out = out.replace(/^(```|~~~)(\w*)[^\n]*\n([\s\S]*?)^\1\s*$/gm, (m, f, lang, code) => `{code${lang ? ':' + lang : ''}}\n${code}{code}`);
      return out.split(/(\{code[^}]*\}[\s\S]*?\{code\})/).map((p, i) => (i % 2 ? p : p
        .replace(/^(#{1,6})\s+(.*)$/gm, (m, h, t) => `h${h.length}. ${t}`)
        .replace(/(\*\*|__)(.+?)\1/g, '\u0001$2\u0001').replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1_$2_').replace(/\u0001/g, '*')
        .replace(/`([^`]+)`/g, '{{$1}}').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]')
        .replace(/^(\s*)[-*+]\s+\[x\]\s+/gim, '$1* (/) ').replace(/^(\s*)[-*+]\s+\[ \]\s+/gm, '$1* ( ) ')
        .replace(/^( *)[-*+]\s+/gm, (m, sp) => '*'.repeat(1 + sp.length / 2) + ' ').replace(/^( *)\d+\.\s+/gm, (m, sp) => '#'.repeat(1 + sp.length / 2) + ' ')
        .replace(/^>\s?\[!(\w+)\]\s*\n((?:>.*\n?)*)/gim, (m, t, body) => `{${/warn|caution/i.test(t) ? 'warning' : 'info'}}\n${body.replace(/^>\s?/gm, '')}{${/warn|caution/i.test(t) ? 'warning' : 'info'}}\n`)
        .replace(/^\|(.*)\|\s*\n\|?\s*:?-{2,}.*\n/gm, (m, h) => '||' + h.split('|').map((c) => c.trim()).join('||') + '||\n'))).join('');
    } },
    { id: 'to-html', group: 'Convert', icon: 'code-xml', name: 'Markdown → HTML', fn: (s) => (G.md ? G.md.render(s, { bare: true }).html : s) },
    { id: 'tsv-to-table', group: 'Convert', icon: 'table', name: 'TSV / CSV → Markdown table', fn: (s) => {
      const rows = s.trim().split('\n').map((l) => (l.includes('\t') ? l.split('\t') : l.split(',')).map((c) => c.trim().replace(/^"|"$/g, '')));
      if (!rows.length) return s;
      const num = rows[0].map((_, c) => rows.slice(1).every((r) => /^-?[\d.,:%]+$/.test(r[c] || '')));
      return ['| ' + rows[0].join(' | ') + ' |', '|' + num.map((n) => (n ? '---:' : '---')).join('|') + '|'].concat(rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |')).join('\n');
    } },
    { id: 'table-to-csv', group: 'Convert', icon: 'sheet', name: 'Markdown table → CSV', fn: (s) => tableBlocks(s).map((rows) => rows.map((r) => r.map((c) => csvCell(c.replace(/`/g, ''))).join(',')).join('\n')).join('\n\n') || s },
    { id: 'table-to-json', group: 'Convert', icon: 'braces', name: 'Markdown table → JSON', fn: (s) => { const t = tableBlocks(s)[0]; if (!t) return s; return JSON.stringify(t.slice(1).map((r) => Object.fromEntries(t[0].map((h, i) => [h, (r[i] || '').replace(/`/g, '')]))), null, 2); } },
    { id: 'json-pretty', group: 'Convert', icon: 'braces', name: 'Format JSON', fn: (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; } } },
    { id: 'json-min', group: 'Convert', icon: 'braces', name: 'Minify JSON', fn: (s) => { try { return JSON.stringify(JSON.parse(s)); } catch (e) { return s; } } },
    { id: 'json-string', group: 'Convert', icon: 'quote', name: 'Escape as JSON string', fn: (s) => JSON.stringify(s) },
    { id: 'fence', group: 'Convert', icon: 'square-code', name: 'Wrap in code fence', fn: (s, ctx) => '```' + ((ctx && ctx.lang) || '') + '\n' + s.replace(/\n$/, '') + '\n```' },
    { id: 'quote', group: 'Convert', icon: 'text-quote', name: 'Quote (> )', fn: (s) => s.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') },
    { id: 'unquote', group: 'Convert', icon: 'text-quote', name: 'Unquote', fn: (s) => s.replace(/^>\s?/gm, '') },
    { id: 'indent', group: 'Convert', icon: 'indent-increase', name: 'Indent 4 spaces', fn: (s) => s.replace(/^(?=.)/gm, '    ') },
    { id: 'dedent', group: 'Convert', icon: 'indent-decrease', name: 'Dedent', desc: 'Remove common leading whitespace', fn: (s) => { const m = Math.min(...(s.match(/^[ \t]*(?=\S)/gm) || ['']).map((x) => x.length)); return s.replace(new RegExp('^[ \\t]{' + m + '}', 'gm'), ''); } },
    // Lines
    { id: 'sort', group: 'Lines', icon: 'arrow-down-a-z', name: 'Sort lines', fn: (s) => s.split('\n').sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join('\n') },
    { id: 'sort-unique', group: 'Lines', icon: 'arrow-down-a-z', name: 'Sort and de-duplicate', fn: (s) => Array.from(new Set(s.split('\n'))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join('\n') },
    { id: 'dedupe', group: 'Lines', icon: 'copy-minus', name: 'Remove duplicate lines', desc: 'Keeps first occurrence and order', fn: (s) => Array.from(new Set(s.split('\n'))).join('\n') },
    { id: 'reverse', group: 'Lines', icon: 'arrow-up-down', name: 'Reverse lines', fn: (s) => s.split('\n').reverse().join('\n') },
    { id: 'number', group: 'Lines', icon: 'list-ordered', name: 'Number lines', fn: (s) => s.split('\n').map((l, i) => `${i + 1}. ${l.replace(/^\s*[-*+]\s+/, '')}`).join('\n') },
    { id: 'unnumber', group: 'Lines', icon: 'list', name: 'Remove list markers and numbers', fn: (s) => s.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '') },
    { id: 'join', group: 'Lines', icon: 'between-horizontal-start', name: 'Join lines', fn: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).join(' ') },
    { id: 'to-bullets', group: 'Lines', icon: 'list', name: 'Lines → bullet list', fn: (s) => s.split('\n').filter((l) => l.trim()).map((l) => '- ' + l.trim()).join('\n') },
    // Case
    { id: 'title-headings', group: 'Case', icon: 'case-sensitive', name: 'Title Case headings', fn: (s) => mapProse(s, (p) => p.replace(/^(#{1,6}\s+)(.*)$/gm, (m, h, t) => h + titleCase(t))) },
    { id: 'sentence-headings', group: 'Case', icon: 'case-lower', name: 'Sentence case headings', fn: (s) => mapProse(s, (p) => p.replace(/^(#{1,6}\s+)(.*)$/gm, (m, h, t) => h + t.replace(/(^\w|\s\w)(\w*)/g, (w, a, b, i) => (i === 0 ? a.toUpperCase() : (/^[A-Z]{2,}/.test(a.trim() + b) ? a : a.toLowerCase())) + b))) },
    { id: 'lower', group: 'Case', icon: 'case-lower', name: 'lowercase', fn: (s) => s.toLowerCase() },
    { id: 'upper', group: 'Case', icon: 'case-upper', name: 'UPPERCASE', fn: (s) => s.toUpperCase() },
    { id: 'slug', group: 'Case', icon: 'link', name: 'slugify', fn: (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-') },
    // Extract
    { id: 'x-code', group: 'Extract', icon: 'file-code-2', name: 'All code blocks', fn: (s) => fences(s).map((f) => '```' + f.lang + '\n' + f.code + '\n```').join('\n\n') },
    { id: 'x-commands', group: 'Extract', icon: 'square-terminal', name: 'Shell commands as a script', fn: (s) => '#!/usr/bin/env bash\nset -euo pipefail\n\n' + fences(s).filter((f) => /^(bash|sh|shell|zsh|console)$/.test(f.lang)).map((f) => f.code.replace(/^\$ /gm, '')).join('\n\n') },
    { id: 'x-tasks', group: 'Extract', icon: 'list-checks', name: 'Open tasks', fn: (s) => (s.match(/^\s*[-*+]\s+\[ \]\s+.*$/gm) || []).map((l) => l.trim()).join('\n') },
    { id: 'x-links', group: 'Extract', icon: 'link', name: 'Links', fn: (s) => Array.from(new Set((s.match(/\[[^\]]+\]\([^)]+\)|<https?:[^>]+>|https?:\/\/[^\s)>]+/g) || []))).join('\n') },
    { id: 'x-paths', group: 'Extract', icon: 'folder-tree', name: 'File paths mentioned', fn: (s) => Array.from(new Set((s.match(/`([~.\w-]*\/[\w.\/-]+\.\w{1,6})`/g) || []).map((x) => x.replace(/`/g, '')))).join('\n') },
    { id: 'x-headings', group: 'Extract', icon: 'list-tree', name: 'Outline', fn: (s) => s.split(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[^\n]*$/m).join('').split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => '  '.repeat(l.match(/^#+/)[0].length - 1) + '- ' + l.replace(/^#+\s+/, '')).join('\n') },
    { id: 'x-tables', group: 'Extract', icon: 'table-2', name: 'Tables as CSV', fn: (s) => tableBlocks(s).map((rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n')).join('\n\n') },
    { id: 'x-questions', group: 'Extract', icon: 'circle-help', name: 'Open questions', fn: (s) => (s.match(/^[^\n]*\?\s*$/gm) || []).map((l) => l.replace(/^\s*[-*+]\s+/, '- ')).join('\n') }
  ];
  G.transform = (id, text, ctx) => { const t = G.transforms.find((x) => x.id === id); return t ? t.fn(text, ctx || {}) : text; };

  // Copy formats offered in every "Copy as" menu.
  G.copyFormats = [
    { id: 'markdown', name: 'Markdown', icon: 'file-text', kbd: '⌘C', fn: (s) => s },
    { id: 'plain', name: 'Plain text', icon: 'type', fn: (s) => G.transform('to-plain', s) },
    { id: 'rich', name: 'Rich text', icon: 'pilcrow', desc: 'For Mail, Docs and Notes: writes HTML and plain text together', fn: (s) => G.transform('to-plain', s), html: (s) => G.transform('to-html', s) },
    { id: 'html', name: 'HTML', icon: 'code-xml', fn: (s) => G.transform('to-html', s) },
    { id: 'codeblock', name: 'Code block with path', icon: 'square-code', desc: 'A fenced block titled with the file path', fn: (s) => { const f = s.includes('```') ? '````' : '```'; return `${f}${(G.current && G.current.lang) || 'md'} title="${(G.current && G.current.path) || 'untitled'}"\n${s.replace(/\n$/, '')}\n${f}`; } },
    { id: 'slack', name: 'Slack', icon: 'message-circle', fn: (s) => G.transform('to-slack', s) },
    { id: 'jira', name: 'Jira / Confluence wiki', icon: 'square-kanban', fn: (s) => G.transform('to-jira', s) },
    { id: 'json', name: 'JSON string', icon: 'braces', fn: (s) => G.transform('json-string', s) },
    { id: 'quote', name: 'Quote with source link', icon: 'text-quote', fn: (s) => G.transform('quote', s) + `\n>\n> — [${G.current?.title || 'source'}](${G.current?.path || ''})` }
  ];
  G.copyAs = (fmtId, text, extra = {}) => {
    const f = G.copyFormats.find((x) => x.id === fmtId) || G.copyFormats[0];
    return G.copy(f.fn(text), Object.assign({ as: f.name, html: f.html ? f.html(text) : undefined, clean: false }, extra));
  };
  // The five formats people reach for sit on top; the rest are one step away.
  const PRIMARY_FORMATS = ['markdown', 'plain', 'rich', 'html', 'codeblock'];
  G.copyMenu = (anchor, getText, extra = {}) => {
    const item = (f) => ({ label: f.name, icon: f.icon, kbd: f.kbd, desc: f.desc, run: () => G.copyAs(f.id, getText(), extra) });
    return G.menu(anchor, [{ header: extra.header || 'Copy as' }].concat(G.copyFormats.filter((f) => PRIMARY_FORMATS.includes(f.id)).map(item)), { width: 250, align: extra.align });
  };

  G.transformMenu = (anchor, getText, apply, opts = {}) => {
    const groups = ['Clean', 'Convert', 'Lines', 'Case'];
    G.menu(anchor, groups.map((g) => ({ label: g, icon: { Clean: 'eraser', Convert: 'repeat', Lines: 'list', Case: 'case-sensitive', Extract: 'scissors' }[g], sub: G.transforms.filter((t) => t.group === g).map((t) => ({ label: t.name, icon: t.icon, desc: t.desc, run: () => apply(t, t.fn(getText(), opts.ctx || {})) })) })), { width: 240 });
  };

  /* ---------- Pages ---------- */

  G.pages = {
    index: 'index.html', workspace: '01-workspace.html', source: '02-source.html', kinds: '03-content-modes.html',
    palette: '04-palette.html', collections: '05-collections.html', clipboard: '06-clipboard.html',
    themes: '07-themes.html', settings: '08-settings.html', macos: '09-macos.html'
  };
  G.page = (k) => G.pages[k] || k;

  /* ---------- Commands ---------- */

  G.commands = [];
  G.command = (c) => { G.commands = G.commands.filter((x) => x.id !== c.id).concat([c]); return c; };
  G.run = (id, arg) => { const c = G.commands.find((x) => x.id === id); if (c) c.run(arg); else G.toast(`"${esc(id)}" is wired in the full app`, { icon: 'info' }); };

  [
    ['go-workspace', 'Go to Workspace', 'app-window', '', () => (location.href = G.page('workspace'))],
    ['go-source', 'Go to Source editor', 'square-code', '', () => (location.href = G.page('source'))],
    ['go-kinds', 'Go to Content modes', 'shapes', '', () => (location.href = G.page('kinds'))],
    ['go-collections', 'Open Library', 'library', '⌃⌘L', () => (location.href = G.page('collections'))],
    ['go-themes', 'Open Theme picker', 'palette', '', () => (location.href = G.page('themes'))],
    ['go-settings', 'Open Settings', 'settings', '⌘,', () => (location.href = G.page('settings'))],
    ['go-index', 'Prototype index', 'layout-grid', '', () => (location.href = G.page('index'))],
    ['toggle-sidebar', 'Show / Hide sidebar', 'panel-left', '⌃⌘S', (t) => { const fromSidebar = t && t.closest && t.closest('.sidebar'); G.toggleSidebar(); if (fromSidebar && G.ui.focusToggle) G.ui.focusToggle(); }],
    ['fold-toggle', 'Fold / Unfold workspace', 'fold-horizontal', '⌘\\', () => G.fold.toggle()],
    ['theme-next', 'Next theme', 'sun-moon', '⌃⌘T', () => { const ids = G.themes.map((t) => t.id); G.setPref('theme', ids[(ids.indexOf(G.resolvedTheme()) + 1) % ids.length]); G.toast('Theme: ' + G.themes.find((t) => t.id === G.resolvedTheme()).name, { icon: 'palette' }); }],
    ['theme-system', 'Theme: follow system', 'monitor', '', () => G.setPref('theme', 'system')],
    ['scale-up', 'Increase text size', 'a-arrow-up', '⌘+', () => G.setPref('scale', Math.min(2.5, +(G.prefs.scale + 0.1).toFixed(2)))],
    ['scale-down', 'Decrease text size', 'a-arrow-down', '⌘−', () => G.setPref('scale', Math.max(0.75, +(G.prefs.scale - 0.1).toFixed(2)))],
    ['scale-reset', 'Actual size', 'a-large-small', '⌘0', () => G.setPref('scale', 1)],
    ['reindex', 'Re-index all collections', 'refresh-cw', '', () => G.toast('Re-indexing 1,290 files in the background', { icon: 'refresh-cw' })],
    ['add-folder', 'Add folder or repository to library…', 'folder-plus', '⌥⌘O', () => (location.href = G.page('collections') + '#add')]
  ].forEach(([id, name, icon, kbd, run]) => G.command({ id, name, icon, kbd, group: id.startsWith('go-') ? 'Navigate' : id.startsWith('theme') || id.startsWith('scale') || id.startsWith('fold') || id === 'toggle-sidebar' ? 'View' : id.startsWith('collect') || id.startsWith('copy') ? 'Copy' : 'Library', run }));
  // Files: new, fork, copy. (Copying lives in the reading and source views; there is no separate studio.)
  G.command({ id: 'new-file', name: 'New file', icon: 'file-plus-2', kbd: '⌘N', group: 'File', desc: 'An untitled document; nothing is written until Save As', run: () => G.newFile() });
  G.command({ id: 'new-file-here', name: 'New file in this folder…', icon: 'folder-plus', group: 'File', run: () => G.newFileIn() });
  G.command({ id: 'fork', name: 'Fork this file', icon: 'git-fork', kbd: '⇧⌘N', group: 'File', desc: 'Writes a copy beside the original as “name (fork)” and opens it in a new tab', run: () => G.forkDoc() });
  G.command({ id: 'save', name: 'Save', icon: 'save', kbd: '⌘S', group: 'File', run: () => G.saveDoc() });
  G.command({ id: 'toggle-metadata', name: 'Show / Hide metadata', icon: 'info', kbd: '⌃⌘I', group: 'View', desc: 'Front matter, modified date, size and Git state in the margin beside the text', run: () => (G.metaToggle ? G.metaToggle() : G.toast('Metadata shows in the Workspace: beside the text when there is room, else in the inspector’s Metadata tab', { icon: 'info', quiet: true })) });
  G.command({ id: 'src-whitespace', name: 'Show / hide whitespace in Source', icon: 'pilcrow', kbd: '⌥⌘W', group: 'Source', run: () => G.setPref('edShowWs', !G.prefs.edShowWs) });
  G.command({ id: 'new-menu', name: 'New file menu', icon: 'plus', group: 'File', run: (a) => G.newMenu(a && a.getBoundingClientRect ? a : { left: innerWidth - 60, right: innerWidth - 60, top: 56, bottom: 56 }) });
  G.command({ id: 'copy-doc', name: 'Copy document as Markdown', icon: 'copy', group: 'Copy', run: () => G.copyScoped ? G.copyScoped('document') : G.copy(G.current ? G.current.src : '', { as: 'Markdown' }) });
  G.command({ id: 'copy-as', name: 'Copy as…', icon: 'clipboard-copy', kbd: '⇧⌘C', group: 'Copy', desc: 'Markdown, plain text, rich text, HTML, code block with path: for the selection, else the block under the pointer, else the document', run: (a) => G.copyAsScoped && G.copyAsScoped(a && a.getBoundingClientRect ? a : null) });
  G.themes.forEach((t) => G.command({ id: 'theme-' + t.id, name: 'Theme: ' + t.name, icon: t.mode === 'dark' ? 'moon' : 'sun', group: 'Theme', run: () => G.setPref('theme', t.id) }));
  // Transforms live in the palette under ">" as "Transform: …" (⌘/ opens it there): Enter copies the result, ⌘↵ replaces the text.
  G.transforms.filter((t) => t.group !== 'Extract').forEach((t) => G.command({ id: 'tf-' + t.id, name: t.name, icon: t.icon, group: 'Transform', desc: t.group + (t.desc ? ' · ' + t.desc : ''), tf: t, run: () => { const sel = G.selectionText && G.selectionText(); G.copy(t.fn(sel || (G.current ? G.current.src : ''), { path: G.current && G.current.path }), { as: t.name }); } }));
  // Extract has no key: it is in the verb menu (right-click, or Enter on a selection) and here, ">Extract …".
  [['x-code', 'Code blocks', 'file-code-2'], ['x-shell', 'Shell commands', 'square-terminal'], ['x-links', 'Links', 'link'], ['x-tables', 'Tables as CSV', 'table-2']].forEach(([id, name, icon]) => G.command({ id: 'extract-' + id, name, icon, group: 'Extract', desc: 'From the selection, else the document; copies the result', run: () => { const src = (G.selectionText && G.selectionText()) || (G.current ? G.current.src : ''); G.copy(id === 'x-shell' ? G.shellCommands(src) : G.transform(id, src), { as: name.toLowerCase(), clean: false }); } }));
  G.typesets.forEach((t) => G.command({ id: 'typeset-' + t.id, name: 'Type set: ' + t.name, icon: 'type', group: 'Theme', desc: t.desc, run: () => G.setPref('typeset', t.id) }));

  /* ---------- Documents the reader makes (new files, forks) and the Recent list ----------
     A new file is a buffer: it writes nothing until Save As. A fork is written at once, beside the original. */

  G.userDocs = store.get('userDocs', {}) || {};
  const saveUserDocs = () => { store.set('userDocs', G.userDocs); G.tree && G.tree.reset(); };
  G.saveUserDocs = saveUserDocs;
  // Documents a page registers for rows the library does not carry (the Library's extra rows).
  G.pageDocs = {};
  G.docById = (id) => G.doc(id) || G.userDocs[id] || G.pageDocs[id] || (G.synth && G.synth(id)) || null;
  // A link in a document to another file: its document id when the file is in the library or a tree, else null.
  G.resolveLink = (href, from) => {
    let p = String(href || '').split('#')[0]; if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null;
    try { p = decodeURI(p); } catch (e) { /* keep as written */ }
    const norm = (x) => { const out = []; x.split('/').forEach((seg) => { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }); return out.join('/'); };
    const abs = p.startsWith('~/') ? '~/' + norm(p.slice(2)) : '~/' + norm((from && from.path ? from.path.replace(/^~\//, '').replace(/[^/]+$/, '') : '') + p);
    const lib = G.library.find((d) => d.path === abs); if (lib) return lib.id;
    const c = G.collections.find((x) => abs.startsWith(x.path + '/')); if (!c) return null;
    const parts = abs.slice(c.path.length + 1).split('/'); const name = parts.pop(); const hit = G.tree.children(c.id, parts.join('/')).files.find((f) => f.name === name);
    return hit ? hit.id : null;
  };
  // Library rows plus the files made in this prototype, for the palette and lists.
  G.allFiles = () => G.library.concat(Object.values(G.userDocs).map((d) => ({ id: d.id, collection: d.collection, kind: d.kind, path: d.path || 'Unsaved/' + d.title, title: d.title, modified: d.modified || 'just now', words: G.stats(d.src || '').words, status: {}, hasSrc: true, lang: d.lang || '' })));
  G.recent = {
    ids() { return (store.get('recent', null) || G.recentSeed || []).filter((id) => G.docById(id)); },
    push(id) { if (!G.docById(id)) return; store.set('recent', [id].concat(this.ids().filter((x) => x !== id)).slice(0, 12)); },
    docs(n = 8) { return this.ids().slice(0, n).map((id) => G.docById(id)); }
  };

  const nowLabel = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
  const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const splitName = (n) => { const m = n.match(/^(.*?)(\.[^./]+)?$/); return [m[1], m[2] || '']; };
  const collOfPath = (path) => G.collections.filter((c) => path === c.path || path.startsWith(c.path + '/')).sort((a, b) => b.path.length - a.path.length)[0];
  const relIn = (c, dir) => (dir === c.path ? '' : dir.slice(c.path.length + 1));
  const taken = (dir, name) => { const c = collOfPath(dir); return Object.values(G.userDocs).some((u) => u.path === dir + '/' + name) || (c && G.tree.children(c.id, relIn(c, dir)).files.some((f) => f.name === name)); };
  const unique = (dir, name) => { if (!taken(dir, name)) return name; const [stem, ext] = splitName(name); for (let n = 2; ; n++) if (!taken(dir, `${stem} ${n}${ext}`)) return `${stem} ${n}${ext}`; };

  // A new document. With a folder it has that path (and appears in its tree); without, it is an untitled scratch buffer.
  G.newDoc = (o = {}) => {
    const cur = G.current && G.docById(G.current.id); const scratch = !o.folder;
    const c = o.folder ? collOfPath(o.folder) : null;
    const name = scratch ? null : unique(o.folder, o.name || 'untitled.md');
    const kind = scratch ? 'notes' : G.tree.kindOfName(name, name);
    const n = Object.values(G.userDocs).filter((d) => d.scratch).length;
    const title = scratch ? 'Untitled' + (n ? ' ' + (n + 1) : '') : name;
    const d = { id: uid(), collection: c ? c.id : (cur && cur.collection) || 'plans', kind, path: scratch ? '' : o.folder + '/' + name, lang: ['code', 'data'].includes(kind) ? G.langOfPath(name) : '', title, created: nowLabel(), modified: 'just now', status: {}, unsaved: true, scratch, src: o.src != null ? o.src : (scratch || !/\.(md|markdown|txt)$/.test(name) ? '' : '# ' + splitName(name)[0] + '\n\n') };
    G.userDocs[d.id] = d; saveUserDocs(); return d;
  };
  // Show a document in a new tab; from a page without tabs, go to the workspace, which opens it there.
  G.openAny = (id) => { if (G.openDoc) G.openDoc(id, { newTab: true }); else location.href = hrefDoc(id); };
  G.removeUserDoc = (id) => { delete G.userDocs[id]; saveUserDocs(); G.emit('docs-changed', { removed: id }); };

  G.newFile = () => {
    const d = G.newDoc({});
    G.openAny(d.id);
    G.toast('New untitled document · it writes nothing until you Save As', { icon: 'file-plus-2', quiet: true, ms: 2600 });
    return d;
  };
  const defaultFolder = () => { const cur = G.current && G.docById(G.current.id); return cur && cur.path ? cur.path.replace(/\/[^/]+$/, '') : G.collections[0].path; };
  G.newFileIn = (folder) => G.fileSheet({
    title: 'New file', okLabel: 'Create', name: 'untitled.md', folder: folder || defaultFolder(),
    hint: 'The file is created in the folder when you save it.',
    onOk: ({ name, folder: f }) => { const d = G.newDoc({ folder: f, name }); G.openAny(d.id); G.toast(`Created <b>${esc(d.title)}</b> in ${esc(f.replace(/^~\//, '~/'))}`, { icon: 'file-plus-2', quiet: true }); }
  });
  G.forkDoc = (d) => {
    d = d || (G.current && G.docById(G.current.id));
    if (!d) return G.toast('Open a document to fork it', { icon: 'info' });
    const dir = d.path ? d.path.replace(/\/[^/]+$/, '') : ''; const [stem, ext] = splitName(d.path ? d.path.split('/').pop() : d.title);
    let name = `${stem} (fork)${ext}`;
    if (dir) for (let k = 2; taken(dir, name); k++) name = `${stem} (fork ${k})${ext}`;
    const f = { id: uid(), collection: d.collection, kind: d.kind, lang: d.lang || '', path: dir ? dir + '/' + name : '', title: name, created: nowLabel(), modified: 'just now', status: {}, src: d.src, fork: true, forkOf: d.id, unsaved: !dir, scratch: !dir };
    G.userDocs[f.id] = f; saveUserDocs();
    const undo = () => G.removeUserDoc(f.id);
    if (G.openDoc) { G.openDoc(f.id, { newTab: true }); G.toast(`Forked to <b>${esc(name)}</b> ·`, { icon: 'git-fork', action: { label: 'Undo', run: undo } }); }
    else { store.set('pendingToast', { msg: `Forked to <b>${esc(name)}</b> ·`, icon: 'git-fork', undo: f.id }); location.href = hrefDoc(f.id); }
    return f;
  };
  // A small dialog: a name and a folder.
  G.fileSheet = (o) => {
    G.closeMenu();
    const cur = G.current && G.docById(G.current.id);
    const opts = G.collections.map((c) => [c.path, `${c.name}  ·  ${c.path}`]);
    const here = o.folder || (cur && cur.path ? cur.path.replace(/\/[^/]+$/, '') : '');
    if (here && !opts.some(([p]) => p === here)) opts.unshift([here, `This folder  ·  ${here}`]);
    const sc = el(`<div class="dlg-scrim" role="dialog" aria-modal="true" aria-label="${esc(o.title)}"><form class="dlg">
      <h3>${esc(o.title)}</h3>
      <label>Name<input class="field" name="name" value="${esc(o.name || '')}" spellcheck="false" autocomplete="off"></label>
      <label>Folder<select class="field" name="folder">${opts.map(([p, l]) => `<option value="${esc(p)}"${p === here ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      ${o.hint ? `<p class="hint">${esc(o.hint)}</p>` : ''}
      <div class="dlg-f"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${esc(o.okLabel || 'OK')}</button></div></form></div>`);
    document.body.appendChild(sc);
    const form = $('form', sc), inp = $('input', sc);
    const close = () => sc.remove();
    $('[data-x]', sc).onclick = close;
    sc.addEventListener('mousedown', (e) => { if (e.target === sc) close(); });
    sc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    form.addEventListener('submit', (e) => { e.preventDefault(); const name = inp.value.trim(); if (!name) return inp.focus(); close(); o.onOk({ name, folder: form.folder.value }); });
    inp.focus(); inp.setSelectionRange(0, splitName(inp.value)[0].length);
  };
  // Save: a document with a path is written where it is; an untitled one asks for a name and folder first.
  G.saveDoc = (d, done) => {
    d = d || (G.current && G.docById(G.current.id)); if (!d) return;
    const finish = () => { d.unsaved = false; d.modified = 'just now'; if (G.userDocs[d.id]) saveUserDocs(); G.emit('docs-changed', { saved: d.id }); done && done(d); G.toast(`Saved <b>${esc(d.path.split('/').pop())}</b>`, { icon: 'save', quiet: true }); };
    if (d.path) return finish();
    G.fileSheet({ title: 'Save As', okLabel: 'Save', name: (d.title || 'Untitled').replace(/\.\w+$/, '') + '.md', folder: defaultFolder(), onOk: ({ name, folder }) => {
      const c = collOfPath(folder); const nm = unique(folder, name);
      Object.assign(d, { path: folder + '/' + nm, title: nm, scratch: false, collection: c ? c.id : d.collection, kind: G.tree.kindOfName(nm, nm) === 'code' ? 'code' : d.kind });
      finish();
    } });
  };
  // The "+" menus in the toolbar and the tab bar.
  G.newMenu = (anchor) => {
    const cur = G.current && G.docById(G.current.id);
    G.menu(anchor, [
      { label: 'New file', icon: 'file-plus-2', kbd: '⌘N', desc: 'An untitled document; nothing is written until Save As', run: () => G.newFile() },
      { label: 'New file in this folder…', icon: 'folder-plus', desc: cur && cur.path ? 'In ' + cur.path.replace(/\/[^/]+$/, '') : '', run: () => G.newFileIn() },
      { label: 'Fork this file', icon: 'git-fork', kbd: '⇧⌘N', desc: 'Write a copy beside this file, named “name (fork)”; the original is never touched', disabled: !cur, run: () => G.forkDoc() },
      { sep: true },
      { label: 'Open file…', icon: 'search', kbd: '⌘K', run: () => G.palette.open('') }
    ], { width: 250 });
  };

  /* ---------- Metadata: everything known about a file ----------
     File, extended attributes, Git, front matter, detection, measures and Marxy's own state. The prototype mocks the values
     plausibly per document; edits are kept in localStorage (`meta`) so they survive a reload. Front matter edits splice
     exactly the affected YAML lines. */

  const hash32 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const agoMs = (str) => {
    str = String(str || '').toLowerCase(); let m;
    if (str === 'just now') return 0; if ((m = str.match(/(\d+)\s*min/))) return +m[1] * 6e4; if ((m = str.match(/(\d+)\s*h/))) return +m[1] * 36e5;
    if (str === 'today') return 95 * 6e4; if (str === 'yesterday') return 26 * 36e5; if ((m = str.match(/(\d+)\s*days?/))) return +m[1] * 864e5;
    if ((m = str.match(/(\d+)\s*weeks?/))) return +m[1] * 7 * 864e5; if (str === 'last month') return 36 * 864e5; if ((m = str.match(/(\d+)\s*months?/))) return +m[1] * 30 * 864e5;
    return 3 * 864e5;
  };
  const FM_LINE = /^([A-Za-z0-9_-]+)(\s*:\s*)(.*)$/;
  const unquote = (r) => { const t = r.trim(); return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t; };
  const quoteLike = (raw, v) => { const q = (raw.trim().match(/^["']/) || [''])[0]; if (q) return q + v + q; return /^[#\[\]{}&*!|>'"%@`]|:\s|\s#/.test(v) ? '"' + v.replace(/"/g, '\\"') + '"' : v; };
  G.fm = {
    // The front matter block: its closing line and each key in authored order, with the line it sits on.
    parse(src) {
      const lines = String(src).split('\n'); if (!lines.length || lines[0].trim() !== '---') return null;
      let end = -1; for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { end = i; break; } if (end < 0) return null;
      const entries = []; for (let i = 1; i < end; i++) { const m = lines[i].match(FM_LINE); if (m) entries.push({ key: m[1], sep: m[2], raw: m[3], value: unquote(m[3]), line: i + 1 }); }
      return { endLine: end + 1, entries, lines };
    },
    // Each returns { src, changed } where changed is the number of lines the edit touched.
    set(src, key, value) { const f = this.parse(src); const e = f && f.entries.find((x) => x.key === key); if (!e) return { src, changed: 0 }; const ls = f.lines.slice(); ls[e.line - 1] = key + e.sep + quoteLike(e.raw, value); return { src: ls.join('\n'), changed: 1 }; },
    add(src, key, value) {
      const f = this.parse(src); const line = key + ': ' + quoteLike('', value);
      if (!f) return { src: '---\n' + line + '\n---\n' + src, changed: 3 };
      const ls = f.lines.slice(); ls.splice(f.endLine - 1, 0, line); return { src: ls.join('\n'), changed: 1 };
    },
    remove(src, key) { const f = this.parse(src); const e = f && f.entries.find((x) => x.key === key); if (!e) return { src, changed: 0 }; const ls = f.lines.slice(); ls.splice(e.line - 1, 1); return { src: ls.join('\n'), changed: 1 }; }
  };
  const SUBJECTS = ['fix(watch): coalesce editor saves into one re-index', 'feat(index): cache highlighted code by content hash', 'docs: rewrite the install section', 'refactor: lift live reload out of app.ts', 'chore: bump dependencies', 'fix(tables): skip empty height cells', 'feat(palette): rank by recency', 'docs(adr): record the decision to pause the fleet'];
  const WHERE_FROM = { reading: 'https://example.org/essays/', inbox: 'https://hooks.example.com/slack/db-ops/' };
  G.meta = {
    ov(id) { return (store.get('meta', {}) || {})[id] || {}; },
    setOv(id, patch) { const m = store.get('meta', {}) || {}; m[id] = Object.assign({}, m[id], patch); store.set('meta', m); G.emit('meta', { id }); },
    get(d) {
      const ov = this.ov(d.id); const info = G.srcInfo ? G.srcInfo(d.src || '') : { bytes: (d.src || '').length, eol: { label: 'LF' }, endsNl: true, enc: 'UTF-8' };
      const name = (d.path || d.title || '').split('/').pop(); const c = G.collections.find((x) => x.id === d.collection); const h = hash32(d.id + (d.path || ''));
      const exec = ov.exec != null ? ov.exec : /\.(sh|zsh|bash)$/.test(name) || /\/bin\//.test(d.path || '');
      const modifiedAt = Date.now() - agoMs(d.modified);
      const repo = c && c.type === 'repo' ? c : null;
      const kinds = d.kind;
      const tags = ov.tags || (c ? ({ plans: ['Work'], projects: ['Work', 'tidemark'], reading: ['Reading'], notes: ['Notes'], inbox: [], marxy: ['Marxy'], dotfiles: [] }[c.id] || []) : []);
      const wf = WHERE_FROM[d.collection];
      const quarantined = ov.quarantine === null ? null : (d.collection === 'reading' || d.collection === 'inbox') ? `0083;${(h % 0xfffffff).toString(16).padStart(8, '0')};Safari;` : null;
      const front = G.fm.parse(d.src || '');
      return {
        file: { path: d.path || '', name, size: info.bytes, created: d.created || stamp(modifiedAt - 20 * 864e5), modified: stamp(modifiedAt), perms: (exec ? 'rwxr-xr-x' : 'rw-r--r--'), mode: exec ? '0755' : '0644', exec, owner: 'ian:staff', encoding: info.enc, eol: info.eol.label, finalNewline: info.endsNl ? 'yes' : 'no' },
        xattr: { tags, whereFrom: wf ? wf + (d.id || '').replace(/[^\w-]/g, '').slice(0, 24) : null, quarantine: quarantined },
        git: repo ? { repo: repo.name, root: repo.path, branch: repo.id === 'marxy' ? 'docs/x-01-direction' : 'main', status: d.unsaved ? 'untracked' : d.status && d.status.changed ? 'modified' : 'clean', commit: { hash: (h >>> 4).toString(16).padStart(7, '0').slice(0, 7), date: stamp(modifiedAt - 2 * 864e5).slice(0, 10), subject: SUBJECTS[h % SUBJECTS.length], author: 'Ian' } } : null,
        front, kind: kinds,
        marxy: { lastRead: ov.lastRead || (d.status && d.status.unread ? 'never' : stamp(modifiedAt - 3 * 36e5)), pinned: !!(d.status && d.status.pinned), readPos: ov.readPos === null ? null : { line: 5 + (h % 40), pct: 8 + (h % 70) } }
      };
    },
    // The compact set shown in the margin: front matter first, then modified, size, git status and branch.
    rows(d, max = 14) {
      const m = this.get(d); const rows = [];
      if (m.front) m.front.entries.forEach((e) => rows.push([e.key, e.value]));
      rows.push(['modified', m.file.modified], ['size', m.file.size.toLocaleString('en-US') + ' bytes']);
      if (m.git) rows.push(['git', m.git.status], ['branch', m.git.branch]);
      return { shown: rows.slice(0, max), more: Math.max(0, rows.length - max) };
    }
  };
  // Renames and pins made earlier are applied to the corpus when the page loads.
  (() => { const all = store.get('meta', {}) || {}; Object.keys(all).forEach((id) => { const o = all[id]; const d = G.doc(id) || null; if (d && o.path) { d.path = o.path; d.title = o.title || d.title; const l = G.library.find((x) => x.id === id); if (l) { l.path = o.path; l.title = d.title; } } if (d && o.pinned != null) { d.status = d.status || {}; d.status.pinned = o.pinned; } }); })();

  /* ---------- Extract: four things, nothing else ---------- */

  const fencesOf = (src) => Array.from(String(src).matchAll(/^(```|~~~)([^\n]*)\n([\s\S]*?)^\1\s*$/gm)).map((m) => ({ lang: (m[2].trim().split(/\s+/)[0] || '').toLowerCase(), code: m[3].replace(/\n$/, '') }));
  // Commands from shell fences, with the prompts stripped.
  G.shellCommands = (src) => fencesOf(src).filter((f) => /^(bash|sh|shell|zsh|console|shellsession)$/.test(f.lang)).map((f) => f.code.replace(/^\s*[$%] /gm, '')).join('\n');
  // The four extractions, as menu items for any text (the verb menu on a selection, or the whole document).
  G.extractItems = (src) => {
    const n = (id) => { const o = G.transform(id, src).trim(); return o ? o.split('\n').filter((l) => l.trim()).length : 0; };
    const code = fencesOf(src).length, sh = fencesOf(src).filter((f) => /^(bash|sh|shell|zsh|console|shellsession)$/.test(f.lang)).length;
    return [
      { label: `Code blocks (${code})`, icon: 'file-code-2', disabled: !code, run: () => G.copy(G.transform('x-code', src), { as: 'code blocks', clean: false }) },
      { label: `Shell commands (${sh})`, icon: 'square-terminal', desc: 'Prompts stripped', disabled: !sh, run: () => G.copy(G.shellCommands(src), { as: 'shell commands', clean: false }) },
      { label: `Links (${n('x-links')})`, icon: 'link', run: () => G.copy(G.transform('x-links', src), { as: 'links' }) },
      { label: `Tables as CSV (${(G.transform('x-tables', src).trim() ? G.transform('x-tables', src).split(/\n\n/).length : 0)})`, icon: 'table-2', run: () => G.copy(G.transform('x-tables', src), { as: 'CSV' }) }
    ];
  };
  G.extractMenu = (anchor, src) => G.menu(anchor, [{ header: 'Extract and copy' }].concat(G.extractItems(src)), { width: 260 });


  /* ---------- Copy and Export: two adjacent controls ----------
     Copy (a split button: a click copies the selection, or the document; the chevron opens Copy as) and Export (a menu:
     PDF, Image, HTML, Word, clean Markdown, Print). Each export opens a small sheet of two or three options and is mocked
     with a toast. Reveal in Finder and Open in external editor live on the title's context menu and in the palette.
     Keys: ⌘C, ⇧⌘C (Copy as at the pointer), ⇧⌘E (Open in external editor). */

  // A small options sheet: { title, hint, fields: [{id, label, type: 'select'|'check', options, value}], okLabel, onOk(values) }.
  G.optionsSheet = (o) => {
    G.closeMenu();
    const sc = el(`<div class="dlg-scrim" role="dialog" aria-modal="true" aria-label="${esc(o.title)}"><form class="dlg">
      <h3>${esc(o.title)}</h3>${o.hint ? `<p class="hint" style="margin-top:-4px">${esc(o.hint)}</p>` : ''}
      ${o.fields.map((f) => f.type === 'check' ? `<label class="chk"><input type="checkbox" name="${f.id}"${f.value ? ' checked' : ''}>${esc(f.label)}</label>` : `<label>${esc(f.label)}<select class="field" name="${f.id}">${f.options.map((x) => `<option${x === f.value ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`).join('')}
      <div class="dlg-f"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${esc(o.okLabel || 'Export')}</button></div></form></div>`);
    document.body.appendChild(sc); const form = $('form', sc); const close = () => sc.remove();
    $('[data-x]', sc).onclick = close; sc.addEventListener('mousedown', (e) => { if (e.target === sc) close(); });
    sc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = {}; o.fields.forEach((f) => { v[f.id] = f.type === 'check' ? form[f.id].checked : form[f.id].value; }); close(); o.onOk(v); });
    $('select, input, .btn.primary', sc).focus();
  };
  const EXPORTS = {
    pdf: { label: 'PDF…', icon: 'file-down', title: 'Export as PDF', ext: 'pdf', fields: [{ id: 'size', label: 'Page size', type: 'select', options: ['A4', 'US Letter'], value: 'A4' }, { id: 'meta', label: 'Include metadata (title, path, date)', type: 'check', value: true }], done: (v) => v.size + (v.meta ? ' · with metadata' : '') },
    image: { label: 'Image (PNG)…', icon: 'image', title: 'Export as image', ext: 'png', fields: [{ id: 'width', label: 'Width', type: 'select', options: ['800 px', '1200 px', '1600 px'], value: '1200 px' }, { id: 'scale', label: 'Scale', type: 'select', options: ['1×', '2×'], value: '2×' }, { id: 'transparent', label: 'Transparent background', type: 'check', value: false }], done: (v) => v.width + ' at ' + v.scale + (v.transparent ? ', transparent' : '') },
    html: { label: 'HTML…', icon: 'code-xml', title: 'Export as HTML', ext: 'html', fields: [{ id: 'fonts', label: 'Embed fonts (self-contained)', type: 'check', value: true }, { id: 'meta', label: 'Include metadata', type: 'check', value: false }], done: (v) => v.fonts ? 'fonts embedded' : 'fonts linked' },
    word: { label: 'Word…', icon: 'file-text', title: 'Export as Word', ext: 'docx', fields: [{ id: 'style', label: 'Styles', type: 'select', options: ['Marxy typography', 'Word defaults'], value: 'Marxy typography' }, { id: 'meta', label: 'Include metadata', type: 'check', value: false }], done: (v) => v.style },
    md: { label: 'Markdown (clean)…', icon: 'file-text', title: 'Export clean Markdown', ext: 'md', fields: [{ id: 'fm', label: 'Remove front matter', type: 'check', value: true }, { id: 'comments', label: 'Remove HTML comments', type: 'check', value: true }], done: (v) => [v.fm ? 'no front matter' : '', v.comments ? 'no comments' : ''].filter(Boolean).join(', ') || 'as written' }
  };
  // ctx() returns { doc, text, label?, selection? }. Export items for a document, or for files (ctx.label).
  G.exportItems = (ctx) => {
    const c = ctx();
    const base = c.label || ((c.doc && (c.doc.path || c.doc.title)) || 'document').split('/').pop().replace(/\.\w+$/, '');
    const scope = c.label ? c.label : ((G.selectionText && G.selectionText()) ? 'The selection' : 'The whole document');
    const item = (k) => { const x = EXPORTS[k]; return { label: x.label, icon: x.icon, run: () => G.optionsSheet({ title: x.title, hint: scope, fields: x.fields, onOk: (v) => G.toast(`${c.label ? 'Exported ' + esc(base) : 'Saved ' + esc(base) + '.' + x.ext} · ${esc(x.done(v))}`, { icon: x.icon, quiet: true }) }) }; };
    return ['pdf', 'image', 'html', 'word', 'md'].map(item).concat([{ sep: true }, { label: 'Print…', icon: 'printer', run: () => G.toast('Print dialog: ' + esc(base), { icon: 'printer', quiet: true }) }]);
  };
  G.exportMenu = (anchor, ctx) => G.menu(anchor, [{ header: 'Export' }].concat(G.exportItems(ctx)), { width: 230, align: 'end' });
  const pointerAt = () => ({ left: G.pointer.x, right: G.pointer.x, top: G.pointer.y, bottom: G.pointer.y });
  // The Copy + Export pair, grouped. opts.copyMenu overrides the chevron's menu and opts.copy the primary click (for lists of files).
  G.copyExportHtml = () => `<div class="tb-group copyexp"><button class="tb-btn lbl-btn" data-ce="copy" title="Copy the selection, or the document (⌘C)">${ic('copy')}Copy</button><button class="tb-btn" data-ce="copyas" style="min-width:22px;padding:0 4px" aria-haspopup="menu" aria-label="Copy as" title="Copy as… (⇧⌘C)">${ic('chevron-down', 'chev')}</button><span class="tb-div"></span><button class="tb-btn lbl-btn" data-ce="export" aria-haspopup="menu" title="Export: PDF, image, HTML, Word, Markdown, Print">${ic('file-down')}Export${ic('chevron-down', 'chev')}</button><span class="tb-div"></span><button class="tb-btn" data-ce="transform" title="Transform (⌘/)" aria-label="Transform">${ic('wand-sparkles')}</button></div>`;
  G.copyExportRun = (k, b, ctx, opts = {}) => {
    if (k === 'copy') return opts.copy ? opts.copy() : G.copy((G.selectionText && G.selectionText()) || ctx().text, { as: 'Markdown' });
    if (k === 'copyas') return opts.copyMenu ? opts.copyMenu(b) : G.copyMenu(b, () => (G.selectionText && G.selectionText()) || ctx().text, { header: 'Copy as' });
    if (k === 'export') return opts.exportMenu ? opts.exportMenu(b) : G.exportMenu(b, ctx);
    if (k === 'transform') return G.palette.open('>Transform: ');
  };
  G.copyExport = (ctx, opts = {}) => {
    const w = el(G.copyExportHtml());
    w.addEventListener('click', (e) => { const b = e.target.closest('[data-ce]'); if (b) G.copyExportRun(b.dataset.ce, b, ctx, opts); });
    G.icons(w); return w;
  };
  // The title or path: Reveal in Finder, Open in external editor, Copy path.
  G.titleMenu = (at, ctx) => { const d = ctx().doc || {}; G.menu(at, [
    { label: 'Reveal in Finder', icon: 'folder-open', kbd: '⌥⌘R', run: () => G.run('reveal-finder') },
    { label: 'Open in external editor', icon: 'square-pen', kbd: '⇧⌘E', run: () => G.run('open-editor') },
    { sep: true }, { label: 'Copy path', icon: 'copy', disabled: !d.path, run: () => G.copy(d.path, { as: 'path', clean: false }) }
  ], { width: 240 }); };
  G.command({ id: 'reveal-finder', name: 'Reveal in Finder', icon: 'folder-open', kbd: '⌥⌘R', group: 'File', run: () => G.toast('Revealed in Finder', { icon: 'folder-open', quiet: true }) });
  G.command({ id: 'open-editor', name: 'Open in external editor', icon: 'square-pen', kbd: '⇧⌘E', group: 'File', run: () => G.toast('Opened in your editor (Settings › Integrations)', { icon: 'square-pen', quiet: true }) });
  G.command({ id: 'export', name: 'Export…', icon: 'file-down', group: 'File', desc: 'PDF, image, HTML, Word, clean Markdown, print', run: (a) => G.exportMenu(a && a.getBoundingClientRect ? a : pointerAt(), () => ({ doc: G.current, text: G.current ? G.current.src : '' })) });

  /* ---------- Fuzzy matching ---------- */

  G.fuzzy = (q, s) => {
    if (!q) return { score: 0, idx: [] };
    const ql = q.toLowerCase(), sl = s.toLowerCase();
    const sub = sl.indexOf(ql);
    if (sub >= 0) return { score: 100 - sub + (sub === 0 || /\W/.test(sl[sub - 1]) ? 40 : 0), idx: Array.from({ length: ql.length }, (_, i) => sub + i) };
    let si = 0, score = 0, idx = [], prev = -2;
    for (const ch of ql) {
      if (ch === ' ') continue;
      const f = sl.indexOf(ch, si);
      if (f < 0) return null;
      score += f === prev + 1 ? 6 : 1; if (f === 0 || /[\W_]/.test(sl[f - 1])) score += 5;
      idx.push(f); prev = f; si = f + 1;
    }
    return { score: score - s.length * 0.02, idx };
  };
  G.hilite = (s, idx) => { if (!idx || !idx.length) return esc(s); const set = new Set(idx); return Array.from(s).map((c, i) => (set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c))).join(''); };

  /* ---------- Command palette ---------- */

  G.paletteModes = [
    { pfx: '', name: 'Everything', icon: 'search' },
    { pfx: '>', name: 'Commands', icon: 'terminal' },
    { pfx: '#', name: 'Headings here', icon: 'hash' },
    { pfx: '@', name: 'Sections everywhere', icon: 'at-sign' },
    { pfx: '/', name: 'Content search', icon: 'text-search' },
    { pfx: '~', name: 'Collections', icon: 'library' },
    { pfx: ':', name: 'Line', icon: 'arrow-right-to-line' }
  ];
  const kindIcon = (k) => (G.kinds && G.kinds[k] ? G.kinds[k].icon : 'g-prose');
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
  G.ago = ago;

  function paletteResults(raw) {
    const mode = G.paletteModes.slice(1).find((m) => raw.startsWith(m.pfx));
    const pfx = mode ? mode.pfx : '';
    let q = (mode ? raw.slice(pfx.length) : raw).trim();
    const filters = {}; q = q.replace(/\b(kind|in):(\S+)/g, (m, k, v) => { filters[k] = v.toLowerCase(); return ''; }).trim();
    const out = [];
    const push = (group, items) => items.length && out.push({ group, items });
    const rank = (list, key) => list.map((x) => ({ x, m: G.fuzzy(q, key(x)) })).filter((r) => r.m).sort((a, b) => b.m.score - a.m.score);
    const files = () => rank(G.allFiles().filter((d) => (!filters.kind || d.kind.startsWith(filters.kind)) && (!filters.in || d.collection.startsWith(filters.in) || G.collections.find((c) => c.id === d.collection).name.toLowerCase().startsWith(filters.in))), (d) => d.title + ' ' + d.path.split('/').slice(-2).join('/'))
      .map(({ x, m }) => ({ type: 'file', icon: kindIcon(x.kind), lang: x.lang, title: x.title, titleIdx: m.idx.filter((i) => i < x.title.length), sub: x.path.replace(/^~\//, ''), meta: x.modified, doc: x }));
    const cmds = () => rank(G.commands, (c) => (c.group ? c.group + ': ' : '') + c.name)
      .map(({ x, m }) => { const off = x.group ? x.group.length + 2 : 0; if (x.tf) return { type: 'transform', icon: x.icon, title: x.name, titleIdx: m.idx.filter((i) => i >= off).map((i) => i - off), sub: 'Transform · ' + x.tf.group, t: x.tf }; return { type: 'cmd', icon: x.icon || 'terminal', title: x.name, titleIdx: m.idx.filter((i) => i >= off).map((i) => i - off), sub: x.group || '', kbd: x.kbd, cmd: x }; });
    if (pfx === '') {
      if (!q && !Object.keys(filters).length) {
        push('Recent', G.recent.docs(6).map((x) => ({ type: 'file', icon: kindIcon(x.kind), lang: x.lang, title: x.title, sub: (x.path || 'Unsaved').replace(/^~\//, ''), meta: x.modified, doc: x })));
        push('Suggested', ['new-file', 'fork', 'fold-toggle', 'palette-headings'].map((id) => G.commands.find((c) => c.id === id)).filter(Boolean).map((x) => ({ type: 'cmd', icon: x.icon, title: x.name, sub: x.group, kbd: x.kbd, cmd: x })));
      } else { push('Files', files().slice(0, 8)); push('Commands', cmds().slice(0, 6)); }
    } else if (pfx === '>') push('Commands', cmds().slice(0, 40));
    else if (pfx === '#') {
      const hs = (G.current && G.current.headings) || [];
      push('In ' + (G.current ? G.current.title : 'this document'), rank(hs, (h) => h.text).map(({ x, m }) => ({ type: 'heading', icon: 'hash', title: '  '.repeat(Math.max(0, x.level - 2)) + x.text, titleIdx: m.idx.map((i) => i + 2 * Math.max(0, x.level - 2)), sub: 'H' + x.level + ' · line ' + x.line, h: x })));
    } else if (pfx === '@') {
      const all = [];
      G.docs.forEach((d) => d.src.split('\n').forEach((l, i) => { const h = l.match(/^(#{1,3})\s+(.*)/); if (h && d.kind !== 'code') all.push({ text: h[2], level: h[1].length, line: i + 1, doc: d }); }));
      push('Sections', rank(all, (h) => h.text).slice(0, 30).map(({ x, m }) => ({ type: 'section', icon: 'at-sign', title: x.text, titleIdx: m.idx, sub: x.doc.title + ' · line ' + x.line, h: x })));
    } else if (pfx === '/') {
      // Content search: the text inside files, landing at the match. The prototype searches the documents it carries.
      const needle = q.toLowerCase();
      if (needle.length < 2) push('Content search', [{ type: 'hint', icon: 'text-search', title: 'Type to search inside files', sub: `Searches the text of ${fmt(G.totalFiles())} indexed files; this prototype searches the ${G.docs.length + Object.keys(G.userDocs).length} documents it carries` }]);
      else {
        const hits = []; let files = 0;
        G.docs.concat(Object.values(G.userDocs)).forEach((d) => { let n = 0; d.src.split('\n').forEach((l, i) => { const at = l.toLowerCase().indexOf(needle); if (at >= 0 && n < 3 && l.trim() !== '---') { if (!n) files++; n++; hits.push({ d, line: i + 1, at, text: l }); } }); });
        const snip = (h) => { const from = Math.max(0, h.at - 36); const t = (from ? '…' : '') + h.text.slice(from, from + 110); const i = t.toLowerCase().indexOf(needle); return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + needle.length)) + '</mark>' + esc(t.slice(i + needle.length)); };
        push(`${hits.length} match${hits.length === 1 ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}`, hits.slice(0, 30).map((h) => ({ type: 'content', icon: kindIcon(h.d.kind), lang: h.d.lang, title: h.d.path ? h.d.path.split('/').pop() : h.d.title, subHtml: snip(h), meta: 'L' + h.line, doc: h.d, line: h.line, needle })));
      }
    } else if (pfx === '~') push('Collections', rank(G.collections, (c) => c.name + ' ' + c.path).map(({ x, m }) => ({ type: 'coll', icon: x.icon, title: x.name, titleIdx: m.idx.filter((i) => i < x.name.length), sub: x.path + ' · ' + fmt(x.files) + ' files', c: x })));
    else if (pfx === ':') { const n = parseInt(q, 10); push('Go to line', [{ type: 'line', icon: 'arrow-right-to-line', title: n ? 'Line ' + n : 'Type a line number', sub: G.current ? G.current.title : '', line: n }]); }
    return out;
  }

  function previewHtml(it) {
    if (!it) return '<div class="pal-empty">No preview</div>';
    if (it.type === 'file') {
      const d = G.docById(it.doc.id);
      const meta = `<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px"><span class="chip">${esc(G.kinds[it.doc.kind].name)}</span><span class="chip">${esc(G.measure(d ? d.src : { words: it.doc.words }, { kind: it.doc.kind }))}</span>${it.doc.status && it.doc.status.duplicateOf ? `<span class="chip warn">${ic('copy')}near-duplicate</span>` : ''}</div>`;
      if (!d || !G.md) return meta + `<div class="faint">${esc(it.doc.path)}</div><p class="muted">Indexed metadata only in this prototype.</p>`;
      const body = ['code', 'data', 'log', 'terminal'].includes(d.kind) ? `<pre class="mono" style="font-size:11.5px;line-height:1.5;margin:0;white-space:pre">${G.hl(d.src.split('\n').slice(0, 24).join('\n'), d.kind === 'log' ? 'log' : d.kind === 'terminal' ? 'term' : d.lang)}</pre>` : `<div class="doc" data-kind="${d.kind}" style="padding:0;font-size:12.5px">${G.md.render(d.src.split('\n').slice(0, 40).join('\n'), { bare: true }).html}</div>`;
      return meta + body;
    }
    if (it.type === 'cmd') return `<div class="stack"><b style="font-size:14px">${esc(it.cmd.name)}</b><span class="muted">${esc(it.cmd.desc || it.cmd.group || '')}</span>${it.kbd ? `<div>Shortcut <span class="kbd">${esc(it.kbd)}</span></div>` : ''}<div class="faint">Enter runs it. Commands can be bound to keys in Settings › Shortcuts.</div></div>`;
    if (it.type === 'transform') {
      const src = (G.selectionText && G.selectionText()) || (G.current ? G.current.src : '');
      const sample = src.slice(0, 1400);
      let out = ''; try { out = it.t.fn(sample, { path: G.current?.path }); } catch (e) { out = String(e); }
      return `<div class="stack"><b style="font-size:14px">${esc(it.t.name)}</b>${it.t.desc ? `<span class="muted">${esc(it.t.desc)}</span>` : ''}<div class="faint">Result preview</div><pre class="mono" style="font-size:11.5px;white-space:pre-wrap;margin:0;background:var(--inset);border:1px solid var(--line);border-radius:7px;padding:8px 10px">${esc(out.slice(0, 1200))}</pre><div class="faint">Enter copies the result · ⌘Enter replaces the text</div></div>`;
    }
    if (it.type === 'content') {
      const ls = it.doc.src.split('\n'); const a = Math.max(0, it.line - 6), z = Math.min(ls.length, it.line + 7);
      const row = (l, i) => { const n = a + i + 1; const body = n === it.line ? esc(l).replace(new RegExp(esc(it.needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), (m) => `<mark>${m}</mark>`) : esc(l); return `<div style="display:grid;grid-template-columns:3.2em 1fr;${n === it.line ? 'background:var(--accent-wash)' : ''}"><span class="faint" style="text-align:right;padding-right:10px">${n}</span><span style="white-space:pre-wrap">${body || ' '}</span></div>`; };
      return `<div class="faint" style="margin-bottom:8px">${esc(it.doc.path || it.doc.title)} · line ${it.line}</div><div class="mono" style="font-size:11.5px;line-height:1.55">${ls.slice(a, z).map(row).join('')}</div><div class="faint" style="margin-top:10px">Enter opens the file at this line.</div>`;
    }
    if (it.type === 'hint') return `<div class="stack"><b style="font-size:14px">Content search</b><span class="muted">Type at least two characters. Results show the matching line; Enter opens the file at that line.</span></div>`;
    if (it.type === 'heading' || it.type === 'section') {
      const d = it.h.doc || G.current; if (!d) return '';
      const lines = d.src.split('\n').slice(it.h.line - 1, it.h.line + 18).join('\n');
      return `<div class="doc" data-kind="${d.kind}" style="padding:0;font-size:12.5px">${G.md ? G.md.render(lines, { bare: true }).html : esc(lines)}</div>`;
    }
    if (it.type === 'coll') return `<div class="stack"><b style="font-size:14px">${esc(it.c.name)}</b><span class="muted">${esc(it.c.path)}</span><span>${fmt(it.c.files)} files${it.c.watch ? ' · watching' : ''}</span></div>`;
    return '';
  }

  G.palette = {
    el: null, hot: 0, flat: [],
    open(prefix = '') {
      if (this.el) { this.close(); }
      const scrim = el(`<div class="scrim" role="dialog" aria-label="Command palette">
        <div class="palette">
          <div class="pal-input">${ic('search')}<input aria-label="Search files, commands, content" placeholder="Search files, or type > for commands, / for content, # headings, : for a line" spellcheck="false" autocomplete="off"><span class="kbd">esc</span></div>
          <div class="pal-modes">${G.paletteModes.map((m) => `<button data-pfx="${esc(m.pfx)}" aria-pressed="false">${ic(m.icon)}${m.name}${m.pfx ? `<b>${esc(m.pfx)}</b>` : ''}</button>`).join('')}</div>
          <div class="pal-body"><div class="pal-list" role="listbox"></div><div class="pal-preview"></div></div>
          <div class="pal-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> move</span><span><span class="kbd">↵</span> open</span><span><span class="kbd">⌘</span><span class="kbd">↵</span> open in split / replace</span><span><span class="kbd">⌥</span><span class="kbd">↵</span> new tab</span><span><span class="kbd">⌘</span><span class="kbd">C</span> copy path or result</span><span style="margin-left:auto"><span class="kbd">⇧⌘P</span> commands <span class="kbd">⌘/</span> transforms <span class="kbd">/</span> content</span></div>
        </div></div>`);
      document.body.appendChild(scrim); this.el = scrim; G.icons(scrim);
      const input = $('input', scrim);
      input.value = prefix;
      input.addEventListener('input', () => { this.hot = 0; this.render(); });
      input.addEventListener('keydown', (e) => this.key(e));
      scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) this.close(); });
      $$('.pal-modes button', scrim).forEach((b) => b.addEventListener('click', () => {
        const cur = input.value; const m = G.paletteModes.slice(1).find((x) => cur.startsWith(x.pfx));
        input.value = b.dataset.pfx + (m ? cur.slice(m.pfx.length) : cur).trimStart(); input.focus(); this.hot = 0; this.render();
      }));
      this.render(); input.focus();
    },
    close() { if (this.el) { this.el.remove(); this.el = null; } },
    render() {
      const input = $('input', this.el); const raw = input.value;
      const groups = paletteResults(raw);
      const list = $('.pal-list', this.el); this.flat = [];
      const curMode = G.paletteModes.slice(1).find((m) => raw.startsWith(m.pfx));
      $$('.pal-modes button', this.el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pfx === (curMode ? curMode.pfx : ''))));
      list.innerHTML = groups.length ? groups.map((g) => `<div class="pal-group">${esc(g.group)}</div>` + g.items.map((it) => {
        const i = this.flat.push(it) - 1;
        return `<div class="pal-item${i === this.hot ? ' hot' : ''}" role="option" data-i="${i}"${it.lang ? ` data-lang="${esc(it.lang)}"` : ''}>${ic(it.icon)}<div style="min-width:0"><div class="pt">${G.hilite(it.title, it.titleIdx)}</div>${it.subHtml ? `<div class="ps">${it.subHtml}</div>` : it.sub ? `<div class="ps">${esc(it.sub)}</div>` : ''}</div><div class="k">${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : it.meta ? `<span>${esc(it.meta)}</span>` : ''}</div></div>`;
      }).join('')).join('') : '<div class="pal-empty">Nothing matches. Try <b>&gt;</b> for commands or <b>@</b> to search every heading.</div>';
      $$('.pal-item', list).forEach((n) => {
        n.addEventListener('mousemove', () => { if (this.hot !== +n.dataset.i) { this.hot = +n.dataset.i; this.mark(); } });
        n.addEventListener('click', () => this.choose(this.flat[+n.dataset.i], {}));
      });
      G.icons(list); this.mark();
    },
    mark() {
      $$('.pal-item', this.el).forEach((n) => n.classList.toggle('hot', +n.dataset.i === this.hot));
      const h = $('.pal-item.hot', this.el); h && h.scrollIntoView({ block: 'nearest' });
      $('.pal-preview', this.el).innerHTML = previewHtml(this.flat[this.hot]); G.icons($('.pal-preview', this.el));
    },
    key(e) {
      if (e.key === 'ArrowDown') { this.hot = Math.min(this.flat.length - 1, this.hot + 1); this.mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this.hot = Math.max(0, this.hot - 1); this.mark(); e.preventDefault(); }
      else if (e.key === 'Escape') this.close();
      else if (e.key === 'Enter') { this.choose(this.flat[this.hot], { meta: e.metaKey || e.ctrlKey, alt: e.altKey }); e.preventDefault(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && !window.getSelection().toString() && $('input', this.el).selectionStart === $('input', this.el).selectionEnd) {
        const it = this.flat[this.hot]; if (!it) return;
        const text = it.type === 'file' ? it.doc.path : it.type === 'transform' ? it.t.fn((G.selectionText && G.selectionText()) || G.current?.src || '', {}) : it.title;
        G.copy(text, { as: it.type === 'file' ? 'path' : undefined }); e.preventDefault();
      }
    },
    choose(it, mods) {
      if (!it) return; this.close();
      if (it.type === 'file') G.openDoc ? G.openDoc(it.doc.id, mods) : (location.href = G.page('workspace') + '#doc=' + encodeURIComponent(it.doc.id));
      else if (it.type === 'cmd') it.cmd.run();
      else if (it.type === 'heading') G.revealHeading && G.revealHeading(it.h);
      else if (it.type === 'section') G.openDoc ? G.openDoc(it.h.doc.id, { line: it.h.line }) : (location.href = G.page('workspace') + '#doc=' + encodeURIComponent(it.h.doc.id));
      else if (it.type === 'transform') {
        const sel = G.selectionText && G.selectionText();
        const src = sel || (G.current ? G.current.src : '');
        const out = it.t.fn(src, { path: G.current?.path });
        if (mods.meta && G.replaceText) { G.replaceText(out, !!sel); G.toast(`${esc(it.t.name)} applied`, { icon: it.t.icon, action: { label: 'Undo', run: () => G.undo && G.undo() } }); }
        else G.copy(out, { as: it.t.name });
      }
      else if (it.type === 'content') G.openDoc ? G.openDoc(it.doc.id, { line: it.line }) : (location.href = G.page('workspace') + '#doc=' + encodeURIComponent(it.doc.id) + '&line=' + it.line);
      else if (it.type === 'coll') location.href = G.page('collections') + '#c=' + it.c.id;
      else if (it.type === 'line' && it.line && G.gotoLine) G.gotoLine(it.line);
    }
  };

  /* ---------- Chrome builders ---------- */

  G.ui = {};
  G.toggleSidebar = () => G.fold.toggle('side');

  /* ---------- Sidebar: Recent, Library views, Repositories, Folders, Smart collections ----------
     Every repository and folder is a tree that opens inline, to any depth; children are made when a folder opens. */

  const sideOpen = new Set(store.get('sideOpen', ['projects|']));
  const saveOpen = () => store.set('sideOpen', Array.from(sideOpen));
  const hrefDoc = (id) => G.page('workspace') + '#doc=' + encodeURIComponent(id);
  const chevHtml = () => `<span class="chev">${ic('g-chev')}</span>`;
  // A document row: Recent items (depth 0) and files in a tree (depth 1 and up).
  const docRowHtml = (d, depth, extra = '') => {
    const cur = G.current;
    return `<a class="nav-item tree-row file${cur && cur.id === d.id ? ' active' : ''}" role="treeitem" tabindex="-1" aria-level="${depth + 1}" data-d="${depth}" style="--d:${depth}" href="${hrefDoc(d.id)}" data-doc="${esc(d.id)}"${d.lang ? ` data-lang="${esc(d.lang)}"` : ''} title="${esc(d.path || 'Unsaved')}">${depth ? '<span class="chev"></span>' : ''}${ic(kindIcon(d.kind))}<span class="lbl">${esc(d.path && depth ? d.path.split('/').pop() : d.title)}</span>${extra}</a>`;
  };
  const dirRowHtml = (coll, d, depth) => { const key = coll + '|' + d.rel; return `<div class="nav-item tree-row dir" role="treeitem" tabindex="-1" aria-level="${depth + 1}" aria-expanded="${sideOpen.has(key)}" data-d="${depth}" style="--d:${depth}" data-tree="${esc(key)}" data-coll="${coll}" data-rel="${esc(d.rel)}" title="${esc(G.tree.rootOf(coll) + '/' + d.rel)}">${chevHtml()}${ic('g-folder')}<span class="lbl">${esc(d.name)}</span></div>`; };
  const kidsHtml = (coll, rel, depth) => {
    const c = G.tree.children(coll, rel);
    const body = c.dirs.map((d) => dirRowHtml(coll, d, depth) + (sideOpen.has(coll + '|' + d.rel) ? kidsHtml(coll, d.rel, depth + 1) : '')).join('')
      + c.files.map((f) => docRowHtml({ id: f.id, kind: f.kind, lang: f.lang, title: f.name, path: f.name }, depth, f.unread ? '<span class="dot" title="Unread"></span>' : '')).join('');
    return `<div class="tree-kids" role="group" data-for="${esc(coll + '|' + rel)}" style="--d:${depth}">${body || `<div class="tree-empty" style="--d:${depth}">Empty folder</div>`}</div>`;
  };
  const rootHtml = (c, active) => {
    const key = c.id + '|'; const open = sideOpen.has(key);
    const count = c.type === 'repo' ? (c.changed > 0 ? `<span class="count quiet" title="${c.changed} files changed since you read">${c.changed}</span>` : '') : `<span class="count">${fmt(c.files)}</span>`;
    return `<a class="nav-item tree-row dir root${active === 'c:' + c.id ? ' active' : ''}" role="treeitem" tabindex="-1" aria-level="1" aria-expanded="${open}" data-d="0" style="--d:0" href="${G.page('collections')}#c=${c.id}" data-nav="c:${c.id}" data-tree="${esc(key)}" data-coll="${c.id}" data-rel="" title="${esc(c.path)}">${chevHtml()}${ic(c.icon || (c.type === 'repo' ? 'g-repo' : 'g-folder'))}<span class="lbl">${esc(c.name)}</span>${count}</a>${open ? kidsHtml(c.id, '', 1) : ''}`;
  };

  // Every section of the sidebar folds on its header; the state is kept per section.
  const secState = () => { const o = store.get('sideCollapsed', null); if (o) return o; return store.get('sideRecent', true) === false ? { recent: true } : {}; };
  const saveSec = (o) => store.set('sideCollapsed', o);
  const SECTIONS = ['recent', 'library', 'repos', 'folders', 'smart'];
  const secHtml = (id, title, count, body, extra = '') => {
    const col = !!secState()[id];
    return `<div class="side-h fold" role="button" tabindex="-1" data-side-fold="${id}" aria-expanded="${!col}" title="${col ? 'Show' : 'Hide'} ${esc(title)} (⌥-click: all)">${chevHtml()}<span class="grow">${esc(title)}</span>${extra}<span class="side-n">${count}</span></div><div class="side-sec${col ? ' collapsed' : ''}" data-sec="${id}"${col ? ' inert' : ''}><div class="side-sec-in">${body}</div></div>`;
  };
  function setSection(id, collapsed) {
    const o = secState(); if (collapsed) o[id] = true; else delete o[id]; saveSec(o);
    const h = $(`.sidebar [data-side-fold="${id}"]`), b = $(`.sidebar [data-sec="${id}"]`); if (!h || !b) return;
    h.setAttribute('aria-expanded', String(!collapsed)); b.classList.toggle('collapsed', collapsed); b.toggleAttribute('inert', collapsed);
    G.ui.rove(h.closest('.sidebar'));
  }
  G.ui.setSection = setSection;
  // ⌥-click: collapse every section, or expand them all when this one was being collapsed from a fully open state.
  G.ui.toggleAllSections = (id) => { const cur = !!secState()[id]; SECTIONS.forEach((x) => setSection(x, !cur)); };

  G.ui.sidebar = (opts = {}) => {
    const active = opts.active || '';
    if (opts.reveal && G.current) G.ui.reveal(G.current);
    const navLink = (key, label, icon, count, href, extra = '') => `<a class="nav-item${active === key ? ' active' : ''}" href="${href}" data-nav="${key}">${ic(icon)}<span class="lbl">${esc(label)}</span>${extra}${count != null ? `<span class="count">${fmt(count)}</span>` : ''}</a>`;
    const repos = G.collections.filter((c) => c.type === 'repo'), folders = G.collections.filter((c) => c.type !== 'repo');
    const changedAll = G.collections.reduce((n, c) => n + (c.changed || 0), 0);
    return `
      <div class="lights"><span></span><span></span><span></span><div class="lights-end"><button class="tb-btn" data-cmd="toggle-sidebar" title="Fold the sidebar away (⌃⌘S)" style="height:24px;min-width:26px">${ic('panel-left')}</button></div></div>
      <button class="side-search" data-cmd="palette" title="Search everything (⌘K)">${ic('search', 'ic-sm')}<span>Search</span><span class="kbd">⌘K</span></button>
      <nav class="side-scroll" aria-label="Library" role="tree">
        ${secHtml('recent', 'Recent', G.recent.docs(8).length, `${G.recent.docs(8).map((d) => docRowHtml(d, 0)).join('')}<a class="nav-item more" href="${G.page('collections')}#view=recent" data-nav="recent"><span class="lbl">All recent…</span></a>`)}
        ${secHtml('library', 'Library', 2, `${navLink('pinned', 'Pinned', 'pin', 3, G.page('collections') + '#view=pinned')}${navLink('changed', 'Changed since you read', 'git-compare', changedAll, G.page('collections') + '#view=changed')}`)}
        ${secHtml('repos', 'Repositories', repos.length, repos.map((c) => rootHtml(c, active)).join(''), `<button class="tb-btn side-add" style="height:20px;min-width:20px;padding:0" title="Add a repository (⌥⌘O)" data-cmd="add-folder">${ic('plus', 'ic-sm')}</button>`)}
        ${secHtml('folders', 'Folders', folders.length, folders.map((c) => rootHtml(c, active)).join(''), `<button class="tb-btn side-add" style="height:20px;min-width:20px;padding:0" title="Add a folder (⌥⌘O)" data-cmd="add-folder">${ic('plus', 'ic-sm')}</button>`)}
        ${secHtml('smart', 'Smart collections', 2, `${navLink('s:dupes', 'Near-duplicates', 'copy', 6, G.page('collections') + '#smart=dupes')}${navLink('s:broken', 'Broken paths or links', 'unlink', 4, G.page('collections') + '#smart=broken')}`)}
      </nav>
      <div class="side-foot">${ic('database', 'ic-sm')}<span class="grow">${fmt(G.totalFiles())} files indexed · ${G.collections.filter((c) => c.watch).length} watched</span><button class="tb-btn" style="height:22px;min-width:22px;padding:0" data-cmd="go-settings" title="Settings (⌘,)">${ic('settings', 'ic-sm')}</button></div>`;
  };

  // Open the folders above a document so it shows in the tree (kept, like any other expansion).
  G.ui.reveal = (d) => {
    if (!d || !d.path) return;
    const c = G.collections.find((x) => d.path === x.path || d.path.startsWith(x.path + '/')); if (!c) return;
    { const o = secState(); const sid = c.type === 'repo' ? 'repos' : 'folders'; if (o[sid]) { delete o[sid]; saveSec(o); } }
    sideOpen.add(c.id + '|'); G.tree.ancestors(d.path, c.id).forEach((rel) => sideOpen.add(c.id + '|' + rel)); saveOpen();
  };
  // Rows are reached with the arrow keys, so exactly one is a tab stop: the focused row, else the active one, else the first.
  G.ui.rove = (host) => {
    const rows = $$('.side-scroll .nav-item, .side-scroll .side-h.fold', host); rows.forEach((r) => r.setAttribute('tabindex', '-1'));
    const first = rows.find((r) => r === document.activeElement) || rows.find((r) => r.classList.contains('active')) || rows[0];
    if (first) first.setAttribute('tabindex', '0');
  };
  // Put the sidebar into its slot, or replace it after a change.
  G.ui.mountSidebar = (opts, host) => {
    host = host || $('[data-slot="sidebar"]') || $('.sidebar'); if (!host) return;
    const keep = host.querySelector('.side-scroll'); const top = keep ? keep.scrollTop : 0;
    host.innerHTML = G.ui.sidebar(opts); G.icons(host); G.ui.rove(host);
    const sc = host.querySelector('.side-scroll'); if (sc) sc.scrollTop = top;
  };

  // Expand or collapse a folder row; its children are made the first time it opens.
  function toggleRow(row, force) {
    const key = row.dataset.tree; const open = force != null ? force : row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', String(open));
    if (open) sideOpen.add(key); else sideOpen.delete(key);
    saveOpen();
    const next = row.nextElementSibling; const has = next && next.classList.contains('tree-kids') && next.dataset.for === key;
    if (!open && has) next.remove();
    if (open && !has) { row.insertAdjacentHTML('afterend', kidsHtml(row.dataset.coll, row.dataset.rel, +row.dataset.d + 1)); G.icons(row.parentNode); }
    G.ui.rove(row.closest('.sidebar'));
  }
  G.ui.toggleRow = toggleRow;
  const rowPath = (row) => G.tree.rootOf(row.dataset.coll) + (row.dataset.rel ? '/' + row.dataset.rel : '');

  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const fold = e.target.closest('.sidebar [data-side-fold]');
    if (fold && !e.target.closest('button')) { const id = fold.dataset.sideFold; if (e.altKey) G.ui.toggleAllSections(id); else setSection(id, fold.getAttribute('aria-expanded') === 'true'); return; }
    // A file row opens through the page's own G.openDoc (a tab, the editor, or the in-page document view), never by leaving the page.
    const frow = e.target.closest('.sidebar a.tree-row.file[data-doc]');
    if (frow && G.openDoc && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); G.openDoc(frow.dataset.doc, { alt: e.altKey }); return; }
    const row = e.target.closest('.sidebar .tree-row.dir');
    if (row) {
      e.preventDefault(); toggleRow(row);
      // The Library page routes by hash, so a repository or folder also opens there.
      if (row.classList.contains('root') && /05-collections/.test(location.pathname)) location.hash = 'c=' + row.dataset.coll;
    }
  });
  const sideActive = () => { const a = $('.sidebar .nav-item.active[data-nav]'); return a ? a.dataset.nav : ''; };
  document.addEventListener('keydown', (e) => {
    const t = e.target; if (!t || !t.closest || e.metaKey || e.ctrlKey || e.altKey) return;
    const row = t.closest('.sidebar .side-scroll .nav-item, .sidebar .side-scroll .side-h.fold'); if (!row || row !== t) return;
    const rows = $$('.sidebar .side-scroll .nav-item, .sidebar .side-scroll .side-h.fold').filter((r) => r.offsetParent && !r.closest('[inert]'));
    const i = rows.indexOf(row); const go = (r) => { if (!r) return; rows.forEach((x) => x.setAttribute('tabindex', '-1')); r.setAttribute('tabindex', '0'); r.focus(); r.scrollIntoView({ block: 'nearest' }); };
    const isDir = row.classList.contains('dir'); const open = row.getAttribute('aria-expanded') === 'true';
    const depth = (r) => +(r.dataset.d || 0);
    // A section header: ← collapses it, → expands it (Space and Enter toggle, below).
    if (row.matches('.side-h.fold') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); G.ui.setSection(row.dataset.sideFold, e.key === 'ArrowLeft'); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); go(rows[i + 1]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(rows[i - 1]); }
    else if (e.key === 'Home') { e.preventDefault(); go(rows[0]); }
    else if (e.key === 'End') { e.preventDefault(); go(rows[rows.length - 1]); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (isDir && !open) toggleRow(row, true); else if (isDir && open) { const n = $$('.sidebar .side-scroll .nav-item').filter((r) => r.offsetParent); go(n[n.indexOf(row) + 1]); } }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (isDir && open) toggleRow(row, false);
      else for (let k = i - 1; k >= 0; k--) if (rows[k].classList.contains('dir') && depth(rows[k]) < depth(row)) { go(rows[k]); break; }
    }
    else if ((e.key === 'Enter' || e.key === ' ') && isDir) { e.preventDefault(); row.click(); }
    else if (e.key === ' ' && row.matches('a')) { e.preventDefault(); row.click(); }
    else if ((e.key === 'Enter' || e.key === ' ') && row.matches('.side-h.fold')) { e.preventDefault(); row.click(); }
  });
  document.addEventListener('focusin', (e) => { const r = e.target.closest && e.target.closest('.sidebar .side-scroll .nav-item, .sidebar .side-scroll .side-h.fold'); if (r && r.getAttribute('tabindex') === '-1') { $$('.sidebar .side-scroll [tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1')); r.setAttribute('tabindex', '0'); } });
  // Right-click on a repository, folder or file in the tree.
  document.addEventListener('contextmenu', (e) => {
    const row = e.target.closest && e.target.closest('.sidebar .tree-row'); if (!row) return;
    e.preventDefault();
    const at = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
    if (row.classList.contains('dir')) {
      const open = row.getAttribute('aria-expanded') === 'true'; const folder = rowPath(row);
      G.menu(at, [
        { label: 'New file here', icon: 'file-plus-2', run: () => G.newFileIn(folder) },
        { label: open ? 'Collapse' : 'Expand', icon: open ? 'chevrons-down-up' : 'chevrons-up-down', kbd: open ? '←' : '→', run: () => toggleRow(row) },
        { sep: true },
        { label: 'Open in Library', icon: 'library', run: () => (location.href = G.page('collections') + '#c=' + row.dataset.coll) },
        { label: 'Copy path', icon: 'copy', run: () => G.copy(folder, { as: 'path' }) },
        { label: 'Reveal in Finder', icon: 'folder-open', run: () => G.toast('Revealed in Finder', { icon: 'folder-open' }) }
      ], { width: 220 });
    } else {
      const d = G.docById(row.dataset.doc);
      G.menu(at, [
        { label: 'Open', icon: 'file', run: () => G.openAny(row.dataset.doc) },
        { label: 'Fork this file', icon: 'git-fork', kbd: '⇧⌘N', run: () => d && G.forkDoc(d) },
        { sep: true },
        { label: 'Copy path', icon: 'copy', run: () => G.copy((d && d.path) || row.title, { as: 'path' }) },
        { label: 'Reveal in Finder', icon: 'folder-open', run: () => G.toast('Revealed in Finder', { icon: 'folder-open' }) }
      ], { width: 220 });
    }
  });

  // Pages that route by hash move the sidebar highlight with this.
  G.ui.setActive = (key) => $$('.sidebar .nav-item[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  G.ui.statusbar = (items) => items.map((it) => (typeof it === 'string' ? `<span class="sb-item">${it}</span>` : it.cmd ? `<button class="sb-item" data-cmd="${it.cmd}" title="${esc(it.title || '')}">${it.icon ? ic(it.icon) : ''}${it.html}</button>` : `<span class="sb-item"${it.id ? ` id="${it.id}"` : ''}>${it.icon ? ic(it.icon) : ''}${it.html}</span>`)).join('');

  // Theme quick menu from the toolbar
  G.themeMenu = (anchor) => {
    const cur = G.prefs.theme;
    G.menu(anchor, [{ header: 'Theme' }, { label: 'Follow system (' + G.themes.find((t) => t.id === G.prefs.themeLight).name + ' / ' + G.themes.find((t) => t.id === G.prefs.themeDark).name + ')', checked: cur === 'system', run: () => G.setPref('theme', 'system') }]
      .concat(G.themes.map((t) => ({ html: `<button class="mi" data-theme-pick="${t.id}"><span class="mck">${cur === t.id ? ic('check') : ''}</span><span>${esc(t.name)}</span><b class="swatch" data-theme="${t.id}"><b></b></b></button>` })))
      .concat([{ header: 'Type set' }], G.typesets.map((t) => ({ label: t.name, checked: G.prefs.typeset === t.id, desc: t.desc, run: () => G.setPref('typeset', t.id) })))
      .concat([{ sep: true }, { label: 'Larger text', icon: 'a-arrow-up', kbd: '⌘+', run: () => G.run('scale-up') }, { label: 'Smaller text', icon: 'a-arrow-down', kbd: '⌘−', run: () => G.run('scale-down') }, { sep: true }, { label: 'Theme picker…', icon: 'palette', run: () => (location.href = G.page('themes')) }, { label: 'Reading settings…', icon: 'sliders-horizontal', run: () => (location.href = G.page('settings') + '#reading') }]), { width: 280 });
    $$('[data-theme-pick]').forEach((b) => {
      const id = b.dataset.themePick;
      b.addEventListener('click', () => { G.closeMenu(); G.setPref('theme', id); });
    });
  };


  /* ---------- Fold-up ----------
     A window (.win) has three parts that can be folded away: the sidebar (side), the bar (toolbar, tabs, tool strip,
     status bar and the second pane in Split) and the inspector (insp). Each is 'docked', 'away' or 'peek' (away, but
     shown over the page while the pointer rests at its edge). "Folded" means every part is away: the document column
     alone on the page ground. The last unfolded arrangement is remembered; a window starts folded when it carries
     data-fold="folded" and is skipped when it carries data-fold="off". CSS does the moving (see app.css, Fold-up). */

  G.fold = (() => {
    const SEL = { side: '.sidebar', bar: '.toolbar, .tabs, .statusbar, .modebar', insp: '.inspector' };
    const PARTS = ['side', 'bar', 'insp'];
    const EDGE = 8, REST = 150, LEAVE = 180;
    let win = null, keys = false, ready = false;
    const st = { side: 'docked', bar: 'docked', insp: 'docked' };
    let arr = Object.assign({ side: true, bar: true, insp: true }, store.get('arrangement', {}));
    const present = (p) => !!(win && $(SEL[p], win));
    const parts = () => PARTS.filter(present);
    const isFolded = () => parts().every((p) => st[p] !== 'docked');
    const els = (p) => (p === 'bar' ? $$('.toolbar, .tabs', win) : $$(SEL[p], win));
    function apply() {
      if (!win) return;
      PARTS.forEach((p) => { win.dataset[p] = st[p]; });
      win.dataset.fold = isFolded() ? 'folded' : 'unfolded';
      document.documentElement.dataset.fold = win.dataset.fold;
      G.emit('fold', { folded: isFolded(), state: Object.assign({}, st) });
    }
    function remember() { if (!isFolded()) { arr = { side: st.side === 'docked', bar: st.bar === 'docked', insp: st.insp === 'docked' }; store.set('arrangement', arr); } }
    const api = {
      state: st,
      isFolded,
      available: () => !!win,
      peek(p) { if (!win || !present(p) || st[p] === 'docked' || st[p] === 'peek') return; unpeek(); st[p] = 'peek'; apply(); },
      unpeek() { unpeek(); },
      dock(p) {
        if (!win || !present(p)) return;
        st[p] = 'docked';
        // Anything docked brings the toolbar with it: its controls are how the rest is reached.
        if (p !== 'bar' && present('bar') && st.bar !== 'docked') st.bar = 'docked';
        remember(); apply();
      },
      away(p) { if (!win || !present(p)) return; st[p] = 'away'; remember(); apply(); },
      toggle(p) {
        if (!win) return;
        if (!p) return isFolded() ? api.unfold() : api.fold();
        if (st[p] === 'docked') api.away(p); else api.dock(p);
      },
      fold() { if (!win) return; remember(); parts().forEach((p) => { st[p] = 'away'; }); apply(); },
      unfold() {
        if (!win) return;
        const a = parts().some((p) => arr[p]) ? arr : { side: true, bar: true, insp: true };
        parts().forEach((p) => { st[p] = a[p] ? 'docked' : 'away'; });
        if (isFolded()) parts().forEach((p) => { st[p] = 'docked'; });
        apply();
      }
    };
    function unpeek() { let ch = false; PARTS.forEach((p) => { if (st[p] === 'peek') { st[p] = 'away'; ch = true; } }); if (ch) apply(); }
    const peeking = () => PARTS.filter((p) => st[p] === 'peek');

    // Anything the reader has open that Escape should close first.
    const somethingOpen = () => G.menuOpen() || G.palette.el || $('.scrim, .sheet-scrim, .seltb, .fn-pop, .ask-sheet, .findbar:not([hidden]), [role="dialog"]');

    function init(opts = {}) {
      win = $('.win');
      if (!win || win.dataset.fold === 'off') { win = null; return; }
      keys = win.hasAttribute('data-fold-keys');
      const startFolded = win.dataset.fold === 'folded' || opts.fold === 'folded';
      if (win.classList.contains('no-side')) { win.classList.remove('no-side'); arr.side = false; }
      else if (G.prefs.sidebar === false && !store.get('arrangement', null)) arr.side = false;
      if (G.prefs.inspector === 'never') arr.insp = false;
      else if (G.prefs.inspector === 'always' && !store.get('arrangement', null)) arr.insp = true;
      if (startFolded) parts().forEach((p) => { st[p] = 'away'; });
      else parts().forEach((p) => { st[p] = arr[p] ? 'docked' : 'away'; });
      apply();
      // Transitions are switched on after the first paint so the page never animates into its starting state.
      requestAnimationFrame(() => requestAnimationFrame(() => { win.classList.add('fx'); ready = true; }));

      // Dock a peeked panel by clicking inside it.
      PARTS.forEach((p) => els(p).forEach((n) => n.addEventListener('mousedown', () => { if (st[p] === 'peek') api.dock(p); })));

      // Edge peek: the pointer rests within 8px of an edge for 150 ms.
      let zone = null, restT = null, leaveT = null;
      const zoneAt = (x, y) => (x <= EDGE ? 'side' : x >= innerWidth - EDGE ? 'insp' : y <= EDGE ? 'bar' : null);
      const rectOf = (p) => { const rs = els(p).map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height); if (!rs.length) return null; return { l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)), t: Math.min(...rs.map((r) => r.top)), b: Math.max(...rs.map((r) => r.bottom)) }; };
      document.addEventListener('mousemove', (e) => {
        if (!win || e.buttons) return;
        const z = zoneAt(e.clientX, e.clientY);
        if (z !== zone) {
          zone = z; clearTimeout(restT);
          if (z && present(z) && st[z] === 'away') restT = setTimeout(() => { if (zone === z) api.peek(z); }, REST);
        }
        const pk = peeking();
        if (!pk.length) return;
        const inside = pk.some((p) => { const r = rectOf(p); return (r && e.clientX >= r.l - 6 && e.clientX <= r.r + 6 && e.clientY >= r.t - 6 && e.clientY <= r.b + 6) || z === p; });
        if (inside) { clearTimeout(leaveT); leaveT = null; } else if (!leaveT) leaveT = setTimeout(() => { leaveT = null; unpeek(); }, LEAVE);
      });
      document.documentElement.addEventListener('mouseleave', () => { zone = null; clearTimeout(restT); if (peeking().length) { clearTimeout(leaveT); leaveT = setTimeout(() => { leaveT = null; unpeek(); }, LEAVE); } });

      // Keys run in the capture phase so Escape can see what is open before the menu or palette closes itself.
      document.addEventListener('keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && !e.altKey && !e.shiftKey && (e.key === '\\' || e.code === 'Backslash')) { e.preventDefault(); e.stopPropagation(); api.toggle(); return; }
        // The sidebar key works in every state and on every page with a sidebar (it also beats a page's own ⌘S).
        if (e.metaKey && e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); e.stopPropagation(); api.toggle('side'); return; }
        if (!keys) return;
        if (mod && e.altKey && e.code === 'KeyI') { e.preventDefault(); e.stopPropagation(); api.toggle('insp'); }
        else if (e.key === 'Escape' && !e.defaultPrevented) {
          if (somethingOpen()) return;
          if (peeking().length) { unpeek(); return; }
          const ae = document.activeElement;
          if (ae && ae.matches && ae.matches('input, textarea, select, [contenteditable]')) { ae.blur(); return; }
          if (!isFolded()) api.fold();
        }
      }, true);

      // One-time hint, only when the window starts folded.
      if (startFolded && !store.get('foldHint', false)) {
        store.set('foldHint', true);
        const h = el(`<div class="fold-hint" role="status">${isMac ? '⌘\\' : 'Ctrl+\\'} unfolds the workspace · move to an edge to peek</div>`);
        document.body.appendChild(h);
        requestAnimationFrame(() => requestAnimationFrame(() => h.classList.add('on')));
        setTimeout(() => h.classList.remove('on'), 3000);
        setTimeout(() => h.remove(), 3700);
      }
    }
    api.init = init;
    return api;
  })();

  /* ---------- Global wiring ---------- */

  G.command({ id: 'palette', name: 'Command palette', icon: 'search', kbd: '⌘K', desc: 'Also ⌘P', group: 'Navigate', run: () => G.palette.open('') });
  G.command({ id: 'palette-commands', name: 'Run a command', icon: 'terminal', kbd: '⇧⌘P', group: 'Navigate', run: () => G.palette.open('>') });
  G.command({ id: 'palette-transforms', name: 'Transform…', icon: 'wand-sparkles', kbd: '⌘/', group: 'Navigate', desc: 'Opens the palette on the transforms, for the selection or the document', run: () => G.palette.open('>Transform: ') });
  G.command({ id: 'palette-content', name: 'Search file contents', icon: 'text-search', group: 'Navigate', desc: 'Type / in the palette', run: () => G.palette.open('/') });
  G.command({ id: 'palette-headings', name: 'Go to heading', icon: 'hash', kbd: '⇧⌘O', group: 'Navigate', run: () => G.palette.open('#') });
  G.command({ id: 'theme-menu', name: 'Theme menu', icon: 'palette', group: 'Theme', run: (a) => G.themeMenu(a || $('[data-cmd="theme-menu"]')) });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cmd]');
    if (!t) return;
    e.preventDefault();
    const c = G.commands.find((x) => x.id === t.dataset.cmd);
    if (c) c.run(t); else G.run(t.dataset.cmd, t);
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (mod && k === 'k' && !e.altKey) { e.preventDefault(); G.palette.el ? G.palette.close() : G.palette.open(''); }
    else if (mod && e.shiftKey && k === 'p') { e.preventDefault(); G.palette.open('>'); }
    else if (mod && !e.altKey && !e.ctrlKey && !e.shiftKey && k === '/') { e.preventDefault(); G.palette.open('>Transform: '); }
    else if (mod && !e.altKey && !e.shiftKey && k === 'p') { e.preventDefault(); G.palette.el ? G.palette.close() : G.palette.open(''); }
    else if (mod && k === ',') { e.preventDefault(); location.href = G.page('settings'); }
    else if (mod && (k === '=' || k === '+')) { e.preventDefault(); G.run('scale-up'); }
    else if (mod && k === '-') { e.preventDefault(); G.run('scale-down'); }
    else if (mod && k === '0') { e.preventDefault(); G.run('scale-reset'); }
    // Option changes e.key on macOS (Option-K types a ring accent), so Option shortcuts match the physical key.
    else if (mod && e.shiftKey && k === 'o') { e.preventDefault(); G.palette.open('#'); }
    else if (e.metaKey && e.ctrlKey && k === 't') { e.preventDefault(); G.run('theme-next'); }
    else if (e.ctrlKey && !e.metaKey && !e.shiftKey && k === 'g' && !G.palette.el) { e.preventDefault(); G.palette.open(':'); }
    // New and fork work folded too: the new document opens in the same folded window.
    else if (e.metaKey && e.ctrlKey && e.code === 'KeyI') { e.preventDefault(); G.run('toggle-metadata'); }
    else if (mod && e.shiftKey && !e.altKey && k === 'e') { e.preventDefault(); G.run('open-editor'); }
    else if (mod && e.altKey && e.code === 'KeyR') { e.preventDefault(); G.run('reveal-finder'); }
    else if (mod && e.altKey && e.code === 'KeyW') { e.preventDefault(); G.run('src-whitespace'); }
    else if (mod && !e.altKey && !e.shiftKey && k === 'n') { e.preventDefault(); G.run('new-file'); }
    else if (mod && !e.altKey && e.shiftKey && k === 'n') { e.preventDefault(); G.run('fork'); }
    else if (mod && !e.altKey && e.shiftKey && k === 'c' && !G.palette.el) { e.preventDefault(); G.run('copy-as'); }
  });
  // Where the pointer last was: ⇧⌘C opens its menu there, and "the block under the pointer" is found from it.
  G.pointer = { x: innerWidth / 2, y: 120, target: null };
  document.addEventListener('mousemove', (e) => { G.pointer.x = e.clientX; G.pointer.y = e.clientY; G.pointer.target = e.target; }, { passive: true });

  // Fill any empty chrome slots and draw icons. Pages call Marxy.boot() after their own markup.
  G.boot = (opts = {}) => {
    const side = $('[data-slot="sidebar"]');
    if (side && !side.children.length) { side.innerHTML = G.ui.sidebar(opts); G.ui.rove(side); }
    G.icons();
    // The reader's per-language colour overrides (compiled by 07-themes), applied after lang-colors.css.
    try {
      const lc = store.get('langCss', '');
      if (typeof lc === 'string' && lc && !document.getElementById('lang-overrides')) { const st = document.createElement('style'); st.id = 'lang-overrides'; st.textContent = lc; document.head.appendChild(st); }
    } catch (e) { /* storage unavailable */ }
    // A fork made on another page announces itself here, in the workspace that opened it.
    const pend = store.get('pendingToast', null);
    if (pend) { store.set('pendingToast', null); G.toast(pend.msg, { icon: pend.icon, action: pend.undo ? { label: 'Undo', run: () => G.removeUserDoc(pend.undo) } : null }); }
    // The way back to a closed sidebar, on every page that has the app sidebar and without any page edit:
    // a toggle as the first item of the toolbar (re-added if a page rebuilds its toolbar), and, when no toolbar is showing
    // (folded), a quiet floating button at the top left that appears while the pointer moves and fades after 1.5 s.
    const win = $('.win'); const hasSidebar = !!(side || (win && $('.sidebar', win)));
    if (hasSidebar && win && win.dataset.fold !== 'off') {
      const ensure = () => {
        const tb = $('.win > .main > .toolbar') || $('.win .toolbar'); if (!tb || tb.querySelector('[data-sidebar-toggle]')) return;
        const b = el(`<button class="tb-btn sb-toggle" data-cmd="toggle-sidebar" data-sidebar-toggle aria-pressed="${G.fold.state.side === 'docked'}" title="Show / hide the sidebar (⌃⌘S)" aria-label="Show or hide the sidebar">${ic('panel-left')}</button>`);
        tb.prepend(b); G.icons(b); syncToggles();
      };
      const syncToggles = () => { const on = G.fold.state.side === 'docked'; $$('[data-sidebar-toggle]').forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); };
      ensure(); G.on('fold', syncToggles); setTimeout(syncToggles, 0);
      new MutationObserver(ensure).observe(win, { childList: true, subtree: true });
      const fl = el(`<button class="sb-float" data-cmd="toggle-sidebar" aria-label="Show the sidebar" title="Show the sidebar (⌃⌘S)">${ic('panel-left')}</button>`);
      document.body.appendChild(fl); G.icons(fl);
      let t = null; const active = () => G.fold.state.side !== 'docked' && G.fold.state.bar !== 'docked';
      const show = () => { if (!active()) return; fl.classList.add('on'); clearTimeout(t); t = setTimeout(() => { if (document.activeElement !== fl) fl.classList.remove('on'); }, 1500); };
      document.addEventListener('mousemove', show, { passive: true });
      fl.addEventListener('focus', () => { fl.classList.add('on'); clearTimeout(t); });
      fl.addEventListener('blur', () => { t = setTimeout(() => fl.classList.remove('on'), 1500); });
      G.on('fold', () => { if (!active()) fl.classList.remove('on'); fl.tabIndex = active() ? 0 : -1; });
      fl.tabIndex = -1;
      // After the sidebar's own close button, focus goes to whichever toggle is showing.
      G.ui.focusToggle = () => setTimeout(() => { const tbt = $('[data-sidebar-toggle]'); if (G.fold.state.bar === 'docked' && tbt) tbt.focus(); else { fl.tabIndex = 0; fl.focus(); } }, 40);
    }
    G.fold.init(opts);
    if (document.fonts && G.measureAll) document.fonts.ready.then(() => G.measureAll());
  };
})();
