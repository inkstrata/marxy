// A question set and its page: read and check `questions.json`, write the page as one self-contained HTML
// file in the reader's own default theme, and clean answers that come back from it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultThemeCss } from '../../packages/theme/scripts/inline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

export const QUESTIONS_FILE = 'questions.json';
export const ANSWERS_FILE = 'answers.json';
export const ANSWERS_MD = 'answers.md';
export const pageName = name => `${name}-questions.html`;

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const VISUAL_KINDS = ['image', 'images', 'bars', 'table', 'code', 'svg'];

/** A new set to fill in: one question showing each part of the format. */
export function setTemplate(name) {
  return {
    title: `Open questions: ${name}`,
    intro: 'What each question decides, and what happens if it is left unanswered.',
    questions: [
      {
        id: 'q1',
        title: 'The question, as one line?',
        from: 'where it came from: a tracker row, a file, a review',
        context: ['Why it is asked, in a paragraph or two. `code` and **bold** are drawn.'],
        visual: [{ bars: { unit: 's', rows: [{ label: 'Today', value: 86 }, { label: 'Proposed', value: 57, note: 'faster' }] }, caption: 'What the choice trades' }],
        choices: [
          { id: 'keep', label: 'Keep it as it is', detail: 'What that means.', recommended: true },
          { id: 'change', label: 'Change it', detail: 'What that means.', specify: 'To what?' },
        ],
        multi: false,
        note: 'Anything to add',
        default: 'What happens with no answer',
      },
    ],
  };
}

/** Problems in a parsed set, as sentences; empty when the set can be drawn. */
export function checkSet(set) {
  const out = [];
  if (!set || typeof set !== 'object') return ['the file is not a JSON object'];
  if (typeof set.title !== 'string' || !set.title.trim()) out.push('the set needs a title');
  if (!Array.isArray(set.questions) || !set.questions.length) return [...out, 'the set needs a questions array with at least one question'];
  const seen = new Set();
  set.questions.forEach((q, i) => {
    const at = `question ${i + 1}${typeof q?.id === 'string' ? ` (${q.id})` : ''}`;
    if (!q || typeof q !== 'object') return out.push(`${at} is not an object`);
    if (typeof q.id !== 'string' || !ID.test(q.id)) out.push(`${at}: id must be 1 to 32 letters, digits, '.', '_' or '-'`);
    else if (seen.has(q.id)) out.push(`${at}: id ${q.id} is used twice`);
    else seen.add(q.id);
    if (typeof q.title !== 'string' || !q.title.trim()) out.push(`${at} needs a title`);
    if (q.context !== undefined && typeof q.context !== 'string' && !(Array.isArray(q.context) && q.context.every(p => typeof p === 'string'))) out.push(`${at}: context is a string or an array of strings`);
    if (q.choices !== undefined && !Array.isArray(q.choices)) out.push(`${at}: choices is an array`);
    const ids = new Set();
    for (const c of q.choices ?? []) {
      if (!c || typeof c.id !== 'string' || !ID.test(c.id)) out.push(`${at}: every choice needs an id of letters, digits, '.', '_' or '-'`);
      else if (ids.has(c.id)) out.push(`${at}: choice ${c.id} is used twice`);
      else ids.add(c.id);
      if (!c || typeof c.label !== 'string' || !c.label.trim()) out.push(`${at}: choice ${c?.id ?? '?'} needs a label`);
      if (c?.image !== undefined && typeof c.image !== 'string') out.push(`${at}: the image of choice ${c.id} is a file name`);
    }
    for (const v of [q.visual ?? []].flat()) {
      const kinds = VISUAL_KINDS.filter(k => v && v[k] !== undefined);
      if (kinds.length !== 1) out.push(`${at}: a visual has exactly one of ${VISUAL_KINDS.join(', ')}`);
      else if (kinds[0] === 'bars' && !(Array.isArray(v.bars?.rows) && v.bars.rows.every(r => typeof r?.label === 'string' && Number.isFinite(r.value)))) out.push(`${at}: bars needs rows of { label, value }`);
      else if (kinds[0] === 'table' && !(Array.isArray(v.table?.rows) && v.table.rows.every(Array.isArray) && (v.table.head === undefined || Array.isArray(v.table.head)))) out.push(`${at}: table needs rows, each an array of cells, and head, if any, as an array`);
      else if (kinds[0] === 'images' && !(Array.isArray(v.images) && v.images.every(x => typeof x?.image === 'string'))) out.push(`${at}: images is an array of { image, label }`);
      else if (kinds[0] === 'image' && typeof v.image !== 'string') out.push(`${at}: image is a file name`);
    }
  });
  return out;
}

