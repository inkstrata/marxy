// C-09: copy-command and the three extract verbs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CodeBlock, Document, Heading, Node } from '../contracts/ast.ts';
import type { Operation } from '../contracts/operation.ts';
import { createBuffer, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { sectionRange } from '../sourcemap/section.ts';
import { copyCommand } from './copy-command.ts';
import { extractCodeBlocks, extractLinks, extractTasks } from './extract.ts';
import { EXTRACT_PACK } from './pack-extract.ts';
import { corpusDocuments } from './testing/corpus.ts';

const enc = new TextEncoder();
const parse = (source: string): Document => parseMarkdown(enc.encode(source), { file: 'c09.md' });

function fence(lang: string, body: string) {
  const source = '```' + lang + '\n' + body + '\n```\n';
  const document = parse(source);
  const node = document.children[0] as CodeBlock;
  return { document, node, range: node.src, text: textOf(createBuffer('c09.md', enc.encode(source)), node.src) };
}

function command(lang: string, body: string): string | undefined {
  const input = fence(lang, body);
  assert.ok(copyCommand.canApply(input), `canApply for ${lang}: ${body}`);
  const r = copyCommand.run(input);
  assert.equal(r.replacement, input.text, 'nothing is spliced');
  return r.clipboard?.text;
}

test('EXTRACT_PACK lists copy-command and the three extract verbs', () => {
  assert.deepEqual(EXTRACT_PACK.map((o) => o.id), ['copy-command', 'extract-code-blocks', 'extract-tasks', 'extract-links']);
  assert.deepEqual(EXTRACT_PACK.map((o) => o.title), ['Copy command', 'Copy all code blocks', 'Copy unchecked tasks', 'Copy all links']);
});

test('copy-command: console block keeps commands, drops output, strips $ and # prompts', () => {
  assert.equal(command('console', '$ ls -l\ntotal 4\n-rw-r--r-- a.txt\n# systemctl restart x\nok\n% pwd'), 'ls -l\nsystemctl restart x\npwd');
});

test('copy-command: bash block strips $ only; a # comment stays', () => {
  assert.equal(command('bash', '# install\n$ npm i\nadded 3 packages\n# then run\n$ npm start'), '# install\nnpm i\n# then run\nnpm start');
  assert.equal(command('bash', '$ ls\n# list files\n$ pwd'), 'ls\n# list files\npwd');
});

test('copy-command: backslash continuation is kept verbatim', () => {
  assert.equal(command('bash', '$ docker run \\\n  -p 80:80 \\\n  nginx\nStarted'), 'docker run \\\n  -p 80:80 \\\n  nginx');
  assert.equal(command('console', '$ docker run \\\n$ literal \\\n  nginx\nout'), 'docker run \\\n$ literal \\\n  nginx');
});

test('copy-command: "> " continuation is a prompt in console only', () => {
  assert.equal(command('console', '$ echo "a\n> b"\na\nb'), 'echo "a\nb"');
  const out = command('bash', '$ echo hi\n> not a prompt\n$ pwd');
  assert.equal(out, 'echo hi\npwd');
  // in a bash block the line after a backslash is verbatim, "> " included
  assert.equal(command('bash', '$ cat \\\n> out.txt'), 'cat \\\n> out.txt');
});

test('copy-command: here-document body is kept, even lines that look like prompts', () => {
  assert.equal(
    command('bash', '$ cat <<EOF > f\n$ not a prompt\n> nor this\nEOF\n$ rm f\ngone'),
    'cat <<EOF > f\n$ not a prompt\n> nor this\nEOF\nrm f',
  );
  assert.equal(command('console', '$ cat <<EOF\n> hello\n> $ x\n> EOF\n$ echo done\ndone'), 'cat <<EOF\nhello\n$ x\nEOF\necho done');
  assert.equal(command('bash', "$ cat <<-'END'\n\tbody\n\tEND\n$ pwd"), "cat <<-'END'\n\tbody\n\tEND\npwd");
});

test('copy-command: here-string and quoted << open no here-document', () => {
  assert.equal(command('bash', '$ cat <<< "$ x"\nx\n$ echo "a << b"\na << b\n$ pwd'), 'cat <<< "$ x"\necho "a << b"\npwd');
});

test('copy-command: PowerShell prompt', () => {
  assert.equal(command('console', 'PS C:\\Users\\a> Get-Date\nMonday\nPS C:\\> dir'), 'Get-Date\ndir');
  assert.equal(command('', '$ ls'), 'ls');
});

test('copy-command: not offered without a prompt line, or for other languages', () => {
  assert.equal(copyCommand.canApply(fence('bash', 'ls -l\necho hi')), false);
  assert.equal(copyCommand.canApply(fence('console', 'just output')), false);
  assert.equal(copyCommand.canApply(fence('js', '$ x = 1')), false);
  assert.equal(copyCommand.canApply({ ...fence('bash', '$ ls'), node: undefined }), false);
});

test('copy-command: refuses invisible and direction-changing characters, with no clipboard', () => {
  for (const ch of ['\u200B', '\u202E', '\u2066', '\u2060', '\u{E0041}', '\uFEFF']) {
    const input = fence('bash', `$ echo a${ch}b`);
    const r = copyCommand.run(input);
    assert.equal(r.clipboard, undefined, `U+${ch.codePointAt(0)!.toString(16)}`);
    assert.equal(r.replacement, input.text);
    assert.equal(r.summary, 'Not copied: the command contains invisible or direction-changing characters');
  }
  // a leading byte-order mark is not deceptive
  assert.deepEqual(copyCommand.run(fence('bash', '\uFEFF$ ls\n$ pwd')).clipboard, { text: 'pwd' });
});

test('copy-command: output never ends in a newline', () => {
  for (const body of ['$ ls', '$ ls\n', '$ ls\n\n\n', '$ cat <<EOF\nx\n']) {
    assert.ok(!/[\r\n]$/.test(command('bash', body)!), JSON.stringify(body));
  }
  assert.equal(command('bash', '$ ls\r\n$ pwd\r\n'), 'ls\npwd');
});

// ---- extract verbs ----

const corpus = new Map(corpusDocuments().map((d) => [d.file, d]));
const wholeInput = (file: string) => {
  const { document, bytes } = corpus.get(file)!;
  return { document, range: document.src, text: new TextDecoder().decode(bytes) };
};
function sectionInput(file: string, title: string) {
  const { document, bytes } = corpus.get(file)!;
  const heading = document.children.find(
    (b): b is Heading => b.type === 'heading' && (b.children[0] as { value?: string })?.value === title,
  )!;
  const range = sectionRange(document, heading);
  return { document, node: heading as Node, range, text: new TextDecoder().decode(bytes.slice(range.start, range.end)) };
}

test('extract-tasks: the unchecked items of 03-ai-plan.md, in order, nesting kept', () => {
  const r = extractTasks.run(wholeInput('03-ai-plan.md'));
  assert.equal(
    r.clipboard?.text,
    [
      '- [ ] Attestation policy decided',
      '  - [ ] Accept `none`'.replace(/`/g, ''),
      '  - [ ] Log AAGUID for analytics (no telemetry to third parties)',
      '- [ ] Recovery flow designed',
      '- [ ] Mobile SDK spike (iOS 17+, Android 14+)',
      '- [ ] Rollout flags created',
      '  - [ ] passkeys.require',
    ].join('\n'),
  );
  assert.equal(r.summary, 'Copied 7 unchecked tasks');
  assert.equal(r.replacement, wholeInput('03-ai-plan.md').text);
});

test('extract-tasks: section scope returns only that section; empty section is not offered', () => {
  const checklist = sectionInput('03-ai-plan.md', 'Checklist');
  assert.ok(extractTasks.canApply(checklist));
  assert.equal(extractTasks.run(checklist).clipboard?.text.split('\n').length, 7);
  const phases = sectionInput('03-ai-plan.md', 'Phases');
  assert.equal(extractTasks.canApply(phases), false);
  assert.equal(extractTasks.canApply(sectionInput('03-ai-plan.md', 'Rollback')), false);
});

test('extract-tasks: checked items are skipped and depth is relative to the shallowest', () => {
  const doc = parse('# T\n\n- [x] done\n  - [ ] child of done\n- plain\n  - [ ] deep one\n');
  const r = extractTasks.run({ document: doc, range: doc.src, text: '' });
  assert.equal(r.clipboard?.text, '  - [ ] child of done\n  - [ ] deep one'.replace(/^ {2}/gm, '  ').replace(/^ {2}- \[ \] child/, '- [ ] child').replace('\n  - [ ] deep', '\n- [ ] deep'));
});

test('extract-code-blocks: 28-llm-answer.md yields every block in order, blank-line joined', () => {
  const input = wholeInput('28-llm-answer.md');
  const blocks: string[] = [];
  const visit = (n: Node) => {
    if (n.type === 'codeBlock') blocks.push(n.value);
    const kids = (n as { children?: Node[] }).children;
    if (Array.isArray(kids)) kids.forEach(visit);
  };
  visit(input.document);
  assert.ok(blocks.length > 2);
  const r = extractCodeBlocks.run(input);
  assert.equal(r.summary, `Copied ${blocks.length} code blocks`);
  assert.equal(r.clipboard?.text, blocks.map((b) => b.replace(/\n$/, '')).join('\n\n'));
  // a section holding none is not offered
  assert.equal(extractCodeBlocks.canApply(sectionInput('28-llm-answer.md', 'Overview')), false);
});

test('extract-links: no corpus document yields a duplicate URL (02-readme has only inline-HTML links, so it is not offered)', () => {
  assert.equal(extractLinks.canApply(wholeInput('02-readme-real-world.md')), false);
  let offered = 0;
  for (const file of corpus.keys()) {
    const input = wholeInput(file);
    if (!extractLinks.canApply(input)) continue;
    offered++;
    const urls = extractLinks.run(input).clipboard!.text.split('\n').map((l) => /\]\(<?([^)>]*)/.exec(l)![1]);
    assert.equal(new Set(urls).size, urls.length, file);
  }
  assert.ok(offered > 0);
});

test('extract-links: deduplicates by URL, gives the real target, drops javascript: and data:', () => {
  const doc = parse('# L\n\n[a](https://x.test/p) and [b](https://x.test/p) [c [d]](https://y.test/) [bad](javascript:alert(1)) [d](data:text/html,x) [rel](./a.md) <https://auto.test/z>\n\n[ref][1]\n\n[1]: https://ref.test/\n');
  const r = extractLinks.run({ document: doc, range: doc.src, text: '' });
  assert.equal(
    r.clipboard?.text,
    ['- [a](https://x.test/p)', '- [c \\[d\\]](https://y.test/)', '- [rel](./a.md)', '- [https://auto.test/z](https://auto.test/z)', '- [ref](https://ref.test/)'].join('\n'),
  );
  assert.equal(r.summary, 'Copied 5 links');
  assert.equal(r.clipboard?.text.includes('javascript'), false);
  const onlyBad = parse('[x](javascript:alert(1))\n');
  assert.equal(extractLinks.canApply({ document: onlyBad, range: onlyBad.src }), false);
});

test('extract verbs: apply to a heading or the whole document only', () => {
  const doc = parse('# T\n\n- [ ] a [l](https://x.test/)\n\n```sh\n$ x\n```\n');
  for (const op of [extractCodeBlocks, extractTasks, extractLinks]) {
    assert.ok(op.canApply({ document: doc, range: doc.src }), op.id);
    assert.equal(op.canApply({ document: doc, node: doc.children[2]!, range: doc.children[2]!.src }), false, op.id);
    assert.deepEqual(op.appliesTo, ['section', 'document']);
  }
});

test('extract verbs: canApply on the document range of 32-long-reference.md, median time', () => {
  const input = wholeInput('32-long-reference.md');
  for (const op of [extractCodeBlocks, extractTasks, extractLinks] as Operation[]) {
    const times: number[] = [];
    for (let i = 0; i < 21; i++) {
      const t = performance.now();
      op.canApply(input);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    console.log(`c09 canApply ${op.id} median ${times[10]!.toFixed(3)} ms`);
    assert.ok(times[10]! < 5, `${op.id} median ${times[10]}`);
  }
});

test('fidelity: every pack-extract operation leaves its input bytes alone over the corpus', () => {
  for (const { file, document, bytes } of corpusDocuments()) {
    const text = new TextDecoder().decode(bytes);
    for (const op of EXTRACT_PACK) {
      const input = { document, range: document.src, text };
      if (op.canApply(input)) assert.equal(op.run(input).replacement, text, `${op.id} on ${file}`);
    }
  }
});
