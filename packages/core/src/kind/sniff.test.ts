// An unknown name whose text is plainly XML or JSON reads as that; a known name never does, and text that is merely close
// stays text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readingOf } from '../reading/index.ts';
import { fileTypeFor, guessedFromBytes, noteContent, noteSniffed } from './registry.ts';
import { sniffFormat } from './sniff.ts';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const XML = '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <appSettings><add key="a" value="b"/></appSettings>\n</configuration>\n';
const PLIST = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>A</key><string>b</string></dict></plist>\n';
const MAP = '{"version":3,"file":"out.js","sources":["a.ts"],"mappings":"AAAA"}';

const names: [string, string, 'xml' | 'json'][] = [
  ['/r/site.config', XML, 'xml'],
  ['/r/app.manifest', '<assembly manifestVersion="1.0"><trustInfo/></assembly>', 'xml'],
  ['/r/bundle.js.map', MAP, 'json'],
  ['/r/Info.plist', PLIST, 'xml'],
  ['/r/Strings.resx2', XML, 'xml'],
  ['/r/data.weird', '[1, 2, {"a": null}]', 'json'],
  ['/r/noext', XML, 'xml'],
];

for (const [path, text, want] of names) {
  test(`${path} reads as ${want} from its text`, () => {
    noteContent(path, null);
    assert.equal(fileTypeFor(path).id, 'unknown');
    assert.equal(sniffFormat(bytes(text)), want);
    noteSniffed(path, bytes(text));
    assert.equal(fileTypeFor(path).id, want);
    assert.equal(fileTypeFor(path).reading, 'tree');
    assert.equal(guessedFromBytes(path), true);
    const reading = readingOf(path, bytes(text));
    assert.equal(reading?.id, 'tree');
    assert.equal(reading?.format, want === 'xml' ? 'XML' : 'JSON');
    assert.match(reading?.html ?? '', new RegExp(`Read as ${want === 'xml' ? 'XML' : 'JSON'} from its text`));
  });
}

test('names the registry knows are never sniffed: .csproj, .props, .targets, .resx, .har and .webmanifest read by name', () => {
  for (const [name, text, id] of [
    ['a.csproj', '<Project Sdk="Microsoft.NET.Sdk"/>', 'xml'],
    ['b.props', '<Project/>', 'xml'],
    ['c.targets', '<Project/>', 'xml'],
    ['d.resx', '<root/>', 'xml'],
    ['e.har', '{"log":{}}', 'json'],
    ['f.webmanifest', '{"name":"x"}', 'json'],
  ] as const) {
    noteSniffed(`/k/${name}`, bytes(text));
    assert.equal(fileTypeFor(`/k/${name}`).id, id, name);
    assert.equal(guessedFromBytes(`/k/${name}`), false, `${name} is read by its name`);
  }
});

test('a known extension wins over what the text looks like', () => {
  noteSniffed('/k/notes.txt', bytes(XML));
  assert.equal(fileTypeFor('/k/notes.txt').id, 'text');
  noteSniffed('/k/script.py', bytes(MAP));
  assert.equal(fileTypeFor('/k/script.py').id, 'python');
  noteSniffed('/k/page.html', bytes(XML));
  assert.equal(fileTypeFor('/k/page.html').id, 'html');
});

test('a .config that is INI stays text, and so do scripts, HTML and prose', () => {
  for (const [name, text] of [
    ['/n/plain.config', '[core]\nmode = fast\n'],
    ['/n/a.cfgx', '; comment\nkey=value\n'],
    ['/n/page.thing', '<!DOCTYPE html>\n<html><body><p>hi</p></body></html>'],
    ['/n/frag.thing', '<div>one</div>\nand then prose'],
    ['/n/unclosed.thing', '<root><a></root>'],
    ['/n/prose.thing', 'Hello there, <not xml> at all.'],
    ['/n/json-ish.thing', '{ not json: true }'],
    ['/n/comments.thing', '{ // jsonc\n "a": 1 }'],
    ['/n/scalar.thing', '"just a string"'],
    ['/n/number.thing', '42'],
    ['/n/ini-section.thing', '[section]\nkey = 1\n'],
    ['/n/empty.thing', ''],
  ] as const) {
    assert.equal(sniffFormat(bytes(text)), null, name);
    noteSniffed(name, bytes(text));
    assert.equal(fileTypeFor(name).id, 'unknown', name);
    assert.equal(readingOf(name, bytes(text))?.id === 'tree', false, name);
  }
});

