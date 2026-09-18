// Conformance inputs written for marxy, one per CommonMark *rule*, in our own arrangement.
//
// Provenance, precisely: every input below was written here, from the rules the CommonMark
// specification states in prose — "a fence is three or more backticks", "up to three spaces of
// indentation", "a closing sequence must be preceded by a space" — and the wording of each `rule`
// field is our summary of the rule, not the specification's text. The inputs are not the
// specification's examples and are not in its order: they are grouped by the construct a reader
// meets, and their content is this project's vocabulary. The specification's own example set is
// CC-BY-SA-4.0, and a set of test vectors is protected by the selection and arrangement even where
// each snippet is too short to protect, so it is not transcribed into this MIT tree (ADR-0006).
//
// A handful of these inputs do coincide with a specification example, because some rules have exactly
// one minimal form: an empty block quote can only be written `>`. `scripts/commonmark-spec.ts` prints
// how many and which ones when a developer has the example file, so the claim is checkable rather than
// asserted — it was 7 of 287 when this file was written.
//
// What makes these cases *check* anything is the oracle, not the input: `conformance.test.ts` renders
// our AST to HTML and compares it with the reference implementation (`commonmark`, BSD-2-Clause,
// dev-only). Breadth beyond these rules comes from `generate.ts`, which composes constructs from a
// seed. The specification's full example set stays available to anyone who wants it, unvendored, via
// `pnpm --filter @marxy/core test:spec` (see ../../scripts/commonmark-spec.ts).

export interface Case {
  /** The construct a reader meets, our taxonomy. */
  readonly construct: string;
  /** The rule this input exercises, in our words. */
  readonly rule: string;
  readonly input: string;
}

const c = (construct: string, rule: string, input: string): Case => ({ construct, rule, input });

