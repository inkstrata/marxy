// B-25.1: the diagram-caption rule looks one step past its caption, never into the fence.
//
// `.marxy-article > p:has(+ pre > code.language-mermaid)` made WebKit re-check the whole article on
// every appended block, so a transcript with a fence every few blocks mounted in cubic time (B-25).
// `p:has(+ pre.language-mermaid)` costs what a sibling check costs. This test parses base.css and
// holds every caption rule to one compound selector after the `+`; it asserts no timing.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every innermost rule as `{ selectors, body }`, at-rule preludes left out. */
function rules(source) {
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{') {
      stack.push({ prelude: source.slice(start, i).trim(), open: i + 1 });
      start = i + 1;
    } else if (source[i] === '}') {
      const frame = stack.pop();
      const body = source.slice(frame.open, i);
      if (!frame.prelude.startsWith('@') && !body.includes('{')) out.push({ selectors: splitTop(frame.prelude, ','), body });
      start = i + 1;
    }
  }
  return out;
}

/** Split on `separator` outside parentheses. */
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === separator && depth === 0) {
      parts.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
}

/** The argument of each `:has(` in a selector. */
function hasArguments(selector) {
  const args = [];
  for (let at = selector.indexOf(':has('); at !== -1; at = selector.indexOf(':has(', at + 1)) {
    let depth = 1;
    let i = at + 5;
    for (; i < selector.length && depth > 0; i++) {
      if (selector[i] === '(') depth++;
      else if (selector[i] === ')') depth--;
    }
    args.push(selector.slice(at + 5, i - 1).trim());
  }
  return args;
}

const captionRules = rules(css).filter((rule) => /font-size:\s*var\(--marxy-size-caption\)/.test(rule.body) && rule.selectors.some((s) => s.includes(':has(')));

test('there is one diagram-caption rule, and it names the four diagram languages (B-25.1)', () => {
  assert.equal(captionRules.length, 1);
  const selectors = captionRules[0].selectors;
  for (const lang of ['mermaid', 'plantuml', 'dot', 'd2']) {
    assert.ok(selectors.includes(`.marxy-article > p:has(+ pre.language-${lang})`), `no caption selector for ${lang}: ${selectors.join(', ')}`);
  }
});

test('every caption selector has one compound selector after the `+`, so no rule reaches into the fence (B-25.1)', () => {
  for (const selector of captionRules[0].selectors) {
    const args = hasArguments(selector);
    assert.equal(args.length, 1, `${selector}: expected one :has()`);
    const after = args[0].replace(/^\+\s*/, '');
    assert.notEqual(after, args[0], `${selector}: the :has() argument does not start with +`);
    // A combinator (descendant space, `>`, `+`, `~`) after the first compound is a second step.
    assert.doesNotMatch(after, /[\s>+~]/, `${selector}: "${after}" is more than one step past the +`);
  }
});
