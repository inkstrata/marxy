// Acquire the Tauri shell, start the app, and mount the summoned palette (MARXY-87).
// let framesObserved and await waitForEnginePaint live in app.ts, not inside waitForEnginePaint(), so that a wait which never actually waited still reports frames=0.
import { bootApplication } from './boot.ts';
import { shell } from './shell/tauri.ts';

export { bootApplication, type BootHandle } from './boot.ts';

if (typeof window === 'undefined' || (!window.location.pathname.endsWith('app.html') && !window.location.pathname.endsWith('palette-boot.html'))) {
  void bootApplication(shell);
}
