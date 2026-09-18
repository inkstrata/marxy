// Named checks for MARXY-72: frameless skip, CI requiredness, afterPaint neutralization,
// hand-reachable required mode, and the definition-of-done skip table in docs/sdlc.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FRAME_ASSERTION_NOT_WRONG,
  MIN_FRAMES_AFTER_RENDER,
  desktopBuildStepFromWorkflow,
  framelessEnvironment,
  paintVerdict,
  paintedFramesOk,
  smokeIsRequired,
  workflowDesktopBuildIsRequired,
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

test('CI desktop build requires smoke on both runner classes without continue-on-error', () => {
  const yaml = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const step = desktopBuildStepFromWorkflow(yaml);
  assert.ok(step, 'workflow must have a Build desktop app step');
  const result = workflowDesktopBuildIsRequired(yaml);
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(
    smokeIsRequired({ GITHUB_ACTIONS: 'true', npm_lifecycle_event: 'build' }),
    true,
    'GITHUB_ACTIONS + the desktop build lifecycle is the equivalent of MARXY_SMOKE_REQUIRED=1',
  );
  assert.equal(
    smokeIsRequired({ GITHUB_ACTIONS: 'true', npm_lifecycle_event: 'test' }),
    false,
    'CI test must not require smoke: it runs before the binary exists',
  );
  assert.equal(/continue-on-error/.test(step), false);
  assert.equal(/\|\|\s*true/.test(step), false);
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

  assert.equal(MIN_FRAMES_AFTER_RENDER, 2);
  assert.equal(paintedFramesOk(0), false);
  assert.equal(paintedFramesOk(1), false);
  assert.equal(paintedFramesOk(2), true);

  const verdict = paintVerdict({
    noPaint: false,
    frames: 0,
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
  assert.match(sdlc, /frame assertion is not what is wrong/);
  assert.match(sdlc, /unit tests never skip/i);
});
