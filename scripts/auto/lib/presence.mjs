// Is the owner using this machine? Unattended jobs stand down when so: the owner games and works on these
// computers, and background builds must not take their CPU, memory or attention.
import { execFileSync } from 'node:child_process';

const IDLE_MS = 10 * 60e3;
const FULL_SCREEN = { 2: 'a full-screen app', 3: 'a Direct3D full-screen app', 4: 'presentation mode', 7: 'a full-screen Store app' };
// Wallpaper Engine lives there too and runs all day; it is not play.
const STEAM = /steamapps[\\/]common(?![\\/]wallpaper_engine)/i;
// The Epic launcher lives under \Epic Games\ too and idles in the tray, so it is not a game.
const WIN_GAME = /\\(Epic Games|XboxGames|GOG Galaxy\\Games|Riot Games|Battle\.net)\\/i;
const EPIC_LAUNCHER = /\\Epic Games\\Launcher\\/i;

// One PowerShell call prints "idle <ms>", "state <n>", then every process path. A game played on a controller
// shows no keyboard or mouse input, so the process list and the full-screen state matter as much as idle time.
const WIN_SCRIPT = `Add-Type -Namespace W -Name N -MemberDefinition '
[StructLayout(LayoutKind.Sequential)] struct LII { public uint cb; public uint t; }
[DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
[DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int s);
public static uint Idle() { var i = new LII(); i.cb = 8; GetLastInputInfo(ref i); return unchecked((uint)Environment.TickCount - i.t); }
public static int State() { int s; SHQueryUserNotificationState(out s); return s; }'
"idle $([W.N]::Idle())"
"state $([W.N]::State())"
Get-Process | Where-Object Path | ForEach-Object Path`;

export const parseWindows = (text) => ({
  idleMs: Number(/^idle (\d+)/m.exec(text)?.[1] ?? NaN),
  state: Number(/^state (\d+)/m.exec(text)?.[1] ?? NaN),
  paths: text.split(/\r?\n/).filter((l) => l && !/^(idle|state) \d+$/.test(l)),
});
/** Idle milliseconds from `ioreg -c IOHIDSystem` (HIDIdleTime is nanoseconds). */
export const parseHidIdle = (text) => Number(/"HIDIdleTime"\s*=\s*(\d+)/.exec(text)?.[1] ?? NaN) / 1e6;
/** Idle milliseconds from KDE's GetSessionIdleTime (seconds). */
export const parseIdleSeconds = (text) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) * 1e3 : NaN);
/** The first line that names a running game, or null. */
export function findGame(text, platform) {
  const hit = (l) => STEAM.test(l) || (platform === 'win32' ? WIN_GAME.test(l) && !EPIC_LAUNCHER.test(l) : platform === 'linux' && /SteamLaunch/.test(l));
  return text.split(/\r?\n/).find(hit)?.trim().slice(0, 120) ?? null;
}

const defaultRun = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 });

export function presence({ platform = process.platform, run = defaultRun } = {}) {
  const ask = (cmd, args) => { try { return String(run(cmd, args) ?? ''); } catch { return ''; } };
  const why = [];
  const input = (ms) => { if (ms < IDLE_MS) why.push(`input ${Math.round(ms / 60e3)} min ago`); };
  let games = '';
  if (platform === 'win32') {
    const w = parseWindows(ask('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64')]));
    input(w.idleMs);
    if (FULL_SCREEN[w.state]) why.push(`${FULL_SCREEN[w.state]} is on screen`);
    games = w.paths.join('\n');
  } else if (platform === 'darwin') {
    input(parseHidIdle(ask('ioreg', ['-c', 'IOHIDSystem'])));
    games = ask('ps', ['-axo', 'args']);
  } else if (platform === 'linux') {
    input(parseIdleSeconds(ask('qdbus', ['org.freedesktop.ScreenSaver', '/ScreenSaver', 'GetSessionIdleTime'])));
    games = ask('ps', ['-eo', 'args']);
  }
  const game = findGame(games, platform);
  if (game) why.push(`a game is running: ${game}`);
  return { busy: why.length > 0, why };
}
