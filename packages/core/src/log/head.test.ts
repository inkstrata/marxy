// The shapes of a log line's head: one line from each writer, where its time and its level sit, and its rank.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logHead, logHeadParts, logRankOf, logStamp } from './head.ts';
import { detectKind } from '../kind/detect.ts';
import { cpuNow } from '../testing/cpu-clock.ts';
import { highlight, LOG_INLINE_CLASS, LOG_LEVEL_CLASS, LOG_SPACE_CLASS, LOG_TIME_CLASS } from '../highlight/grammar.ts';

/** `line`'s time and level as the text they cover, and its rank. */
function read(line: string): { time: string | null; level: string | null; rank: number } | null {
  const head = logHead(line);
  if (head === null) return null;
  return {
    time: head.time ? line.slice(head.time[0], head.time[1]) : null,
    level: head.level ? line.slice(head.level[0], head.level[1]) : null,
    rank: head.rank,
  };
}

const SAMPLES: readonly (readonly [string, string, { time: string | null; level: string | null; rank: number }])[] = [
  ['Windows CBS', '2024-01-15 10:23:45, Info                  CBS    Starting TrustedInstaller initialization.', { time: '2024-01-15 10:23:45', level: 'Info', rank: 1 }],
  ['Windows CBS', '2024-01-15 10:23:46, Error                 CSI    00000007 (F) Hydration failed', { time: '2024-01-15 10:23:46', level: 'Error', rank: 3 }],
  ['Windows DISM', '2024-01-15 10:24:02, Warning               DISM   DISM Provider Store: PID=4120 Failed to load the provider', { time: '2024-01-15 10:24:02', level: 'Warning', rank: 2 }],
  ['WindowsUpdate.log, Windows 7 to 8.1', '2015-10-07\t09:25:05:497\t 920\tb3c\tAU\t###########  AU: Initializing Automatic Updates  ###########', { time: '2015-10-07\t09:25:05:497', level: null, rank: 1 }],
  ['WindowsUpdate.log, Windows 7 to 8.1', '2015-10-07\t09:25:05:518\t 920\tb3c\tAgent\tWARNING: Failed to evaluate Installed rule', { time: '2015-10-07\t09:25:05:518', level: 'WARNING', rank: 2 }],
  ['WindowsUpdate.log, decoded', '2017/09/07 15:04:47.7929823 1020  6332  Agent           FATAL: Search failed, hr = 0x80240022', { time: '2017/09/07 15:04:47.7929823', level: 'FATAL', rank: 3 }],
  ['IIS W3C', '2024-01-15 10:23:45 10.0.0.5 GET /default.htm - 443 - 192.168.1.20 Mozilla/5.0+(Windows+NT+10.0) https://example.com/ 404 0 2 15', { time: '2024-01-15 10:23:45', level: '404', rank: 2 }],
  ['syslog, RFC 3164', "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick on /dev/pts/8", { time: 'Oct 11 22:14:15', level: '<34>', rank: 3 }],
  ['syslog, as a file', 'Oct  1 06:25:01 deploy-box CRON[2213]: (root) CMD (test -x /usr/sbin/anacron)', { time: 'Oct  1 06:25:01', level: null, rank: 1 }],
  ['syslog, rsyslog high precision', '2024-01-15T10:23:45.123456+00:00 deploy-box systemd[1]: Started Daily apt download activities.', { time: '2024-01-15T10:23:45.123456+00:00', level: null, rank: 1 }],
  ['syslog, RFC 5424', '<165>1 2003-10-11T22:14:15.003Z mymachine.example.com evntslog - ID47 [exampleSDID@32473 iut="3"] An application event', { time: '2003-10-11T22:14:15.003Z', level: '<165>', rank: 1 }],
  ['nginx access', '203.0.113.7 - - [10/Oct/2024:13:55:36 +0000] "GET /v2/tides HTTP/1.1" 502 157 "-" "curl/8.4.0"', { time: '10/Oct/2024:13:55:36 +0000', level: '502', rank: 3 }],
  ['nginx error', '2024/10/10 13:55:36 [error] 1234#1234: *5 connect() failed (111: Connection refused) while connecting to upstream', { time: '2024/10/10 13:55:36', level: 'error', rank: 3 }],
  ["Python logging's default", 'WARNING:root:disk is 91% full', { time: null, level: 'WARNING', rank: 2 }],
  ['Python logging with asctime', '2024-01-15 10:23:45,123 - tides.fetch - ERROR - gauge 0417 timed out', { time: '2024-01-15 10:23:45,123', level: 'ERROR', rank: 3 }],
  ['.NET console', 'fail: Microsoft.AspNetCore.Server.Kestrel[13]', { time: null, level: 'fail', rank: 3 }],
  ['.NET console with a time', '[10:23:45] info: Microsoft.Hosting.Lifetime[14]', { time: '10:23:45', level: 'info', rank: 1 }],
  ['Serilog console', '[10:23:45 WRN] Gauge {GaugeId} is slow', { time: '10:23:45', level: 'WRN', rank: 2 }],
  ['Serilog file', '2024-01-15 10:23:45.123 +01:00 [FTL] Host terminated unexpectedly', { time: '2024-01-15 10:23:45.123 +01:00', level: 'FTL', rank: 3 }],
];

