// Acquire the Tauri shell, start the app, and mount the summoned palette.
// let framesObserved and await waitForEnginePaint live in app.ts, not inside waitForEnginePaint(), so that a wait which never actually waited still reports frames=0.
/// <reference types="vite/client" />
import { bootApplication } from './boot.ts';
import { shell } from './shell/tauri.ts';

export { bootApplication, type BootHandle } from './boot.ts';

const harnessPage = typeof window !== 'undefined' && (window.location.pathname.endsWith('app.html') || window.location.pathname.endsWith('palette-boot.html'));
// `vite` serving index.html to a plain browser, or the demo build (`build:demo`): the app over the demo files
// (harness/web.ts). Never in the build Tauri ships, whose mode is `production`.
const browserDev = (import.meta.env.DEV || import.meta.env.MODE === 'demo') && typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);

if (typeof window === 'undefined' || !harnessPage) {
  if (browserDev) void import('./harness/web.ts');
  else void bootApplication(shell);
}
