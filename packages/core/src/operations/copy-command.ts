// copy-command: the commands of a shell or console block, prompts removed (C-09; rules in
// docs/research/reader-artifacts/06-readmes.md §8). Clipboard only: the buffer is never touched.
import type { CodeBlock } from '../contracts/ast.ts';
import type { Operation, OperationInput, OperationResult } from '../contracts/operation.ts';

const CONSOLE_LANGS: ReadonlySet<string> = new Set(['console', 'shell-session', 'shellsession', 'terminal', '']);
const SHELL_LANGS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'shell']);
const POWERSHELL_LANGS: ReadonlySet<string> = new Set(['powershell', 'ps1', 'pwsh']);

type Mode = 'console' | 'shell' | 'powershell';

function modeOf(block: CodeBlock): Mode | null {
  const lang = (block.lang ?? '').trim().toLowerCase();
  if (CONSOLE_LANGS.has(lang)) return 'console';
  if (SHELL_LANGS.has(lang)) return 'shell';
  if (POWERSHELL_LANGS.has(lang)) return 'powershell';
  return null;
}

/** Characters that change what a terminal runs without showing it (rule 5). */
const DECEPTIVE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\u{E0000}-\u{E007F}]/u;
const DECEPTIVE_AFTER_FIRST = /[\uFEFF]/;

/** Invisible or direction-changing characters (a leading byte-order mark is not one). */
export function hasDeceptiveCharacters(value: string): boolean {
  return DECEPTIVE.test(value) || DECEPTIVE_AFTER_FIRST.test(value.slice(1));
}

interface Heredoc { readonly terminator: string; readonly dash: boolean; }

/** What a command leaves open at the end of a line: it continues on the next one while any is set. */
interface Open { quote: string | null; depth: number; joined: boolean; }

/**
 * Reads one line of a command, carrying `open` (quotes, parentheses and `$(`/`<(` that span lines)
 * from line to line, and returns the here-documents the line opens. Quotes are tracked so
 * `echo "a << b"` opens none, and `<<<` (a here-string) is never a here-document.
 */
function scanLine(line: string, open: Open, esc: string): Heredoc[] {
  const found: Heredoc[] = [];
  open.joined = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (open.quote !== null) {
      if (ch === open.quote) open.quote = null;
      else if (ch === esc && open.quote === '"') {
        if (i === line.length - 1) open.joined = true;
        i++;
      }
      continue;
    }
    if (ch === esc) {
      if (i === line.length - 1) open.joined = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') { open.quote = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]!))) break;
    if (ch === '(') { open.depth++; continue; }
    if (ch === ')') { if (open.depth > 0) open.depth--; continue; }
    if (ch !== '<' || line[i + 1] !== '<') continue;
    if (line[i + 2] === '<') { i += 2; continue; }
    let j = i + 2;
    const dash = line[j] === '-';
    if (dash) j++;
    while (line[j] === ' ' || line[j] === '\t') j++;
    const word = /^(?:'([^']*)'|"([^"]*)"|\\?([^\s;|&<>()'"]+))/.exec(line.slice(j));
    if (word) {
      found.push({ terminator: word[1] ?? word[2] ?? word[3] ?? '', dash });
      j += word[0].length;
    }
    i = j - 1;
  }
  return found;
}

const isOpen = (open: Open): boolean => open.quote !== null || open.depth > 0 || open.joined;

/**
 * `$ ` and `% `; in a console block also `# ` and `PS C:\> `; in a PowerShell block only `PS …> `.
 * `# ` is the root prompt in a console block (a session transcript), never in a shell block, where
 * `#` begins a comment. Null when the line is not a prompt line.
 */
function promptLength(line: string, mode: Mode): number | null {
  if (mode !== 'powershell' && (line.startsWith('$ ') || line.startsWith('% '))) return 2;
  if (mode === 'console' && line.startsWith('# ')) return 2;
  if (mode === 'shell') return null;
  const ps = /^PS [^>\r\n]*> /.exec(line);
  return ps ? ps[0].length : null;
}

interface Parsed {
  readonly commands: readonly string[];
  /** Prompt lines that start a command. */
  readonly commandCount: number;
  /** Non-blank lines dropped as output. */
  readonly outputCount: number;
  readonly hasPrompt: boolean;
  /** False when the block ends inside a quote, parenthesis, continuation or here-document. */
  readonly complete: boolean;
}

function parseCommands(value: string, mode: Mode): Parsed {
  const esc = mode === 'powershell' ? '`' : '\\';
  const out: string[] = [];
  let commandCount = 0;
  let outputCount = 0;
  let inCommand = false; // the last line read was a command or its continuation, not output
  let continuing = false;
  let heredocs: Heredoc[] = [];
  let ps2: boolean | null = null; // whether this here-document's body is shown behind `> `
  const open: Open = { quote: null, depth: 0, joined: false };
  const finishLine = (text: string) => {
    heredocs = scanLine(text, open, esc);
    continuing = isOpen(open);
  };
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
      }
      continue;
    }
    if (continuing) {
      if (mode === 'console' && line.startsWith('> ')) line = line.slice(2);
      out.push(line);
      finishLine(line);
      continue;
    }
    const prompt = promptLength(line, mode);
    if (prompt !== null) {
      const command = line.slice(prompt);
      commandCount++;
      inCommand = true;
      out.push(command);
      finishLine(command);
      continue;
    }
    if (mode === 'console' && inCommand && (line.startsWith('> ') || line === '>')) {
      const rest = line === '>' ? '' : line.slice(2);
      out.push(rest);
      finishLine(rest);
      continue;
    }
    // In a shell block `#` begins a comment, which belongs to the command text and stays.
    if (mode === 'shell' && line.startsWith('#')) {
      out.push(line);
      continue;
    }
    inCommand = false; // output
    if (line.trim() !== '') outputCount++;
  }
  return {
    commands: out,
    commandCount,
    outputCount,
    hasPrompt: commandCount > 0,
    complete: !continuing && heredocs.length === 0,
  };
}

/** Whether a command can be copied whole: it has a prompt, something after it, and does not end mid-command. */
function usable(parsed: Parsed): boolean {
  return parsed.hasPrompt && parsed.complete && parsed.commands.some((c) => c.trim() !== '');
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Copy command. Pure: clipboard only, never a trailing newline, refuses deceptive characters. */
export const copyCommand: Operation = {
  id: 'copy-command',
  title: 'Copy command',
  appliesTo: ['block'],
  canApply(input) {
    if (input.node?.type !== 'codeBlock') return false;
    const mode = modeOf(input.node);
    return mode !== null && usable(parseCommands(input.node.value, mode));
  },
  run(input: OperationInput): OperationResult {
    const block = input.node as CodeBlock;
    if (hasDeceptiveCharacters(block.value)) {
      return { replacement: input.text, summary: 'Not copied: the command contains invisible or direction-changing characters' };
    }
    const mode = modeOf(block);
    if (mode === null) return { replacement: input.text };
    const parsed = parseCommands(block.value, mode);
    if (!usable(parsed)) return { replacement: input.text };
    const text = parsed.commands.join('\n').replace(/[\r\n]+$/, '');
    const left = parsed.outputCount > 0 ? `; ${count(parsed.outputCount, 'output line', 'output lines')} left out` : '';
    return {
      replacement: input.text,
      clipboard: { text },
      summary: `Copied ${count(parsed.commandCount, 'command', 'commands')}${left}`,
    };
  },
};
