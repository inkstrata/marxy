export interface MermaidResult {
  readonly ok: boolean;
  readonly kind: string;
  readonly svg: string | null;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  /** Why it was not drawn, or what was left out; '' when there is nothing to say. */
  readonly note: string;
}

export interface MermaidOptions {
  /** The width of `text` set at `px` in `weight`; the renderer's own estimate is used when absent or it throws. */
  readonly measure?: (text: string, px: number, weight?: string | number) => number;
  readonly fontPx?: number;
  /** Prefix for the ids inside the SVG, so two diagrams on a page never share one. */
  readonly idPrefix?: string;
}

export function render(src: string, opts?: MermaidOptions): MermaidResult;
