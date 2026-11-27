// The Studio's Page tab: the measure (its rule shown on the canvas
// while the dial is held), paragraphs, alignment and figures.
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { el } from '../frame/dom.ts';
import type { StudioCtx, StudioPiece } from './context.ts';
import { row, segmented } from './dials.ts';
import css from './tabs-tpp.css?inline';
import { lookDial, syncSeg } from './tab-type.ts';

// The app holds the column to 45 to 80 characters; a width of 40 to 96 would show values the page never takes.
const MIN = 45;
const MAX = 80;

export const mountPage: StudioPiece = (host: HTMLElement, ctx: StudioCtx) => {
  adoptRuntimeSheet(document, 'marxy-studio-tpp-style', css);
  let held = false;
  const measure = lookDial(ctx, 'measure', {
    label: 'Measure',
    min: MIN,
    max: MAX,
    step: 1,
    say: (v) => `${v} characters`,
    note: ' ',
    hold: (on, v) => {
      held = on;
      ctx.showMeasure(on ? v : null);
    },
    set: (v) => {
      if (held) ctx.showMeasure(v);
    },
  });
  const measureNote = measure.el.querySelector<HTMLElement>('.marxy-studio-dial-note')!;

  const look0 = ctx.look();
  const PARA = [['space', 'Spaced'], ['indent', 'Indented']] as const;
  const ALIGN = [['left', 'Ragged'], ['justify', 'Justified']] as const;
  const FIGS = [['lining', 'Lining'], ['old', 'Old style']] as const;
  const para = segmented('Paragraphs', PARA, look0.para, (v) => ctx.set('para', v));
  const align = segmented('Alignment', ALIGN, look0.align, (v) => ctx.set('align', v));
  const figs = segmented('Figures', FIGS, look0.figures ?? 'lining', (v) => ctx.set('figures', v));
  const note = (text: string): HTMLElement => el('p', 'marxy-studio-page-note', text);
  const sample = el('span', 'marxy-studio-page-figs', '1984 · 3,750');

  const mCol = el('div', 'marxy-studio-col marxy-studio-page-measure');
  mCol.append(el('div', 'marxy-studio-h', 'Line'), measure.el);
  const pCol = el('div', 'marxy-studio-col marxy-studio-page-col');
  pCol.append(el('div', 'marxy-studio-h', 'Paragraphs'), row('New paragraph', para), note('Indents mark a new paragraph the way books do; spaced paragraphs suit working documents.'));
  const aCol = el('div', 'marxy-studio-col marxy-studio-page-col');
  aCol.append(el('div', 'marxy-studio-h', 'Alignment'), row('Lines', align), note(`Justified lines, with hyphens, only at ${MIN} characters or more; shorter lines stay ragged.`));
  const fCol = el('div', 'marxy-studio-col marxy-studio-page-col');
  fCol.append(el('div', 'marxy-studio-h', 'Figures'), row('Numbers', figs), row('As set', sample), note('Old style applies to articles only; working documents keep lining figures.'));
  host.append(mCol, pCol, aCol, fCol);

  const sync = (): void => {
    const look = ctx.look();
    const res = ctx.resolved();
    measure.sync(look);
    const f = res.facts;
    measureNote.textContent = !f.chars
      ? 'This kind of text runs to the edge; the measure is for prose.'
      : f.chars !== look.measure
        ? `This page shows ${f.chars}: ${res.why.some((w) => w.rule === 'lean') ? 'leaning back keeps lines short' : res.why.some((w) => w.rule === 'working') ? 'a working document gets a wider measure' : 'a rule adapts it'}.`
        : `Counted from the face, not ch; ${MIN} to ${MAX}. You can also drag the edge of the page.`;
    syncSeg(para, PARA.map(([v]) => v), look.para);
    syncSeg(align, ALIGN.map(([v]) => v), look.align);
    syncSeg(figs, FIGS.map(([v]) => v), look.figures ?? 'lining');
    sample.style.fontVariantNumeric = (look.figures ?? 'lining') === 'old' ? 'oldstyle-nums' : 'lining-nums';
  };
  sync();
  const off = ctx.onPaint(sync);
  return () => {
    off();
    if (held) ctx.showMeasure(null);
  };
};
