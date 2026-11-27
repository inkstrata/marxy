// A large page is painted before the panels read it: the cards walk the whole text (outline, links) for a second or more
// at 2 MB, and first text would wait on them. The frame marks a large document's path once its page has had a frame.
export const PANELS_AFTER_PAINT_BYTES = 1024 * 1024;

const painted = new Set<string>();

export const markPainted = (path: string): void => {
  painted.add(path);
};

/** Whether the panels may read `path`'s document of `bytes` now. */
export const mayRead = (path: string, bytes: number): boolean => bytes < PANELS_AFTER_PAINT_BYTES || painted.has(path);