test('binary and non-UTF-8 text is not sniffed; secret names are left alone, a lookalike name is not a secret', () => {
  assert.equal(sniffFormat(new Uint8Array([0x7b, 0x00, 0x7d])), null);
  assert.equal(sniffFormat(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])), null);
  noteSniffed('/s/creds.key', bytes(MAP));
  assert.notEqual(fileTypeFor('/s/creds.key').id, 'json');
  assert.equal(guessedFromBytes('/s/creds.key'), false);
  noteSniffed('/s/.env.local', bytes(MAP));
  assert.notEqual(fileTypeFor('/s/.env.local').id, 'json');
  assert.equal(guessedFromBytes('/s/.env.local'), false);
  noteSniffed('/s/service.pem2', bytes(MAP));
  assert.equal(fileTypeFor('/s/service.pem2').id, 'json', 'a name that only resembles a key is not a secret');
});

test('a sniffed kind survives the index walk and a save (noteContent), and goes when the bytes stop being XML', () => {
  const p = '/w/site.config';
  noteSniffed(p, bytes(XML));
  assert.equal(fileTypeFor(p).id, 'xml');
  noteContent(p, { class: 'text' });
  assert.equal(fileTypeFor(p).id, 'xml');
  assert.equal(guessedFromBytes(p), true);
  noteContent(p, null);
  assert.equal(fileTypeFor(p).id, 'xml');
  noteSniffed(p, bytes('plain text now'));
  assert.equal(fileTypeFor(p).id, 'unknown');
});

test('a big file is framed, not parsed: a 300 KB JSON still sniffs, an INI with brackets does not', () => {
  const big = `[${Array.from({ length: 30000 }, (_, i) => `{"id":${i}}`).join(',')}]`;
  assert.ok(big.length > 256 * 1024);
  assert.equal(sniffFormat(bytes(big)), 'json');
  assert.equal(sniffFormat(bytes(`[core]\n${'a=b\n'.repeat(80000)}`)), null);
});

test('a big JSON is not parsed to be sure; a big XML with a declaration still is XML', () => {
  const pad = ' '.repeat(2 * 1024 * 1024);
  assert.equal(sniffFormat(bytes(`{"a":1}${pad}`)), null);
  assert.equal(sniffFormat(bytes(`<?xml version="1.0"?><a>${pad}</a>`)), 'xml');
  assert.equal(sniffFormat(bytes(`<a>${pad}</a>`)), null);
});

test('a BOM before the declaration does not hide it, and a later noteContent keeps the sniff', () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(XML)]);
  assert.equal(sniffFormat(withBom), 'xml');
  noteSniffed('/b/x.config2', withBom);
  assert.equal(fileTypeFor('/b/x.config2').id, 'xml');
  noteContent('/b/x.config2', null);
  assert.equal(fileTypeFor('/b/x.config2').id, 'xml');
});

test('a file past the limit is stamped by its head only: a change past the head does not re-sniff', () => {
  const p = '/w/huge.config3';
  const make = (tail: number): Uint8Array => {
    const b = new Uint8Array(2 * 1024 * 1024).fill(0x20);
    b.set(bytes(XML));
    b[b.length - 1] = tail;
    return b;
  };
  assert.equal(noteSniffed(p, make(1))?.id, 'xml');
  // Same head and length: the earlier answer stands without reading the rest.
  assert.equal(noteSniffed(p, make(2))?.id, 'xml');
  const other = make(1);
  other.set(bytes('plain'));
  assert.equal(noteSniffed(p, other), undefined);
});
