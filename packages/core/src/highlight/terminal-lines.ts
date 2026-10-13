// The lines of a terminal session (K-17): which are a prompt and its command, which continue a command, and which are
// the command's output. Pure: it reads lines and returns where things are, and writes nothing. Detection's own prompt
// (`PROMPT`, kind/detect.ts) says whether a text is a session; this says what each line of one is.

import { PROMPT } from '../kind/detect.ts';

export const TERM_PROMPT_CLASS = 'marxy-term-prompt';
export const TERM_COMMAND_CLASS = 'marxy-term-command';
/** A line that opens a command after the first line of its block: it carries the half line above it. */
export const TERM_START_CLASS = 'marxy-term-start';

/** The fence languages a Markdown file reads as a session. */
const FENCE_LANGUAGES: ReadonlySet<string> = new Set(['terminal', 'console', 'shellsession', 'sh-session']);

/** Whether a fence language id (or a file-type table id) is read as a terminal session. */
export const isTerminalLang = (lang: string): boolean => FENCE_LANGUAGES.has(lang.trim().toLowerCase());

/** A line is the first line of a command, a later line of one (after a `\`), or output. */
export type TerminalRole = 'command' | 'continuation' | 'output';

export interface TerminalLine {
  readonly role: TerminalRole;
  /** UTF-16 offset where the command text begins: after the prompt and its space; 0 for output. */
  readonly commandAt: number;
  /** The first line of a group (a prompt line). */
  readonly start: boolean;
}

/**
 * The prompt shapes. `$ `, `% `, `PS …> ` and `user@host path % ` (what detection reads) are always prompts. `# ` and
 * `> ` are also what a heading comment and a quoted line in output look like, so they are prompts only in a session
 * with no other kind of prompt: a root shell, or a PowerShell-less `>` console. A prompt needs a command after it.
 */
const STRONG: readonly RegExp[] = [
  /^\$ (?=\S)/,
  /^% (?=\S)/,
  /^PS [^>\r\n]*> (?=\S)/,
  /^[\w.-]+@[\w.-]+[ :][^$%#\r\n]*[$%#] (?=\S)/,
  /^\[[^\]\r\n]+\][$%#] (?=\S)/,
];
const WEAK: readonly RegExp[] = [/^# (?=\S)/, /^> (?=\S)/];

const promptEnd = (line: string, patterns: readonly RegExp[]): number => {
  for (const p of patterns) {
    const m = p.exec(line);
    if (m !== null) return m[0].length;
  }
  return -1;
};

/** Whether a line asks for the next to continue it: it ends in a backslash that is not itself escaped. */
const continues = (line: string): boolean => /(?<!\\)(?:\\\\)*\\$/.test(line);

/** The `PROMPT` of detection, re-exported so a test can hold the two readings together. */
export const DETECTION_PROMPT: RegExp = PROMPT;

/** What every line of `lines` is. A `$` inside output (`$HOME`, `cost $5`) is output: a prompt is the line's opening. */
export function terminalLines(lines: readonly string[]): readonly TerminalLine[] {
  const hasStrong = lines.some((l) => promptEnd(l, STRONG) >= 0);
  // With no strong prompt anywhere, the first weak prompt names the one weak shape the session uses.
  let weak: RegExp | null = null;
  if (!hasStrong) {
    for (const l of lines) {
      const w = WEAK.find((p) => p.test(l));
      if (w !== undefined) {
        weak = w;
        break;
      }
    }
  }
  const out: TerminalLine[] = [];
  let open = false;
  for (const line of lines) {
    if (open) {
      // A continuation line may carry the secondary prompt `> `; it is not a prompt of a new command.
      out.push({ role: 'continuation', commandAt: line.startsWith('> ') ? 2 : 0, start: false });
      open = continues(line);
      continue;
    }
    const at = promptEnd(line, weak === null ? STRONG : [weak]);
    if (at < 0) {
      out.push({ role: 'output', commandAt: 0, start: false });
      continue;
    }
    out.push({ role: 'command', commandAt: at, start: true });
    open = continues(line);
  }
  return out;
}

/** One command and the output that follows it. */
export interface TerminalGroup {
  /** The command's own text, prompts stripped, its lines joined with a newline (the backslashes stay). */
  readonly command: string;
  /** The output lines, each as the file has it, blank lines included. */
  readonly output: readonly string[];
  /** The line index the group opens at. */
  readonly at: number;
}

/** The groups of a session: output before the first prompt belongs to no group (`preamble`). */
export function terminalGroups(lines: readonly string[]): { readonly preamble: readonly string[]; readonly groups: readonly TerminalGroup[] } {
  const read = terminalLines(lines);
  const preamble: string[] = [];
  const groups: { command: string[]; output: string[]; at: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const r = read[i]!;
    const line = lines[i]!;
    if (r.role === 'command') groups.push({ command: [line.slice(r.commandAt)], output: [], at: i });
    else if (r.role === 'continuation') groups.at(-1)!.command.push(line.slice(r.commandAt));
    else (groups.at(-1)?.output ?? preamble).push(line);
  }
  return { preamble, groups: groups.map((g) => ({ command: g.command.join('\n'), output: g.output, at: g.at })) };
}

/** A text as lines, split as the reader splits a file: `\r\n`, `\r` and `\n`, a closing newline not a line. */
export function textLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Every command of the session, prompts stripped, one after another, each on its own line. */
export function copyCommands(text: string): string {
  return terminalGroups(textLines(text)).groups.map((g) => g.command).join('\n');
}

/** The output of the session and nothing else, each line as the file has it. */
export function copyOutput(text: string): string {
  const { preamble, groups } = terminalGroups(textLines(text));
  return [...preamble, ...groups.flatMap((g) => g.output)].join('\n');
}
