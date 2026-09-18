// Named checks for MARXY-72: frameless skip, CI requiredness, afterPaint neutralization,
// hand-reachable required mode, and the definition-of-done skip table in docs/sdlc.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FRAME_ASSERTION_NOT_WRONG,
  MIN_FRAMES_AFTER_RENDER,
  NEUTRALISE_AFTER_PAINT,
  cliSmokeStepFromWorkflow,
  framelessEnvironment,
  framesFromPaintedLine,
  paintVerdict,
  paintedFramesOk,
  smokeIsRequired,
  workflowCliSmokeIsRequired,
} from './smoke-verdict.mjs';

const repoRoot = new URL('../../../', import.meta.url).pathname;

const framelessHow = 'The app rendered the document (21 blocks, 919 chars), then the app reported MARK no_paint and exited 1.';

test('frameless optional smoke skips, names the environment, and says the frame assertion is not what is wrong', () => {
  assert.equal(smokeIsRequired({}), false);
  const environment = framelessEnvironment('darwin');
  const verdict = paintVerdict({
    noPaint: true,
    frames: Number.NaN,
    required: false,
    how: framelessHow,
    environment,
  });
  assert.equal(verdict.status, 'skip');
  assert.match(verdict.message, /macOS display asleep, dark wake, or a locked screen over ssh/);
  assert.match(verdict.message, new RegExp(FRAME_ASSERTION_NOT_WRONG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8'));
  assert.equal(
    /MARXY_SMOKE_REQUIRED=1/.test(pkg.scripts.build),
    false,
    'desktop build must not hardcode MARXY_SMOKE_REQUIRED=1; that is what fails a sleeping laptop',
  );
});

test('CI verify:cli requires smoke on both runner classes without continue-on-error', () => {
  const yaml = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const step = cliSmokeStepFromWorkflow(yaml);
  assert.ok(step, 'workflow must have a CLI smoke check on the built binary step');
  const result = workflowCliSmokeIsRequired(yaml);
  assert.equal(result.ok, true, result.reasons.join('; '));
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8'));
  assert.match(
    pkg.scripts['verify:cli'],
    /MARXY_SMOKE_REQUIRED=1/,
    'verify:cli is how CI requires the smoke; the workflow must not rely on a build-lifecycle equivalent',
  );
  assert.equal(
    smokeIsRequired({ GITHUB_ACTIONS: 'true', npm_lifecycle_event: 'build' }),
    false,
    'GITHUB_ACTIONS + the desktop build lifecycle is not requiredness; CI runs verify:cli instead',
  );
  assert.equal(/continue-on-error/.test(step), false);
  assert.equal(/\|\|\s*true/.test(step), false);
  assert.match(yaml, /macos-latest/);
  assert.match(yaml, /ubuntu-latest/);
});

test('afterPaint neutralised on a machine that delivers frames still fails the smoke', () => {
  const main = readFileSync(join(repoRoot, 'apps/desktop/src/main.ts'), 'utf8');
  const framesObserved = main.indexOf('let framesObserved');
  const afterPaint = main.indexOf('function afterPaint(');
  assert.ok(framesObserved >= 0, 'the independent frame counter must still exist');
  assert.ok(afterPaint >= 0, 'afterPaint() must still exist');
  assert.ok(
    framesObserved < afterPaint,
    'the frame counter lives outside afterPaint(), so neutralizing afterPaint reports frames=0',
  );
  assert.match(main, /neutralising afterPaint\(\) reports frames=0/);

  // A machine that painted: the app printed frames=2. Neutralizing afterPaint at the
  // harness boundary is what a stubbed afterPaint() does — the wait never happened.
  const painted = 'MARK painted frames=2 since_render_ms=29';
  assert.equal(framesFromPaintedLine(painted), 2);
  const frames = framesFromPaintedLine(painted, { neutralizeAfterPaint: true });
  assert.equal(frames, 0);
  assert.equal(MIN_FRAMES_AFTER_RENDER, 2);
  assert.equal(paintedFramesOk(frames), false);

  const verdict = paintVerdict({
    noPaint: false,
    frames,
    required: false,
    how: '',
    environment: framelessEnvironment('darwin'),
  });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.message, /frames=0/);
  assert.equal(
    verdict.message.includes(FRAME_ASSERTION_NOT_WRONG),
    false,
    'a neutralized afterPaint is a real defect, not a frameless skip',
  );

  // Run the smoke harness itself with neutralization forced, so this is not only a helper call.
  const run = spawnSync(process.execPath, [join(repoRoot, 'apps/desktop/scripts/smoke-cli-open.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, [NEUTRALISE_AFTER_PAINT]: '1', MARXY_SMOKE_REQUIRED: '' },
    encoding: 'utf8',
  });
  if (/no release binary/.test(run.stdout + run.stderr)) {
    // pnpm test in CI runs before the binary exists; the harness self-check below still runs.
    const self = spawnSync(
      process.execPath,
      [join(repoRoot, 'apps/desktop/scripts/smoke-cli-open.mjs'), '--selftest-neutralise-after-paint'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.notEqual(self.status, 0, self.stdout + self.stderr);
    assert.match(self.stderr + self.stdout, /frames=0/);
    assert.equal(
      (self.stderr + self.stdout).includes(FRAME_ASSERTION_NOT_WRONG),
      false,
    );
    return;
  }
  assert.notEqual(run.status, 0, `neutralized afterPaint must fail the smoke, got exit ${run.status}\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr + run.stdout, /frames=0/);
  assert.equal(
    (run.stderr + run.stdout).includes(FRAME_ASSERTION_NOT_WRONG),
    false,
    'a neutralized afterPaint is a real defect, not a frameless skip',
  );
});

test('MARXY_SMOKE_REQUIRED=1 fails in the frameless state', () => {
  assert.equal(smokeIsRequired({ MARXY_SMOKE_REQUIRED: '1' }), true);
  const environment = framelessEnvironment('darwin');
  const verdict = paintVerdict({
    noPaint: true,
    frames: Number.NaN,
    required: true,
    how: framelessHow,
    environment,
  });
  assert.equal(verdict.status, 'fail');
  assert.match(verdict.message, new RegExp(environment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8'));
  assert.match(
    pkg.scripts['verify:cli'],
    /MARXY_SMOKE_REQUIRED=1/,
    'verify:cli is the hand-reachable required mode',
  );
});

test('docs/sdlc.md states which definition-of-done commands may skip', () => {
  const sdlc = readFileSync(join(repoRoot, 'docs/sdlc.md'), 'utf8');
  for (const command of ['pnpm build', 'pnpm typecheck', 'pnpm lint', 'pnpm test']) {
    assert.match(sdlc, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(sdlc, /pnpm typecheck[^\n]*never skip/i);
  assert.match(sdlc, /pnpm lint[^\n]*never skip/i);
  assert.match(sdlc, /animation frames/i);
  assert.match(sdlc, /MARXY_SMOKE_REQUIRED=1/);
  assert.match(sdlc, /verify:cli/);
  assert.match(sdlc, /frame assertion is not what is wrong/);
  assert.match(sdlc, /unit tests never skip/i);
  assert.equal(
    /GITHUB_ACTIONS[^\n]*build[^\n]*lifecycle/.test(sdlc),
    false,
    'skip table must not describe CI as a build-lifecycle equivalent; CI runs verify:cli',
  );
  assert.match(sdlc, /merge-bar\.mjs/);
  assert.match(sdlc, /## Credentials/);
});
