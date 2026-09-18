// Classifies the desktop CLI smoke: skip only when the machine delivered no frames,
// fail when a machine that can paint did not, and keep required mode a hard fail even
// in the frameless state (MARXY-72). The frames >= 2 assertion (MARXY-13) is never weakened.
// `.github/workflows/ci.yml` is outside this story's paths; CI requiredness is the equivalent
// of MARXY_SMOKE_REQUIRED=1 when GitHub Actions runs the desktop `build` lifecycle.

/** The MARXY-13 floor: first_text must be at least this many animation frames after render. */
export const MIN_FRAMES_AFTER_RENDER = 2;

/** Printed on every frameless skip so the next agent does not delete the frames assertion. */
export const FRAME_ASSERTION_NOT_WRONG =
  'Wake the display and re-run — the frame assertion is not what is wrong.';

/**
 * Whether this smoke run must fail instead of skip.
 * `MARXY_SMOKE_REQUIRED=1` is the hand-reachable required mode (`verify:cli` and a forced build).
 * GitHub Actions always sets `GITHUB_ACTIONS=true`; the desktop `build` script is what CI
 * runs (`pnpm --filter @marxy/desktop build`). `pnpm test` also launches this harness, but
 * before the binary exists, so only the build lifecycle is required there.
 */
export function smokeIsRequired(env = process.env) {
  if (env.MARXY_SMOKE_REQUIRED === '1') return true;
  return env.GITHUB_ACTIONS === 'true' && env.npm_lifecycle_event === 'build';
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

const BUILD_STEP_NAME = 'Build desktop app';

/** The named CI step that builds the desktop app, or null if the workflow has no such step. */
export function desktopBuildStepFromWorkflow(yaml) {
  const start = yaml.search(/^[ \t]*- name:[ \t]*Build desktop app[ \t]*$/m);
  if (start < 0) return null;
  const rest = yaml.slice(start);
  const firstNewline = rest.indexOf('\n');
  const afterFirstLine = firstNewline < 0 ? '' : rest.slice(firstNewline + 1);
  const next = afterFirstLine.search(/^[ \t]*- name:/m);
  return next < 0 ? rest : rest.slice(0, firstNewline + 1 + next);
}

/**
 * Both GitHub-hosted runner classes must run the desktop build, and that step must not
 * be softened with continue-on-error or `|| true`.
 */
export function workflowDesktopBuildIsRequired(yaml) {
  const reasons = [];
  if (!/\bmacos-latest\b/.test(yaml)) reasons.push('workflow is missing macos-latest');
  if (!/\bubuntu-latest\b/.test(yaml)) reasons.push('workflow is missing ubuntu-latest');
  const step = desktopBuildStepFromWorkflow(yaml);
  if (!step) {
    reasons.push(`workflow has no "${BUILD_STEP_NAME}" step`);
    return { ok: false, reasons };
  }
  if (!/pnpm --filter @marxy\/desktop build/.test(step)) {
    reasons.push('Build desktop app does not run pnpm --filter @marxy/desktop build');
  }
  if (/continue-on-error/.test(step)) {
    reasons.push('Build desktop app sets continue-on-error');
  }
  if (/\|\|\s*true/.test(step)) {
    reasons.push('Build desktop app uses || true');
  }
  if (/^[ \t]*if:/m.test(step)) {
    reasons.push('Build desktop app is gated by if: and may skip a runner class');
  }
  const setsRequired = /MARXY_SMOKE_REQUIRED:\s*['"]?1['"]?/.test(step)
    || /MARXY_SMOKE_REQUIRED=1/.test(step);
  const equivalent = smokeIsRequired({ GITHUB_ACTIONS: 'true', npm_lifecycle_event: 'build' });
  if (!setsRequired && !equivalent) {
    reasons.push('Build desktop app neither sets MARXY_SMOKE_REQUIRED=1 nor has an equivalent required mode');
  }
  return { ok: reasons.length === 0, reasons, setsRequired, equivalent };
}
