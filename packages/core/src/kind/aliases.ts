// A type the registry already has, under another extension or a fixed name (`.geojson` is JSON, `Cargo.lock` is TOML,
// `.zshrc` is shell). Pure data: `registry.ts` clones each target row under the new match, never associated, so the alias
// reads, colours and opens as its row does. No imports: the registry reads this, not the other way round.

/** Extensions are lowercase with no dot (the registry matches the last segment only); names are whole, lowercase. */
export interface Alias {
  readonly ext?: readonly string[];
  readonly name?: readonly string[];
}

/** By target row id. */
export const ROW_ALIASES: Readonly<Record<string, Alias>> = {
  // Programming languages
  awk: { ext: ['gawk', 'mawk', 'nawk'] },
  csharp: { ext: ['csx'] },
  cpp: { ext: ['c++', 'h++', 'hxx', 'inl', 'ino', 'ipp', 'ixx', 'cppm', 'tcc', 'tpp', 'txx'] },
  cobol: { ext: ['cobol', 'cpy'] },
  'common-lisp': { ext: ['asd'] },
  erlang: { ext: ['escript'], name: ['rebar.config', 'rebar.lock'] },
  elixir: { name: ['mix.lock'] },
  'emacs-lisp': { name: ['.emacs', '.spacemacs'] },
  groovy: { ext: ['gvy'], name: ['jenkinsfile'] },
  hlsl: { ext: ['fxh', 'hlsli', 'cginc'] },
  haskell: { ext: ['hs-boot', 'hsc'] },
  javascript: { ext: ['es6'] },
  java: { ext: ['jav', 'jsh'] },
  kotlin: { ext: ['ktm'] },
  lua: { ext: ['rockspec', 'wlua'], name: ['.luacheckrc'] },
  matlab: { ext: ['matlab'] },
  nim: { ext: ['nimble'] },
  ocaml: { ext: ['mll', 'mly', 'eliom'] },
  php: { ext: ['php3', 'php4', 'php5', 'phps', 'phpt', 'ctp'], name: ['.php_cs', '.php_cs.dist'] },
  plsql: { ext: ['plsql', 'pkb', 'pks'] },
  pascal: { ext: ['pascal', 'dpr', 'lpr'] },
  perl: { ext: ['perl', 'plx', 'psgi'], name: ['cpanfile', '.latexmkrc', 'latexmkrc'] },
  prolog: { ext: ['prolog', 'yap'] },
  python: { ext: ['pyi', 'pyw', 'py3', 'gyp', 'gypi', 'wsgi'], name: ['sconstruct', 'sconscript', 'wscript', '.gclient'] },
  raku: { ext: ['p6', 'pm6', 'pl6', 'nqp'] },
  r: { name: ['.rprofile'] },
  ruby: {
    ext: ['gemspec', 'podspec', 'rake', 'rbi', 'rbw', 'ru', 'jbuilder', 'thor', 'rabl'],
    name: ['.irbrc', '.pryrc', '.simplecov', 'berksfile', 'brewfile', 'capfile', 'dangerfile', 'fastfile', 'guardfile', 'podfile', 'puppetfile', 'steepfile', 'thorfile', 'vagrantfile'],
  },
  scala: { ext: ['sbt'] },
  zig: { ext: ['zon'] },
  viml: { name: ['.vimrc', '.gvimrc', '.nvimrc', '.exrc', '_vimrc'] },

  // Shell
  shellscript: {
    ext: ['bats', 'ksh', 'sbatch', 'slurm', 'zsh-theme', 'tmux'],
    name: [
      '.bash_aliases', '.bash_functions', '.bash_logout', '.bash_profile', '.bashrc', '.envrc', '.kshrc', '.profile', '.tmux.conf', '.xinitrc',
      '.xsession', '.zlogin', '.zlogout', '.zprofile', '.zshenv', '.zshrc', 'pkgbuild', 'gradlew', 'mvnw',
    ],
  },
  // Not searchable, like `.env`: it may hold secrets.
  dotenv: { name: ['.flaskenv'] },

  // Build and project files
  bicep: { ext: ['bicepparam'] },
  docker: { ext: ['containerfile'], name: ['containerfile'] },
  hcl: { ext: ['nomad'] },
  terraform: { ext: ['tofu'] },
  just: { ext: ['just'], name: ['.justfile'] },
  make: { ext: ['mak', 'make', 'makefile'], name: ['bsdmakefile', 'kbuild', 'makefile.am', 'makefile.in', 'makefile.inc'] },
  proto: { ext: ['textproto', 'pbtxt', 'txtpb'] },
  graphql: { ext: ['gql', 'graphqls'] },
  sql: { ext: ['mysql', 'pgsql', 'psql'] },
  'git-commit': { name: ['.gitmessage'] },

  // Markup and documents
  bibtex: { ext: ['bibtex'] },
  latex: { ext: ['ltx', 'dtx', 'ins', 'bbx', 'cbx', 'lbx'] },
  html: { ext: ['xht', 'xhtml'] },
  erb: { ext: ['rhtml'] },
  jinja: { ext: ['jinja2'] },
  razor: { ext: ['vbhtml'] },
  wikitext: { ext: ['wikitext'] },
  rst: { ext: ['rest'] },

  // Data
  ini: { ext: ['cnf', 'url', 'inf'], name: ['.coveragerc', '.flake8', '.pylintrc', 'pylintrc', '.codespellrc', '.editorconfig', '.gitconfig', '.gitmodules'] },
  json: {
    ext: ['avsc', 'geojson', 'topojson', 'gltf', 'har', 'mcmeta', 'sarif', 'tfstate', 'webmanifest', 'jsonld'],
    name: [
      '.arcconfig', '.watchmanconfig', '.all-contributorsrc', '.nycrc', '.c8rc', '.htmlhintrc', '.tern-project', 'module.bazel.lock', 'package.resolved',
      'pipfile.lock', 'composer.lock', 'deno.lock', 'flake.lock',
    ],
  },
  toml: { name: ['cargo.lock', 'gopkg.lock', 'pipfile', 'pdm.lock', 'poetry.lock', 'uv.lock', 'mise.lock'] },
  yaml: {
    ext: ['sublime-syntax', 'yaml-tmlanguage', 'cff'],
    name: ['.clang-format', '.clang-tidy', '.clangd', '.gemrc', 'citation.cff', 'glide.lock', 'pixi.lock'],
  },
  xml: {
    ext: [
      'ant', 'axaml', 'axml', 'ccproj', 'csproj', 'dita', 'ditamap', 'filters', 'fsproj', 'fxml', 'glade', 'gpx', 'iml', 'ivy', 'jelly', 'jsproj', 'kml',
      'mjml', 'mxml', 'natvis', 'nuspec', 'props', 'ps1xml', 'pubxml', 'rdf', 'resx', 'scxml', 'shproj', 'slnx', 'storyboard', 'targets', 'urdf', 'vbproj',
      'vcxproj', 'vsixmanifest', 'vstemplate', 'wixproj', 'wsdl', 'wxi', 'wxl', 'wxs', 'xacro', 'xaml', 'xib', 'xlf', 'xliff', 'xmi', 'xmp', 'xsd', 'xul',
      'zcml', 'opml',
    ],
    name: ['.classpath', '.cproject', '.project', 'app.config', 'nuget.config', 'web.config', 'packages.config', 'web.debug.config', 'web.release.config'],
  },
};

