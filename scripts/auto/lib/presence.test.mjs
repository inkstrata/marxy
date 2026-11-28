import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPresence, presence, parseWindows, parseHidIdle, parseKdeIdle, findGame } from './presence.mjs';

const WIN_IDLE = (ms, state = 1, paths = ['C:\\Windows\\explorer.exe']) => `idle ${ms}\r\nstate ${state}\r\n${paths.join('\r\n')}\r\n`;

test('windows output parses into idle, state and paths', () => {
  assert.deepEqual(parseWindows(WIN_IDLE(5000, 3, ['C:\\a.exe'])), { idleMs: 5000, state: 3, paths: ['C:\\a.exe'] });
  assert.ok(Number.isNaN(parseWindows('').idleMs));
});

test('macOS and KDE idle times', () => {
  assert.equal(parseHidIdle('    | |   "HIDIdleTime" = 120000000000\n'), 120000);
  assert.ok(Number.isNaN(parseHidIdle('nothing')));
  assert.equal(parseKdeIdle('42\n'), 42000);
  assert.equal(parseKdeIdle('1800000\n'), 1800000, 'over a million is milliseconds');
  assert.ok(Number.isNaN(parseKdeIdle('')));
});

test('games are found by path or launcher', () => {
  assert.ok(findGame('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\Hades.exe', 'win32'));
  assert.ok(findGame('/home/deck/.steam/steamapps/common/Hades/hades', 'linux'));
  assert.ok(findGame('D:\\Epic Games\\Fortnite\\FortniteClient.exe', 'win32'));
  assert.ok(findGame('C:\\XboxGames\\Halo\\Content\\halo.exe', 'win32'));
  assert.ok(findGame('/usr/bin/reaper SteamLaunch AppId=1', 'linux'));
  assert.equal(findGame('/usr/bin/reaper SteamLaunch AppId=1', 'darwin'), null);
  assert.equal(findGame('C:\\Riot Games\\Riot Client\\RiotClientServices.exe', 'win32'), null);
  assert.ok(findGame('C:\\Riot Games\\VALORANT\\live\\VALORANT.exe', 'win32'));
  assert.equal(findGame('C:\\Program Files (x86)\\Battle.net\\Battle.net.exe', 'win32'), null);
  assert.equal(findGame('C:\\Program Files\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe', 'win32'), null);
  assert.equal(findGame('C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe', 'win32'), null);
  assert.equal(findGame('C:\\Windows\\explorer.exe', 'win32'), null);
});

const win = (out) => presence({ platform: 'win32', run: () => out });

test('windows: recent input, full screen and games each make it busy', () => {
  assert.deepEqual(win(WIN_IDLE(11 * 60e3)), { busy: false, why: [] });
  assert.match(win(WIN_IDLE(2 * 60e3)).why[0], /input 2 min ago/);
  assert.match(win(WIN_IDLE(11 * 60e3, 3)).why[0], /Direct3D/);
  for (const s of [2, 3, 4, 7]) assert.equal(win(WIN_IDLE(11 * 60e3, s)).busy, true);
  for (const s of [1, 5, 6]) assert.equal(win(WIN_IDLE(11 * 60e3, s)).busy, false);
  assert.match(win(WIN_IDLE(11 * 60e3, 1, ['D:\\SteamLibrary\\steamapps\\common\\X\\x.exe'])).why[0], /game is running/);
});

test('macOS and Linux read idle time and the process list', () => {
  const mac = (idle, ps = '') => presence({ platform: 'darwin', run: (c) => (c === 'ioreg' ? `"HIDIdleTime" = ${idle}` : ps) });
  assert.equal(mac(11 * 60e9).busy, false);
  assert.equal(mac(30e9).busy, true);
  assert.equal(mac(11 * 60e9, '/Users/o/Library/Steam/steamapps/common/G/g').busy, true);
  const linux = (idle, ps = '') => presence({ platform: 'linux', run: (c) => (c === 'qdbus' ? idle : c === 'qdbus6' ? '' : ps) });
  const plasma6 = presence({ platform: 'linux', run: (c) => { if (c === 'qdbus6') return '3\n'; throw new Error('no qdbus'); } });
  assert.equal(plasma6.busy, true, 'qdbus6 answers when qdbus is missing');
  assert.equal(linux('900\n').busy, false);
  assert.equal(linux('5\n').busy, true);
  assert.equal(linux('', 'reaper SteamLaunch AppId=2').busy, true);
});

test('a failing probe is no signal', () => {
  assert.deepEqual(presence({ platform: 'linux', run: () => { throw new Error('missing'); } }), { busy: false, why: [] });
  assert.deepEqual(presence({ platform: 'win32', run: () => { throw new Error('timeout'); } }), { busy: false, why: [] });
});

test('withPresence: busy stops work, except in the final sweep where it goes light', () => {
  const busy = { busy: true, why: ['input 1 min ago'] };
  const idle = { busy: false, why: [] };
  const normal = { allowed: true, reason: 'ok' };
  const final = { allowed: true, reason: 'final sweep', finalSweep: true };
  assert.equal(withPresence(normal, idle, 'night'), normal);
  const stopped = withPresence(normal, busy, 'night');
  assert.deepEqual([stopped.allowed, stopped.reason], [false, 'owner is using this machine: input 1 min ago']);
  const light = withPresence(final, busy, 'night');
  assert.deepEqual([light.allowed, light.lightOnly, light.presence], [true, true, busy]);
  assert.equal(withPresence(final, busy, 'research-now'), final, 'research is light, presence is ignored');
  assert.equal(withPresence({ ...final, allowed: false }, busy, 'night').allowed, false, 'a refusal stays a refusal');
  assert.equal(withPresence(final, idle, 'night').lightOnly, undefined);
});