export const RULE_CASES: readonly Case[] = [
  // --- paragraphs and text -----------------------------------------------------------------------
  c('paragraphs', 'a blank line separates paragraphs', 'marxy reads.\n\nIt does not write.\n'),
  c('paragraphs', 'consecutive lines are one paragraph, joined by a soft break', 'a reader\nof markdown\n'),
  c('paragraphs', 'leading whitespace on a paragraph line is dropped', '   marxy\n  reads\n'),
  c('paragraphs', 'trailing whitespace on a paragraph line is dropped', 'marxy reads   \n'),
  c('paragraphs', 'many blank lines still make one break', 'first\n\n\n\n\nsecond\n'),
  c('paragraphs', 'a document of only whitespace has no blocks', '   \n\t\n  \n'),
  c('paragraphs', 'a document with no trailing newline still ends its paragraph', 'no newline at the end'),
  c('paragraphs', 'an empty document produces nothing', ''),
  c('paragraphs', 'interior runs of spaces are kept as written', 'two  spaces   and\ttab\n'),
  c('paragraphs', 'a lone NUL is replaced, not dropped', 'by\u0000te\n'),
  c('paragraphs', 'text may be any Unicode: CJK, RTL, combining marks, astral', '读者 مرحبا é\u0301 𝔊 😀\n'),
  c('paragraphs', 'CRLF ends a line like LF', 'windows\r\nlines\r\n\r\nsecond\r\n'),
  c('paragraphs', 'a lone CR ends a line too', 'old mac\rlines\r'),

  // --- backslash escapes -------------------------------------------------------------------------
  c('escapes', 'a backslash before ASCII punctuation is literal', '\\*not emphasis\\* and \\`not code\\`\n'),
  c('escapes', 'a backslash before a non-punctuation character is literal backslash', '\\marxy \\4 \\é\n'),
  c('escapes', 'an escaped backslash does not escape what follows', '\\\\*this is emphasis*\n'),
  c('escapes', 'escapes do not work inside a code span', '`\\*kept\\*`\n'),
  c('escapes', 'escapes do not work inside an indented code block', '    \\[kept\\]\n'),
  c('escapes', 'escapes do not work inside a fenced code block', '```\n\\_kept\\_\n```\n'),
  c('escapes', 'an escape disables a block marker at the start of a line', '\\# not a heading\n\n\\> not a quote\n'),
  c('escapes', 'an escape disables a list marker', '\\- not a bullet\n\n1\\. not ordered\n'),
  c('escapes', 'an escaped bracket does not open a link', '\\[marxy](/reader)\n'),
  c('escapes', 'an escape works inside a link destination and title', '[r](/a\\*b "t\\*t")\n'),
  c('escapes', 'an escaped pipe is not a cell divider', '| a \\| b |\n| --- |\n| c |\n'),
  c('escapes', 'a backslash at end of line is a hard break, not an escape of the line ending', 'bytes\\\nkept\n'),

  // --- character references ----------------------------------------------------------------------
  c('entities', 'a named reference decodes', '&amp; &copy; &hellip;\n'),
  c('entities', 'a decimal reference decodes', '&#98;&#121;&#116;&#101;\n'),
  c('entities', 'a hexadecimal reference decodes in either case', '&#x62;&#X79;\n'),
  c('entities', 'an astral reference decodes to a surrogate pair', '&#x1F4D6; &#128214;\n'),
  c('entities', 'a NUL reference becomes the replacement character', '&#0;\n'),
  c('entities', 'an unknown or malformed reference is literal text', '&marxy; &#; &#x; &amp\n'),
  c('entities', 'a reference does not create markup', '&#42;not emphasis&#42;\n'),
  c('entities', 'a reference does not create a block marker', '&#35; not a heading\n'),
  c('entities', 'references are literal inside code', '`&amp;` and\n\n    &amp;\n'),
  c('entities', 'a reference decodes inside a link destination', '[r](/f&ouml;&ouml;)\n'),
  c('entities', 'a reference decodes inside a fence info string', '```f&ouml;&ouml;\nx\n```\n'),

  // --- code spans --------------------------------------------------------------------------------
  c('code spans', 'a single backtick pair delimits code', '`read()`\n'),
  c('code spans', 'a longer backtick run delimits code containing backticks', '``a ` b``\n'),
  c('code spans', 'one space is stripped from each end when both are present', '` a `\n'),
  c('code spans', 'only one space is stripped from each end', '`  a  `\n'),
  c('code spans', 'a code span of only spaces keeps one', '`  `\n'),
  c('code spans', 'stripping needs a space at both ends', '` a`\n'),
  c('code spans', 'line endings inside a code span become spaces', '`read\nand\nwrite`\n'),
  c('code spans', 'a backtick run must be matched in length', '``a`\n'),
  c('code spans', 'an unmatched backtick run is literal', '`marxy\n'),
  c('code spans', 'code spans bind tighter than emphasis', '*marxy`*`\n'),
  c('code spans', 'code spans bind tighter than links', '[not a `link](/x`)\n'),
  c('code spans', 'code spans bind tighter than raw HTML', '`<b>` and <b>`</b>\n'),
  c('code spans', 'a code span may hold markdown-looking text', '`# *_[]()_*`\n'),

  // --- emphasis ----------------------------------------------------------------------------------
  c('emphasis', 'a star pair emphasises', '*reader*\n'),
  c('emphasis', 'an underscore pair emphasises', '_reader_\n'),
  c('emphasis', 'two stars make strong', '**reader**\n'),
  c('emphasis', 'two underscores make strong', '__reader__\n'),
  c('emphasis', 'three make strong inside emphasis', '***reader***\n'),
  c('emphasis', 'an opening run must be left-flanking: no space after it', '* not emphasis *\n'),
  c('emphasis', 'a closing run must be right-flanking: no space before it', '*not emphasis *\n'),
  c('emphasis', 'a star run may open mid-word', 'by*te*s\n'),
  c('emphasis', 'an underscore run may not open mid-word', 'by_te_s\n'),
  c('emphasis', 'an underscore run may not close mid-word', '_by_tes\n'),
  c('emphasis', 'intraword underscores stay literal in numbers too', '5_6_7\n'),
  c('emphasis', 'a star run can be both opener and closer', '*(*reader*)*\n'),
  c('emphasis', 'delimiters must nest, not interleave', '*reader _of_ marks*\n'),
  c('emphasis', 'mismatched delimiter kinds do not pair', '_reader*\n'),
  c('emphasis', 'emphasis may span a soft break', '*reader\nof marks*\n'),
  c('emphasis', 'emphasis may not span a blank line', '*reader\n\nof marks*\n'),
  c('emphasis', 'strong may contain emphasis', '**reader *of* marks**\n'),
  c('emphasis', 'emphasis may contain strong', '*reader **of** marks*\n'),
  c('emphasis', 'adjacent runs split into nested emphasis', '*reader**of**marks*\n'),
  c('emphasis', 'a run longer than four still resolves left to right', 'a******b*********c\n'),
  c('emphasis', 'an empty run is literal', '** ** and **** ****\n'),
  c('emphasis', 'emphasis may wrap a link', '*[reader](/r)*\n'),
  c('emphasis', 'a link may wrap emphasis', '[*reader*](/r)\n'),
  c('emphasis', 'emphasis may wrap an image', '*![alt](/i.png)*\n'),
  c('emphasis', 'a delimiter inside code does not pair with one outside', '*a `*` b*\n'),
  c('emphasis', 'a delimiter inside a raw tag does not pair', '**a<https://e.invalid/?q=**>\n'),
  c('emphasis', 'punctuation next to a run still flanks', 'read-_only_ and (*this*)\n'),
  c('emphasis', 'a quoted word emphasises intraword with stars', 'a*"reader"*\n'),
  c('emphasis', 'strikethrough is not CommonMark: tildes stay literal', '~~reader~~\n'),
  c('emphasis', 'nested strong inside emphasis inside strong', '**a *b **c** d* e**\n'),

  // --- links -------------------------------------------------------------------------------------
  c('links', 'an inline link takes a destination', '[reader](/r)\n'),
  c('links', 'an inline link takes a title in double quotes', '[reader](/r "the reader")\n'),
  c('links', 'a title may use single quotes or parentheses', "[a](/r 'one') [b](/r (two))\n"),
  c('links', 'a destination may be empty', '[reader]()\n'),
  c('links', 'an angle-bracketed destination may hold spaces', '[reader](</the reader>)\n'),
  c('links', 'a bare destination may not hold spaces', '[reader](/the reader)\n'),
  c('links', 'a destination may hold balanced parentheses', '[reader](/r(and)s)\n'),
  c('links', 'an unbalanced parenthesis must be escaped', '[reader](/r\\))\n'),
  c('links', 'the link text may be empty', '[](/r)\n'),
  c('links', 'the link text may hold emphasis and code', '[*reader* `now`](/r)\n'),
  c('links', 'the link text may not hold another link', '[a [reader](/r) b](/outer)\n'),
  c('links', 'brackets in link text must be balanced or escaped', '[reader \\[note\\]](/r)\n'),
  c('links', 'a full reference link resolves against its definition', '[reader][ref]\n\n[ref]: /r "t"\n'),
  c('links', 'a collapsed reference link uses its own text as label', '[reader][]\n\n[reader]: /r\n'),
  c('links', 'a shortcut reference link uses its text as label', '[reader]\n\n[reader]: /r\n'),
  c('links', 'label matching folds case and collapses whitespace', '[READER   OF\nMARKS]\n\n[reader of marks]: /r\n'),
  c('links', 'label matching folds Unicode case', '[ΣΊΓΜΑ]\n\n[σίγμα]: /r\n'),
  c('links', 'an unresolved reference stays literal text', '[reader][missing]\n'),
  c('links', 'the first definition of a label wins', '[reader]\n\n[reader]: /first\n[reader]: /second\n'),
  c('links', 'a definition may wrap across lines', '[reader]: \n  /r\n  "the title"\n\n[reader]\n'),
  c('links', 'a definition is not a paragraph, and renders nothing', '[reader]: /r\n'),
  c('links', 'a definition indented four spaces is code, not a definition', '    [reader]: /r\n\n[reader]\n'),
  c('links', 'a definition may follow a paragraph line only if the paragraph ends', 'marxy\n[reader]: /r\n'),
  c('links', 'an inline link wins over a definition of the same label', '[reader](/inline)\n\n[reader]: /ref\n'),
  c('links', 'a destination is percent-encoded but existing escapes are kept', '[a](/a b%20c&d)\n'),
  c('links', 'a destination may be a fragment or a query', '[a](#byte) [b](?q=1#f)\n'),

  // --- images ------------------------------------------------------------------------------------
  c('images', 'an image takes alt text and a source', '![the reader](/r.png)\n'),
  c('images', 'an image takes a title', '![alt](/r.png "a title")\n'),
  c('images', 'alt text is flattened from inline content', '![*a* `b` [c](/c)](/r.png)\n'),
  c('images', 'alt text may be empty', '![](/r.png)\n'),
  c('images', 'a reference image resolves against its definition', '![reader][ref]\n\n[ref]: /r.png "t"\n'),
  c('images', 'a shortcut reference image uses its alt as label', '![reader]\n\n[reader]: /r.png\n'),
  c('images', 'an escaped bang is literal, and the brackets still link', '\\![reader]\n\n[reader]: /r\n'),
  c('images', 'an image may sit inside a link', '[![alt](/i.png)](/r)\n'),
  c('images', 'an unresolved reference image stays literal', '![reader][missing]\n'),

  // --- autolinks ---------------------------------------------------------------------------------
  c('autolinks', 'an absolute URI in angle brackets is a link', '<https://marxy.invalid/read>\n'),
  c('autolinks', 'the scheme may be any letter-digit-plus-dot-hyphen run', '<x-y+z.1:anything>\n'),
  c('autolinks', 'an email in angle brackets becomes a mailto link', '<reader@marxy.invalid>\n'),
  c('autolinks', 'a URI autolink may not hold spaces', '<https://marxy.invalid/a b>\n'),
  c('autolinks', 'backslash escapes do not work in an autolink', '<https://marxy.invalid/?q=\\*>\n'),
  c('autolinks', 'an ampersand in an autolink is escaped in HTML, not decoded', '<https://marxy.invalid/?a=1&b=2>\n'),
  c('autolinks', 'empty angle brackets are literal', '<>\n'),
  c('autolinks', 'a plain URL without brackets is not a CommonMark link', 'read https://marxy.invalid/ now\n'),
  c('autolinks', 'a bare email without brackets is not a CommonMark link', 'mail reader@marxy.invalid now\n'),

  // --- raw HTML (inline) -------------------------------------------------------------------------
  c('raw html', 'an open tag passes through', 'press <kbd>b</kbd> now\n'),
  c('raw html', 'a self-closing tag passes through', 'a <br/> b <br /> c\n'),
  c('raw html', 'attributes may be unquoted, single- or double-quoted', '<a href=x id=\'y\' class="z">\n'),
  c('raw html', 'an attribute value may hold markdown characters', '<span title="*not* emphasis">\n'),
  c('raw html', 'a tag may span a line ending', '<span\n  class="reader">\n'),
  c('raw html', 'an invalid tag name is literal text', '<3a> <_b>\n'),
  c('raw html', 'a malformed attribute makes it literal text', '<a h*ref="x">\n'),
  c('raw html', 'a closing tag takes no attributes', '</a href="x">\n'),
  c('raw html', 'a comment passes through', 'a <!-- byte -- fidelity --> b\n'),
  c('raw html', 'a processing instruction passes through', 'a <?marxy read?> b\n'),
  c('raw html', 'a declaration passes through', 'a <!DOCTYPE reader> b\n'),
  c('raw html', 'a CDATA section passes through', 'a <![CDATA[>&<]]> b\n'),
  c('raw html', 'text inside raw inline HTML is still markdown', '<b>*read*</b>\n'),

  // --- line breaks -------------------------------------------------------------------------------
  c('hard breaks', 'two trailing spaces make a hard break', 'read  \non\n'),
  c('hard breaks', 'more than two trailing spaces also make one', 'read     \non\n'),
  c('hard breaks', 'a trailing backslash makes a hard break', 'read\\\non\n'),
  c('hard breaks', 'one trailing space is a soft break', 'read \non\n'),
  c('hard breaks', 'leading whitespace after a hard break is dropped', 'read  \n     on\n'),
  c('hard breaks', 'a hard break works inside emphasis', '*read  \non*\n'),
  c('hard breaks', 'a hard break does not work inside a code span', '`read  \non`\n'),
  c('hard breaks', 'a hard break does not work inside raw HTML', '<a href="read  \non">\n'),
  c('hard breaks', 'a break may not end a paragraph', 'read\\\n\nread  \n'),
  c('hard breaks', 'a break may not end a heading', '# read\\\n\n# read  \n'),
  c('soft breaks', 'a line ending in a paragraph is a soft break', 'read\non\n'),
  c('soft breaks', 'surrounding spaces are dropped from a soft break', 'read \n on\n'),

  // --- ATX headings ------------------------------------------------------------------------------
  c('atx headings', 'one to six hashes make levels one to six', '# a\n## b\n### c\n#### d\n##### e\n###### f\n'),
  c('atx headings', 'seven hashes are not a heading', '####### g\n'),
  c('atx headings', 'the hashes need a space or a line ending after them', '#marxy\n\n#\n'),
  c('atx headings', 'up to three spaces of indentation are allowed', '   ### indented\n'),
  c('atx headings', 'four spaces make it code', '    ### code\n'),
  c('atx headings', 'extra spaces after the hashes are dropped', '#      read      \n'),
  c('atx headings', 'a closing hash sequence is dropped', '## read ##\n'),
  c('atx headings', 'a closing sequence needs a space before it', '## read##\n'),
  c('atx headings', 'text after a closing sequence keeps the hashes', '## read ## now\n'),
  c('atx headings', 'an escaped hash is not a closing sequence', '## read \\##\n'),
  c('atx headings', 'heading content is inline markdown', '# *read* `now` [r](/r)\n'),
  c('atx headings', 'an empty heading is allowed', '##\n###   \n'),
  c('atx headings', 'a heading needs no blank line around it', 'a\n# b\nc\n'),
  c('atx headings', 'a tab after the hashes works like a space', '#\tread\n'),

  // --- setext headings ---------------------------------------------------------------------------
  c('setext headings', 'equals underlines make level one', 'read\n====\n'),
  c('setext headings', 'hyphens underline makes level two', 'read\n----\n'),
  c('setext headings', 'a single underline character is enough', 'read\n=\n'),
  c('setext headings', 'the underline may be indented up to three spaces', 'read\n   ---\n'),
  c('setext headings', 'four spaces of indentation is not an underline', 'read\n    ---\n'),
  c('setext headings', 'the underline may have trailing spaces', 'read\n---   \n'),
  c('setext headings', 'the underline may not have interior spaces', 'read\n-- -\n'),
  c('setext headings', 'a multi-line paragraph becomes one setext heading', 'read\non\n===\n'),
  c('setext headings', 'the content may hold inline markup across lines', '*read\non*\n===\n'),
  c('setext headings', 'a hyphen underline after a blank line is a thematic break', '\n---\n'),
  c('setext headings', 'an underline cannot follow a code block', '    read\n---\n'),
  c('setext headings', 'an underline cannot follow a list', '- read\n---\n'),
  c('setext headings', 'an underline cannot interrupt a quote', '> read\n---\n'),

  // --- thematic breaks ---------------------------------------------------------------------------
  c('thematic breaks', 'three or more stars, hyphens or underscores make a break', '***\n\n---\n\n___\n'),
  c('thematic breaks', 'two are not enough', '**\n\n--\n\n__\n'),
  c('thematic breaks', 'spaces between the characters are allowed', ' * * *\n'),
  c('thematic breaks', 'the characters may not be mixed', '*-*\n'),
  c('thematic breaks', 'up to three spaces of indentation are allowed', '   ***\n'),
  c('thematic breaks', 'four spaces make it code', '    ***\n'),
  c('thematic breaks', 'no other content may follow on the line', '*** read\n'),
  c('thematic breaks', 'a break may interrupt a paragraph', 'read\n***\non\n'),
  c('thematic breaks', 'a break takes precedence over a list item', '* read\n* * *\n'),

  // --- indented code blocks ----------------------------------------------------------------------
  c('indented code', 'four spaces start a code block', '    read()\n'),
  c('indented code', 'indentation beyond four is content', '    read\n      deeper\n'),
  c('indented code', 'a tab counts as four columns', '\tread()\n'),
  c('indented code', 'mixed tab and space indentation reaches the four columns', '  \tread()\n'),
  c('indented code', 'content is literal, not markdown', '    *read* <b>x</b> &amp;\n'),
  c('indented code', 'content may look like a fence', '\t```\n\tread\n'),
  c('indented code', 'interior blank lines stay inside one block', '    read\n\n    on\n'),
  c('indented code', 'trailing blank lines are not part of the block', '    read\n    \n\n'),
  c('indented code', 'a code block may not interrupt a paragraph', 'read\n    on\n'),
  c('indented code', 'a code block may follow a paragraph after a blank line', 'read\n\n    on\n'),
  c('indented code', 'blank lines inside keep their own indentation harmlessly', '    read\n      \n    on\n'),

  // --- fenced code blocks ------------------------------------------------------------------------
  c('fenced code', 'three backticks open and close a block', '```\nread\n```\n'),
  c('fenced code', 'three tildes open and close a block', '~~~\nread\n~~~\n'),
  c('fenced code', 'two backticks are not a fence', '``\nread\n``\n'),
  c('fenced code', 'the closing fence must be at least as long', '````\nread\n```\n````\n'),
  c('fenced code', 'a longer closing fence is allowed', '```\nread\n`````\n'),
  c('fenced code', 'the other fence character does not close it', '```\n~~~\n```\n'),
  c('fenced code', 'an unclosed fence runs to the end of the document', '```\nread\n'),
  c('fenced code', 'an empty fenced block is allowed', '```\n```\n'),
  c('fenced code', 'a fenced block of blank lines keeps them', '```\n\n  \n```\n'),
  c('fenced code', 'the info string names the language', '```rust\nfn read() {}\n```\n'),
  c('fenced code', 'only the first word of the info string is the language', '```rust edition=2021\nfn read() {}\n```\n'),
  c('fenced code', 'a backtick fence may not have a backtick in its info string', '``` a`b\nread\n```\n'),
  c('fenced code', 'a tilde fence may have backticks in its info string', '~~~ a`b`c\nread\n~~~\n'),
  c('fenced code', 'fence indentation is removed from the content lines', '  ```\n  read\n   deeper\n ```\n'),
  c('fenced code', 'content indented less than the fence keeps no indentation', '   ```\nread\n   ```\n'),
  c('fenced code', 'a closing fence may be indented up to three spaces', '```\nread\n   ```\n'),
  c('fenced code', 'a closing fence indented four spaces is content', '```\nread\n    ```\n'),
  c('fenced code', 'a closing fence may not have other content', '```\nread\n``` now\n'),
  c('fenced code', 'a fence may interrupt a paragraph', 'read\n```\non\n```\n'),
  c('fenced code', 'content is literal, not markdown', '```\n*read* <b>x</b> [r](/r)\n```\n'),

  // --- block quotes ------------------------------------------------------------------------------
  c('block quotes', 'a greater-than sign quotes a block', '> read\n'),
  c('block quotes', 'the space after the marker is optional', '>read\n'),
  c('block quotes', 'up to three spaces of indentation are allowed', '   > read\n'),
  c('block quotes', 'four spaces make it code', '    > read\n'),
  c('block quotes', 'a paragraph continues lazily without a marker', '> read\non\n'),
  c('block quotes', 'a blank line ends the quote', '> read\n\non\n'),
  c('block quotes', 'an interior blank quote line separates paragraphs', '> read\n>\n> on\n'),
  c('block quotes', 'a quote may contain a quote', '> > read\n'),
  c('block quotes', 'markers may be written without spaces when nested', '>>> read\n'),
  c('block quotes', 'a quote may hold any block: heading, list, code', '> # read\n> - a\n> ```\n> x\n> ```\n'),
  c('block quotes', 'an empty quote is allowed', '>\n'),
  c('block quotes', 'a quote may interrupt a paragraph', 'read\n> on\n'),
  c('block quotes', 'lazy continuation does not extend to a new block', '> read\n- on\n'),
  c('block quotes', 'an indented code block inside a quote needs its own four spaces', '>     read\n'),
  c('block quotes', 'two quotes separated by a blank line are separate', '> a\n\n> b\n'),

  // --- lists -------------------------------------------------------------------------------------
  c('lists', 'a hyphen, star or plus starts a bullet list', '- a\n\n* b\n\n+ c\n'),
  c('lists', 'changing the bullet character starts a new list', '- a\n* b\n'),
  c('lists', 'a number with a dot or paren starts an ordered list', '1. a\n\n1) b\n'),
  c('lists', 'changing the ordered delimiter starts a new list', '1. a\n1) b\n'),
  c('lists', 'the first number sets the start attribute', '7. a\n8. b\n'),
  c('lists', 'later numbers are ignored', '1. a\n9. b\n'),
  c('lists', 'up to nine digits are allowed in a marker', '123456789. a\n'),
  c('lists', 'ten digits are not a marker', '1234567890. a\n'),
  c('lists', 'a marker needs a space or line ending after it', '-a\n\n1.a\n'),
  c('lists', 'content is indented to the first non-space after the marker', '-    read\n     on\n'),
  c('lists', 'an item may start with a blank line, then one space of content indent', '-\n  read\n'),
  c('lists', 'an item may be empty', '- a\n-\n- b\n'),
  c('lists', 'an empty item may not interrupt a paragraph', 'read\n-\n'),
  c('lists', 'a blank line between items makes the list loose', '- a\n\n- b\n'),
  c('lists', 'a blank line inside an item makes the list loose', '- a\n\n  still a\n- b\n'),
  c('lists', 'a tight list wraps no paragraphs', '- a\n- b\n'),
  c('lists', 'two blank lines no longer end a list', '- a\n\n\n- b\n'),
  c('lists', 'an item may hold several blocks', '1. read\n\n   ```\n   x\n   ```\n\n   > q\n'),
  c('lists', 'sub-lists nest by indentation', '- a\n  - b\n    - c\n'),
  c('lists', 'insufficient indentation makes a sibling, not a child', '- a\n - b\n  - c\n'),
  c('lists', 'a list marker may follow a list marker on one line', '- - read\n'),
  c('lists', 'an item may start with a heading', '- # read\n- on\n'),
  c('lists', 'a list interrupts a paragraph only for bullets and a one-start', 'read\n- on\n\nread\n1. on\n\nread\n2. not a list\n'),
  c('lists', 'an ordered item needs its content indented past the marker', '10. a\n    - b\n'),
  c('lists', 'code inside an item is indented relative to the content column', '- read\n\n      code\n'),
  c('lists', 'a definition inside an item still defines', '- a\n- [ref]: /r\n- [a][ref]\n'),
  c('lists', 'a task marker is not CommonMark: the brackets stay text', '- [x] read\n- [ ] on\n'),

  // --- HTML blocks -------------------------------------------------------------------------------
  c('html blocks', 'a known block tag starts an HTML block that ends at a blank line', '<div>\n*read*\n</div>\n'),
  c('html blocks', 'markdown resumes after the blank line', '<div>\n\n*read*\n\n</div>\n'),
  c('html blocks', 'a script block ends at its closing tag', '<script>\nlet a = 1 < 2;\n</script>\nread\n'),
  c('html blocks', 'a pre block ends at its closing tag', '<pre>\n  read\n</pre>\nread\n'),
  c('html blocks', 'a comment block ends at the comment close', '<!-- read\n\non -->\nafter\n'),
  c('html blocks', 'a processing instruction block ends at its close', '<?marxy\n\nread ?>\nafter\n'),
  c('html blocks', 'a declaration block ends at the angle bracket', '<!DOCTYPE html>\n'),
  c('html blocks', 'a CDATA block ends at its close', '<![CDATA[\nread\n]]>\nafter\n'),
  c('html blocks', 'an unknown tag on its own line still starts a block', '<reader-widget>\nread\n</reader-widget>\n'),
  c('html blocks', 'a closing tag may start a block', '</div>\nread\n'),
  c('html blocks', 'an HTML block may be indented up to three spaces', '  <div>\n  read\n'),
  c('html blocks', 'four spaces make it code', '    <div>\n'),
  c('html blocks', 'a paragraph is not interrupted by an unknown inline tag', 'read\n<a href="/r">\non\n'),
  c('html blocks', 'a known block tag does interrupt a paragraph', 'read\n<div>\non\n'),
  c('html blocks', 'a block may hold blank-looking markup on one line', '<div></div>\n```\nread\n```\n'),

  // --- tabs --------------------------------------------------------------------------------------
  c('tabs', 'a tab is four columns for block structure', '\tread\n'),
  c('tabs', 'a tab after a list marker indents the content', '-\tread\n'),
  c('tabs', 'a tab after a quote marker is content indentation', '>\tread\n'),
  c('tabs', 'a tab inside a paragraph is kept as a tab', 'read\tand\twrite\n'),
  c('tabs', 'a tab inside code is kept as a tab', '    read\tcode\n'),
  c('tabs', 'a tab may reach the code indentation inside a list item', '- read\n\n\t\tcode\n'),
  c('tabs', 'a tab-indented fence is code content, not a fence', '\t~~~\n\tread\n\t~~~\n'),

  // --- documents that mix constructs ---------------------------------------------------------------
  c('documents', 'a README shape: heading, prose, list, code, table-free', '# marxy\n\nA markdown **reader**.\n\n- fast\n- quiet\n\n```sh\npnpm test\n```\n'),
  c('documents', 'a quote holding a nested list and a fence', '> - a\n>   - b\n>\n> ```\n> read\n> ```\n'),
  c('documents', 'an agent artifact shape: headings, tasks as text, code', '## Plan\n\n1. read\n2. write\n\n    indented note\n\n### Notes\n\n`byte` fidelity\n'),
  c('documents', 'prose with every inline construct at once', 'A *reader* with **marks**, `code`, [a link](/r "t"), ![an image](/i.png), <https://e.invalid>, <kbd>K</kbd>, an &amp; entity and a hard break  \nafter it.\n'),
  c('documents', 'CJK and RTL prose with markup', '**读者** 与 `代码`。\n\nمرحبا *بالعالم* [رابط](/r).\n'),
  c('documents', 'a document that is one long paragraph of soft breaks', 'a\nb\nc\nd\ne\nf\n'),
  c('documents', 'nested quotes holding nested lists holding code', '> > - a\n> >   ```\n> >   read\n> >   ```\n'),
  c('documents', 'headings of every level separated by prose', '# a\n\np\n\n## b\n\np\n\n### c\n\np\n\n#### d\n\np\n\n##### e\n\np\n\n###### f\n'),
];
