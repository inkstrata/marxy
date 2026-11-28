// Is the owner using this machine? Unattended jobs stand down when so: the owner games and works on these
// computers, and background builds must not take their CPU, memory or attention.
import { execFileSync } from 'node:child_process';

const IDLE_MS = 10 * 60e3;
const FULL_SCREEN = { 2: 'a full-screen app', 3: 'a Direct3D full-screen app', 4: 'presentation mode', 7: 'a full-screen Store app' };
// Wallpaper Engine lives there too and runs all day; it is not play.
const STEAM = /steamapps[\\/]common(?![\\/]wallpaper_engine)/i;
// The Epic launcher and the Riot client live under those folders too and idle in the tray, so they are not games.
// Battle.net is left out: its launcher idles all day and its games install elsewhere.
const WIN_GAME = /\\(Epic Games|XboxGames|GOG Galaxy\\Games|Riot Games)\\/i;
const LAUNCHER = /\\(Epic Games\\Launcher|Riot Games\\Riot Client)\\/i;

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
/**
 * Idle milliseconds from KDE's GetSessionIdleTime, or NaN when the answer cannot be classified. Its unit is unverified
 * on Set (the freedesktop interface says seconds; KDE may answer milliseconds), so a reading counts only when both
 * units agree on which side of 10 minutes it falls: under 600 is recent input either way, 600,000 or more is idle
 * either way. Anything between could be input a second ago or an hour of idleness, so it is unknown, and unknown
 * reads as busy: guessing "away" would start heavy work under the owner's hands.
 */
export const parseKdeIdle = (text) => {
  const t = String(text ?? '').trim();
  if (!/^\d+$/.test(t)) return NaN;
  const n = Number(t);
  if (n < IDLE_MS / 1e3) return n * 1e3;
  return n >= IDLE_MS ? n : NaN;
};
/** The first line that names a running game, or null. */
export function findGame(text, platform) {
  const hit = (l) => STEAM.test(l) || (platform === 'win32' ? WIN_GAME.test(l) && !LAUNCHER.test(l) : platform === 'linux' && /SteamLaunch/.test(l));
  return text.split(/\r?\n/).find(hit)?.trim().slice(0, 120) ?? null;
}

const defaultRun = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 });

/**
 * Fails closed. A probe whose command is not on this system (qdbus on a machine without KDE) is no signal. A probe
 * that runs but errors, times out or answers something unreadable makes the owner busy: a loaded gaming machine is
 * exactly where a probe times out, and reading that as "away" would start builds under the owner's game.
 */
export function presence({ platform = process.platform, run = defaultRun } = {}) {
  const MISSING = Symbol('missing');
  const ask = (cmd, args) => {
    try { return String(run(cmd, args) ?? ''); } catch (e) { return e?.code === 'ENOENT' ? MISSING : null; }
  };
  const why = [];
  const unknown = (probe) => why.push(`presence unknown: ${probe}`);
  const input = (ms) => { if (ms < IDLE_MS) why.push(`input ${Math.round(ms / 60e3)} min ago`); };
  const processes = (args) => { const out = ask('ps', args); if (out === null) unknown('ps'); return typeof out === 'string' ? out : ''; };
  let games = '';
  if (platform === 'win32') {
    const out = ask('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WIN_SCRIPT, 'utf16le').toString('base64')]);
    const w = typeof out === 'string' ? parseWindows(out) : null;
    if (out === MISSING) { /* no PowerShell: no signal */ } else if (!w || Number.isNaN(w.idleMs) || Number.isNaN(w.state)) unknown('powershell');
    else {
      input(w.idleMs);
      if (FULL_SCREEN[w.state]) why.push(`${FULL_SCREEN[w.state]} is on screen`);
      games = w.paths.join('\n');
    }
  } else if (platform === 'darwin') {
    const out = ask('ioreg', ['-c', 'IOHIDSystem']);
    const idle = typeof out === 'string' ? parseHidIdle(out) : NaN;
    if (out !== MISSING) { if (Number.isNaN(idle)) unknown('ioreg'); else input(idle); }
    games = processes(['-axo', 'args']);
  } else if (platform === 'linux') {
    // Plasma 6 ships qdbus6; try both and take the first that answers. Unknown only when one ran and none answered.
    const args = ['org.freedesktop.ScreenSaver', '/ScreenSaver', 'GetSessionIdleTime'];
    const answers = ['qdbus', 'qdbus6'].map((c) => ({ c, out: ask(c, args) })).filter((a) => a.out !== MISSING);
    const idle = answers.map((a) => (a.out === null ? NaN : parseKdeIdle(a.out))).find((n) => !Number.isNaN(n));
    if (idle !== undefined) input(idle);
    else if (answers.length) unknown(`${answers[0].c} idle time`);
    games = processes(['-eo', 'args']);
  }
  const game = findGame(games, platform);
  if (game) why.push(`a game is running: ${game}`);
  return { busy: why.length > 0, why };
}
