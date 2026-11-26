// Book: cream stock, indents, justified lines, italic heads and old-style figures.
import type { Look } from '../look.ts';

export const book: Look = { id: 'book', name: 'Book', blurb: 'Cream stock, indents and justified lines.', group: 'light', day: { l: 0.962, c: 0.024, h: 88 }, night: { l: 0.185, c: 0.012, h: 75 }, ink: 12.5, inkNight: 10.5, accent: 32, code: 0.3, face: 'palatino', size: 21, lead: 1.46, measure: 60, weight: 400, headWeight: 500, scale: 1.2, para: 'indent', align: 'justify', headStyle: 'italic', figures: 'old' };
