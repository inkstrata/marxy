// Classifies the desktop CLI smoke: skip only when the machine delivered no frames,
// fail when a machine that can paint did not, and keep required mode a hard fail even
// in the frameless state (MARXY-72). The frames >= 2 assertion (MARXY-13) is never weakened.
// In CI the smoke is required: the `CLI smoke check on the built binary` step runs `verify:cli`
// (`MARXY_SMOKE_REQUIRED=1`) in ci.yml's `rust` job and in nightly.yml's macOS and Linux builds (A-09).

/** The MARXY-13 floor: first_text must be at least this many animation frames after render. */
export const MIN_FRAMES_AFTER_RENDER = 2;

/** Printed on every frameless skip so the next agent does not delete the frames assertion. */
export const FRAME_ASSERTION_NOT_WRONG =
  'Wake the display and re-run — the frame assertion is not what is wrong.';

/** Env var that forces frames=0 at the harness, as if afterPaint() returned without waiting. */
export const NEUTRALISE_AFTER_PAINT = 'MARXY_SMOKE_NEUTRALISE_AFTER_PAINT';

/**
 * Whether this smoke run must fail instead of skip.
 * `MARXY_SMOKE_REQUIRED=1` is required mode: `verify:cli` sets it, and so does CI's
 * `CLI smoke check on the built binary` step. Local `pnpm build` does not.
 */
export function smokeIsRequired(env = process.env) {
  return env.MARXY_SMOKE_REQUIRED === '1';
}

/** Names the environment that delivered no frames, so the skip reason is not a generic "skipped". */
export function framelessEnvironment(platform = process.platform) {
  if (platform === 'darwin') {
    return 'macOS display asleep, dark wake, or a locked screen over ssh';
  }
  if (platform === 'linux') {
    return 'Linux session with no usable display, or a locked screen';
  }
  return `${platform} session that delivers no animation frames`;
}

/**
 * The skip/fail sentence for a machine that rendered the document and then received no frames.
 * `how` is the launch-specific clause (deadline, watchdog, block counts).
 */
export function framelessSkipMessage({ how, environment }) {
  return [
    `this environment delivered no animation frames at all (${environment}).`,
    how,
    'No first_text was printed, which is the correct behaviour here.',
    FRAME_ASSERTION_NOT_WRONG,
  ].join(' ');
}

/** True when MARK painted reported a real wait, not a neutralized afterPaint() that returned frames=0. */
export function paintedFramesOk(frames) {
  return Number.isFinite(frames) && frames >= MIN_FRAMES_AFTER_RENDER;
}

/**
 * Frames reported by the app, or 0 when afterPaint is neutralized at the harness boundary.
 * Neutralization is what a stubbed afterPaint() does: the machine still painted (the line
 * says frames=2) but the wait never happened, so the independent counter did not advance.
 */
export function framesFromPaintedLine(painted, { neutralizeAfterPaint = false } = {}) {
  const reported = Number(/frames=(\d+)/.exec(painted)?.[1] ?? NaN);
  if (neutralizeAfterPaint) return 0;
  return reported;
}

/**
 * Final paint verdict after the other launch checks have passed.
 * `noPaint` means the machine delivered no frames (MARK no_paint or the harness watchdog).
 * A machine that can paint and reports frames below the MARXY-13 floor always fails,
 * including when afterPaint() has been neutralized.
 *
 * @returns {{ status: 'ok' | 'skip' | 'fail', message: string }}
 */
export function paintVerdict({ noPaint, frames, required, how, environment }) {
  if (noPaint) {
    const message = framelessSkipMessage({ how, environment });
    return { status: required ? 'fail' : 'skip', message };
  }
  if (!paintedFramesOk(frames)) {
    return {
      status: 'fail',
      message: `first_text must be at least ${MIN_FRAMES_AFTER_RENDER} animation frames after the render, got frames=${frames}`,
    };
  }
  return { status: 'ok', message: '' };
}

/**
 * Spawn options that put a launch in a process group of its own, so `killLaunch` can end all of it.
 * On Linux a launch is `xvfb-run` → `dbus-run-session` → the app, and the session bus starts
 * xdg-desktop-portal and xdg-document-portal; the document portal FUSE-mounts `$XDG_RUNTIME_DIR/doc`.
 */
export function launchSpawnOptions(platform = process.platform) {
  return platform === 'win32' ? {} : { detached: true };
}

/**
 * Ends a launch and everything it started. Killing only the direct child (`xvfb-run`) orphans the
 * app, its session bus and the document portal, which keeps the FUSE mount: every later launch on
 * that runner then logs `fuse init failed` and starts from a dirtier machine (CI run 37040073668).
 */
export function killLaunch(child, signal = 'SIGKILL') {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * Why a launch that had to be killed did not exit, from its own marks. The app prints `MARK quit
 * code=<n>` just before it leaves, so the two stalls that look alike from outside come apart: one
 * after `quit` is the process teardown, one before it is the webview never asking to quit.
 */
export function stalledExitMessage(lines, waitedMs) {
  const marks = lines.filter(l => l.startsWith('MARK '));
  const last = marks.at(-1)?.split(' ').slice(0, 2).join(' ') ?? '(no mark)';
  const quit = marks.find(l => l.startsWith('MARK quit '));
  return quit
    ? `the launch printed "${quit.split(' ').filter((_, i) => i !== 2).join(' ')}" and was still running ${waitedMs} ms later: the process teardown stalled`
    : `the launch never asked to quit; its last mark was "${last}", and it was still running ${waitedMs} ms later`;
}