/** A grammar on the allow-list with no row of its own: the registry makes one, `associated: false`. */
export interface GrammarAlias extends Alias {
  readonly lang: string;
  readonly glob?: readonly string[];
}

export const NEW_GRAMMAR_ROWS: readonly GrammarAlias[] = [
  { lang: 'jsonc', ext: ['jsonc', 'code-workspace', 'sublime-settings', 'sublime-project', 'sublime-keymap', 'sublime-commands', 'sublime-menu'], name: ['.babelrc', '.jshintrc', '.jscsrc', '.swcrc', 'bun.lock'] },
  { lang: 'systemd', ext: ['service', 'socket', 'timer'] },
  { lang: 'ssh-config', name: ['ssh_config', 'sshd_config'] },
  { lang: 'apache', name: ['.htaccess', 'httpd.conf', 'apache2.conf'] },
  { lang: 'postcss', ext: ['pcss', 'postcss'] },
  { lang: 'codeql', ext: ['ql', 'qll'] },
  { lang: 'gn', ext: ['gn', 'gni'] },
  { lang: 'ahk', ext: ['ahk', 'ahkl'] },
  { lang: 'wolfram', ext: ['wl', 'wlt', 'wls'] },
  { lang: 'stata', ext: ['ado', 'mata', 'sthlp'] },
  { lang: 'coq', ext: ['coq'] },
  { lang: 'hy', ext: ['hy'] },
  { lang: 'hxml', ext: ['hxml'] },
  { lang: 'rbs', ext: ['rbs'] },
  { lang: 'soy', ext: ['soy'] },
  { lang: 'surrealql', ext: ['surql'] },
  { lang: 'c3', ext: ['c3'] },
  // A glob, so it beats the `php` extension; nothing but a Blade template is called `*.blade.php`.
  { lang: 'blade', glob: ['*.blade.php'] },
  { lang: 'shellsession', ext: ['sh-session'] },
  { lang: 'fortran-fixed-form', ext: ['f77'] },
];
