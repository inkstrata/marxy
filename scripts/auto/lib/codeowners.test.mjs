import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeowners, ownedFiles } from './codeowners.mjs';

const text = `
# owner paths
/.github/            @owner
AGENTS.md            @owner
/docs/**/rules.md    @owner
/scripts/*.json      @owner
*.lock               @owner  # lockfiles
/scripts/allowlists/free.json
`;

test('parseCodeowners skips blanks and comments', () => {
  const rules = parseCodeowners(text);
  assert.equal(rules.length, 6);
  assert.deepEqual(rules[4].owners, ['@owner']);
  assert.deepEqual(rules[5].owners, []);
});

const rules = parseCodeowners(text);
const cases = [
  ['.github/workflows/ci.yml', true, 'anchored directory'],
  ['src/.github/x', false, 'anchored directory only at the root'],
  ['AGENTS.md', true, 'unanchored file name at the root'],
  ['packages/core/AGENTS.md', true, 'unanchored file name at depth'],
  ['docs/rules.md', true, '** matches no segments'],
  ['docs/a/b/rules.md', true, '** matches several segments'],
  ['scripts/registry.json', true, '* within a segment'],
  ['scripts/allowlists/dependencies.json', false, '* does not cross a slash'],
  ['pnpm-lock.lock', true, 'unanchored wildcard'],
  ['scripts/README.md', false, 'no rule'],
];
for (const [file, owned, why] of cases) {
  test(`ownedFiles: ${why}`, () => assert.deepEqual(ownedFiles([file], rules), owned ? [file] : []));
}

test('the last matching rule wins', () => {
  const r = parseCodeowners('/scripts/ @owner\n/scripts/auto/\n/scripts/auto/policy.mjs @owner');
  assert.deepEqual(ownedFiles(['scripts/a.mjs', 'scripts/auto/b.mjs', 'scripts/auto/policy.mjs'], r),
    ['scripts/a.mjs', 'scripts/auto/policy.mjs']);
});
