// Scratch: an absolutely placed top-level box at the end of the article (the margin-note shape) holding a candidate,
// sitting on the screen; and adopt after the kill switch flipped with the background finished.
import { startHarness } from 'file:///C:/Dev/reader/worktrees/typeset-waste/packages/typeset/test/harness.mjs';

const label = process.argv[2] ?? '?';
const P = (i) => `<p data-marxy-s="${i}">Paragraph ${i} is long enough to wrap over several lines, with words in it that the line breaker has real choices about, and a few more so it does wrap.</p>`;
const body = Array.from({ length: 120 }, (_, i) => P(i)).join('');
const h = await startHarness();
const out = {};
for (const at of [0, 3000, 6000, 'end']) {
  const page = await h.open(body + `<div class="note" style="position:absolute;right:0;width:200px">${P(900)}</div>`, { height: 600 });
  out[at] = await page.evaluate(async (at) => {
    const doc = document.getElementById('doc');
    doc.style.position = 'relative';
    const y = at === 'end' ? doc.scrollHeight : at;
    window.scrollTo(0, y);
    const note = doc.querySelector('.note');
    note.style.top = `${window.scrollY - (doc.getBoundingClientRect().top + window.scrollY) + 100}px`;
    const c = window.typeset.attach(doc, { lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: () => {} } });
    await c.ready;
    const r = note.getBoundingClientRect();
    return { noteOnScreen: r.top < innerHeight && r.bottom > 0, noteSet: note.firstElementChild.classList.contains('marxy-set') };
  }, at);
  await page.close();
}
const page = await h.open(body, { height: 600 });
out.killedAdopt = await page.evaluate(async () => {
  const doc = document.getElementById('doc');
  const queued = [];
  const c = window.typeset.attach(doc, { lineBox: window.lineBox, glueStretchEm: 0.6, hyphenate: false, lastLineMinWidth: 0.33, hanging: 'none', scheduler: { schedule: (w) => queued.push(w) } });
  await c.ready;
  while (queued.length) queued.shift()(() => Number.POSITIVE_INFINITY);
  await c.done;
  const before = doc.querySelectorAll('.marxy-set').length;
  doc.style.setProperty('--marxy-typeset', 'none');
  const extra = document.createElement('p');
  extra.setAttribute('data-marxy-s', '999');
  extra.textContent = 'An added paragraph.';
  doc.append(extra);
  c.adopt([extra]);
  const queuedAfterAdopt = queued.length;
  while (queued.length) queued.shift()(() => Number.POSITIVE_INFINITY);
  return { before, queuedAfterAdopt, after: doc.querySelectorAll('.marxy-set').length };
});
await h.close();
console.log(label, JSON.stringify(out));
