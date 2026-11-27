// The record of `measure-interactions.mjs` and the comparison of two records: plain data in, plain data
// out, so the shape is testable without a browser.

/** Bumped when a number changes meaning, so a comparison can say the two records are not alike. */
export const RECORD_VERSION = 2;

/**
 * What each measured step reports, in print order: counts first, then durations. `unit` is `ms` for
 * durations, `n` for counts. A change in a count is exact on any machine; a change in a duration is only as
 * good as the machine is quiet.
 */
const SETTLED = [['taskMs', 'ms'], ['scriptMs', 'ms'], ['layoutMs', 'ms'], ['styleMs', 'ms'], ['longestTaskMs', 'ms']];
const EDIT = [['removedTop', 'n'], ['addedTop', 'n'], ['layouts', 'n'], ['recalcs', 'n'], ...SETTLED];
const SWITCH = [['layouts', 'n'], ['recalcs', 'n'], ['shownMs', 'ms'], ['taskMs', 'ms'], ['scriptMs', 'ms'], ['layoutMs', 'ms']];
export const STEPS = [
  { step: 'open', label: 'open', fields: [['nodes', 'n'], ['layouts', 'n'], ['recalcs', 'n'], ['firstContentMs', 'ms'], ...SETTLED, ['settleMs', 'ms']] },
  { step: 'key', label: 'cursor key (j)', fields: [['layouts', 'n'], ['recalcs', 'n'], ['handlerMs', 'ms'], ['taskMs', 'ms'], ['scriptMs', 'ms'], ['layoutMs', 'ms']] },
  { step: 'click', label: 'first click', fields: [['layouts', 'n'], ['recalcs', 'n'], ['handlerMs', 'ms'], ['taskMs', 'ms'], ['scriptMs', 'ms'], ['layoutMs', 'ms'], ['styleMs', 'ms']] },
  { step: 'undo', label: 'undo', fields: EDIT },
  { step: 'reload', label: 'reload from disk', fields: EDIT },
  { step: 'tabBack', label: 'tab switch to it', fields: SWITCH },
  { step: 'tabAway', label: 'tab switch away', fields: SWITCH },
  { step: 'toRead', label: 'Source to Read', fields: SWITCH },
  { step: 'toSource', label: 'Read to Source', fields: SWITCH },
];

/** What the durations cover, printed under every table so none is read as time to show. */
export const LEGEND = [
  'Counts first; they do not depend on the machine. removedTop/addedTop: top-level nodes of the article taken out and put in.',
  'taskMs, scriptMs, layoutMs, styleMs and the counts run from the action until the main thread has been idle for about a second,',
  '  so they include typesetting that follows it: not the time until the page shows it. A cursor key: the 150 ms after each press.',
  'shownMs: until the tab or mode is current and two frames have painted. firstContentMs: until the article holds the text.',
  'handlerMs: event handlers only (a click sees handlers of 16 ms or more). longestTaskMs: tasks of 50 ms or more only.',
];