for (const [writer, line, expected] of SAMPLES) {
  test(`${writer}: ${line.slice(0, 48)}`, () => {
    assert.deepEqual(read(line), expected);
  });
}

test('lines that only look like a head are none', () => {
  for (const line of [
    'ERROR: no timestamp',
    'WARNING: do not run this as root',
    'info: a note to self',
    '2026-10-14 10:00:00 meeting with the harbour office',
    '2026-10-14T10:00:00Z notes: the gauge is fine',
    'Oct 11 was a calm day',
    '    at sign::run (sign.rs:88)',
    '<p>2026-10-14</p>',
  ]) assert.equal(logHead(line), null, line);
});

test('a level token ranks by its word, a syslog priority by its severity, a status by its class', () => {
  assert.equal(logRankOf('VRB'), 0);
  assert.equal(logRankOf('dbug'), 0);
  assert.equal(logRankOf('INF'), 1);
  assert.equal(logRankOf('crit'), 3);
  assert.equal(logRankOf('<15>'), 0, 'user.debug');
  assert.equal(logRankOf('<13>'), 1, 'user.notice');
  assert.equal(logRankOf('<12>'), 2, 'user.warning');
  assert.equal(logRankOf('<11>'), 3, 'user.err');
  assert.equal(logRankOf('200'), 1);
  assert.equal(logRankOf('404'), 2);
  assert.equal(logRankOf('503'), 3);
  assert.equal(logRankOf('hello'), undefined);
});

test('a time reads as a day, a time of day and an instant, whatever the writer', () => {
  assert.deepEqual(logStamp('2015-10-07\t09:25:05:497'), { date: '2015-10-07', clock: '09:25:05:497', iso: '2015-10-07T09:25:05.497', ms: Date.parse('2015-10-07T09:25:05.497') });
  assert.equal(logStamp('10/Oct/2024:13:55:36 +0000').iso, '2024-10-10T13:55:36+00:00');
  assert.equal(logStamp('10/Oct/2024:13:55:36 +0000').ms, Date.UTC(2024, 9, 10, 13, 55, 36));
  assert.equal(logStamp('2024-01-15 10:23:45.123 +01:00').clock, '10:23:45.123');
  assert.equal(logStamp('2017/09/07 15:04:47.7929823').ms, Date.parse('2017-09-07T15:04:47.792'));
  assert.deepEqual(logStamp('Oct 11 22:14:15'), { date: null, clock: '22:14:15', iso: null, ms: (22 * 3600 + 14 * 60 + 15) * 1000 });
});

test('each writer\'s file is detected as a log by its shape, under a .txt name', () => {
  const files: Record<string, string> = {
    'cbs.txt': SAMPLES.slice(0, 3).map(([, l]) => l).join('\r\n'),
    'syslog.txt': ['Oct  1 06:25:01 deploy-box CRON[2213]: (root) CMD (x)', 'Oct  1 06:25:02 deploy-box sshd[88]: Accepted key', 'Oct  1 06:25:03 deploy-box kernel: [ 1.0] usb 1-1: new device'].join('\n'),
    'access.txt': Array.from({ length: 4 }, (_, i) => `203.0.113.${i} - - [10/Oct/2024:13:55:3${i} +0000] "GET / HTTP/1.1" 200 12 "-" "curl"`).join('\n'),
    'dotnet.txt': ['info: Microsoft.Hosting.Lifetime[14]', '      Now listening on: http://localhost:5000', 'info: Microsoft.Hosting.Lifetime[0]', '      Application started.', 'warn: Tides.Gauges[3]', '      Gauge 0417 is slow'].join('\n'),
    'python.txt': ['INFO:tides:started', 'WARNING:tides:slow gauge', 'ERROR:tides:gauge 0417 down', 'Traceback (most recent call last):', '  File "x.py", line 1'].join('\n'),
  };
  for (const [path, text] of Object.entries(files)) {
    assert.equal(detectKind({ path, head: new TextEncoder().encode(`${text}\n`) }).kind, 'log', path);
  }
});

test('the runs: a status inside its line stays in the line, a bracketed time loses its brackets to spacing', async () => {
  const line = SAMPLES.find(([w]) => w === 'nginx access')![1];
  const runs = (await highlight(line, 'log'))![0]!.map((t) => [t.text, t.className ?? null]);
  assert.deepEqual(runs, [
    ['203.0.113.7 - - ', null],
    ['[', LOG_SPACE_CLASS],
    ['10/Oct/2024:13:55:36 +0000', LOG_TIME_CLASS],
    ['] ', LOG_SPACE_CLASS],
    ['"GET /v2/tides HTTP/1.1" ', null],
    ['502', `${LOG_LEVEL_CLASS} ${LOG_INLINE_CLASS}`],
    [' 157 "-" "curl/8.4.0"', null],
  ]);
  const dotnet = (await highlight('fail: Tides.Gauges[3]', 'log'))![0]!.map((t) => [t.text, t.className ?? null]);
  assert.deepEqual(dotnet, [['fail', LOG_LEVEL_CLASS], [': ', LOG_SPACE_CLASS], ['Tides.Gauges[3]', null]]);
  for (const [, l] of SAMPLES) {
    const text = (await highlight(l, 'log'))![0]!.map((t) => t.text).join('');
    assert.equal(text, l, 'the runs are the line');
  }
});

