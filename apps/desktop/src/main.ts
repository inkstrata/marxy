// Acquire the Tauri shell and start the app. Startup itself lives in app.ts (MARXY-95).
// let framesObserved and await waitForEnginePaint live there,
// not inside waitForEnginePaint(), so that a wait which never actually waited still
// reports frames=0. The live mark is await shell.mark('first_text', paintedAt);
// the painted line still carries frames=${frames} signal=${signal}.
import { startApp } from './app.ts';
import { shell } from './shell/tauri.ts';

void startApp(shell);