/** The middle value; the mean of the two middle values for an even count; NaN for none. */
export function median(xs) {
  const v = xs.filter(x => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return Number.NaN;
  const s = [...v].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round = (x, places = 1) => (Number.isFinite(x) ? Number(x.toFixed(places)) : undefined);

/**
 * One row per field, each the median over the repetitions that produced it. A field no repetition
 * produced is left out, which `missing` then reports.
 */
export function medians(samples) {
  const out = {};
  const names = new Set(samples.flatMap(s => Object.keys(s ?? {})));
  for (const name of names) {
    const m = median(samples.map(s => s?.[name]));
    const r = round(m, 2);
    if (r !== undefined) out[name] = r;
  }
  return out;
}

/**
 * The record: `meta` (commit, date, machine class, Edge version, repetitions), the `documents` keyed by
 * name (each a map of step to field to number), and `missing`, the `document/step` names asked for that
 * produced no number at all.
 */
export function buildRecord({ meta, documents, steps = STEPS.map(s => s.step) }) {
  const missing = [];
  const docs = {};
  for (const [name, result] of Object.entries(documents)) {
    docs[name] = {};
    // `steps` is one list for every document, or a map of document name to the steps run on it.
    for (const step of Array.isArray(steps) ? steps : (steps[name] ?? [])) {
      const fields = result[step];
      if (!fields || Object.keys(fields).length === 0) missing.push(`${name}/${step}`);
      else docs[name][step] = fields;
    }
  }
  return { version: RECORD_VERSION, meta, documents: docs, missing };
}

/** Every number in a record as `document/step/field` to value. */
export function flatten(record) {
  const out = new Map();
  for (const [doc, steps] of Object.entries(record.documents ?? {})) {
    for (const [step, fields] of Object.entries(steps)) {
      for (const [field, value] of Object.entries(fields)) if (typeof value === 'number') out.set(`${doc}/${step}/${field}`, value);
    }
  }
  return out;
}

const unitOf = (step, field) => STEPS.find(s => s.step === step)?.fields.find(f => f[0] === field)?.[1] ?? 'ms';

/**
 * This run against a saved one, in print order: each row has the name, both numbers (undefined when one
 * side lacks it), the change, and the change as a percentage of the saved number (undefined when that is 0).
 */
export function compare(base, now) {
  const a = flatten(base);
  const b = flatten(now);
  const order = [];
  for (const doc of new Set([...Object.keys(base.documents ?? {}), ...Object.keys(now.documents ?? {})])) {
    for (const { step, fields } of STEPS) for (const [field] of fields) order.push(`${doc}/${step}/${field}`);
  }
  const rows = [];
  for (const name of order) {
    if (!a.has(name) && !b.has(name)) continue;
    const before = a.get(name);
    const after = b.get(name);
    const [doc, step, field] = name.split('/');
    const change = before !== undefined && after !== undefined ? round(after - before, 2) : undefined;
    rows.push({ name, doc, step, field, unit: unitOf(step, field), before, after, change, percent: change !== undefined && before ? round((change / before) * 100, 0) : undefined });
  }
  return rows;
}

const cell = v => (v === undefined ? '-' : String(v));

/** The run as a table: a heading per document, a line per step with `field value` pairs. */
export function formatTable(record) {
  const lines = [];
  const m = record.meta ?? {};
  lines.push(`measure-interactions: ${m.commit ?? 'unknown commit'}${m.dirty ? ' (uncommitted changes)' : ''}, ${m.date ?? ''}, ${m.machine ?? ''}, ${m.edge ?? ''}, ${m.runs ?? '?'} runs`);
  for (const [doc, steps] of Object.entries(record.documents)) {
    lines.push('', `${doc}`);
    for (const { step, label, fields } of STEPS) {
      const f = steps[step];
      if (!f) continue;
      const parts = fields.filter(([k]) => k in f).map(([k]) => `${k} ${f[k]}`);
      lines.push(`  ${label.padEnd(18)} ${parts.join('  ')}`);
    }
  }
  if (record.missing?.length) lines.push('', `no number for: ${record.missing.join(', ')}`);
  lines.push('', ...LEGEND);
  return `${lines.join('\n')}\n`;
}

const stepsOf = record => Object.entries(record.documents ?? {}).map(([d, s]) => `${d}: ${Object.keys(s).join(' ')}`).sort();
const sameCode = (a, b) => !a.dirty && !b.dirty && ['apps', 'packages', 'fixtures'].every(k => a[k] && a[k] === b[k]);

/** Why two records may not be alike: each a line of the comparison's head. */
export function warnings(base, now) {
  const out = [];
  const a = base.meta ?? {};
  const b = now.meta ?? {};
  if (base.version !== now.version) out.push(`record versions differ (${base.version} and ${now.version}); numbers may not mean the same`);
  const sa = stepsOf(base);
  const sb = stepsOf(now);
  if (sa.join('\n') !== sb.join('\n')) out.push(`the documents or steps differ: saved ${sa.join('; ') || 'none'}; now ${sb.join('; ') || 'none'}`);
  if (a.runs !== b.runs || a.keys !== b.keys) out.push(`runs or keys differ (${a.runs}/${a.keys} and ${b.runs}/${b.keys})`);
  if (a.machine && b.machine && a.machine !== b.machine) out.push('the machines differ; compare counts, not durations');
  if (a.dirty || b.dirty) out.push(`${a.dirty ? 'the saved' : 'this'} record${a.dirty && b.dirty ? ' and this one were' : ' was'} taken on a tree with uncommitted changes`);
  if (a.code && b.code && sameCode(a.code, b.code)) out.push('the app, packages and fixtures are the same in both: any change is the machine or the tool');
  return out;
}

/** The comparison as a table: name, saved, now, change. Durations in ms, counts as counts. */
export function formatCompare(base, now) {
  const rows = compare(base, now);
  const width = Math.max(10, ...rows.map(r => r.name.length));
  const head = `${'number'.padEnd(width)}  ${'saved'.padStart(10)}  ${'now'.padStart(10)}  ${'change'.padStart(10)}  ${'%'.padStart(6)}`;
  const lines = [`against ${base.meta?.commit ?? 'unknown commit'} (${base.meta?.date ?? ''}, ${base.meta?.machine ?? ''}) from ${now.meta?.commit ?? 'unknown commit'}`];
  for (const w of warnings(base, now)) lines.push(`warning: ${w}`);
  lines.push(head);
  for (const r of rows) {
    const sign = r.change !== undefined && r.change > 0 ? '+' : '';
    lines.push(`${r.name.padEnd(width)}  ${cell(r.before).padStart(10)}  ${cell(r.after).padStart(10)}  ${(r.change === undefined ? '-' : sign + r.change).padStart(10)}  ${(r.percent === undefined ? '-' : `${sign}${r.percent}%`).padStart(6)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The text with every definition line (`[^n]: ...`, `[label]: ...`, up to three spaces in) turned into
 * ordinary text by escaping its opening bracket. A page with a footnote or link definition is rebuilt whole
 * by an in-place update; this makes the same page one that can be updated in place.
 */
export function neutraliseDefinitions(text) {
  return text.replace(/^( {0,3})\[(?=[^\]\n]+\]:)/gm, '$1\\[');
}
