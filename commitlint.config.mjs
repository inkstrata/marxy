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
    // The Jira key belongs at the end of the subject, checked directly rather than through the
    // parser's issue references: with issuePrefixes set, a key mentioned anywhere in the body was
    // read as a footer, so a commit could not name a sibling story without failing.
    'marxy-key-in-subject': [2, 'always'],
    'trailer-exists': [0],
  },
  plugins: [{
    rules: {
      'marxy-key-in-subject': ({ header }) => [
        /\(MARXY-\d+\)$/.test(header ?? '') || /^(Merge|Revert|\w+(\(\w+\))?!?: .*\((bootstrap|spike)\))/.test(header ?? ''),
        'subject must end with the Jira key in parentheses, e.g. "(MARXY-23)" — docs/conventions.md',
      ],
    },
  }],
  ignores: [msg => /^(Merge|Revert)\b/.test(msg)],
};
