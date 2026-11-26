// Newsprint (drawn for Marxy): grey stock and press ink; a broadsheet's justified, indented columns under bold sans heads, and a press red.
import type { Look } from '../look.ts';

export const newsprint: Look = { id: 'newsprint', name: 'Newsprint', blurb: 'Grey stock, press ink and justified columns.', group: 'light', day: { l: 0.935, c: 0.006, h: 95 }, night: { l: 0.2, c: 0.004, h: 95 }, ink: 13, inkNight: 11, accent: 25, code: 0.35, face: 'source', headFace: 'inter', sizeFace: 'source', size: 20, lead: 1.46, measure: 56, weight: 400, headWeight: 760, headTracking: -0.02, scale: 1.28, para: 'indent', align: 'justify' };
