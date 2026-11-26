// Dim: the readers' gray. Firefox's light gray page (#d7d7db) by day; by night the dark gray Safari and Instapaper call Gray, held out of the band where no ink reaches 7 : 1.
import type { Look } from '../look.ts';

export const dim: Look = { id: 'dim', name: 'Dim', blurb: 'The readers’ gray: low glare by day, dark gray by night.', group: 'light', day: { l: 0.88, c: 0.005, h: 286 }, night: { l: 0.33, c: 0.006, h: 270 }, ink: 11, inkNight: 7.6, accent: 245, code: 0.45, face: 'literata', sizeFace: 'literata', size: 20, lead: 1.52, measure: 66, weight: 400, headWeight: 600, scale: 1.25, para: 'space', align: 'left' };
