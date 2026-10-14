// A terminal session's lines (K-17): which are commands, which continue one, which are output.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { highlight, lineMetaForHighlight, plainTextFromTokens, TERM_COMMAND_CLASS, TERM_PROMPT_CLASS, TERM_START_CLASS } from './index.ts';
import { copyCommands, copyOutput, DETECTION_PROMPT, isTerminalLang, terminalGroups, terminalLines, textLines } from './terminal-lines.ts';

const session = [
  'ian@eris ~/Code/tidemark % git status --short',
  ' M Cargo.toml',
  '?? logs/build.log',
  'ian@eris ~/Code/tidemark % echo $HOME',
  '$HOME is /Users/ian',
  '  $ indented, so output; and so is cost: $5',
  '',
  'ian@eris ~/Code/tidemark % cargo test',
  'running 2 tests',
].join('\n');

test('a session of three commands gives three groups; a $ inside output (not at the line start) is output', () => {
  const { groups, preamble } = terminalGroups(textLines(session));
  assert.deepEqual(groups.map((g) => g.command), ['git status --short', 'echo $HOME', 'cargo test']);
  assert.deepEqual(preamble, []);
  // `$HOME` and the indented `$` line are output of the second command, and the blank line stays in it.
  assert.deepEqual(groups[1]!.output, ['$HOME is /Users/ian', '  $ indented, so output; and so is cost: $5', '']);
});

test('a "$ " line is a prompt wherever it opens a line, unless it follows a continued command', () => {
  const lines = ['$ ls', 'a b', '$ pwd', '/r'];
  assert.deepEqual(terminalLines(lines).map((l) => l.role), ['command', 'output', 'command', 'output']);
  assert.deepEqual(terminalLines(lines).map((l) => l.commandAt), [2, 0, 2, 0]);
});

test('a multi-line command continued with a backslash is one command', () => {
  const lines = ['$ docker run \\', '  --rm \\', '> -v /a:/b \\', '  alpine', 'hello', '$ ls'];
  const read = terminalLines(lines);
  assert.deepEqual(read.map((l) => l.role), ['command', 'continuation', 'continuation', 'continuation', 'output', 'command']);
  const { groups } = terminalGroups(lines);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.command, 'docker run \\\n  --rm \\\n-v /a:/b \\\n  alpine');
  assert.deepEqual(groups[0]!.output, ['hello']);
  // An escaped backslash at the end does not continue.
  assert.deepEqual(terminalLines(['$ echo \\\\', 'out']).map((l) => l.role), ['command', 'output']);
});

test('the prompts: $, %, PS …>, user@host path %, [user@host dir]$; # and > only in a session with no other prompt', () => {
  const roles = (lines: string[]) => terminalLines(lines).map((l) => l.role);
  assert.deepEqual(roles(['% ls', 'x', 'PS C:\\Users\\ian> dir', 'y', '[ian@eris ~]$ pwd', 'z', 'ian@eris:~$ id', 'w']), ['command', 'output', 'command', 'output', 'command', 'output', 'command', 'output']);
  // A root shell: `# ` is the prompt, because nothing else is.
  assert.deepEqual(roles(['# apt update', 'Hit:1', '# whoami', 'root']), ['command', 'output', 'command', 'output']);
  // With a `$` prompt in the session, a `# heading` or `> quote` in the output is output.
  assert.deepEqual(roles(['$ cat notes', '# Heading', '> quoted', '$ ls']), ['command', 'output', 'output', 'command']);
  // A bare prompt with no command is not one.
  assert.deepEqual(roles(['$ ', '$', 'text']), ['output', 'output', 'output']);
});

test('the detection pattern and these agree: every line detection calls a prompt opens a group here', () => {
  for (const line of ['$ ls -la', 'ian@eris ~/Code/tidemark % git status', 'ian@eris ~ # id']) {
    assert.ok(DETECTION_PROMPT.test(line), line);
    assert.equal(terminalLines([line])[0]!.role, 'command', line);
  }
});

test('the starts: the half line is above every command but the first line of the block', () => {
  const lines = textLines(session);
  const tokens = lines.map((l) => (l === '' ? [] : [{ text: l }]));
  const meta = lineMetaForHighlight('terminal', tokens);
  assert.deepEqual(meta.flatMap((m, i) => (m.lineClass === TERM_START_CLASS ? [i] : [])), [3, 7]);
});

test('the runs: a prompt, then the command, then the output as it is; the text is the text', async () => {
  for (const lang of ['terminal', 'console', 'shellsession', 'sh-session', 'Console']) {
    const lines = (await highlight(session, lang))!;
    assert.equal(plainTextFromTokens(lines), session, lang);
  }
  const lines = (await highlight('ian@eris ~ % ls -l\n total 0\n', 'terminal'))!;
  assert.deepEqual(lines[0], [{ text: 'ian@eris ~ % ', className: TERM_PROMPT_CLASS }, { text: 'ls -l', className: TERM_COMMAND_CLASS }]);
  assert.deepEqual(lines[1], [{ text: ' total 0' }]);
  assert.ok(isTerminalLang('sh-session') && !isTerminalLang('bash') && !isTerminalLang('log'));
});

test('an escape is output like any character: no run reads it, and the colour of output does not follow what it says', async () => {
  const text = '$ ls --color\n\u001b[31mred\u001b[0m ERROR\n';
  const lines = (await highlight(text, 'terminal'))!;
  assert.deepEqual(lines[1], [{ text: '\u001b[31mred\u001b[0m ERROR' }]);
  assert.equal(plainTextFromTokens(lines), text.replace(/\n$/, '\n'));
});

test('copy commands: every command, prompts stripped, one per line; copy output: the output lines as the file has them', () => {
  assert.equal(copyCommands(session), 'git status --short\necho $HOME\ncargo test');
  assert.equal(copyOutput(session), [' M Cargo.toml', '?? logs/build.log', '$HOME is /Users/ian', '  $ indented, so output; and so is cost: $5', '', 'running 2 tests'].join('\n'));
  assert.equal(copyCommands('just output\n'), '');
  assert.equal(copyOutput('$ true\n'), '');
  // CRLF files give lines, not carriage returns.
  assert.equal(copyCommands('$ a\r\nout\r\n$ b\r\n'), 'a\nb');
});
