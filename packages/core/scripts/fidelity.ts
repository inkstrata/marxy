// Byte-fidelity gate: opening a document and saving it must put back exactly the bytes that were
// there, and an edit must change exactly the bytes it names (AGENTS.md non-negotiable 4, ADR-0004).
//
// The gate drives the shell's real save path — apps/desktop/src-tauri/src/atomic_write.rs, compiled
// here by a bare rustc because it depends on std alone — rather than a second implementation of it,
// so a normalising save turns this red. It proves that itself: the same corpus is run against
// deliberately broken copies of the save path, and the gate fails if any of them slips through.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byteOffsets } from '../src/parse/byte-offsets.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const corpusDir = join(repoRoot, 'fixtures', 'corpus');
const savePathSource = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src', 'atomic_write.rs');
const shellDir = join(repoRoot, 'apps', 'desktop', 'src', 'shell');

/** The two fixtures that exist because every plausible save path gets them wrong. */
const HARD_FIXTURES = ['12-crlf-and-bom.md', '13-no-trailing-newline.md'];

/** The signature the gate compiles against; also the anchor the deliberately broken copies patch. */
const SAVE_SIGNATURE = 'pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const failures: string[] = [];
const fail = (message: string) => void failures.push(message);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const work = mkdtempSync(join(tmpdir(), 'marxy-fidelity-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

const corpus = readdirSync(corpusDir).filter(name => !name.startsWith('.')).sort();
const bytesOf = (name: string) => readFileSync(join(corpusDir, name));

// ---------------------------------------------------------------------------------------------
// The corpus still carries the hazards the gate exists to catch.
// ---------------------------------------------------------------------------------------------

function checkCorpusPreconditions(): void {
  for (const name of HARD_FIXTURES) {
    if (!corpus.includes(name)) fail(`corpus: ${name} is missing; the gate's hardest case is gone`);
  }
  if (corpus.includes(HARD_FIXTURES[0]!)) {
    const bytes = bytesOf(HARD_FIXTURES[0]!);
    if (!bytes.subarray(0, 3).equals(BOM)) fail(`corpus: ${HARD_FIXTURES[0]} no longer starts with a byte-order mark`);
    if (!bytes.includes('\r\n')) fail(`corpus: ${HARD_FIXTURES[0]} no longer contains a CRLF line ending`);
  }
  if (corpus.includes(HARD_FIXTURES[1]!)) {
    const bytes = bytesOf(HARD_FIXTURES[1]!);
    if (bytes.at(-1) === 0x0a) fail(`corpus: ${HARD_FIXTURES[1]} now ends with a newline, so it tests nothing`);
  }
  if (corpus.length < 10) fail(`corpus: only ${corpus.length} files; the round trip needs the corpus`);
  // A precondition on the corpus rather than on the code: the view decodes for display, and a file
  // that cannot survive that decode would make a display-side bug look like a save-side one.
  for (const name of corpus) {
    const bytes = bytesOf(name);
    const decoded = Buffer.from(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), 'utf-8');
    if (!bytes.equals(decoded)) fail(`corpus: ${name} does not survive a UTF-8 decode, so the view cannot show it faithfully`);
  }
}

// ---------------------------------------------------------------------------------------------
// The real save path, compiled and driven.
// ---------------------------------------------------------------------------------------------

/** Compiles a driver around the save path's source and returns the binary. `patch` breaks it on purpose. */
function buildSavePath(label: string, patch?: (source: string) => string): string {
  const dir = join(work, label);
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(savePathSource, 'utf8');
  if (patch && !source.includes(SAVE_SIGNATURE)) {
    fail(`gate: the save path no longer declares \`${SAVE_SIGNATURE}\`, so the gate cannot prove it catches a normalising save`);
    return '';
  }
  // The save path is compiled as itself, beside a generated driver that calls it, so what runs below
  // is the shipped code rather than a description of it.
  writeFileSync(join(dir, 'atomic_write.rs'), patch ? patch(source) : source);
  const driver = join(dir, 'driver.rs');
  writeFileSync(driver, `mod atomic_write;\n\n${DRIVER_MAIN}`);
  const binary = join(dir, 'driver');
  const built = spawnSync('rustc', ['--edition', '2021', '-A', 'dead_code', '-o', binary, driver], { encoding: 'utf8' });
  if (built.error || built.status !== 0) {
    fail(`gate: cannot compile the save path (${label}): ${built.error?.message ?? built.stderr.trim()}`);
    return '';
  }
  return binary;
}

const DRIVER_MAIN = `fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).expect("the document to open");
    if let Err(message) = atomic_write::write_atomic(std::path::Path::new(&args[2]), &bytes) {
        eprintln!("{message}");
        std::process::exit(2);
    }
}
`;

/** Saves `source`'s bytes over `destination` through the real save path. Returns an error message or null. */
function save(binary: string, source: string, destination: string): string | null {
  const run = spawnSync(binary, [source, destination], { encoding: 'utf8' });
  if (run.error) return run.error.message;
  return run.status === 0 ? null : run.stderr.trim() || `exit ${run.status}`;
}

/** Opens each corpus file and saves it back; returns the files whose bytes did not survive. */
function roundTrip(binary: string, names: readonly string[], label: string): string[] {
  const changed: string[] = [];
  const dir = join(work, `round-trip-${label}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const original = bytesOf(name);
    const destination = join(dir, name);
    // Seeded with something longer than most documents, so a save that failed to truncate would
    // leave a tail behind and be caught rather than hidden by the new bytes being longer.
    writeFileSync(destination, Buffer.alloc(original.length + 4096, 0x7e));
    const error = save(binary, join(corpusDir, name), destination);
    if (error) {
      changed.push(`${name} (refused: ${error})`);
      continue;
    }
    if (sha256(readFileSync(destination)) !== sha256(original)) changed.push(name);
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------
// An edited document: the splice changes its range and nothing else.
// ---------------------------------------------------------------------------------------------

/**
 * Editing is transformation over byte ranges (ADR-0004), so a save after an edit has to be faithful
 * everywhere the edit is not. The interesting fixture is the CRLF-and-BOM one, where an offset taken
 * from a JavaScript string is not the byte offset and the naive version would cut the document apart
 * in the wrong place.
 */
function checkEditedDocumentIsSpliced(binary: string): void {
  const dir = join(work, 'edited');
  mkdirSync(dir, { recursive: true });

  const edits: { file: string; find: string; replaceWith: string }[] = [
    { file: '12-crlf-and-bom.md', find: 'Windows', replaceWith: 'CRLF-terminated' },
    { file: '13-no-trailing-newline.md', find: 'last line', replaceWith: 'final line' },
  ];

  let edited = 0;
  for (const { file, find, replaceWith } of edits) {
    if (!corpus.includes(file)) continue;
    const original = bytesOf(file);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(original);
    const at = text.indexOf(find);
    if (at < 0) {
      fail(`edit: ${file} no longer contains "${find}", so the spliced-save check tests nothing`);
      continue;
    }
    const offsets = byteOffsets(text);
    const start = offsets.at(at);
    const end = offsets.at(at + find.length);
    const replacement = Buffer.from(replaceWith, 'utf-8');
    const spliced = Buffer.concat([original.subarray(0, start), replacement, original.subarray(end)]);

    const source = join(dir, `${file}.spliced`);
    const destination = join(dir, file);
    writeFileSync(source, spliced);
    writeFileSync(destination, original);
    const error = save(binary, source, destination);
    if (error) {
      fail(`edit: saving an edited ${file} was refused: ${error}`);
      continue;
    }

    const saved = readFileSync(destination);
    if (!saved.subarray(0, start).equals(original.subarray(0, start))) {
      fail(`edit: saving ${file} changed bytes before the edited range`);
    }
    if (!saved.subarray(start, start + replacement.length).equals(replacement)) {
      fail(`edit: saving ${file} did not put the edit in its range`);
    }
    if (!saved.subarray(start + replacement.length).equals(original.subarray(end))) {
      fail(`edit: saving ${file} changed bytes after the edited range`);
    }
    if (saved.at(-1) !== original.at(-1)) {
      fail(`edit: saving ${file} changed the document's last byte`);
    }
    const crlfCount = (bytes: Buffer) => bytes.toString('latin1').split('\r\n').length - 1;
    if (crlfCount(saved) !== crlfCount(original)) {
      fail(`edit: saving ${file} changed its line endings`);
    }
    edited++;
  }
  if (edited > 0) {
    console.log(`fidelity: an edited document saves its spliced range and nothing else (${edited} documents, byte offsets over UTF-16 ones)`);
  }

  // The CRLF-and-BOM fixture must genuinely punish an offset taken from the decoded string, or the
  // check above would pass just as happily against code that never converts offsets at all.
  const file = HARD_FIXTURES[0]!;
  if (corpus.includes(file)) {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytesOf(file));
    const at = text.indexOf('Windows');
    if (at >= 0 && byteOffsets(text).at(at) === at) {
      fail(`edit: in ${file} the byte offset equals the string offset, so the fixture no longer exercises the hazard`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The gate can tell a faithful save from a normalising one.
// ---------------------------------------------------------------------------------------------

/** Each entry is a normalisation someone might add to the save path in good faith. */
const NORMALISATIONS: { name: string; rust: string }[] = [
  {
    name: 'CRLF line endings rewritten to LF',
    rust: `let owned: Vec<u8> = { let mut out = Vec::new(); let mut i = 0;
        while i < bytes.len() { if bytes[i] == b'\\r' && bytes.get(i + 1) == Some(&b'\\n') { i += 1; continue; }
        out.push(bytes[i]); i += 1; } out };
        let bytes: &[u8] = &owned;`,
  },
  {
    name: 'a trailing newline added to a file that had none',
    rust: `let owned: Vec<u8> = { let mut out = bytes.to_vec();
        if out.last() != Some(&b'\\n') { out.push(b'\\n'); } out };
        let bytes: &[u8] = &owned;`,
  },
  {
    name: 'a byte-order mark stripped',
    rust: `let owned: Vec<u8> = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) { bytes[3..].to_vec() }
        else { bytes.to_vec() };
        let bytes: &[u8] = &owned;`,
  },
];

function checkTheGateWouldCatchANormalisingSave(): void {
  for (const { name, rust } of NORMALISATIONS) {
    const label = name.replace(/[^a-z]+/gi, '-');
    const binary = buildSavePath(label, source => source.replace(SAVE_SIGNATURE, `${SAVE_SIGNATURE}\n    ${rust}`));
    if (!binary) continue;
    const caught = roundTrip(binary, corpus, label);
    if (caught.length === 0) {
      fail(`selftest: a save path with ${name} passed the round trip; this gate proves nothing`);
    } else {
      console.log(`fidelity: a save path with ${name} is caught (${caught.length} files differ, including ${caught[0]})`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The durability and refusal semantics, from the save path's own tests.
// ---------------------------------------------------------------------------------------------

function runSavePathUnitTests(): void {
  const binary = join(work, 'save-path-tests');
  const built = spawnSync('rustc', ['--test', '--edition', '2021', '-A', 'dead_code', '-o', binary, savePathSource], { encoding: 'utf8' });
  if (built.error || built.status !== 0) {
    fail(`gate: cannot compile the save path's tests: ${built.error?.message ?? built.stderr.trim()}`);
    return;
  }
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  const summary = (run.stdout ?? '').split('\n').find(line => line.startsWith('test result:')) ?? '';
  if (run.status !== 0) {
    fail(`gate: the save path's own tests fail — ${summary || run.stderr.trim()}\n${run.stdout}`);
    return;
  }
  console.log(`fidelity: the save path's durability and refusal tests pass — ${summary.trim()}`);
}

// ---------------------------------------------------------------------------------------------
// The shell never turns a document into text.
// ---------------------------------------------------------------------------------------------

/** Converting bytes to a string and back is where every normalisation in this gate would enter. */
function checkTheShellKeepsBytes(): void {
  const forbidden = /\bTextDecoder\b|\bTextEncoder\b|\.normalize\s*\(|String\.fromCharCode|\btoString\s*\(\s*['"]/;
  const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const name of readdirSync(shellDir)) {
    if (!/\.m?ts$/.test(name)) continue;
    const source = stripComments(readFileSync(join(shellDir, name), 'utf8'));
    const hit = forbidden.exec(source);
    if (hit) fail(`shell: apps/desktop/src/shell/${name} converts document bytes to text (\`${hit[0]}\`); the shell passes bytes through`);
  }
}

// ---------------------------------------------------------------------------------------------

checkCorpusPreconditions();
checkTheShellKeepsBytes();
runSavePathUnitTests();

const savePath = buildSavePath('faithful');
if (savePath) {
  const changed = roundTrip(savePath, corpus, 'faithful');
  for (const name of changed) fail(`fidelity: ${name} does not survive open → save`);
  if (changed.length === 0) {
    console.log(`fidelity: ${corpus.length} corpus files survive open → save byte-identically, including ${HARD_FIXTURES.join(' and ')}`);
  }
  checkEditedDocumentIsSpliced(savePath);
  checkTheGateWouldCatchANormalisingSave();
}

if (failures.length > 0) {
  for (const message of failures) console.error(message);
  process.exit(1);
}
console.log('fidelity: ok');
