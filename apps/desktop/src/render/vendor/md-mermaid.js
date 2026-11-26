/* md-mermaid.js: draws a subset of Mermaid (flowchart, sequenceDiagram) as static, accessible SVG.
   No libraries, no network. Adapted from the original renderer; the
   one change is that it is an ES module, its `render` exported, where the original was a classic script. */

  var LINE_H = 1.3;
  var MAX_NODES = 150, MAX_EDGES = 300;

  var UNSUPPORTED = {
    classDiagram: "Class diagrams", "classDiagram-v2": "Class diagrams",
    stateDiagram: "State diagrams", "stateDiagram-v2": "State diagrams",
    erDiagram: "Entity relationship diagrams", gantt: "Gantt charts", pie: "Pie charts",
    gitGraph: "Git graphs", mindmap: "Mind maps", timeline: "Timelines", journey: "User journeys",
    quadrantChart: "Quadrant charts", "sankey-beta": "Sankey diagrams", sankey: "Sankey diagrams",
    "xychart-beta": "XY charts", xychart: "XY charts", "block-beta": "Block diagrams", block: "Block diagrams",
    requirementDiagram: "Requirement diagrams", requirement: "Requirement diagrams",
    C4Context: "C4 diagrams", C4Container: "C4 diagrams", C4Component: "C4 diagrams",
    C4Dynamic: "C4 diagrams", C4Deployment: "C4 diagrams",
    "packet-beta": "Packet diagrams", packet: "Packet diagrams", kanban: "Kanban boards",
    "architecture-beta": "Architecture diagrams", architecture: "Architecture diagrams",
    "radar-beta": "Radar charts", radar: "Radar charts", "treemap-beta": "Treemaps", treemap: "Treemaps",
    zenuml: "ZenUML diagrams", info: "Info diagrams"
  };

  // ------------------------------------------------------------------ small helpers

  // Drops what XML 1.0 cannot carry: control characters, lone surrogates, U+FFFE/FFFF.
  function xmlSafe(s) {
    if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/.test(s)) return s;
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { out += s.charAt(i) + s.charAt(i + 1); i++; }
        continue;
      }
      if ((c >= 0xdc00 && c <= 0xdfff) || (c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffe || c === 0xffff) continue;
      out += s.charAt(i);
    }
    return out;
  }

  function esc(s) {
    return xmlSafe(String(s)).replace(/[&<>"']/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;";
    });
  }

  function n1(v) {
    var r = Math.round(v * 10) / 10;
    return r === 0 || !isFinite(r) ? "0" : String(r);
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  function defaultMeasure(text, px, weight) {
    var bold = weight === "bold" || +weight >= 600, w = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i), code = text.charCodeAt(i);
      if (code >= 0xdc00 && code <= 0xdfff) continue;
      if (c === " " || c === "i" || c === "l" || c === ".") w += 0.3;
      else if (c === "m" || c === "w" || c === "M" || c === "W") w += 0.75;
      else if (code >= 0x2e80) w += 1;
      else w += bold ? 0.6 : 0.56;
    }
    return w * px;
  }

  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  var NAMED = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: "\u00a0", num: "#", semi: ";", colon: ":" };

  // Mermaid's own escapes (#quot; #35;) plus the HTML ones people paste in.
  function decodeEntities(s) {
    return s.replace(/[#&](#?)(x?)([0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, hash, hex, k) {
      if (/^\d+$/.test(k) || (hex && /^[0-9a-fA-F]+$/.test(k))) {
        var cp = parseInt(k, hex ? 16 : 10);
        return cp > 0 && cp <= 0x10ffff && String.fromCodePoint ? String.fromCodePoint(cp) : m;
      }
      return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m;
    });
  }

  function unquote(s) {
    s = String(s).trim();
    if (s.length >= 2 && ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') || (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'"))) return s.slice(1, -1);
    return s;
  }

  // Label text as Mermaid shows it: <br> breaks lines, other tags and icon codes drop out.
  function cleanLabel(s, md) {
    s = String(s == null ? "" : s);
    if (md || (s.length > 1 && s.charAt(0) === "`" && s.charAt(s.length - 1) === "`")) {
      s = s.replace(/^`|`$/g, "");
      s = s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
        .replace(/\*(.+?)\*/g, "$1").replace(/(^|[^\w])_(.+?)_(?![\w])/g, "$1$2");
    }
    s = s.replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n").replace(/<\/?[A-Za-z][^<>]*>/g, "");
    s = s.replace(/\bfa[srbl]?:fa-[\w-]+\s?/g, "");
    s = decodeEntities(s);
    return s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
  }

  function oneLine(s) { return String(s).replace(/\s*\n\s*/g, " ").trim(); }

  function wrapLines(text, ctx, px, maxW, weight) {
    var out = [];
    String(text).split("\n").forEach(function (para) {
      var words = para.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); return; }
      var line = words[0];
      for (var i = 1; i < words.length; i++) {
        var t = line + " " + words[i];
        if (ctx.measure(t, px, weight || "normal") <= maxW) line = t;
        else { out.push(line); line = words[i]; }
      }
      out.push(line);
    });
    while (out.length > 1 && out[out.length - 1] === "") out.pop();
    while (out.length > 1 && out[0] === "") out.shift();
    return out;
  }

  // {lines, w, h} for a label at font size px, wrapped at maxW (0: never wrap).
  function textBlock(text, ctx, px, maxW, balance, weight) {
    var lines = maxW ? wrapLines(text, ctx, px, maxW, weight) : String(text).split("\n");
    if (balance && maxW && lines.length > 1) {
      var lo = 0, hi = maxW, count = lines.length;
      for (var it = 0; it < 12; it++) {
        var mid = (lo + hi) / 2;
        if (wrapLines(text, ctx, px, mid, weight).length <= count) hi = mid; else lo = mid;
      }
      lines = wrapLines(text, ctx, px, hi, weight);
    }
    var w = 0;
    lines.forEach(function (l) { w = Math.max(w, ctx.measure(l, px, weight || "normal")); });
    return { lines: lines, w: w, h: lines.length * px * LINE_H, px: px };
  }

  // Lines centred on (cx, cy); anchor "start" puts x at the left edge instead.
  function textSvg(cls, tb, cx, cy, anchor) {
    var lh = tb.px * LINE_H, top = cy - tb.lines.length * lh / 2;
    var s = '<text class="' + cls + '" text-anchor="' + (anchor || "middle") + '">';
    tb.lines.forEach(function (l, i) {
      s += '<tspan x="' + n1(cx) + '" y="' + n1(top + lh * (i + 0.5) + tb.px * 0.35) + '">' + esc(l) + "</tspan>";
    });
    return s + "</text>";
  }

  function perr(line, msg) { var e = new Error(msg); e.mmLine = line; return e; }

  function fail(kind, note) {
    return { ok: false, kind: kind, svg: null, width: 0, height: 0, title: "", note: note };
  }

  // ------------------------------------------------------------------ front matter, header, accessibility lines

  function preprocess(src) {
    var raw = src.replace(/\r\n?/g, "\n").split("\n");
    var start = 0, fmTitle = null, k = 0;
    while (k < raw.length && !raw[k].trim()) k++;
    if (k < raw.length && raw[k].trim() === "---") {
      var j = k + 1, t = null;
      while (j < raw.length && raw[j].trim() !== "---") {
        var mt = /^\s*title\s*:\s*(.*)$/.exec(raw[j]);
        if (mt) t = unquote(mt[1]);
        j++;
      }
      if (j < raw.length) { start = j + 1; fmTitle = t; }
    }
    var lines = [];
    for (var i = start; i < raw.length; i++) lines.push({ no: i + 1, text: raw[i] });
    var pre = { lines: lines, fmTitle: fmTitle, kind: "unknown", word: "", headerAt: -1, headerRest: "" };
    for (i = 0; i < lines.length; i++) {
      var s = lines[i].text.trim();
      if (!s || /^%%/.test(s)) continue;
      var m = /^([A-Za-z][\w-]*)(.*)$/.exec(s);
      if (!m) return pre;
      pre.word = m[1];
      pre.headerAt = i;
      pre.headerRest = m[2];
      if (m[1] === "graph" || m[1] === "flowchart" || m[1] === "flowchart-elk") pre.kind = "flowchart";
      else if (m[1] === "sequenceDiagram") pre.kind = "sequence";
      else if (Object.prototype.hasOwnProperty.call(UNSUPPORTED, m[1])) pre.kind = m[1];
      return pre;
    }
    return pre;
  }

  // accTitle / accDescr lines (single line or { block }). Returns the index of the last line consumed, or -1.
  function takeAcc(lines, i, model) {
    var s = lines[i].text.trim(), m;
    if ((m = /^accTitle\s*:\s*(.*)$/.exec(s))) { model.accTitle = m[1].trim(); return i; }
    if ((m = /^accDescr\s*:\s*(.*)$/.exec(s))) { model.accDescr = m[1].trim(); return i; }
    if ((m = /^accDescr\s*\{(.*)$/.exec(s))) {
      var parts = [], rest = m[1], j = i;
      for (;;) {
        var close = rest.indexOf("}");
        if (close >= 0) { parts.push(rest.slice(0, close)); break; }
        parts.push(rest);
        if (++j >= lines.length) throw perr(lines[i].no, "accDescr is never closed with }.");
        rest = lines[j].text;
      }
      model.accDescr = parts.join(" ").replace(/\s+/g, " ").trim();
      return j;
    }
    return -1;
  }

  function makeCtx(src, opts) {
    var user = typeof opts.measure === "function" ? opts.measure : null;
    var px = +opts.fontPx > 0 ? +opts.fontPx : 14;
    var prefix = typeof opts.idPrefix === "string" && opts.idPrefix ? opts.idPrefix.replace(/[^\w-]/g, "_") : "mm" + hashStr(src) + "-";
    return {
      px: px, sm: px - 1.5, idp: prefix,
      measure: function (text, size, weight) {
        if (user) {
          try { var w = +user(text, size, weight); if (w >= 0 && isFinite(w)) return w; } catch (e) { /* fall back */ }
        }
        return defaultMeasure(text, size, weight);
      }
    };
  }

  function render(src, opts) {
    var kind = "unknown";
    try {
      opts = opts || {};
      src = String(src == null ? "" : src);
      var pre = preprocess(src);
      kind = pre.kind;
      if (pre.headerAt < 0) return fail("unknown", pre.lines.some(function (l) { var t = l.text.trim(); return t && t.slice(0, 2) !== "%%"; }) ? "The first line does not name a diagram type this reader can draw." : "The diagram is empty.");
      var ctx = makeCtx(src, opts);
      if (kind === "flowchart") return renderFlow(pre, ctx);
      if (kind === "sequence") return renderSeq(pre, ctx);
      if (kind !== "unknown") return fail(kind, UNSUPPORTED[kind] + " are not drawn here; this reader draws flowcharts and sequence diagrams.");
      return fail("unknown", "The first line does not name a diagram type this reader can draw.");
    } catch (e) {
      if (e && e.mmLine) return fail(kind, "Line " + e.mmLine + " could not be read: " + e.message.replace(/\.$/, "") + ".");
      return fail(kind, "The diagram could not be drawn.");
    }
  }

  function svgOpen(cls, w, h, idp, title, desc) {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="mm ' + cls + '" viewBox="0 0 ' + n1(w) + " " + n1(h) +
      '" width="' + n1(w) + '" height="' + n1(h) + '" role="img" aria-labelledby="' + idp + 'title" aria-describedby="' + idp + 'desc">' +
      '<title id="' + idp + 'title">' + esc(title) + "</title>" + '<desc id="' + idp + 'desc">' + esc(desc) + "</desc>";
  }

  // Arrowheads: the path stops 4px short of its target and each head reaches forward to it.
  function markerDefs(idp, used) {
    var s = "<defs>";
    function mk(id, refX, body) {
      s += '<marker id="' + idp + id + '" viewBox="0 0 10 10" refX="' + refX + '" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">' + body + "</marker>";
    }
    if (used.arrow) mk("arrow", 6, '<path class="mm-head" d="M0,0.5 L10,5 L0,9.5 Z"/>');
    if (used.arrowS) mk("arrow-s", 4, '<path class="mm-head" d="M10,0.5 L0,5 L10,9.5 Z"/>');
    if (used.open) mk("open", 6, '<path class="mm-head mm-head-open" d="M0,0.5 L10,5 L0,9.5 L3,5 Z"/>');
    if (used.openS) mk("open-s", 4, '<path class="mm-head mm-head-open" d="M10,0.5 L0,5 L10,9.5 L7,5 Z"/>');
    if (used.circle) mk("circle", 5, '<circle class="mm-head mm-head-o" cx="5" cy="5" r="4"/>');
    if (used.cross) mk("cross", 5.5, '<path class="mm-head mm-head-x" d="M0.8,2.2 L2.2,0.8 L5,3.6 L7.8,0.8 L9.2,2.2 L6.4,5 L9.2,7.8 L7.8,9.2 L5,6.4 L2.2,9.2 L0.8,7.8 L3.6,5 Z"/>');
    return s + "</defs>";
  }

  function markerAttr(idp, head, atStart, used) {
    if (!head) return "";
    var id = head === "arrow" ? (atStart ? "arrow-s" : "arrow") : head === "open" ? (atStart ? "open-s" : "open") : head;
    used[id === "arrow-s" ? "arrowS" : id === "open-s" ? "openS" : id] = true;
    return " marker-" + (atStart ? "start" : "end") + '="url(#' + idp + id + ')"';
  }

  // ------------------------------------------------------------------ flowchart: parse

  var DIRS = { TB: "TD", TD: "TD", BT: "BT", RL: "RL", LR: "LR", ">": "LR", "<": "RL", "^": "BT", v: "TD" };

  var SHAPE_OPEN = [
    ["(((", ")))", "circle"], ["((", "))", "circle"], ["([", "])", "stadium"], ["(", ")", "round"],
    ["[[", "]]", "subroutine"], ["[(", ")]", "cylinder"], ["[/", "", "slantR"], ["[\\", "", "slantL"], ["[", "]", "rect"],
    ["{{", "}}", "hexagon"], ["{", "}", "diamond"], [">", "]", "flag"]
  ];

  // Mermaid 11 `A@{ shape: name }` names, folded onto the shapes drawn here.
  var SHAPE_NAMES = {
    rect: "rect", rectangle: "rect", proc: "rect", process: "rect", card: "rect", doc: "rect", document: "rect",
    rounded: "round", event: "round", stadium: "stadium", pill: "stadium", terminal: "stadium",
    "fr-rect": "subroutine", subprocess: "subroutine", subroutine: "subroutine", "framed-rectangle": "subroutine",
    cyl: "cylinder", cylinder: "cylinder", database: "cylinder", db: "cylinder", "h-cyl": "cylinder", disk: "cylinder",
    circle: "circle", circ: "circle", "dbl-circ": "circle", "double-circle": "circle", "sm-circ": "circle", start: "circle", stop: "circle",
    diam: "diamond", diamond: "diamond", decision: "diamond", question: "diamond",
    hex: "hexagon", hexagon: "hexagon", prepare: "hexagon",
    "lean-r": "para", "lean-right": "para", "in-out": "para", "lean-l": "para-l", "lean-left": "para-l", "out-in": "para-l",
    "trap-b": "trap", trapezoid: "trap", priority: "trap", "trapezoid-bottom": "trap",
    "trap-t": "trap-l", "inv-trapezoid": "trap-l", manual: "trap-l", "trapezoid-top": "trap-l",
    odd: "flag", flag: "flag"
  };

  // Splits a line on ';' outside quotes, brackets and |labels|, and drops a trailing %% comment.
  function splitStatements(text) {
    var out = [], cur = "", depth = 0, q = false, pipe = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (q) { cur += c; if (c === '"') q = false; continue; }
      if (c === '"') { q = true; cur += c; continue; }
      if (c === "%" && text.charAt(i + 1) === "%" && !pipe) break;
      if (c === "|" && depth === 0) pipe = !pipe;
      else if (!pipe) {
        if (c === "[" || c === "(" || c === "{") depth++;
        else if ((c === "]" || c === ")" || c === "}") && depth > 0) depth--;
        else if (c === ";" && depth === 0) { out.push(cur); cur = ""; continue; }
      }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  function headOf(c) { return c === ">" || c === "<" ? "arrow" : c === "x" ? "cross" : c === "o" ? "circle" : null; }

  function parseFlow(pre) {
    var model = { dir: "TD", nodes: new Map(), nodeList: [], clusters: new Map(), clusterList: [], edges: [], title: pre.fmTitle, accTitle: null, accDescr: null };
    var seq = 0, stack = [], closed = [], lines = pre.lines;

    function defineNode(id, shp) {
      var n = model.nodes.get(id);
      if (!n) {
        n = { id: id, label: id, shape: "rect", cluster: null, seq: seq++ };
        model.nodes.set(id, n);
        model.nodeList.push(n);
      }
      if (shp) {
        if (shp.label != null) n.label = shp.label;
        if (shp.shape) n.shape = shp.shape;
      }
      if (stack.length) stack[stack.length - 1].mentions.push(id);
    }

    function openSub(rest, no) {
      var id, title, m;
      if (!rest) { id = "subGraph" + model.clusterList.length; title = ""; }
      else if (rest.charAt(0) === '"') { title = unquote(rest); id = title; }
      else if ((m = /^([^\s\[\]"]+)\s*\[(.*)\]$/.exec(rest))) { id = m[1]; title = unquote(m[2]); }
      else { id = rest; title = rest; }
      var c = model.clusters.get(id);
      if (!c) {
        c = { id: id, title: title, parent: stack.length ? stack[stack.length - 1] : null, children: [], mentions: [], line: no, seq: seq++ };
        model.clusters.set(id, c);
        model.clusterList.push(c);
        if (c.parent) c.parent.children.push(c);
      }
      stack.push(c);
    }

    function parseChain(s, no) {
      var p = 0, len = s.length;
      function ws() { while (p < len && /\s/.test(s.charAt(p))) p++; }
      function bad(msg) { throw perr(no, msg); }
      function isIdChar(c) { return /[A-Za-z0-9_\u00C0-\uFFFF]/.test(c); }

      function readId() {
        var st = p;
        while (p < len) {
          var c = s.charAt(p);
          if (isIdChar(c)) p++;
          else if ((c === "-" || c === ".") && p > st && isIdChar(s.charAt(p + 1))) p++;
          else break;
        }
        return s.slice(st, p);
      }

      function readLabelUntil(q, closers) {
        var i = q, k;
        while (i < len && s.charAt(i) === " ") i++;
        if (s.charAt(i) === '"') {
          var e = s.indexOf('"', i + 1);
          if (e >= 0) {
            var j = e + 1;
            while (j < len && s.charAt(j) === " ") j++;
            for (k = 0; k < closers.length; k++) {
              if (s.substr(j, closers[k][0].length) === closers[k][0]) return { end: j + closers[k][0].length, shape: closers[k][1], label: s.slice(i + 1, e) };
            }
          }
        }
        var best = -1, bk = -1;
        for (k = 0; k < closers.length; k++) {
          var idx = s.indexOf(closers[k][0], q);
          if (idx >= 0 && (best < 0 || idx < best)) { best = idx; bk = k; }
        }
        if (best < 0) return null;
        return { end: best + closers[bk][0].length, shape: closers[bk][1], label: s.slice(q, best).trim() };
      }

      function readShape() {
        for (var k = 0; k < SHAPE_OPEN.length; k++) {
          var o = SHAPE_OPEN[k];
          if (s.substr(p, o[0].length) !== o[0]) continue;
          var closers = o[2] === "slantR" ? [["/]", "para"], ["\\]", "trap"]] :
            o[2] === "slantL" ? [["\\]", "para-l"], ["/]", "trap-l"]] : [[o[1], o[2]]];
          var r = readLabelUntil(p + o[0].length, closers);
          if (r) { p = r.end; return r; }
        }
        bad("a node shape is never closed");
      }

      function shapeData(body, cur) {
        var r = { shape: cur ? cur.shape : null, label: cur ? cur.label : null };
        var m1 = /(?:^|[,\s])shape\s*:\s*["']?([\w-]+)/.exec(body);
        if (m1) r.shape = SHAPE_NAMES[m1[1].toLowerCase()] || "rect";
        var m2 = /(?:^|[,\s])label\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,\n]+))/.exec(body);
        if (m2) r.label = m2[1] != null ? m2[1] : m2[2] != null ? m2[2] : m2[3].trim();
        return r;
      }

      function nodeRef() {
        ws();
        var id = readId();
        if (!id) bad(p < len ? 'unexpected "' + s.charAt(p) + '"' : "a node is missing");
        var q = p;
        while (q < len && s.charAt(q) === " ") q++;
        var c = s.charAt(q), shp = null;
        if (c === "[" || c === "(" || c === "{" || (c === ">" && q === p)) { p = q; shp = readShape(); }
        if (s.substr(p, 2) === "@{") {
          var e = s.indexOf("}", p);
          if (e < 0) bad("node data opened with @{ is never closed");
          shp = shapeData(s.slice(p + 2, e), shp);
          p = e + 1;
        }
        if (s.substr(p, 3) === ":::") { p += 3; while (p < len && /[\w-]/.test(s.charAt(p))) p++; }
        defineNode(id, shp);
        return id;
      }

      function group() {
        var ids = [nodeRef()];
        for (;;) {
          var save = p;
          ws();
          if (s.charAt(p) === "&") { p++; ids.push(nodeRef()); }
          else { p = save; return ids; }
        }
      }

      function mk(type, a, b) { return { type: type, startHead: headOf(a), endHead: headOf(b), label: "" }; }

      function pipeEnd(i) {
        var j = i;
        while (j < len && s.charAt(j) === " ") j++;
        if (s.charAt(j) === '"') {
          var e = s.indexOf('"', j + 1);
          if (e >= 0 && s.indexOf("|", e + 1) >= 0) return s.indexOf("|", e + 1);
        }
        return s.indexOf("|", i);
      }

      function link() {
        var rest = s.slice(p), m, L = null;
        var eid = /^[A-Za-z0-9_]+@(?=[-=.~<xo])/.exec(rest);
        if (eid) { p += eid[0].length; rest = s.slice(p); }
        if ((m = /^([<xo]?)(-{2,})([->xo])/.exec(rest))) L = mk("normal", m[1], m[3]);
        else if ((m = /^([<xo]?)-(\.+)-([>xo]?)/.exec(rest))) L = mk("dotted", m[1], m[3]);
        else if ((m = /^([<xo]?)(={2,})([=>xo])/.exec(rest))) L = mk("thick", m[1], m[3]);
        else if ((m = /^~{3,}/.exec(rest))) L = mk("invisible", "", "");
        if (L) {
          p += m[0].length;
          var save = p;
          ws();
          if (s.charAt(p) === "|") {
            var e = pipeEnd(p + 1);
            if (e < 0) bad("an edge label opened with | is never closed");
            L.label = unquote(s.slice(p + 1, e));
            p = e + 1;
          } else p = save;
          return L;
        }
        // Text between the two halves: -- text -->, -. text .->, == text ==>
        if ((m = /^([<xo]?)(--|==|-\.)/.exec(rest))) {
          var from = p + m[0].length, look = from;
          while (look < len && s.charAt(look) === " ") look++;
          if (s.charAt(look) === '"' && s.indexOf('"', look + 1) > 0) look = s.indexOf('"', look + 1) + 1;
          var endRe = m[2] === "--" ? /-{2,}[>xo]|-{3,}/g : m[2] === "==" ? /={2,}[>xo]|={3,}/g : /\.+-+[>xo]?/g;
          endRe.lastIndex = look;
          var em = endRe.exec(s);
          if (!em) bad("an edge starting with " + m[2] + " has no end");
          var last = em[0].charAt(em[0].length - 1);
          L = mk(m[2] === "--" ? "normal" : m[2] === "==" ? "thick" : "dotted", m[1], /[>xo]/.test(last) ? last : "");
          L.label = unquote(s.slice(from, em.index));
          p = em.index + em[0].length;
          return L;
        }
        return null;
      }

      var groups = [group()], links = [];
      ws();
      while (p < len) {
        var lk = link();
        if (!lk) bad('unexpected "' + s.slice(p, p + 14).trim() + '"');
        ws();
        if (p >= len) bad("an arrow has no node after it");
        links.push(lk);
        groups.push(group());
        ws();
      }
      links.forEach(function (lk, i) {
        groups[i].forEach(function (a) {
          groups[i + 1].forEach(function (b) {
            model.edges.push({ from: a, to: b, type: lk.type, startHead: lk.startHead, endHead: lk.endHead, label: lk.label, line: no, idx: model.edges.length });
          });
        });
      });
    }

    function statement(st, no) {
      var m;
      if ((m = /^subgraph(?:\s+(.*))?$/.exec(st))) return openSub((m[1] || "").trim(), no);
      if (st === "end") {
        if (!stack.length) throw perr(no, "end has no subgraph to close");
        closed.push(stack.pop());
        return;
      }
      if (/^(classDef|class|style|linkStyle|click|direction)(\s|$)/.test(st)) return;
      if (/^(accTitle|accDescr)\s*[:{]/.test(st)) return;
      parseChain(st, no);
    }

    function statementLine(text, no) {
      splitStatements(text).forEach(function (part) {
        var st = part.trim();
        if (st) statement(st, no);
      });
    }

    var hdr = pre.headerRest.trim();
    var dm = /^(TB|TD|BT|RL|LR)(?![\w-])|^([<>^v])(?=\s|;|$)/.exec(hdr);
    if (dm) { model.dir = DIRS[dm[1] || dm[2]]; hdr = hdr.slice(dm[0].length); }
    statementLine(hdr, lines[pre.headerAt].no);
    for (var i = pre.headerAt + 1; i < lines.length; i++) {
      var t = lines[i].text, s = t.trim();
      if (!s || s.slice(0, 2) === "%%") continue;
      var acc = takeAcc(lines, i, model), no = lines[i].no;
      if (acc >= 0) { i = acc; continue; }
      // A markdown string (backticks) may run over several lines.
      while ((t.match(/`/g) || []).length % 2 && i + 1 < lines.length) t += "\n" + lines[++i].text;
      statementLine(t, no);
    }
    if (stack.length) {
      var open = stack[stack.length - 1];
      throw perr(open.line, 'the subgraph "' + (open.title || open.id) + '" is never closed with end');
    }
    // An id that names a subgraph means the subgraph, never a node of its own.
    model.nodeList = model.nodeList.filter(function (n) {
      if (!model.clusters.has(n.id)) return true;
      model.nodes.delete(n.id);
      return false;
    });
    // Inner subgraphs close first, so a node mentioned in several belongs to the innermost one.
    closed.forEach(function (c) {
      c.mentions.forEach(function (id) {
        var n = model.nodes.get(id);
        if (n && !n.cluster) n.cluster = c;
      });
    });
    return model;
  }

  // ------------------------------------------------------------------ layered layout of one level
  // Coordinates here are local: u runs along the flow (rank axis), v across it (order axis).

  // Reverses DFS back edges, ranks by longest path, then pulls each source down next to its nearest child.
  function rankBlocks(n, edges) {
    var out = [], state = [], rev = [], i;
    for (i = 0; i < n; i++) { out.push([]); state.push(0); }
    edges.forEach(function (e, k) { rev.push(false); if (e.a !== e.b) out[e.a].push(k); });
    function dfs(v) {
      state[v] = 1;
      out[v].forEach(function (k) {
        var w = edges[k].b;
        if (state[w] === 1) rev[k] = true;
        else if (state[w] === 0) dfs(w);
      });
      state[v] = 2;
    }
    for (i = 0; i < n; i++) if (!state[i]) dfs(i);
    var succ = [], pred = [], indeg = [], rank = [];
    for (i = 0; i < n; i++) { succ.push([]); pred.push([]); indeg.push(0); rank.push(0); }
    edges.forEach(function (e, k) {
      if (e.a === e.b) return;
      var u = rev[k] ? e.b : e.a, v = rev[k] ? e.a : e.b;
      succ[u].push(v); pred[v].push(u); indeg[v]++;
    });
    var order = [], queue = [];
    for (i = 0; i < n; i++) if (!indeg[i]) queue.push(i);
    while (queue.length) {
      var v = queue.shift();
      order.push(v);
      succ[v].forEach(function (w) { if (--indeg[w] === 0) queue.push(w); });
    }
    order.forEach(function (v) { pred[v].forEach(function (u) { rank[v] = Math.max(rank[v], rank[u] + 1); }); });
    for (i = order.length - 1; i >= 0; i--) {
      var s = order[i];
      if (pred[s].length || !succ[s].length) continue;
      var mn = Infinity;
      succ[s].forEach(function (w) { mn = Math.min(mn, rank[w]); });
      rank[s] = mn - 1;
    }
    var lo = 0;
    if (n) { lo = Infinity; rank.forEach(function (r) { lo = Math.min(lo, r); }); }
    return { rank: rank.map(function (r) { return r - lo; }), rev: rev };
  }

  // lv: { blocks:[{kind,vlo,vhi,usz}], edges:[{a,b,label,offA,offB}], ports:[{block,side,off}], rank, rev }
  // opt: { cluster, title:{w,h,vsz}|null, titleSide:"uStart"|"uEnd"|"vStart" }
  // Ranks are doubled so every edge has a middle row for its label or bend; a cluster adds a port row on each border.
  function layoutLevel(lv, opt) {
    var rank = lv.rank, rev = lv.rev, maxR = 0, r, i;
    rank.forEach(function (q) { maxR = Math.max(maxR, q); });
    var off = opt.cluster ? 1 : 0, R = 2 * (maxR + 2 * off);
    var rows = [], items = [], segs = [];
    for (r = 0; r <= R; r++) rows.push([]);

    function add(it) { it.id = items.length; it.up = []; it.dn = []; items.push(it); rows[it.row].push(it.id); return it.id; }
    function thin(it) { return it.kind === "virt" || it.kind === "port"; }
    function solid(it) { return it.kind === "node" || it.kind === "cluster"; }

    var blockItem = lv.blocks.map(function (b, k) {
      return add({ kind: b.kind, row: 2 * (rank[k] + off), vlo: b.vlo, vhi: b.vhi, usz: b.usz, block: k });
    });
    // The title sits in the port rows on its side so that ports and their bends stay clear of it.
    if (opt.title && opt.titleSide !== "vStart") {
      (opt.titleSide === "uStart" ? [0, 1] : [R, R - 1]).forEach(function (row) {
        add({ kind: "title", row: row, vlo: opt.title.vsz / 2, vhi: opt.title.vsz / 2, usz: 0, pin: true });
      });
    }

    function connect(chain, offTop, offBot) {
      for (var k = 0; k + 1 < chain.length; k++) {
        var a = items[chain[k]], b = items[chain[k + 1]];
        var w = thin(a) && thin(b) ? 8 : solid(a) && solid(b) ? 1 : 2;
        a.dn.push(segs.length); b.up.push(segs.length);
        segs.push({ up: a.id, dn: b.id, w: w, offUp: k === 0 ? offTop || 0 : 0, offDn: k + 2 === chain.length ? offBot || 0 : 0 });
      }
    }
    function chainBetween(top, bot, label) {
      var r0 = items[top].row, r1 = items[bot].row, chain = [top];
      var mid = label ? r0 + 1 + 2 * Math.floor(((r1 - r0) / 2 - 1) / 2) : -1;
      for (var q = r0 + 1; q < r1; q++) {
        var lab = q === mid;
        chain.push(add({ kind: lab ? "label" : "virt", row: q, vlo: lab ? label.vsz / 2 : 0, vhi: lab ? label.vsz / 2 : 0, usz: lab ? label.usz : 0 }));
      }
      chain.push(bot);
      return chain;
    }

    var chains = lv.edges.map(function (e, k) {
      if (e.a === e.b) return null;
      var top = blockItem[rev[k] ? e.b : e.a], bot = blockItem[rev[k] ? e.a : e.b];
      var ch = chainBetween(top, bot, e.label);
      connect(ch, rev[k] ? e.offB : e.offA, rev[k] ? e.offA : e.offB);
      return ch;
    });
    var portChains = lv.ports.map(function (pt) {
      var pid = add({ kind: "port", row: pt.side === 0 ? 0 : R, vlo: 0, vhi: 0, usz: 0 });
      var bi = blockItem[pt.block];
      var ch = pt.side === 0 ? chainBetween(pid, bi, null) : chainBetween(bi, pid, null);
      connect(ch, pt.side === 0 ? 0 : pt.off, pt.side === 0 ? pt.off : 0);
      return ch;
    });

    // ---- order within rows: depth-first start, barycentre sweeps, then adjacent swaps
    var seen = [], init = rows.map(function () { return []; });
    function visit(id) {
      if (seen[id]) return;
      seen[id] = true;
      init[items[id].row].push(id);
      items[id].dn.forEach(function (k) { visit(segs[k].dn); });
    }
    items.slice().sort(function (a, b) { return a.row - b.row || a.id - b.id; }).forEach(function (it) { visit(it.id); });
    rows = init.map(function (row) {
      return row.filter(function (id) { return items[id].pin; }).concat(row.filter(function (id) { return !items[id].pin; }));
    });
    var pos = [];
    function setPos() { rows.forEach(function (row) { row.forEach(function (id, k) { pos[id] = k; }); }); }
    setPos();
    var segsAt = rows.map(function () { return []; });
    segs.forEach(function (sg, k) { segsAt[items[sg.up].row].push(k); });

    // Attachment offsets break ties, so two edges leaving one cluster at different ports are ordered like their ports.
    function keyUp(sg) { return pos[sg.up] + sg.offUp * 1e-4; }
    function keyDn(sg) { return pos[sg.dn] + sg.offDn * 1e-4; }
    function crossings() {
      var total = 0;
      for (var q = 0; q < R; q++) {
        var list = segsAt[q].map(function (k) { return [keyUp(segs[k]), keyDn(segs[k])]; });
        list.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        var lows = list.map(function (l) { return l[1]; }).sort(function (a, b) { return a - b; });
        var n = lows.length, bit = [], count = 0, z;
        for (z = 0; z <= n; z++) bit.push(0);
        for (var j = 0; j < list.length; j++) {
          var lo = 0, hi = n;
          while (lo < hi) { var md = (lo + hi) >> 1; if (lows[md] <= list[j][1]) lo = md + 1; else hi = md; }
          var idx = lo, le = 0;
          for (z = idx; z > 0; z -= z & -z) le += bit[z];
          total += count - le;
          for (z = idx; z <= n; z += z & -z) bit[z]++;
          count++;
        }
      }
      return total;
    }
    function sortRow(q, useUp) {
      var keyed = rows[q].map(function (id, k) {
        var it = items[id], list = useUp ? it.up : it.dn, key = k;
        if (it.pin) key = -1;
        else if (list.length) {
          var sum = 0;
          list.forEach(function (sk) { sum += useUp ? keyUp(segs[sk]) : keyDn(segs[sk]); });
          key = sum / list.length;
        }
        return { id: id, key: key, k: k };
      });
      keyed.sort(function (a, b) { return a.key - b.key || a.k - b.k; });
      rows[q] = keyed.map(function (o) { return o.id; });
      rows[q].forEach(function (id, k) { pos[id] = k; });
    }
    function snapshot() { return rows.map(function (row) { return row.slice(); }); }
    var best = snapshot(), bestC = crossings(), c;
    for (var it = 0; it < 4 && bestC > 0; it++) {
      for (r = 1; r <= R; r++) sortRow(r, true);
      if ((c = crossings()) < bestC) { bestC = c; best = snapshot(); }
      for (r = R - 1; r >= 0; r--) sortRow(r, false);
      if ((c = crossings()) < bestC) { bestC = c; best = snapshot(); }
    }
    rows = best;
    setPos();
    function pairCross(a, b) {
      var n = 0;
      items[a].up.forEach(function (sa) { items[b].up.forEach(function (sb) { if (keyUp(segs[sa]) > keyUp(segs[sb])) n++; }); });
      items[a].dn.forEach(function (sa) { items[b].dn.forEach(function (sb) { if (keyDn(segs[sa]) > keyDn(segs[sb])) n++; }); });
      return n;
    }
    for (var pass = 0, moved = true; moved && pass < 12; pass++) {
      moved = false;
      for (r = 0; r <= R; r++) {
        var row = rows[r];
        for (i = 0; i + 1 < row.length; i++) {
          var a = row[i], b = row[i + 1];
          if (items[a].pin || items[b].pin) continue;
          if (pairCross(b, a) < pairCross(a, b)) { row[i] = b; row[i + 1] = a; pos[a] = i + 1; pos[b] = i; moved = true; }
        }
      }
    }

    // ---- positions across the flow: each item is pulled to its neighbours' mean, rows kept apart by
    // an exact projection (pool-adjacent-violators on the separation constraints).
    var x = [];
    function gap(a, b) {
      var A = items[a], B = items[b];
      return A.vhi + B.vlo + (solid(A) && solid(B) ? 32 : thin(A) && thin(B) ? 10 : 14);
    }
    rows.forEach(function (row) {
      var cur = 0;
      row.forEach(function (id, k) { if (k) cur += gap(row[k - 1], id); x[id] = cur; });
      if (row.length) {
        var mid = (x[row[0]] - items[row[0]].vlo + x[row[row.length - 1]] + items[row[row.length - 1]].vhi) / 2;
        row.forEach(function (id) { x[id] -= mid; });
      }
    });
    function desired(id, mode) {
      var itm = items[id], sw = 0, sx = 0;
      if (itm.kind === "title") {
        var left = Infinity;
        items.forEach(function (o) { if (o.row >= 2 && o.row <= R - 2) left = Math.min(left, x[o.id] - o.vlo); });
        return [isFinite(left) ? left + itm.vlo : x[id], 4];
      }
      if (mode & 1) itm.up.forEach(function (k) { var sg = segs[k]; sw += sg.w; sx += sg.w * (x[sg.up] + sg.offUp - sg.offDn); });
      if (mode & 2) itm.dn.forEach(function (k) { var sg = segs[k]; sw += sg.w; sx += sg.w * (x[sg.dn] + sg.offDn - sg.offUp); });
      return sw ? [sx / sw, sw] : [x[id], 0.25];
    }
    function place(row, mode) {
      var n = row.length, t = [], w = [], S = 0, k, blocks = [];
      if (!n) return;
      for (k = 0; k < n; k++) {
        if (k) S += gap(row[k - 1], row[k]);
        var d = desired(row[k], mode);
        t.push(d[0] - S); w.push(d[1]);
      }
      for (k = 0; k < n; k++) {
        blocks.push({ sw: w[k], st: w[k] * t[k], n: 1 });
        while (blocks.length > 1) {
          var hi = blocks[blocks.length - 1], lo = blocks[blocks.length - 2];
          if (lo.st / lo.sw <= hi.st / hi.sw) break;
          lo.sw += hi.sw; lo.st += hi.st; lo.n += hi.n;
          blocks.pop();
        }
      }
      S = 0; k = 0;
      blocks.forEach(function (bl) {
        var y = bl.st / bl.sw;
        for (var j = 0; j < bl.n; j++, k++) { if (k) S += gap(row[k - 1], row[k]); x[row[k]] = y + S; }
      });
    }
    for (var iter = 0; iter < 12; iter++) {
      for (r = 1; r <= R; r++) place(rows[r], 1);
      for (r = R - 1; r >= 0; r--) place(rows[r], 2);
    }
    for (r = 0; r <= R; r++) place(rows[r], 3);
    for (r = R; r >= 0; r--) place(rows[r], 3);

    // ---- positions along the flow
    var band = rows.map(function (row) {
      var m = 0;
      row.forEach(function (id) { if (items[id].kind !== "title") m = Math.max(m, items[id].usz); });
      return m;
    });
    var hasLabel = rows.map(function (row) { return row.some(function (id) { return items[id].kind === "label"; }); });
    var cy = [], first = off ? 2 : 0, last = off ? R - 2 : R, cur = 0;
    for (r = first; r <= last; r++) {
      if (r > first) cur += hasLabel[r] || hasLabel[r - 1] ? 22 : 28;
      cy[r] = cur + band[r] / 2;
      cur += band[r];
    }
    var vMin = Infinity, vMax = -Infinity;
    items.forEach(function (itm) { vMin = Math.min(vMin, x[itm.id] - itm.vlo); vMax = Math.max(vMax, x[itm.id] + itm.vhi); });
    var uC = 0, vC = 0, res = { items: items, chains: chains, portChains: portChains, blockItem: blockItem, band: band, usz: cur, vsz: vMax - vMin };
    if (opt.cluster) {
      var PAD = 14, tH = opt.title ? opt.title.h + 6 : 0;
      var isPort = function (id) { return items[id].kind === "port"; };
      var bS = PAD + (opt.titleSide === "uStart" ? tH : 0), bE = PAD + (opt.titleSide === "uEnd" ? tH : 0);
      if (rows[0].some(isPort)) bS = Math.max(bS, 30);
      if (rows[R].some(isPort)) bE = Math.max(bE, 30);
      var uMin = -bS, uMax = cur + bE;
      vMin -= PAD;
      vMax += PAD;
      if (opt.title && opt.titleSide === "vStart") {
        vMin -= tH;
        var need = opt.title.w + 2 * PAD - (uMax - uMin);
        if (need > 0) { uMin -= need / 2; uMax += need / 2; }
      }
      cy[0] = uMin; cy[1] = uMin / 2; cy[R - 1] = (cur + uMax) / 2; cy[R] = uMax;
      uC = (uMin + uMax) / 2; vC = (vMin + vMax) / 2;
      res.usz = uMax - uMin; res.vsz = vMax - vMin;
    }
    items.forEach(function (itm) { itm.u = cy[itm.row] - uC; itm.v = x[itm.id] - vC; });
    return res;
  }

  // ------------------------------------------------------------------ flowchart: shapes

  var DIR_WORDS = { TD: "top to bottom", BT: "bottom to top", LR: "left to right", RL: "right to left" };
  var SHAPE_CLASS = { rect: "rect", round: "round", stadium: "stadium", subroutine: "subroutine", cylinder: "cylinder", circle: "circle",
    diamond: "diamond", hexagon: "hexagon", flag: "flag", para: "para", "para-l": "para", trap: "trap", "trap-l": "trap" };
  // Shapes whose side facing the flow is flat enough to spread several edge ends along it.
  var FLAT_TB = { rect: 1, round: 1, subroutine: 1, stadium: 1, cylinder: 1, flag: 1, para: 1, "para-l": 1, trap: 1, "trap-l": 1, hexagon: 1 };
  var FLAT_LR = { rect: 1, round: 1, subroutine: 1, cylinder: 1, flag: 1, para: 1, "para-l": 1, trap: 1, "trap-l": 1 };

  function sgn(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

  function towards(P, Q, d) {
    var du = Q.u - P.u, dv = Q.v - P.v, l = Math.sqrt(du * du + dv * dv) || 1;
    return { u: P.u + d * du / l, v: P.v + d * dv / l };
  }

  function sizeNode(n, ctx) {
    var label = cleanLabel(n.label);
    var maxW = n.shape === "diamond" ? 170 : n.shape === "circle" ? 150 : 220;
    var tb = textBlock(label, ctx, ctx.px, maxW, true), tw = tb.w, th = tb.h, w, h, dx = 0, dy = 0;
    switch (n.shape) {
      case "circle": w = h = Math.max(64, Math.sqrt(tw * tw + th * th) + 16); break;
      case "diamond":
        var a = tw / 2 + 10 + 2 * (th / 2 + 6);
        w = 2 * a; h = Math.max(36, a); break;
      case "stadium": h = th + 18; w = tw + h + 8; break;
      case "subroutine": h = th + 18; w = tw + 44; break;
      case "cylinder":
        w = Math.max(64, tw + 28);
        n.ry = Math.min(10, Math.max(5, w * 0.07));
        h = th + 18 + 2 * n.ry; dy = n.ry; break;
      case "hexagon": h = th + 18; w = tw + 28 + h / 2; break;
      case "flag": h = th + 18; w = tw + 28 + h / 3; dx = h / 6; break;
      case "para": case "para-l": h = th + 18; w = tw + 28 + h * 0.35; break;
      case "trap": case "trap-l": h = th + 18; w = tw + 28 + h * 0.5; break;
      default: w = tw + 28; h = th + 18;
    }
    n.w = Math.max(64, w); n.h = h; n.tb = tb; n.dx = dx; n.dy = dy; n.text = oneLine(label);
  }

  // Outline as a polygon centred on 0,0 (screen orientation), for clipping edges to the border.
  function outline(n) {
    var w = n.w, h = n.h, x1 = -w / 2, x2 = w / 2, y1 = -h / 2, y2 = h / 2, pts = [], s = h * 0.35;
    function arc(cx, cy, rx, ry, a0, a1, steps) {
      for (var i = 0; i <= steps; i++) { var t = a0 + (a1 - a0) * i / steps; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    }
    switch (n.shape) {
      case "circle": arc(0, 0, w / 2, w / 2, 0, 2 * Math.PI, 36); pts.pop(); break;
      case "diamond": pts = [[0, y1], [x2, 0], [0, y2], [x1, 0]]; break;
      case "stadium": arc(x2 - h / 2, 0, h / 2, h / 2, -Math.PI / 2, Math.PI / 2, 12); arc(x1 + h / 2, 0, h / 2, h / 2, Math.PI / 2, 1.5 * Math.PI, 12); break;
      case "cylinder": arc(0, y1 + n.ry, w / 2, n.ry, Math.PI, 2 * Math.PI, 14); arc(0, y2 - n.ry, w / 2, n.ry, 0, Math.PI, 14); break;
      case "hexagon": pts = [[x1, 0], [x1 + h / 4, y1], [x2 - h / 4, y1], [x2, 0], [x2 - h / 4, y2], [x1 + h / 4, y2]]; break;
      case "flag": pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1 + h / 3, 0]]; break;
      case "para": pts = [[x1 + s, y1], [x2, y1], [x2 - s, y2], [x1, y2]]; break;
      case "para-l": pts = [[x1, y1], [x2 - s, y1], [x2, y2], [x1 + s, y2]]; break;
      case "trap": pts = [[x1 + s, y1], [x2 - s, y1], [x2, y2], [x1, y2]]; break;
      case "trap-l": pts = [[x1, y1], [x2, y1], [x2 - s, y2], [x1 + s, y2]]; break;
      default: pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    }
    return pts;
  }

  function shapeSvg(n, cx, cy) {
    var w = n.w, h = n.h, x1 = cx - w / 2, y1 = cy - h / 2, x2 = cx + w / 2, y2 = cy + h / 2;
    var cls = ' class="mm-node mm-' + SHAPE_CLASS[n.shape] + '"';
    function rect(r) {
      return "<rect" + cls + ' x="' + n1(x1) + '" y="' + n1(y1) + '" width="' + n1(w) + '" height="' + n1(h) + '"' +
        (r ? ' rx="' + n1(r) + '" ry="' + n1(r) + '"' : "") + "/>";
    }
    switch (n.shape) {
      case "rect": return rect(0);
      case "round": return rect(7);
      case "stadium": return rect(h / 2);
      case "circle": return "<circle" + cls + ' cx="' + n1(cx) + '" cy="' + n1(cy) + '" r="' + n1(w / 2) + '"/>';
      case "subroutine":
        return "<path" + cls + ' d="M' + n1(x1) + "," + n1(y1) + "H" + n1(x2) + "V" + n1(y2) + "H" + n1(x1) + "Z" +
          "M" + n1(x1 + 8) + "," + n1(y1) + "V" + n1(y2) + "M" + n1(x2 - 8) + "," + n1(y1) + "V" + n1(y2) + '"/>';
      case "cylinder":
        // The front rim of the lid is drawn right to left so its fill winds the same way as the body.
        var rx = n1(w / 2), ry = n1(n.ry), top = n1(y1 + n.ry);
        return "<path" + cls + ' d="M' + n1(x1) + "," + top + "A" + rx + "," + ry + " 0 0 1 " + n1(x2) + "," + top +
          "V" + n1(y2 - n.ry) + "A" + rx + "," + ry + " 0 0 1 " + n1(x1) + "," + n1(y2 - n.ry) + "Z" +
          "M" + n1(x2) + "," + top + "A" + rx + "," + ry + " 0 0 1 " + n1(x1) + "," + top + '"/>';
      default:
        return "<polygon" + cls + ' points="' + outline(n).map(function (p) { return n1(cx + p[0]) + "," + n1(cy + p[1]); }).join(" ") + '"/>';
    }
  }

  // Where the line v = off, walking from the centre along u in direction dir, leaves the polygon (local coords).
  function exitU(poly, off, dir) {
    var best = null;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      if (p[1] === q[1] || (p[1] - off) * (q[1] - off) > 0) continue;
      var u = p[0] + (off - p[1]) / (q[1] - p[1]) * (q[0] - p[0]);
      if (u * dir >= 0 && (best === null || u * dir > best * dir)) best = u;
    }
    return best;
  }

  // Monotone cubic through points ordered along u: end tangents run along the flow, no overshoot between.
  function curvePoints(P) {
    var n = P.length, m = [], out = [P[0]], i;
    for (i = 0; i < n; i++) {
      if (i === 0 || i === n - 1 || P[i].flat) { m.push(0); continue; }
      var h0 = P[i].u - P[i - 1].u, h1 = P[i + 1].u - P[i].u;
      var s0 = h0 ? (P[i].v - P[i - 1].v) / h0 : 0, s1 = h1 ? (P[i + 1].v - P[i].v) / h1 : 0;
      var pp = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
      m.push((sgn(s0) + sgn(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(pp)) || 0);
    }
    for (i = 0; i + 1 < n; i++) {
      var a = P[i], b = P[i + 1], h = (b.u - a.u) / 3;
      out.push({ u: a.u + h, v: a.v + m[i] * h }, { u: b.u - h, v: b.v - m[i + 1] * h }, b);
    }
    return out;
  }

  // ------------------------------------------------------------------ flowchart: layout and drawing

  function renderFlow(pre, ctx) {
    var m = parseFlow(pre), nodes = m.nodeList, clusters = m.clusterList;
    if (nodes.length > MAX_NODES || m.edges.length > MAX_EDGES) {
      return fail("flowchart", "This flowchart has " + plural(nodes.length, "node") + " and " + plural(m.edges.length, "connection") + ", too many to draw well here.");
    }
    if (!nodes.length && !clusters.length) return fail("flowchart", "The flowchart has no nodes to draw.");
    var dir = m.dir, horiz = dir === "LR" || dir === "RL";
    var titleSide = dir === "TD" ? "uStart" : dir === "BT" ? "uEnd" : "vStart";
    function T(u, v) { return dir === "TD" ? [v, u] : dir === "BT" ? [v, -u] : dir === "LR" ? [u, v] : [-u, v]; }
    function toLocal(x, y) { return dir === "TD" ? [y, x] : dir === "BT" ? [-y, x] : dir === "LR" ? [x, y] : [-x, y]; }

    nodes.forEach(function (n) { sizeNode(n, ctx); n.kind = "node"; n.loops = []; });
    clusters.forEach(function (c) {
      c.kind = "cluster";
      c.titleText = oneLine(cleanLabel(c.title));
      c.ttb = c.titleText ? textBlock(c.titleText, ctx, ctx.px, 0, false, "bold") : null;
      c.level = { cluster: c, members: [], edges: [], ports: [] };
    });
    var root = { cluster: null, members: [], edges: [], ports: [] };
    var levels = [root].concat(clusters.map(function (c) { return c.level; }));
    function parentOf(X) { return X.kind === "node" ? X.cluster : X.parent; }
    function levelOf(X) { var p = parentOf(X); return p ? p.level : root; }
    nodes.forEach(function (n) { levelOf(n).members.push(n); });
    clusters.forEach(function (c) { levelOf(c).members.push(c); });
    levels.forEach(function (L) {
      L.members.sort(function (a, b) { return a.seq - b.seq; });
      if (L.cluster && !L.members.length) L.members.push({ kind: "dummy" });
      L.members.forEach(function (X, i) { X.bi = i; });
    });
    function chainUp(X) { var out = [X], p = parentOf(X); while (p) { out.push(p); p = parentOf(p); } return out; }

    var edges = m.edges.map(function (e) {
      var ed = { src: e, A: m.clusters.get(e.from) || m.nodes.get(e.from), B: m.clusters.get(e.to) || m.nodes.get(e.to), idx: e.idx };
      ed.label = e.label ? cleanLabel(e.label) : "";
      if (ed.label) {
        ed.tb = textBlock(ed.label, ctx, ctx.sm, 200, true);
        var lw = ed.tb.w + 10, lh = ed.tb.h + 4;
        ed.lsize = { w: lw, h: lh, vsz: horiz ? lh : lw, usz: horiz ? lw : lh };
      }
      var A = ed.A, B = ed.B;
      if (A === B) { if (A.kind === "node") A.loops.push(ed); ed.skip = true; return ed; }
      var ca = chainUp(A), cb = chainUp(B), Lc = null, ia = ca.length, ib = cb.length;
      for (var i = 1; i < ca.length; i++) {
        var j = cb.indexOf(ca[i]);
        if (j >= 1) { Lc = ca[i]; ia = i; ib = j; break; }
      }
      ed.bA = ca[ia - 1]; ed.bB = cb[ib - 1];
      if (ed.bA === ed.bB) { ed.skip = true; return ed; }
      ed.Lv = Lc ? Lc.level : root;
      ed.exits = ca.slice(1, ia);
      ed.entries = cb.slice(1, ib).reverse();
      ed.k = ed.Lv.edges.length;
      ed.Lv.edges.push({ a: ed.bA.bi, b: ed.bB.bi, label: ed.lsize || null, ed: ed });
      return ed;
    });

    levels.forEach(function (L) {
      var rk = rankBlocks(L.members.length, L.edges);
      L.rank = rk.rank; L.rev = rk.rev;
    });
    // An edge leaves and enters clusters on the side its main segment runs to.
    edges.forEach(function (ed) {
      if (ed.skip) return;
      var down = ed.Lv.rank[ed.bA.bi] < ed.Lv.rank[ed.bB.bi], child = ed.A;
      var inner = null, list = [];
      ed.exitPorts = [];
      ed.exits.forEach(function (C) {
        var pt = { block: child.bi, side: down ? 1 : 0, off: 0, k: C.level.ports.length, inner: inner };
        C.level.ports.push(pt);
        ed.exitPorts.push(pt);
        inner = pt;
        child = C;
      });
      child = ed.B;
      inner = null;
      ed.entries.slice().reverse().forEach(function (C) {
        var pt = { block: child.bi, side: down ? 0 : 1, off: 0, k: C.level.ports.length, inner: inner };
        C.level.ports.push(pt);
        list.unshift(pt);
        inner = pt;
        child = C;
      });
      ed.entryPorts = list;
    });

    function loopExt(n) {
      if (!n.loops.length) return 0;
      var lab = 0;
      n.loops.forEach(function (ed) { if (ed.lsize) lab = Math.max(lab, ed.lsize.vsz + 8); });
      return 0.75 * (30 + 14 * (n.loops.length - 1)) + 10 + lab;
    }
    function blockOf(X) {
      if (X.kind === "node") {
        var half = (horiz ? X.h : X.w) / 2;
        return { kind: "node", vlo: half, vhi: half + loopExt(X), usz: horiz ? X.w : X.h };
      }
      if (X.kind === "cluster") return { kind: "cluster", vlo: X.vsz / 2, vhi: X.vsz / 2, usz: X.usz };
      return { kind: "node", vlo: 28, vhi: 28, usz: 14 };
    }
    function layoutOne(L) {
      L.edges.forEach(function (le) {
        var ed = le.ed;
        le.offA = ed.exitPorts.length ? ed.exitPorts[ed.exitPorts.length - 1].v : 0;
        le.offB = ed.entryPorts.length ? ed.entryPorts[0].v : 0;
      });
      L.ports.forEach(function (pt) { pt.off = pt.inner ? pt.inner.v : 0; });
      var opt = { cluster: !!L.cluster, title: null, titleSide: titleSide };
      if (L.cluster && L.cluster.ttb) {
        var tb = L.cluster.ttb;
        opt.title = { w: tb.w, h: tb.h, vsz: horiz ? tb.h : tb.w };
      }
      var res = layoutLevel({ blocks: L.members.map(blockOf), edges: L.edges, ports: L.ports, rank: L.rank, rev: L.rev }, opt);
      L.res = res;
      L.ports.forEach(function (pt, k) {
        var ch = res.portChains[k];
        pt.v = res.items[pt.side === 0 ? ch[0] : ch[ch.length - 1]].v;
      });
      if (L.cluster) { L.cluster.usz = res.usz; L.cluster.vsz = res.vsz; }
    }
    function layoutTree(C) { C.children.forEach(layoutTree); layoutOne(C.level); }
    clusters.forEach(function (c) { if (!c.parent) layoutTree(c); });
    layoutOne(root);

    function place(L, u0, v0) {
      L.u0 = u0; L.v0 = v0;
      L.members.forEach(function (X, i) {
        var it = L.res.items[L.res.blockItem[i]];
        X.au = u0 + it.u; X.av = v0 + it.v;
        if (X.kind === "cluster") place(X.level, X.au, X.av);
      });
    }
    place(root, 0, 0);

    // ---- edge paths: the level chains joined at cluster borders, ends clipped to the shapes
    edges.forEach(function (ed) {
      if (ed.skip) return;
      var segs = [];
      ed.exitPorts.forEach(function (pt, i) {
        var ch = ed.exits[i].level.res.portChains[pt.k];
        segs.push({ L: ed.exits[i].level, ids: pt.side === 1 ? ch : ch.slice().reverse() });
      });
      var lch = ed.Lv.res.chains[ed.k];
      segs.push({ L: ed.Lv, ids: ed.Lv.rev[ed.k] ? lch.slice().reverse() : lch });
      ed.entryPorts.forEach(function (pt, i) {
        var ch = ed.entries[i].level.res.portChains[pt.k];
        segs.push({ L: ed.entries[i].level, ids: pt.side === 0 ? ch : ch.slice().reverse() });
      });
      var acc = [];
      segs.forEach(function (sg) {
        var list = sg.ids.map(function (id) { return { L: sg.L, it: sg.L.res.items[id] }; });
        if (acc.length) {
          if (acc[acc.length - 1].it.kind === "port") list.shift(); else acc.pop();
        }
        acc = acc.concat(list);
      });
      // A bend that shares a row with nodes runs straight through that row's band.
      var path = [];
      acc.forEach(function (e, k) {
        var u = e.L.u0 + e.it.u, v = e.L.v0 + e.it.v, kind = e.it.kind;
        if (kind === "label") ed.labelAt = { u: u, v: v };
        var half = kind === "virt" && e.it.row % 2 === 0 ? e.L.res.band[e.it.row] / 2 : 0;
        if (half > 0 && k > 0 && k < acc.length - 1) {
          var d = sgn(acc[k + 1].L.u0 + acc[k + 1].it.u - (acc[k - 1].L.u0 + acc[k - 1].it.u));
          path.push({ u: u - d * (half + 3), v: v, flat: true }, { u: u + d * (half + 3), v: v, flat: true });
        } else path.push({ u: u, v: v, flat: kind === "port" });
      });
      ed.path = path;
    });

    function localPoly(X) {
      if (X.kind === "cluster") {
        var hu = X.usz / 2, hv = X.vsz / 2;
        return [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]];
      }
      return outline(X).map(function (p) { return toLocal(p[0], p[1]); });
    }
    var ends = new Map();
    function addEnd(X, ed, at, nb) {
      var side = nb.u > X.au ? 1 : 0, rec = ends.get(X);
      if (!rec) { rec = [[], []]; ends.set(X, rec); }
      rec[side].push({ ed: ed, at: at, nbv: nb.v, side: side });
    }
    edges.forEach(function (ed) {
      if (ed.skip) return;
      var P = ed.path;
      addEnd(ed.A, ed, 0, P[1]);
      addEnd(ed.B, ed, P.length - 1, P[P.length - 2]);
    });
    ends.forEach(function (rec, X) {
      var poly = localPoly(X);
      rec.forEach(function (list) {
        if (!list.length) return;
        list.sort(function (a, b) { return a.nbv - b.nbv || a.ed.idx - b.ed.idx; });
        var half = X.kind === "cluster" ? X.vsz / 2 : (horiz ? X.h : X.w) / 2;
        var flat = X.kind === "cluster" || (horiz ? FLAT_LR : FLAT_TB)[X.shape];
        var range = half * (flat ? 0.6 : 0.22);
        var step = list.length > 1 ? Math.min(14, 2 * range / (list.length - 1)) : 0;
        list.forEach(function (en, i) {
          var off = (i - (list.length - 1) / 2) * step, dirn = en.side ? 1 : -1;
          var u = exitU(poly, off, dirn);
          if (u === null) { off = 0; u = exitU(poly, 0, dirn) || 0; }
          en.ed.path[en.at] = { u: X.au + u, v: X.av + off };
        });
      });
    });

    // ---- geometry in screen space, then one shift so the drawing starts at the margin
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(x1, y1, x2, y2) {
      minX = Math.min(minX, x1, x2); minY = Math.min(minY, y1, y2);
      maxX = Math.max(maxX, x1, x2); maxY = Math.max(maxY, y1, y2);
    }
    function boxOf(au, av, usz, vsz) {
      var a = T(au - usz / 2, av - vsz / 2), b = T(au + usz / 2, av + vsz / 2);
      return { x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) };
    }
    clusters.forEach(function (c) { c.box = boxOf(c.au, c.av, c.usz, c.vsz); grow(c.box.x1, c.box.y1, c.box.x2, c.box.y2); });
    nodes.forEach(function (n) {
      var p = T(n.au, n.av);
      n.x = p[0]; n.y = p[1];
      grow(n.x - n.w / 2, n.y - n.h / 2, n.x + n.w / 2, n.y + n.h / 2);
    });
    var used = {}, conns = 0, descParts = [];
    function nameOf(X) { return X.kind === "cluster" ? X.titleText || X.id : X.text || X.id; }
    edges.forEach(function (ed) {
      var e = ed.src;
      if (e.type === "invisible") return;
      conns++;
      var d = nameOf(ed.A) + " to " + nameOf(ed.B);
      if (e.startHead && e.endHead) d += ", both ways";
      if (ed.label) d += ", labelled " + oneLine(ed.label);
      descParts.push(d);
      if (ed.skip && !(ed.A === ed.B && ed.A.kind === "node")) return;
      var pts;
      if (ed.A === ed.B) {
        // Self-loop on the node's outer side, across the flow.
        var X = ed.A, k = Math.min((horiz ? X.w : X.h) / 4, 10), i = X.loops.indexOf(ed), depth = 30 + 14 * i;
        var poly = localPoly(X).map(function (p) { return [p[1], p[0]]; });
        var b1 = exitU(poly, -k, 1) || 0, b2 = exitU(poly, k, 1) || 0;
        var S = { u: X.au - k, v: X.av + b1 }, E = { u: X.au + k, v: X.av + b2 };
        var C1 = { u: S.u - 10, v: S.v + depth }, C2 = { u: E.u + 10, v: E.v + depth };
        if (e.startHead) S = towards(S, C1, 4);
        if (e.endHead) E = towards(E, C2, 4);
        pts = [S, C1, C2, E];
        if (ed.lsize) ed.labelAt = { u: X.au, v: X.av + Math.max(b1, b2) + 0.75 * depth + 6 + ed.lsize.vsz / 2 };
      } else {
        var P = ed.path, n = P.length;
        if (e.startHead) P[0] = { u: P[0].u + 4 * sgn(P[1].u - P[0].u), v: P[0].v };
        if (e.endHead) P[n - 1] = { u: P[n - 1].u + 4 * sgn(P[n - 2].u - P[n - 1].u), v: P[n - 1].v };
        pts = curvePoints(P);
      }
      ed.screen = pts.map(function (p) { var q = T(p.u, p.v); grow(q[0], q[1], q[0], q[1]); return q; });
      if (ed.labelAt && ed.lsize) {
        var lp = T(ed.labelAt.u, ed.labelAt.v);
        ed.lbox = { x: lp[0], y: lp[1] };
        grow(lp[0] - ed.lsize.w / 2, lp[1] - ed.lsize.h / 2, lp[0] + ed.lsize.w / 2, lp[1] + ed.lsize.h / 2);
      }
    });

    var M = 6, ox = M - minX, oy = M - minY, W = maxX - minX + 2 * M, H = maxY - minY + 2 * M;
    function P2(q) { return n1(q[0] + ox) + "," + n1(q[1] + oy); }
    var body = "";
    if (clusters.length) {
      body += '<g class="mm-clusters">';
      clusters.forEach(function (c) {
        var b = c.box;
        body += '<rect class="mm-cluster" x="' + n1(b.x1 + ox) + '" y="' + n1(b.y1 + oy) + '" width="' + n1(b.x2 - b.x1) + '" height="' + n1(b.y2 - b.y1) + '" rx="4" ry="4"/>';
        if (c.ttb) body += textSvg("mm-cluster-label mm-text-md", c.ttb, b.x1 + ox + 10, b.y1 + oy + 6 + c.ttb.h / 2, "start");
      });
      body += "</g>";
    }
    var edgeSvg = "", labelSvg = "";
    edges.forEach(function (ed) {
      if (!ed.screen) return;
      var e = ed.src, s = ed.screen, d = "M" + P2(s[0]);
      for (var i = 1; i + 2 < s.length; i += 3) d += "C" + P2(s[i]) + " " + P2(s[i + 1]) + " " + P2(s[i + 2]);
      var cls = "mm-edge" + (e.type === "dotted" ? " mm-edge-dotted" : e.type === "thick" ? " mm-edge-thick" : "");
      edgeSvg += '<path class="' + cls + '" d="' + d + '"' + markerAttr(ctx.idp, e.startHead, true, used) + markerAttr(ctx.idp, e.endHead, false, used) + "/>";
      if (ed.lbox) {
        var L = ed.lsize, cx = ed.lbox.x + ox, cy = ed.lbox.y + oy;
        labelSvg += '<rect class="mm-edge-label-bg" x="' + n1(cx - L.w / 2) + '" y="' + n1(cy - L.h / 2) + '" width="' + n1(L.w) + '" height="' + n1(L.h) + '" rx="3" ry="3"/>' +
          textSvg("mm-edge-label mm-text-sm", ed.tb, cx, cy);
      }
    });
    body += '<g class="mm-edges">' + edgeSvg + "</g>";
    if (labelSvg) body += '<g class="mm-edge-labels">' + labelSvg + "</g>";
    body += '<g class="mm-nodes">';
    nodes.forEach(function (n) {
      body += '<g class="mm-node-group">' + shapeSvg(n, n.x + ox, n.y + oy) + textSvg("mm-node-label mm-text-md", n.tb, n.x + ox + n.dx, n.y + oy + n.dy) + "</g>";
    });
    body += "</g>";

    var title = m.accTitle || ((m.title ? oneLine(m.title) + ". " : "") + "Flowchart, " + DIR_WORDS[dir] + ": " + plural(nodes.length, "node") + ", " + plural(conns, "connection"));
    var desc = (m.accDescr ? m.accDescr + " " : "") + (descParts.length ? descParts.join("; ") + "." : "No connections.");
    var groups = clusters.map(function (c) {
      var names = nodes.filter(function (n) { return n.cluster === c; }).map(nameOf).concat(c.children.map(nameOf));
      return (c.titleText || c.id) + (names.length ? " holds " + names.join(", ") : " is empty");
    });
    if (groups.length) desc += " Groups: " + groups.join("; ") + ".";
    var svg = svgOpen("mm-flow", W, H, ctx.idp, title, desc) + markerDefs(ctx.idp, used) + body + "</svg>";
    return { ok: true, kind: "flowchart", svg: svg, width: Math.round(W * 10) / 10, height: Math.round(H * 10) / 10, title: title, note: "" };
  }

  // ------------------------------------------------------------------ sequence diagrams

  // arrow -> [dotted, head, both ends]
  var SEQ_ARROW = {
    "<<-->>": [true, "arrow", true], "<<->>": [false, "arrow", true],
    "-->>": [true, "arrow"], "->>": [false, "arrow"], "--x": [true, "cross"], "-x": [false, "cross"],
    "--)": [true, "open"], "-)": [false, "open"], "-->": [true, null], "->": [false, null]
  };
  var RE_MSG = /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]*?)\s*(?::(.*))?$/;
  var BLOCK_WORDS = { loop: "loop", alt: "alt", opt: "opt", par: "par", critical: "critical", "break": "break" };

  // Mermaid ends a sequence statement at ';' too; an entity such as #59; keeps its semicolon.
  function splitSeq(s) {
    var out = [], cur = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === ";" && !/[#&]#?\w+$/.test(cur)) { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseSeq(pre) {
    var lines = pre.lines, model = { title: pre.fmTitle, accTitle: null, accDescr: null, parts: new Map(), order: [], events: [] };
    var stack = [], num = null;
    function part(id, label, kind) {
      id = unquote(id.trim());
      var p = model.parts.get(id);
      if (!p) { p = { id: id, label: id, kind: "participant", idx: model.order.length }; model.parts.set(id, p); model.order.push(p); }
      if (label != null) p.label = unquote(label);
      if (kind) p.kind = kind;
      return p;
    }
    function statement(s, no) {
      var m;
      if ((m = /^title(?:\s*:\s*|\s+)(.*)$/.exec(s))) { model.title = m[1].trim(); return; }
      if ((m = /^autonumber(?:\s+(.*))?$/.exec(s))) {
        var arg = (m[1] || "").trim(), nums = arg.split(/\s+/).map(Number);
        num = arg === "off" ? null : { next: arg && isFinite(nums[0]) ? nums[0] : 1, step: isFinite(nums[1]) ? nums[1] : 1 };
        return;
      }
      if ((m = /^(?:create\s+)?(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(s))) {
        part(m[2].replace(/@\{.*\}\s*$/, ""), m[3] != null ? m[3].trim() : null, m[1]);
        return;
      }
      if (/^destroy\s/.test(s) || /^(links?|properties|details)\s/.test(s)) return;
      if ((m = /^(activate|deactivate)\s+(.+)$/.exec(s))) { model.events.push({ t: m[1] === "activate" ? "act" : "deact", p: part(m[2]) }); return; }
      if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:(.*)$/i.exec(s))) {
        var ids = m[2].split(",").map(function (x) { return part(x); });
        model.events.push({ t: "note", pos: m[1].toLowerCase().replace(/\s+/g, " "), a: ids[0], b: ids[ids.length - 1], text: cleanLabel(m[3]) });
        return;
      }
      if ((m = /^(loop|alt|opt|par_over|par|critical|break|rect)(?:\s+(.*))?$/.exec(s))) {
        var kind = m[1] === "par_over" ? "par" : m[1];
        stack.push({ kind: kind, no: no });
        model.events.push({ t: "start", kind: kind, text: kind === "rect" ? "" : cleanLabel(m[2] || "") });
        return;
      }
      if (/^box(\s|$)/.test(s)) { stack.push({ kind: "box", no: no }); return; }
      if ((m = /^(else|and|option)(?:\s+(.*))?$/.exec(s))) {
        if (!stack.length || stack[stack.length - 1].kind === "box") throw perr(no, m[1] + " is outside any block");
        model.events.push({ t: "div", kind: m[1], text: cleanLabel(m[2] || "") });
        return;
      }
      if (s === "end") {
        if (!stack.length) throw perr(no, "end has no block to close");
        if (stack.pop().kind !== "box") model.events.push({ t: "end" });
        return;
      }
      if ((m = RE_MSG.exec(s)) && m[1].trim() && m[4].trim()) {
        var A = SEQ_ARROW[m[2]];
        var ev = { t: "msg", from: part(m[1]), to: part(m[4]), dotted: A[0], head: A[1], both: !!A[2], act: m[3], text: cleanLabel(m[5] || "") };
        if (num) { ev.num = num.next; num.next += num.step; }
        model.events.push(ev);
        return;
      }
      throw perr(no, "it is not a sequence diagram statement");
    }
    for (var i = pre.headerAt + 1; i < lines.length; i++) {
      var s = lines[i].text.trim(), no = lines[i].no;
      if (!s || s.slice(0, 2) === "%%") continue;
      var acc = takeAcc(lines, i, model);
      if (acc >= 0) { i = acc; continue; }
      splitSeq(s).forEach(function (part) { part = part.trim(); if (part) statement(part, no); });
    }
    if (stack.length) {
      var open = stack[stack.length - 1];
      throw perr(open.no, "the " + open.kind + " block is never closed with end");
    }
    return model;
  }

  function renderSeq(pre, ctx) {
    var model = parseSeq(pre), order = model.order, events = model.events, n = order.length;
    var msgCount = events.filter(function (e) { return e.t === "msg"; }).length;
    if (!n) return fail("sequence", "The sequence diagram has no participants to draw.");
    if (n > 50 || msgCount > MAX_EDGES) {
      return fail("sequence", "This sequence diagram has " + plural(n, "participant") + " and " + plural(msgCount, "message") + ", too many to draw well here.");
    }
    var px = ctx.px, sm = ctx.sm, M = 8, i;

    order.forEach(function (p) {
      var label = cleanLabel(p.label);
      p.text = oneLine(label) || p.id;
      p.tb = textBlock(label, ctx, px, 160, true, "bold");
      p.w = Math.max(p.tb.w + 28, 72);
    });
    var bandH = 0;
    order.forEach(function (p) { bandH = Math.max(bandH, p.kind === "actor" ? 44 + p.tb.h : p.tb.h + 18); });
    events.forEach(function (e) {
      if (e.t === "msg") e.tb = textBlock(e.text, ctx, sm, 280);
      else if (e.t === "note") { e.tb = textBlock(e.text, ctx, sm, 220, true); e.w = Math.max(e.tb.w + 20, 48); e.h = e.tb.h + 12; }
      else if (e.t === "start" || e.t === "div") {
        e.cond = e.text ? "[" + oneLine(e.text) + "]" : "";
        e.ctb = e.cond ? textBlock(e.cond, ctx, sm, 0) : null;
        if (e.t === "start") e.tabW = ctx.measure(e.kind, sm, "bold") + 20;
      }
    });

    // ---- columns: neighbours far enough apart for every label that sits between them
    var gaps = [], cons = [];
    for (i = 0; i + 1 < n; i++) gaps.push(order[i].w / 2 + order[i + 1].w / 2 + 30);
    function need(a, b, d) { if (a !== b && a >= 0 && b < n && b >= 0 && a < n) cons.push([Math.min(a, b), Math.max(a, b), d]); }
    var spans = [];
    events.forEach(function (e) {
      if (e.t === "msg") {
        var a = e.from.idx, b = e.to.idx;
        if (a === b) need(a, a + 1, Math.max(44, e.tb.w + 12 + (e.num != null ? 12 : 0)) + 28);
        else need(a, b, e.tb.w + 36 + (e.num != null ? 18 : 0));
        spans.forEach(function (sp) { sp.lo = Math.min(sp.lo, a, b); sp.hi = Math.max(sp.hi, a, b); });
      } else if (e.t === "note") {
        var ia = Math.min(e.a.idx, e.b.idx), ib = Math.max(e.a.idx, e.b.idx);
        if (e.pos === "right of") need(ia, ia + 1, e.w + 28);
        else if (e.pos === "left of") need(ia - 1, ia, e.w + 28);
        else if (ia === ib) { need(ia - 1, ia, e.w / 2 + 18); need(ia, ia + 1, e.w / 2 + 18); }
        else need(ia, ib, e.w - 40);
        spans.forEach(function (sp) { sp.lo = Math.min(sp.lo, ia); sp.hi = Math.max(sp.hi, ib); });
      } else if (e.t === "start") {
        spans.push({ e: e, lo: Infinity, hi: -Infinity, w: e.tabW + (e.ctb ? e.ctb.w + 16 : 0) });
      } else if (e.t === "div") {
        if (spans.length && e.ctb) spans[spans.length - 1].w = Math.max(spans[spans.length - 1].w, e.ctb.w + 20);
      } else if (e.t === "end") {
        var sp = spans.pop();
        if (sp && sp.hi > sp.lo) need(sp.lo, sp.hi, sp.w + 12 - 2 * 16);
        if (sp && spans.length) { spans[spans.length - 1].lo = Math.min(spans[spans.length - 1].lo, sp.lo); spans[spans.length - 1].hi = Math.max(spans[spans.length - 1].hi, sp.hi); }
      }
    });
    cons.sort(function (p, q) { return (p[1] - p[0]) - (q[1] - q[0]) || p[0] - q[0]; });
    cons.forEach(function (c) {
      var cur = 0, k;
      for (k = c[0]; k < c[1]; k++) cur += gaps[k];
      if (cur < c[2]) for (k = c[0]; k < c[1]; k++) gaps[k] += (c[2] - cur) / (c[1] - c[0]);
    });
    var X = [0];
    for (i = 1; i < n; i++) X.push(X[i - 1] + gaps[i - 1]);

    // ---- rows, top to bottom
    var ops = [], minX = Infinity, maxX = -Infinity, used = {}, idp = ctx.idp;
    function op(layer, f) { ops.push([layer, ops.length, f]); }
    function gx(a, b) { minX = Math.min(minX, a, b); maxX = Math.max(maxX, a, b); }
    var top = M, y = top + bandH + 16, act = order.map(function () { return []; }), acts = [];
    var lastLineY = null, lastMsg = null, fstack = [], frames = [], descParts = [];
    function edgeX(p, rightSide) {
      var k = act[p.idx].length;
      return k ? X[p.idx] + (rightSide ? 5 : -5) + (k - 1) * 4 : X[p.idx];
    }
    function extend(a, b) { fstack.forEach(function (f) { f.min = Math.min(f.min, a, b); f.max = Math.max(f.max, a, b); }); }
    function rectSvg(cls, x, yy, w, h, r) {
      return '<rect class="' + cls + '" x="' + n1(x) + '" y="' + n1(yy) + '" width="' + n1(w) + '" height="' + n1(h) + '"' + (r ? ' rx="' + r + '" ry="' + r + '"' : "") + "/>";
    }
    function bgText(cls, tb, x, cy, anchor) {
      var w = tb.w + 8, x1 = anchor === "start" ? x - 4 : x - w / 2;
      return function (ox) { return rectSvg("mm-edge-label-bg", x1 + ox, cy - tb.h / 2 - 1, w, tb.h + 2, 2) + textSvg(cls, tb, x + ox, cy, anchor); };
    }

    events.forEach(function (e) {
      if (e.t === "msg") {
        var a = e.from, b = e.to, self = a === b, right = self || X[b.idx] > X[a.idx];
        var textTop = y + 4, lineY = textTop + (e.text ? e.tb.h + 5 : 10);
        var numR = e.num != null ? Math.max(8, ctx.measure(String(e.num), sm, "bold") / 2 + 4) : 0;
        var x1 = edgeX(a, right);
        if (e.act === "+") act[b.idx].push(lineY);
        var x2 = self ? x1 : edgeX(b, !right);
        if (e.act === "-" && act[a.idx].length) acts.push({ p: a.idx, y1: act[a.idx].pop(), y2: lineY, level: act[a.idx].length });
        var cls = "mm-msg" + (e.dotted ? " mm-msg-dotted" : ""), mStart = e.both ? e.head : null;
        var dsc = (e.num != null ? e.num + ". " : "") + a.text + " to " + b.text + (e.text ? ": " + oneLine(e.text) : "");
        descParts.push(dsc);
        if (self) {
          var y2 = lineY + 18, sx = x1, far = sx + 44, s0 = sx + (mStart ? 4 : 0), s1 = sx + (e.head ? 4 : 0);
          op(3, function (ox) {
            return '<path class="' + cls + ' mm-self" d="M' + n1(s0 + ox) + "," + n1(lineY) + "C" + n1(far + ox) + "," + n1(lineY) + " " + n1(far + ox) + "," + n1(y2) + " " + n1(s1 + ox) + "," + n1(y2) + '"' +
              markerAttr(idp, mStart, true, used) + markerAttr(idp, e.head, false, used) + "/>";
          });
          var lx = sx + Math.max(8, numR + 4);
          if (e.text) op(4, function (ox) { return textSvg("mm-msg-label mm-text-sm", e.tb, lx + ox, textTop + e.tb.h / 2, "start"); });
          gx(sx, Math.max(far, lx + e.tb.w));
          extend(sx - 6, Math.max(far - 8, lx + e.tb.w));
          lastLineY = lineY;
          y = y2 + 14;
          lastMsg = null;
        } else {
          var dir = x2 > x1 ? 1 : -1, msg = { x1: x1 + (mStart ? 4 * dir : 0), x2: x2 - (e.head ? 4 * dir : 0), toIdx: b.idx, dir: dir };
          op(3, function (ox) {
            return '<line class="' + cls + '" x1="' + n1(msg.x1 + ox) + '" y1="' + n1(lineY) + '" x2="' + n1(msg.x2 + ox) + '" y2="' + n1(lineY) + '"' +
              markerAttr(idp, mStart, true, used) + markerAttr(idp, e.head, false, used) + "/>";
          });
          var mid = (x1 + x2) / 2, crosses = Math.abs(a.idx - b.idx) > 1;
          if (e.text) op(4, crosses ? bgText("mm-msg-label mm-text-sm", e.tb, mid, textTop + e.tb.h / 2) : function (ox) { return textSvg("mm-msg-label mm-text-sm", e.tb, mid + ox, textTop + e.tb.h / 2); });
          extend(Math.min(x1, x2, mid - e.tb.w / 2), Math.max(x1, x2, mid + e.tb.w / 2));
          lastLineY = lineY;
          lastMsg = msg;
          y = lineY + 18;
        }
        if (e.num != null) {
          var label = String(e.num), ntb = textBlock(label, ctx, sm, 0), r = numR, nx = x1;
          op(7, function (ox) {
            return '<circle class="mm-num" cx="' + n1(nx + ox) + '" cy="' + n1(lineY) + '" r="' + n1(r) + '"/>' + textSvg("mm-num-label mm-text-sm", ntb, nx + ox, lineY);
          });
          gx(nx - r, nx + r);
        }
      } else if (e.t === "note") {
        var ia = e.a.idx, ib = e.b.idx, nx1;
        var lo = Math.min(X[ia], X[ib]), hi = Math.max(X[ia], X[ib]), w = e.w;
        if (e.pos === "right of") nx1 = edgeX(e.a, true) + 10;
        else if (e.pos === "left of") nx1 = edgeX(e.a, false) - 10 - w;
        else {
          if (ia !== ib && hi - lo + 20 > e.tb.w) { e.tb = textBlock(e.text, ctx, sm, hi - lo + 20, true); e.h = e.tb.h + 12; }
          w = ia === ib ? w : Math.max(e.tb.w + 20, hi - lo + 40);
          nx1 = (lo + hi) / 2 - w / 2;
        }
        var ny = y + 4, nw = w;
        op(5, function (ox) { return rectSvg("mm-note", nx1 + ox, ny, nw, e.h, 0) + textSvg("mm-note-label mm-text-sm", e.tb, nx1 + nw / 2 + ox, ny + e.h / 2); });
        gx(nx1, nx1 + nw);
        extend(nx1, nx1 + nw);
        descParts.push("note " + e.pos + " " + e.a.text + (e.b !== e.a ? " and " + e.b.text : "") + ": " + oneLine(e.text));
        y = ny + e.h + 12;
      } else if (e.t === "act") {
        var st = act[e.p.idx];
        st.push(lastLineY != null ? lastLineY : y);
        // The message that triggered it already ended at the lifeline: stop it at the new box instead.
        if (lastMsg && lastMsg.toIdx === e.p.idx && st.length === 1) lastMsg.x2 -= 5 * lastMsg.dir;
      } else if (e.t === "deact") {
        var sd = act[e.p.idx];
        if (sd.length) {
          var y1 = sd.pop();
          acts.push({ p: e.p.idx, y1: y1, y2: Math.max(lastLineY != null ? lastLineY : y, y1 + 12), level: sd.length });
        }
      } else if (e.t === "start") {
        var f = { e: e, y1: y + 2, divs: [], min: Infinity, max: -Infinity };
        fstack.push(f);
        frames.push(f);
        if (e.kind !== "rect") descParts.push(e.kind + (e.text ? " " + oneLine(e.text) : "") + " begins");
        y = f.y1 + (e.kind === "rect" ? 10 : 30);
      } else if (e.t === "div") {
        fstack[fstack.length - 1].divs.push({ y: y + 4, e: e });
        descParts.push(e.kind + (e.text ? " " + oneLine(e.text) : ""));
        y += 30;
      } else if (e.t === "end") {
        var fr = fstack.pop();
        fr.y2 = y + 4;
        y = fr.y2 + 12;
        if (!isFinite(fr.min)) { fr.min = X[0] - 30; fr.max = X[n - 1] + 30; }
        fr.x1 = fr.min - 16;
        fr.x2 = Math.max(fr.max + 16, fr.x1 + (fr.e.kind === "rect" ? 0 : fr.e.tabW + (fr.e.ctb ? fr.e.ctb.w + 16 : 0) + 10));
        fr.divs.forEach(function (d) { if (d.e.ctb) fr.x2 = Math.max(fr.x2, fr.x1 + d.e.ctb.w + 24); });
        if (fstack.length) { var pf = fstack[fstack.length - 1]; pf.min = Math.min(pf.min, fr.x1); pf.max = Math.max(pf.max, fr.x2); }
        gx(fr.x1, fr.x2);
        if (fr.e.kind !== "rect") descParts.push("end of " + fr.e.kind);
      }
    });
    var lifeBottom = y + 6;
    order.forEach(function (p, k) { while (act[k].length) acts.push({ p: k, y1: act[k].pop(), y2: lifeBottom - 6, level: act[k].length }); });
    var repeat = lifeBottom + bandH + M > 400;
    var H = repeat ? lifeBottom + bandH + M : lifeBottom + M;

    frames.forEach(function (f) {
      var e = f.e;
      op(0, function (ox) {
        var s = rectSvg("mm-frame" + (e.kind === "rect" ? " mm-frame-rect" : ""), f.x1 + ox, f.y1, f.x2 - f.x1, f.y2 - f.y1, 0);
        f.divs.forEach(function (d) { s += '<line class="mm-frame-divider" x1="' + n1(f.x1 + ox) + '" y1="' + n1(d.y) + '" x2="' + n1(f.x2 + ox) + '" y2="' + n1(d.y) + '"/>'; });
        return s;
      });
      if (e.kind === "rect") return;
      op(6, function (ox) {
        var x1 = f.x1 + ox, tw = e.tabW, ty = f.y1 + 10;
        var s = '<path class="mm-frame-tab" d="M' + n1(x1) + "," + n1(f.y1) + "H" + n1(x1 + tw) + "V" + n1(f.y1 + 13) + "L" + n1(x1 + tw - 7) + "," + n1(f.y1 + 20) + "H" + n1(x1) + 'Z"/>';
        s += textSvg("mm-frame-label mm-text-sm", textBlock(e.kind, ctx, sm, 0, false, "bold"), x1 + 8, ty, "start");
        if (e.ctb) s += bgText("mm-frame-cond mm-text-sm", e.ctb, x1 + tw + 8, ty, "start")(0);
        f.divs.forEach(function (d) { if (d.e.ctb) s += bgText("mm-frame-cond mm-text-sm", d.e.ctb, x1 + 10, d.y + 13, "start")(0); });
        return s;
      });
    });
    order.forEach(function (p, k) {
      var x = X[k];
      gx(x - p.w / 2, x + p.w / 2);
      op(1, function (ox) { return '<line class="mm-lifeline" x1="' + n1(x + ox) + '" y1="' + n1(top + bandH) + '" x2="' + n1(x + ox) + '" y2="' + n1(repeat ? lifeBottom : lifeBottom - 2) + '"/>'; });
      [top].concat(repeat ? [lifeBottom] : []).forEach(function (ty, atBottom) {
        op(8, function (ox) {
          var cx = x + ox, bh = p.tb.h + 18;
          if (p.kind === "actor") {
            var fy = atBottom ? ty : ty + bandH - p.tb.h - 44;
            return '<g class="mm-actor-group"><circle class="mm-actor" cx="' + n1(cx) + '" cy="' + n1(fy + 10) + '" r="7"/>' +
              '<path class="mm-actor" d="M' + n1(cx) + "," + n1(fy + 17) + "V" + n1(fy + 30) + "M" + n1(cx - 11) + "," + n1(fy + 22) + "H" + n1(cx + 11) +
              "M" + n1(cx) + "," + n1(fy + 30) + "L" + n1(cx - 9) + "," + n1(fy + 41) + "M" + n1(cx) + "," + n1(fy + 30) + "L" + n1(cx + 9) + "," + n1(fy + 41) + '"/>' +
              textSvg("mm-actor-label mm-text-md", p.tb, cx, fy + 44 + p.tb.h / 2 - 1) + "</g>";
          }
          var by = atBottom ? ty : ty + bandH - bh;
          return '<g class="mm-actor-group">' + rectSvg("mm-actor", cx - p.w / 2, by, p.w, bh, 3) + textSvg("mm-actor-label mm-text-md", p.tb, cx, by + bh / 2) + "</g>";
        });
      });
    });
    acts.forEach(function (a) {
      op(2, function (ox) { return rectSvg("mm-activation", X[a.p] - 5 + a.level * 4 + ox, a.y1, 10, Math.max(a.y2 - a.y1, 4), 0); });
    });

    var ox = M - minX, W = maxX - minX + 2 * M;
    ops.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    var body = ops.map(function (o) { return o[2](ox); }).join("");
    var title = model.accTitle || ((model.title ? oneLine(model.title) + ". " : "") + "Sequence diagram: " + plural(n, "participant") + ", " + plural(msgCount, "message"));
    var desc = (model.accDescr ? model.accDescr + " " : "") + "Participants: " + order.map(function (p) { return p.text; }).join(", ") + ". " +
      (descParts.length ? descParts.join("; ") + "." : "No messages.");
    var svg = svgOpen("mm-seq", W, H, idp, title, desc) + markerDefs(idp, used) + body + "</svg>";
    return { ok: true, kind: "sequence", svg: svg, width: Math.round(W * 10) / 10, height: Math.round(H * 10) / 10, title: title, note: "" };
  }

  export { render };
