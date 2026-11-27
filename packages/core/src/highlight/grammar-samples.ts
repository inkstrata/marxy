// Test data: a short sample per language the registry names, and one polyglot sample every other allow-listed
// grammar is run over. Each sample holds a keyword, a string or a comment its grammar is expected to colour. Read by
// core's highlight test and the desktop app's role-parity test; nothing ships it.

/** Samples by language id, for the languages Read and Source are each asked to colour. */
export const GRAMMAR_SAMPLES: Readonly<Record<string, string>> = {
  ruby: 'class Greeter < Base\n  def hi(name) # say it\n    puts "hi #{name}"\n    return 42 if name.nil?\n  end\nend\n',
  php: '<?php\nfunction hi(string $name): string {\n  // greet\n  return "hi " . $name . 42;\n}\n',
  lua: 'local function hi(name) -- greet\n  if name == nil then return "none" end\n  return "hi " .. name .. 42\nend\n',
  r: 'hi <- function(name) {\n  # greet\n  if (is.null(name)) return("none")\n  paste("hi", name, 42)\n}\n',
  elixir: 'defmodule Greeter do\n  # greet\n  def hi(name) when is_binary(name), do: "hi #{name}"\n  def hi(_), do: :none\nend\n',
  haskell: 'module Main where\n-- greet\nhi :: String -> String\nhi name = "hi " ++ name\nmain = print (hi "x", 42)\n',
  vue: '<template>\n  <p class="marxy-hi">{{ name }}</p>\n</template>\n<script setup lang="ts">\nconst name = "x"; // greet\n</script>\n',
  svelte: '<script>\n  let name = "x"; // greet\n  export let n = 42;\n</script>\n<p class="marxy-hi">{name}</p>\n',
  scss: '$c: #333; // greet\n.hi {\n  color: $c;\n  &:hover { margin: 4px; }\n}\n',
  graphql: '# greet\nquery Hi($id: ID!) {\n  user(id: $id) { name age }\n}\n',
  make: '# greet\nCC := gcc\nall: main.o\n\t$(CC) -o app main.o\n.PHONY: all\n',
  csharp: 'using System;\n// greet\npublic class Hi {\n  public static int Main() { Console.WriteLine("hi"); return 42; }\n}\n',
  zig: 'const std = @import("std");\n// greet\npub fn main() void {\n    const x: u32 = 42;\n    std.debug.print("hi {d}\\n", .{x});\n}\n',
  powershell: '# greet\nfunction Get-Hi([string]$Name) {\n  if ($Name -eq $null) { return "none" }\n  Write-Output "hi $Name" 42\n}\n',
  terraform: '# greet\nresource "aws_s3_bucket" "b" {\n  bucket = "hi"\n  count  = 42\n  tags   = { Name = var.name }\n}\n',
  hcl: '# greet\nservice "web" {\n  port = 42\n  name = "hi"\n}\n',
  dart: '// greet\nvoid main() {\n  final name = "hi";\n  if (name.isEmpty) return;\n  print(42);\n}\n',
  perl: '# greet\nuse strict;\nsub hi { my ($name) = @_; return "hi $name"; }\nprint hi("x"), 42;\n',
  'objective-c': '// greet\n#import <Foundation/Foundation.h>\n@interface Hi : NSObject\n- (int)run;\n@end\nint main() { return 42; }\n',
  'objective-cpp': '// greet\n#import <Foundation/Foundation.h>\nclass Hi { public: int run() { return 42; } };\n',
  jsx: '// greet\nexport const App = () => <p className="marxy-hi">{42}</p>;\n',
  mdx: '# Hi\n\nimport X from "./x"\n\n<X n={42} />\n',
  just: '# greet\nbuild target="x":\n    echo "hi {{target}}"\n',
  dotenv: '# greet\nNAME="hi"\nCOUNT=42\n',
  rst: 'Title\n=====\n\n.. note:: greet\n\n``code`` and *emphasis*\n',
  matlab: '% greet\nfunction y = hi(x)\n  if x > 42\n    y = "hi";\n  end\nend\n',
  prolog: '% greet\nhi(Name) :- format("hi ~w~n", [Name]), X is 42.\n',
  kotlin: '// greet\nfun main() {\n    val name = "hi"\n    if (name.isEmpty()) return\n    println(42)\n}\n',
  swift: '// greet\nfunc hi(_ name: String) -> String {\n  if name.isEmpty { return "none" }\n  return "hi \\(name)"\n}\n',
  sql: '-- greet\nSELECT name, 42 FROM users WHERE id = \'x\';\n',
  python: '@decorator(1)\nclass Foo(Base):\n    def run(self, x: int = 3):\n        s = "plain"\n        print(f"a\\n{x!r} {self.y}")\n        return len([1])  # c\n',
  typescript: '@Component({a:1})\nclass A { b = 1; run(this: A) { console.log("a\\n", this.b, `t${1}`); } }\nconst o = { k: 1 }; const t = true; // c\n',
  rust: '#[derive(Debug)]\nstruct S { a: i32 }\nfn main() {\n    println!("hi\\n");\n    let x: Vec<u8> = Vec::new();\n    self.a;\n}\n',
  go: 'package main\nfunc (s *S) Run(x int) string {\n\tfmt.Println("a\\n", s.y)\n\treturn len(x)\n}\n// c\n',
  shellscript: 'if [ -n "$X" ]; then echo hi ; fi # c\n',
  c: '// greet\nint main(void) { return 0; }\n',
  cpp: '// greet\nclass A { public: int b = 2; };\n',
  java: '// greet\npublic class A { String s = "x"; }\n',
  toml: '# greet\n[t]\nk = "v"\nn = 3\n',
  yaml: '# greet\nkey: "value"\nn: 3\n',
  json: '{"a": 1, "b": "x", "c": true}\n',
  css: '/* greet */\nbody { color: red; margin: 4px; }\n',
  html: '<!-- greet -->\n<p class="marxy-hi">hi</p>\n',
  markdown: '# Title\n\nSome *text* and `code`.\n',
};

/**
 * One text for every other grammar: the comment marks, quotes, keywords, numbers and brackets most languages share, so
 * each grammar has something to read. What it makes of it is its own; the sample only has to exercise the tokenizer.
 */
export const POLYGLOT_SAMPLE = [
  '# comment',
  '// comment',
  '-- comment',
  '; comment',
  '/* block */',
  'def main(x) { return "str\\n" + 42; }',
  "if (a == 'b') then print(true) end",
  '<tag attr="v">text</tag>',
  'key: value',
  '[section]',
  'let y = 3.14',
  '',
].join('\n');
