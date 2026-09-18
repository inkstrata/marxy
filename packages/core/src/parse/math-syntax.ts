// Syntax half of micromark-extension-math. The package root also re-exports HTML that imports katex
// (4.3 MB, tens of ms cold); marxy never renders maths through it (MARXY-60).
export { math } from '../../node_modules/micromark-extension-math/lib/syntax.js';