test('a head is read from the line\'s start only, and from no more than its first characters', () => {
  assert.equal(logHeadParts('x'.repeat(10) + '2024-01-15 10:23:45 ERROR late'), null);
  const long = `2024-01-15 10:23:45 ERROR ${'x'.repeat(100_000)}`;
  assert.equal(logHead(long)?.rank, 3);
});

test('Apache error log: the time in brackets, the level after its module, 2.2 without one', () => {
  assert.deepEqual(read('[Fri Mar 01 12:00:00.123456 2024] [core:error] [pid 123] AH00037: Symbolic link not allowed'), { time: 'Fri Mar 01 12:00:00.123456 2024', level: 'error', rank: 3 });
  assert.deepEqual(read('[Fri Mar 01 12:00:01.000001 2024] [mpm_event:notice] [pid 1:tid 2] AH00489: Apache configured'), { time: 'Fri Mar 01 12:00:01.000001 2024', level: 'notice', rank: 1 });
  assert.deepEqual(read('[Wed Oct 11 14:32:52 2000] [warn] [client 127.0.0.1] client denied'), { time: 'Wed Oct 11 14:32:52 2000', level: 'warn', rank: 2 });
  assert.equal(read('[Fri Mar 01 12:00:00 2024] [ssl:trace3] handshake')?.rank, 0);
  assert.deepEqual(logStamp('Fri Mar 01 12:00:00.123456 2024'), { date: '2024-03-01', clock: '12:00:00.123456', iso: '2024-03-01T12:00:00.123456', ms: Date.parse('2024-03-01T12:00:00.123') });
});

test('a 200 KB line of fields with no level after them is no head, at once', () => {
  const line = `2024-01-01 10:00:00 ${'x.y - '.repeat(200_000 / 6)}`;
  const t0 = cpuNow();
  assert.equal(logHead(line), null);
  assert.equal(logHead(`2024-01-01 10:00:00 ${'x.y - '.repeat(40)}`), null);
  const ms = cpuNow() - t0;
  assert.ok(ms < 100, `${Math.round(ms)} ms`);
});

test('every shape gives up on crafted 200 KB lines within a bound: each line costs what its first characters cost', () => {
  const n = 200_000;
  const fill = (unit: string): string => unit.repeat(Math.ceil(n / unit.length));
  const lines = [
    // The first shape's fields: brackets, names with dots, `name - `, separators.
    `2024-01-01 10:00:00 ${fill('x.y - ')}`,
    `2024-01-01 10:00:00 ${fill('[a] ')}`,
    `2024-01-01 10:00:00 ${fill('a.')}`,
    `2024-01-01 10:00:00 ${fill(' - ')}`,
    `[2024-01-01 10:00:00]${fill('[|')}`,
    `2024-01-01 10:00:00.${fill('1')}`,
    // .NET, Python, WindowsUpdate.
    `info: ${fill('a')}`,
    `[10:00:00] warn: ${fill('a[')}`,
    `INFO:${fill('a')}`,
    `2015-10-07\t09:25:05:497\t${fill(' ')}`,
    `2015-10-07\t09:25:05:497\t 920\tb3c\t${fill('a')}`,
    `2017/09/07 15:04:47.7929823 ${fill('1 ')}`,
    // IIS: a method, then what could be a status, again and again.
    `2024-01-15 10:23:45 10.0.0.5 GET /x ${fill('200 0 0 ')}x`,
    `2024-01-15 10:23:45 ${fill('a ')}`,
    // Access logs, Apache's error log, syslog.
    `1.2.3.4 - - [10/Oct/2024:13:55:36 +0000] "${fill('a')}`,
    `${fill('a ')}`,
    `[Fri Mar 01 12:00:00.123456 2024] [${fill('a')}`,
    `<165>1 2003-10-11T22:14:15.003Z ${fill('a ')}`,
    `<34>Oct 11 22:14:15 host ${fill('a')}`,
    `Oct 11 22:14:15 ${fill('a ')}`,
    `2024-01-15T10:23:45.123456+00:00 host ${fill('a[1')}`,
    fill('<1'),
    fill('['),
    fill('9'),
  ];
  const t0 = cpuNow();
  for (const line of lines) logHead(line);
  const ms = cpuNow() - t0;
  assert.ok(ms < 200, `${Math.round(ms)} ms for ${lines.length} crafted lines of 200 KB`);
});
