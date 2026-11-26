// The image page's arithmetic: fit never enlarges past 100 %; pixels draw square from
// 300 %, a grid shows past 800 % and the pixel readout from 400 %. The page never turns pixels itself (the webview turns a
// JPEG by its EXIF, a decoded PNG comes back upright): an orientation only swaps the sides it is drawn at. Pure.

/** The steps + and − move through. */
export const ZOOMS: readonly number[] = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** The scale that fits `w` × `h` in a stage `stageW` × `stageH`, never above 1: fit does not enlarge. */
export function fitScale(stageW: number, stageH: number, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 1;
  return Math.max(0.01, Math.min(1, stageW / w, stageH / h));
}

/** The next step from `current` in `dir`, or the end of the steps. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOMS.find((z) => z > current + 1e-6) ?? ZOOMS[ZOOMS.length - 1]!;
  return [...ZOOMS].reverse().find((z) => z < current - 1e-6) ?? ZOOMS[0]!;
}

/** Pixels are drawn square (no smoothing) from 300 %. */
export const pixelsSquare = (z: number): boolean => z >= 3 - 1e-6;
/** A grid sits between pixels past 800 %. */
export const gridShown = (z: number): boolean => z > 8 + 1e-6;
/** The bar says the pixel under the pointer from 400 %. */
export const readoutShown = (z: number): boolean => z >= 4 - 1e-6;

export const percent = (z: number): string => `${Math.round(z * 100)} %`;

/** The size an image is shown at: as stored, its sides swapped when its EXIF orientation turns it a quarter. */
export function orientedSize(w: number, h: number, orientation: number): { readonly w: number; readonly h: number } {
  return orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h };
}

/** What an EXIF orientation does to the stored pixels, in the card's words. */
export const ORIENTATION_WORDS: Readonly<Record<number, string>> = {
  1: 'as stored',
  2: 'mirrored',
  3: 'turned 180°',
  4: 'flipped',
  5: 'turned and mirrored',
  6: 'turned 90° clockwise',
  7: 'turned and mirrored',
  8: 'turned 90° anticlockwise',
};
