// The average character advance of a face (ADR-0033, H-06): the mean width of one character of English
// prose, in em. `--marxy-avg-char` is this number; the measure is counted in these, never in `ch`.
// Pure: the caller supplies the advances (a canvas in the app, `hmtx` at build time), so the same
// sample and the same mean serve both and the two can be checked against each other.

/**
 * The fixed sample every measurement uses: the opening of Jane Austen's "Pride and Prejudice" (1813,
 * public domain), about 900 characters of ordinary English prose. Letters, spaces and punctuation fall in
 * the proportions of real running text, so the mean is the advance a reader's line actually averages,
 * not that of an alphabet. Changing one character changes every measured number: change it with the
 * measure-face and cross-check tests, and with the themes' declared values.
 */
export const MEASURE_SAMPLE =
  'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. ' +
  'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters. ' +
  '"My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?" ' +
  'Mr. Bennet replied that he had not. ' +
  '"But it is," returned she; "for Mrs. Long has just been here, and she told me all about it." ' +
  'Mr. Bennet made no answer. ' +
  '"Do you not want to know who has taken it?" cried his wife impatiently. ' +
  '"You want to tell me, and I have no objection to hearing it." ' +
  'This was invitation enough.';

/** The mean of `advanceOf` over the code points of `text`, in em. 0 for an empty text. */
export function averageAdvance(text: string, advanceOf: (character: string) => number): number {
  let sum = 0;
  let count = 0;
  for (const character of text) {
    sum += advanceOf(character);
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

/** The mean advance, in em, from the width of the whole `text` set at `sizePx`: a measured run's total over its length. */
export function averageAdvanceOfRun(widthPx: number, sizePx: number, text: string): number {
  const count = [...text].length;
  return count === 0 || sizePx <= 0 ? 0 : widthPx / sizePx / count;
}
