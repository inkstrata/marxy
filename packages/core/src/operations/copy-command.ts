// copy-command: the commands of a shell or console block, prompts removed (C-09; rules in
// docs/research/reader-artifacts/06-readmes.md §8). Clipboard only: the buffer is never touched.
import type { CodeBlock } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';

const CONSOLE_LANGS: ReadonlySet<string> = new Set(['console', 'shell-session', 'shellsession', 'terminal', '']);
const SHELL_LANGS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'shell']);

type Mode = 'console' | 'shell';

function modeOf(block: CodeBlock): Mode | null {
  const lang = (block.lang ?? '').trim().toLowerCase();
  if (CONSOLE_LANGS.has(lang)) return 'console';
  if (SHELL_LANGS.has(lang)) return 'shell';
  return null;
}

/** Characters that change what a terminal runs without showing it (rule 5). */
const DECEPTIVE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\u{E0000}-\u{E007F}]/u;
const DECEPTIVE_AFTER_FIRST = /[\uFEFF]/;

function hasDeceptiveCharacters(value: string): boolean {
  return DECEPTIVE.test(value) || DECEPTIVE_AFTER_FIRST.test(value.slice(1));
}

interface Heredoc { readonly terminator: string; readonly dash: boolean; }

/**
 * The here-documents a command line opens, in order. Quotes are tracked so `echo "a << b"` opens
 * none, and `<<<` (a here-string) is never a here-document.
 */
function heredocsOpenedBy(command: string): Heredoc[] {
  const found: Heredoc[] = [];
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') i++;
      continue;
    }
    if (ch === '\\') { i++; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(command[i - 1]!))) break;
    if (ch !== '<' || command[i + 1] !== '<') continue;
    if (command[i + 2] === '<') { i += 2; continue; }
    let j = i + 2;
    const dash = command[j] === '-';
    if (dash) j++;
    while (command[j] === ' ' || command[j] === '\t') j++;
    const word = /^(?:'([^']*)'|"([^"]*)"|\\?([^\s;|&<>()'"]+))/.exec(command.slice(j));
    if (word) {
      found.push({ terminator: word[1] ?? word[2] ?? word[3] ?? '', dash });
      j += word[0].length;
    }
    i = j - 1;
  }
  return found;
}

function endsWithContinuation(line: string): boolean {
  const slashes = /\\*$/.exec(line)![0].length;
  return slashes % 2 === 1;
}

/** `$ `, `% `, and in a console block `# ` and `PS C:\> `; null when the line is not a prompt line. */
function promptLength(line: string, mode: Mode): number | null {
  if (line.startsWith('$ ') || line.startsWith('% ')) return 2;
  if (mode !== 'console') return null;
  if (line.startsWith('# ')) return 2;
  const ps = /^PS [^>\r\n]*> /.exec(line);
  return ps ? ps[0].length : null;
}

interface Parsed { readonly commands: readonly string[]; readonly hasPrompt: boolean; }

function parseCommands(value: string, mode: Mode): Parsed {
  const out: string[] = [];
  let hasPrompt = false;
  let inCommand = false; // the last line read was a command or its continuation, not output
  let continuing = false;
  let heredocs: Heredoc[] = [];
  let ps2: boolean | null = null; // whether this here-document's body is shown behind `> `
  for (const raw of value.split(/\r\n|\n|\r/)) {
    let line = raw;
    if (heredocs.length > 0) {
      if (mode === 'console') {
        if (ps2 === null) ps2 = line.startsWith('> ') || line === '>';
        if (ps2) line = line === '>' ? '' : line.startsWith('> ') ? line.slice(2) : line;
      }
      out.push(line);
      const { terminator, dash } = heredocs[0]!;
      if ((dash ? line.replace(/^\t+/, '') : line) === terminator) {
        heredocs = heredocs.slice(1);
        ps2 = null;
        if (heredocs.length === 0) continuing = false;
      }
      continue;
    }
    if (continuing) {
      if (mode === 'console' && line.startsWith('> ')) line = line.slice(2);
      out.push(line);
      continuing = endsWithContinuation(line);
      heredocs = heredocsOpenedBy(line);
      continue;
    }
    const prompt = promptLength(line, mode);
    if (prompt !== null) {
      const command = line.slice(prompt);
      hasPrompt = true;
      inCommand = true;
      out.push(command);
      continuing = endsWithContinuation(command);
      heredocs = heredocsOpenedBy(command);
      continue;
    }
    if (mode === 'console' && inCommand && (line.startsWith('> ') || line === '>')) {
      const rest = line === '>' ? '' : line.slice(2);
      out.push(rest);
      continuing = endsWithContinuation(rest);
      heredocs = heredocsOpenedBy(rest);
      continue;
    }
    // In a shell block `#` begins a comment, which belongs to the command text and stays.
    if (mode === 'shell' && line.startsWith('#')) {
      out.push(line);
      continue;
    }
    inCommand = false; // output
  }
  return { commands: out, hasPrompt };
}

/** Copy command. Pure: clipboard only, never a trailing newline, refuses deceptive characters. */
export const copyCommand: Operation = {
  id: 'copy-command',
  title: 'Copy command',
  appliesTo: ['block'],
  canApply(input) {
    if (input.node?.type !== 'codeBlock') return false;
    const mode = modeOf(input.node);
    return mode !== null && parseCommands(input.node.value, mode).hasPrompt;
  },
  run(input: OperationInput): OperationResult {
    const block = input.node as CodeBlock;
    if (hasDeceptiveCharacters(block.value)) {
      return { replacement: input.text, summary: 'Not copied: the command contains invisible or direction-changing characters' };
    }
    const mode = modeOf(block);
    if (mode === null) return { replacement: input.text };
    const text = parseCommands(block.value, mode).commands.join('\n').replace(/[\r\n]+$/, '');
    return { replacement: input.text, clipboard: { text } };
  },
};