/** Reads `questions.json` from a set folder and checks it; throws with every problem listed. */
export function readSet(dir) {
  const path = join(dir, QUESTIONS_FILE);
  if (!existsSync(path)) throw new Error(`no ${QUESTIONS_FILE} in ${dir}`);
  let set;
  try {
    set = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path}: ${e.message}`);
  }
  const problems = checkSet(set);
  if (problems.length) throw new Error(`${path}:\n  ${problems.join('\n  ')}`);
  return set;
}

/**
 * Answers as the page sends them, kept to the set's own questions and choices: a picked id that is not a
 * choice, text past 20,000 characters, and keys the format does not have are dropped.
 */
export function cleanAnswers(set, raw) {
  const text = s => (typeof s === 'string' ? s.slice(0, 20000) : '');
  const answers = {};
  for (const q of set.questions) {
    const a = raw?.answers?.[q.id];
    if (!a || typeof a !== 'object') continue;
    const choiceIds = new Set((q.choices ?? []).map(c => c.id));
    let picked = Array.isArray(a.picked) ? [...new Set(a.picked.filter(id => choiceIds.has(id)))] : [];
    if (!q.multi) picked = picked.slice(0, 1);
    const specify = {};
    for (const id of picked) if (text(a.specify?.[id]).trim()) specify[id] = text(a.specify[id]);
    const note = text(a.note);
    if (picked.length || note.trim()) answers[q.id] = { picked, ...(Object.keys(specify).length ? { specify } : {}), ...(note.trim() ? { note } : {}) };
  }
  return { answers, sent: raw?.sent === true, saved: new Date().toISOString() };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escapes text, then draws `code` and **bold**; nothing else is read as markup. */
export function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** A file beside the set as a data URL, so the page needs nothing next to it. */
function dataUrl(dir, file) {
  const path = isAbsolute(file) ? file : join(dir, file);
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`${file}: an image is ${Object.keys(IMAGE_TYPES).join(', ')}`);
  if (!existsSync(path)) throw new Error(`${file}: no such file beside the set`);
  return `data:${type};base64,${readFileSync(path).toString('base64')}`;
}

function figure(body, caption) {
  return `<figure class="marxy-ask-visual">${body}${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}</figure>`;
}

function picture(dir, file, alt) {
  return `<img src="${dataUrl(dir, file)}" alt="${esc(alt ?? '')}">`;
}

function visualHtml(dir, v) {
  if (v.image !== undefined) return figure(picture(dir, v.image, v.alt ?? v.caption), v.caption);
  if (v.images !== undefined) {
    // One under the other at the column's width: pictures compared as rows, never as a grid.
    const rows = v.images.map(x => `<div class="marxy-ask-shot">${x.label ? `<div class="marxy-ask-shot-label">${inline(x.label)}</div>` : ''}${picture(dir, x.image, x.alt ?? x.label)}</div>`).join('');
    return figure(rows, v.caption);
  }
  if (v.bars !== undefined) {
    const { unit = '', rows } = v.bars;
    const max = Math.max(...rows.map(r => Math.abs(r.value)), 1e-9);
    const body = rows.map(r => {
      const pct = Math.max(0.5, (Math.abs(r.value) / max) * 100).toFixed(1);
      return `<div class="marxy-ask-bar"><span class="marxy-ask-bar-label">${inline(r.label)}</span><span class="marxy-ask-bar-track"><span class="marxy-ask-bar-fill${r.mark ? ' marxy-ask-bar-mark' : ''}" style="width:${pct}%"></span></span><span class="marxy-ask-bar-value">${esc(r.value)}${esc(unit)}${r.note ? ` <span class="marxy-ask-faint">${inline(r.note)}</span>` : ''}</span></div>`;
    }).join('');
    return figure(`<div class="marxy-ask-bars">${body}</div>`, v.caption);
  }
  if (v.table !== undefined) {
    const head = v.table.head ? `<thead><tr>${v.table.head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>` : '';
    const body = v.table.rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
    return figure(`<table>${head}<tbody>${body}</tbody></table>`, v.caption);
  }
  if (v.code !== undefined) return figure(`<pre><code>${esc(v.code)}</code></pre>`, v.caption);
  // An SVG the set's writer drew, as an image so its scripts never run on the page.
  return figure(`<img src="data:image/svg+xml;base64,${Buffer.from(String(v.svg)).toString('base64')}" alt="${esc(v.alt ?? v.caption ?? '')}">`, v.caption);
}

function questionHtml(dir, q, n) {
  const paras = [q.context ?? []].flat().map(p => `<p>${inline(p)}</p>`).join('');
  const visuals = [q.visual ?? []].flat().map(v => visualHtml(dir, v)).join('');
  const type = q.multi ? 'checkbox' : 'radio';
  const choices = (q.choices ?? []).map(c => `
      <div class="marxy-ask-choice" data-choice="${esc(c.id)}">
        <label>
          <input type="${type}" name="q-${esc(q.id)}" value="${esc(c.id)}">
          <span class="marxy-ask-choice-text"><span class="marxy-ask-choice-label">${inline(c.label)}${c.recommended ? ' <span class="marxy-ask-faint">suggested</span>' : ''}</span>${c.detail ? `<span class="marxy-ask-choice-detail">${inline(c.detail)}</span>` : ''}</span>
        </label>
        ${c.image ? `<div class="marxy-ask-choice-image">${picture(dir, c.image, c.label)}</div>` : ''}
        ${c.specify ? `<div class="marxy-ask-specify" hidden><label><span>${inline(c.specify)}</span><textarea rows="2" data-specify="${esc(c.id)}"></textarea></label></div>` : ''}
      </div>`).join('');
  const note = q.note ?? ((q.choices ?? []).length ? 'Anything to add' : 'Your answer');
  return `
  <section class="marxy-ask-q" id="q-${esc(q.id)}" data-q="${esc(q.id)}">
    <div class="marxy-ask-kicker"><span>${n}</span><span>${esc(q.id)}</span>${q.from ? `<span>${inline(q.from)}</span>` : ''}<span class="marxy-ask-state"></span></div>
    <h2>${inline(q.title)}</h2>
    ${paras}${visuals}
    ${choices ? `<fieldset class="marxy-ask-choices"><legend>${q.multi ? 'Pick any' : 'Pick one'}</legend>${choices}</fieldset>` : ''}
    <label class="marxy-ask-note"><span>${inline(note)}</span><textarea rows="${(q.choices ?? []).length ? 2 : 4}" data-note></textarea></label>
    ${q.default ? `<p class="marxy-ask-default">If left unanswered: ${inline(q.default)}</p>` : ''}
  </section>`;
}

/** Reader's own faces, embedded so the page draws the same with nothing beside it; a face that is missing falls back. */
function fontCss() {
  const faces = [
    ['Atkinson Hyperlegible Next', 'fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext[wght].woff2', 'woff2', '200 800'],
    ['Literata', 'fonts/literata/Literata[opsz,wght].ttf', 'truetype', '200 900'],
  ];
  return faces.filter(([, rel]) => existsSync(join(REPO, rel))).map(([family, rel, format, weight]) =>
    `@font-face{font-family:"${family}";src:url(data:font/${format === 'woff2' ? 'woff2' : 'ttf'};base64,${readFileSync(join(REPO, rel)).toString('base64')}) format("${format}");font-weight:${weight};font-style:normal;font-display:block}`,
  ).join('\n');
}

const read = rel => readFileSync(join(HERE, rel), 'utf8');

/**
 * The page for a set. `served` pages save to the command that serves them; a page opened as a file keeps
 * its answers in the browser and offers Copy and Save. `answers` are the ones on disk, to start from.
 */
export function renderPage(set, { dir, name, served = false, answers = null, fonts = true }) {
  const data = { name, served, title: set.title, questions: set.questions.map(q => ({ id: q.id, title: q.title, default: q.default, multi: Boolean(q.multi), choices: (q.choices ?? []).map(c => ({ id: c.id, label: c.label, specify: c.specify })) })), answers };
  // `</` inside the JSON would end the script element early.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const shared = read('ask-answers.mjs').replace(/^export /gm, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(set.title)}</title>
<style>
${fonts ? fontCss() : ''}
${defaultThemeCss()}
${read('ask-page.css')}
</style>
</head>
<body>
<main class="marxy-ask">
  <header class="marxy-ask-head">
    <div class="marxy-ask-kicker"><span>Questions</span><span>${esc(name)}</span><span>${set.questions.length} to answer</span></div>
    <h1>${inline(set.title)}</h1>
    ${set.intro ? `<p>${inline(set.intro)}</p>` : ''}
  </header>
  ${set.questions.map((q, i) => questionHtml(dir, q, i + 1)).join('')}
</main>
<footer class="marxy-ask-foot">
  <span class="marxy-ask-progress"></span>
  <span class="marxy-ask-saved" aria-live="polite"></span>
  <span class="marxy-ask-actions">
    <button type="button" data-act="copy">Copy answers</button>
    ${served ? '<button type="button" data-act="send" class="marxy-ask-primary">Send answers</button>' : '<button type="button" data-act="save" class="marxy-ask-primary">Save answers file</button>'}
  </span>
</footer>
<script type="application/json" id="marxy-ask-data">${json}</script>
<script>
${shared}
${read('ask-page.js')}
</script>
</body>
</html>
`;
}
