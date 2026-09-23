/* Knuth-Plass total-fit line breaking (Knuth & Plass, "Breaking Paragraphs into Lines", 1981),
   with TeX's plain-format defaults, plus a first-fit breaker and a common evaluator so any
   set of breaks (including a browser's) can be scored under the same model. */
(function (global) {
  'use strict';
  const INF = 10000; // TeX's infinite penalty; also the badness cap

  const DEFAULTS = {
    stretch: 1 / 2, shrink: 1 / 3,          // interword glue as a fraction of the space (cmr10: 3.33pt +1.67pt -1.11pt)
    hyphenPenalty: 50, exHyphenPenalty: 50,
    leftHyphenMin: 2, rightHyphenMin: 3,
    pretolerance: 100, tolerance: 200,      // badness limits for the first (no hyphenation) and second pass
    linePenalty: 10, doubleHyphenDemerits: 10000, finalHyphenDemerits: 5000, adjDemerits: 10000,
    raggedStretch: 0,                       // >0: fixed interword spaces and this much stretch at every line end (TeX \raggedright uses 2em)
    emergencyStretch: 0,                    // px of imaginary stretch per line in the final pass; 3em is a common choice
  };

  function badness(r) {
    if (!isFinite(r)) return INF;
    const b = 100 * Math.abs(r) ** 3;
    return b > INF ? INF : b;
  }
  const fitnessClass = (r) => (r < -0.5 ? 0 : r <= 0.5 ? 1 : r <= 1 ? 2 : 3); // tight, decent, loose, very loose

  // Items carry word/frag indices so breaks from other engines can be mapped back onto them.
  function itemize(text, measure, opt) {
    const o = Object.assign({}, DEFAULTS, opt);
    const space = measure(' ');
    const hyphenW = measure('-');
    const ragged = o.raggedStretch > 0;
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const items = [];
    const keyIndex = new Map();
    words.forEach((word, w) => {
      const clean = word.replace(/­/g, '');
      const cuts = [];
      let ci = 0;
      for (const ch of word) {
        if (ch === '­') {
          if (ci >= o.leftHyphenMin && clean.length - ci >= o.rightHyphenMin) cuts.push({ at: ci, kind: 'soft' });
          continue;
        }
        ci += ch.length;
        if (ci < clean.length && (ch === '-' || ch === '‐' || ch === '–')) cuts.push({ at: ci, kind: 'hard' });
        else if (ci < clean.length && ch === '—') cuts.push({ at: ci, kind: 'dash' });
      }
      let prev = 0, prevW = 0, frag = 0;
      for (const c of cuts.concat([{ at: clean.length, kind: 'end' }])) {
        if (c.at <= prev && !(c.kind === 'end' && prev === 0)) continue;
        const wEnd = measure(clean.slice(0, c.at));
        items.push({ type: 'box', width: wEnd - prevW, text: clean.slice(prev, c.at), word: w, frag });
        prevW = wEnd; prev = c.at;
        if (c.kind !== 'end') {
          const p = c.kind === 'soft'
            ? { type: 'penalty', width: hyphenW, penalty: o.hyphenPenalty, flagged: true, auto: true, text: '-' }
            : { type: 'penalty', width: 0, penalty: o.exHyphenPenalty, flagged: c.kind === 'hard', text: '' };
          p.word = w; p.frag = frag;
          keyIndex.set(w + ':' + frag, items.length);
          items.push(p);
          frag++;
        }
      }
      if (w < words.length - 1) {
        keyIndex.set(w + ':end', items.length);
        items.push(ragged ? { type: 'glue', width: space, stretch: 0, shrink: 0, word: w }
                          : { type: 'glue', width: space, stretch: space * o.stretch, shrink: space * o.shrink, word: w });
      }
    });
    items.push({ type: 'penalty', width: 0, penalty: INF, flagged: false, text: '' });
    items.push({ type: 'glue', width: 0, stretch: 1e9, shrink: 0 }); // \parfillskip
    items.push({ type: 'penalty', width: 0, penalty: -INF, flagged: false, text: '' });
    keyIndex.set('final', items.length - 1);
    return { items, keyIndex, words };
  }

  const widthFn = (lineWidths) => (line) => (Array.isArray(lineWidths) ? lineWidths[Math.min(line, lineWidths.length - 1)] : lineWidths);

  function nextStart(items, b) {
    for (let j = b + 1; j < items.length; j++) if (items[j].type === 'box') return j;
    return items.length;
  }

  function isLegal(items, b, allowAuto) {
    const it = items[b];
    if (it.type === 'glue') return b > 0 && items[b - 1].type === 'box';
    if (it.type === 'penalty') return it.penalty < INF && (allowAuto || !it.auto);
    return false;
  }

  // One pass of the total-fit algorithm. Returns node chain or null when no feasible breaks exist.
  function totalFit(items, lineWidths, p, maxBadness, allowAuto, emergency) {
    const width = widthFn(lineWidths);
    // Emergency stretch only changes how lines are scored, never the glue they are set with,
    // so hopeless lines stay distinguishable instead of all hitting the badness cap.
    const extraY = p.raggedStretch + (emergency || 0);
    const varying = Array.isArray(lineWidths);
    const n = items.length;
    let sumW = 0, sumY = 0, sumZ = 0;
    let active = [{ position: 0, line: 0, fitness: 1, tw: 0, ty: 0, tz: 0, demerits: 0, prev: null, flagged: false, ratio: 0 }];
    for (let b = 0; b < n; b++) {
      const it = items[b];
      if (it.type === 'box') { sumW += it.width; continue; }
      if (isLegal(items, b, allowAuto)) {
        const pen = it.type === 'penalty' ? it.penalty : 0;
        const pw = it.type === 'penalty' ? it.width : 0;
        const flagged = it.type === 'penalty' && it.flagged;
        const forced = it.type === 'penalty' && pen <= -INF;
        const final = b === n - 1;
        const best = new Map();
        let minD = Infinity;
        const next = [];
        for (const a of active) {
          const L = sumW - a.tw + pw;
          const W = width(a.line);
          let r;
          if (L < W) { const Y = sumY - a.ty + extraY; r = Y > 0 ? (W - L) / Y : Infinity; }
          else if (L > W) { const Z = sumZ - a.tz; r = Z > 0 ? (W - L) / Z : -Infinity; }
          else r = 0;
          if (r >= -1) {
            const bad = badness(r);
            if (bad <= maxBadness) {
              let d = p.linePenalty + bad;
              d = d >= INF ? 1e8 : d * d;
              if (pen > 0) d += pen * pen; else if (pen > -INF) d -= pen * pen;
              if (a.flagged && final) d += p.finalHyphenDemerits;
              else if (a.flagged && flagged) d += p.doubleHyphenDemerits;
              const c = fitnessClass(r);
              if (Math.abs(c - a.fitness) > 1) d += p.adjDemerits;
              d += a.demerits;
              const key = varying ? (a.line + 1) + ':' + c : String(c);
              const cur = best.get(key);
              if (!cur || d < cur.demerits) best.set(key, { node: a, demerits: d, ratio: r, cls: c });
              if (d < minD) minD = d;
            }
          }
          if (!(r < -1 || forced)) next.push(a);
        }
        if (best.size) {
          let tw = sumW, ty = sumY, tz = sumZ;
          for (let j = b; j < n; j++) {
            const x = items[j];
            if (x.type === 'glue') { tw += x.width; ty += x.stretch; tz += x.shrink; }
            else if (x.type === 'box' || (x.type === 'penalty' && x.penalty <= -INF && j > b)) break;
          }
          for (const cand of best.values()) {
            if (cand.demerits <= minD + p.adjDemerits) {
              next.push({ position: b, line: cand.node.line + 1, fitness: cand.cls, tw, ty, tz,
                demerits: cand.demerits, prev: cand.node, flagged, ratio: cand.ratio });
            }
          }
        }
        active = next;
        if (!active.length) return null;
      }
      if (it.type === 'glue') { sumW += it.width; sumY += it.stretch; sumZ += it.shrink; }
    }
    const last = active.filter((a) => a.position === n - 1);
    if (!last.length) return null;
    let bestNode = last[0];
    for (const a of last) if (a.demerits < bestNode.demerits) bestNode = a;
    const breaks = [];
    for (let x = bestNode; x.prev; x = x.prev) breaks.push(x.position);
    return breaks.reverse();
  }

  // TeX's strategy: a pass without hyphenation, then with hyphenation, then an emergency pass with
  // extra imaginary stretch; after that any badness, and first-fit only for material that cannot fit at all.
  function knuthPlass(items, lineWidths, opt) {
    const p = Object.assign({}, DEFAULTS, opt);
    let breaks = null, pass = 0;
    if (p.pretolerance >= 0) { breaks = totalFit(items, lineWidths, p, p.pretolerance, false); pass = 1; }
    if (!breaks) { breaks = totalFit(items, lineWidths, p, p.tolerance, true); pass = 2; }
    if (!breaks && p.emergencyStretch > 0) { breaks = totalFit(items, lineWidths, p, p.tolerance, true, p.emergencyStretch); pass = 3; }
    if (!breaks) { breaks = totalFit(items, lineWidths, p, INF, true, p.emergencyStretch); pass = 4; }
    if (!breaks) { breaks = firstFit(items, lineWidths); pass = 5; }
    return { breaks, pass };
  }

  // What browsers and most word processors do: fill each line at natural width, never look back.
  function firstFit(items, lineWidths) {
    const width = widthFn(lineWidths);
    const n = items.length;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (items[i].type === 'penalty' ? 0 : items[i].width);
    const legal = [];
    for (let b = 0; b < n; b++) if (isLegal(items, b, true)) legal.push(b);
    const breaks = [];
    let s = 0, line = 0, lastFit = -1;
    for (let k = 0; k < legal.length; k++) {
      const b = legal[k], it = items[b];
      const forced = it.type === 'penalty' && it.penalty <= -INF;
      const natural = pre[b] - pre[s] + (it.type === 'penalty' ? it.width : 0);
      if (natural <= width(line) + 1e-6) {
        lastFit = b;
        if (forced) { breaks.push(b); s = nextStart(items, b); line++; lastFit = -1; }
        continue;
      }
      if (lastFit >= 0) { breaks.push(lastFit); s = nextStart(items, lastFit); line++; lastFit = -1; k--; continue; }
      breaks.push(b); s = nextStart(items, b); line++; lastFit = -1; // overfull
    }
    return breaks;
  }

  // Score any break sequence under the Knuth-Plass model.
  function evaluate(items, breaks, lineWidths, opt) {
    const p = Object.assign({}, DEFAULTS, opt);
    const width = widthFn(lineWidths);
    const n = items.length;
    const pw = new Float64Array(n + 1), py = new Float64Array(n + 1), pz = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      pw[i + 1] = pw[i] + (it.type === 'penalty' ? 0 : it.width);
      py[i + 1] = py[i] + (it.type === 'glue' ? it.stretch : 0);
      pz[i + 1] = pz[i] + (it.type === 'glue' ? it.shrink : 0);
    }
    let s = 0, prevFlagged = false, prevClass = 1, total = 0;
    const lines = breaks.map((b, i) => {
      const it = items[b];
      const L = pw[b] - pw[s] + (it.type === 'penalty' ? it.width : 0);
      const Y = py[b] - py[s] + p.raggedStretch, Z = pz[b] - pz[s];
      const W = width(i);
      const r = L < W ? (Y > 0 ? (W - L) / Y : Infinity) : L > W ? (Z > 0 ? (W - L) / Z : -Infinity) : 0;
      const final = b === n - 1;
      const bad = r < -1 ? Infinity : badness(r);
      let d = p.linePenalty + (isFinite(bad) ? bad : INF);
      d = d >= INF ? 1e8 : d * d;
      const pen = it.type === 'penalty' ? it.penalty : 0;
      if (pen > 0) d += pen * pen; else if (pen > -INF) d -= pen * pen;
      const flagged = it.type === 'penalty' && it.flagged;
      if (prevFlagged && final) d += p.finalHyphenDemerits;
      else if (prevFlagged && flagged) d += p.doubleHyphenDemerits;
      const c = fitnessClass(r);
      if (Math.abs(c - prevClass) > 1) d += p.adjDemerits;
      total += d;
      const line = { start: s, end: b, ratio: r, badness: bad, fitness: c, flagged, auto: !!it.auto, demerits: d, final, natural: L, width: W };
      prevFlagged = flagged; prevClass = c; s = nextStart(items, b);
      return line;
    });
    return { lines, totalDemerits: total };
  }

  function lineText(items, line) {
    let t = '';
    for (let j = line.start; j < line.end; j++) {
      const it = items[j];
      if (it.type === 'box') t += it.text;
      else if (it.type === 'glue' && j > line.start && it.width > 0) t += ' ';
    }
    const e = items[line.end];
    if (e.type === 'penalty' && e.text && !line.final) t += e.text;
    return t.replace(/ +$/, '');
  }

  global.KP = { DEFAULTS, INF, itemize, knuthPlass, totalFit, firstFit, evaluate, lineText, badness, fitnessClass };
})(typeof window !== 'undefined' ? window : globalThis);
