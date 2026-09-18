// Commit message conventions (docs/conventions.md). Run in CI over the PR's commits and its title.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'style', 'revert']],
    'scope-enum': [1, 'always', ['core', 'typeset', 'theme', 'shell', 'desktop', 'corpus', 'gates', 'ci', 'docs', 'orchestration', 'release', 'fonts', 'bootstrap', 'spike']],
    'header-max-length': [2, 'always', 72],
    'subject-full-stop': [2, 'never', '.'],
    'body-max-line-length': [1, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
    // The Jira key belongs in the subject: "(MARXY-123)" at the end. Warn (not fail) so bootstrap/spike history passes.
    'references-empty': [1, 'never'],
    'trailer-exists': [0],
  },
  parserPreset: { parserOpts: { issuePrefixes: ['MARXY-'], referenceActions: null } },
  ignores: [msg => /^(Merge|Revert)\b/.test(msg)],
};
