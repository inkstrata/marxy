// Minimal TrueType advance-width reader for the rag study: enough of head/maxp/hhea/hmtx/cmap/fvar
// to measure text in the bundled body face at its default instance. No dependency, no DOM, no kerning.
import { readFileSync } from 'node:fs';

/** Advances come from hmtx, which describes the default variable-font instance only. */
export function readFont(path) {
  const buf = readFileSync(path);
  const tables = readTableDirectory(buf);
  const unitsPerEm = buf.readUInt16BE(tables.head.offset + 18);
  const numGlyphs = buf.readUInt16BE(tables.maxp.offset + 4);
  const numberOfHMetrics = buf.readUInt16BE(tables.hhea.offset + 34);
  const advances = readHmtx(buf, tables.hmtx.offset, numGlyphs, numberOfHMetrics);
  const cmap = readCmap(buf, tables.cmap.offset);
  const axes = tables.fvar ? readFvarDefaults(buf, tables.fvar.offset) : {};
  const glyphFor = (codePoint) => cmap.get(codePoint) ?? 0;
  const advanceOf = (codePoint) => advances[glyphFor(codePoint)] / unitsPerEm;
  return {
    unitsPerEm,
    numGlyphs,
    axes,
    /** Advance of one code point, in em. Missing glyphs fall back to .notdef, as a renderer would not. */
    advanceOf,
    hasGlyph: (codePoint) => cmap.has(codePoint),
    /** Advance of a string in em: the sum of its code points' advances, no kerning, no ligatures. */
    widthOf(text) {
      let sum = 0;
      for (const ch of text) sum += advanceOf(ch.codePointAt(0));
      return sum;
    },
  };
}

function readTableDirectory(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables[buf.toString('ascii', rec, rec + 4).trim()] = {
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    };
  }
  for (const required of ['head', 'maxp', 'hhea', 'hmtx', 'cmap']) {
    if (!tables[required]) throw new Error(`font is missing the ${required} table`);
  }
  return tables;
}

function readHmtx(buf, offset, numGlyphs, numberOfHMetrics) {
  const advances = new Uint16Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numberOfHMetrics) last = buf.readUInt16BE(offset + g * 4);
    advances[g] = last; // glyphs past numberOfHMetrics repeat the final advance (monospaced tail)
  }
  return advances;
}

function readCmap(buf, offset) {
  const numSubtables = buf.readUInt16BE(offset + 2);
  let best = null;
  for (let i = 0; i < numSubtables; i++) {
    const rec = offset + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const subOffset = offset + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(subOffset);
    const unicodeFull = platform === 3 && encoding === 10;
    const unicodeBmp = (platform === 3 && encoding === 1) || platform === 0;
    if (format === 12 && unicodeFull) best = { format, subOffset, rank: 2 };
    else if (format === 4 && unicodeBmp && (best?.rank ?? 0) < 1) best = { format, subOffset, rank: 1 };
  }
  if (!best) throw new Error('font has no format 4 or 12 Unicode cmap subtable');
  return best.format === 12 ? readCmap12(buf, best.subOffset) : readCmap4(buf, best.subOffset);
}

function readCmap4(buf, o) {
  const segCount = buf.readUInt16BE(o + 6) / 2;
  const ends = o + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const ranges = deltas + segCount * 2;
  const map = new Map();
  for (let s = 0; s < segCount; s++) {
    const end = buf.readUInt16BE(ends + s * 2);
    const start = buf.readUInt16BE(starts + s * 2);
    const delta = buf.readInt16BE(deltas + s * 2);
    const rangeOffset = buf.readUInt16BE(ranges + s * 2);
    if (start === 0xffff) continue;
    for (let c = start; c <= end && c !== 0x10000; c++) {
      let g;
      if (rangeOffset === 0) g = (c + delta) & 0xffff;
      else {
        const gi = ranges + s * 2 + rangeOffset + (c - start) * 2;
        g = buf.readUInt16BE(gi);
        if (g !== 0) g = (g + delta) & 0xffff;
      }
      if (g !== 0) map.set(c, g);
    }
  }
  return map;
}

function readCmap12(buf, o) {
  const nGroups = buf.readUInt32BE(o + 12);
  const map = new Map();
  for (let i = 0; i < nGroups; i++) {
    const g = o + 16 + i * 12;
    const start = buf.readUInt32BE(g);
    const end = buf.readUInt32BE(g + 4);
    const startGlyph = buf.readUInt32BE(g + 8);
    for (let c = start; c <= end; c++) map.set(c, startGlyph + (c - start));
  }
  return map;
}

function readFvarDefaults(buf, o) {
  const axisCount = buf.readUInt16BE(o + 8);
  const axisSize = buf.readUInt16BE(o + 10);
  const axesArray = o + buf.readUInt16BE(o + 4);
  const axes = {};
  for (let i = 0; i < axisCount; i++) {
    const a = axesArray + i * axisSize;
    axes[buf.toString('ascii', a, a + 4)] = buf.readInt32BE(a + 8) / 65536;
  }
  return axes;
}
