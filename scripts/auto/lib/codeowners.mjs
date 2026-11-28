// The subset of GitHub's CODEOWNERS syntax the merge gate needs: which changed files wait for the owner.

export function parseCodeowners(text) {
  const rules = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...rest] = line.split(/\s+/);
    // An inline comment ends the owner list.
    const cut = rest.findIndex((t) => t.startsWith('#'));
    const owners = cut === -1 ? rest : rest.slice(0, cut);
    rules.push({ pattern, owners, re: toRegExp(pattern) });
  }
  return rules;
}

function toRegExp(pattern) {
  let p = pattern;
  const dir = p.endsWith('/');
  if (dir) p = p.slice(0, -1);
  // A leading slash, or a slash inside the pattern, ties it to the repository root.
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let body = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      if (p[i + 2] === '/') { body += '(?:.*/)?'; i += 2; } else { body += '.*'; i += 1; }
    } else if (c === '*') body += '[^/]*';
    else if (c === '?') body += '[^/]';
    else body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A name without a trailing wildcard also covers everything inside it when it is a directory;
  // `docs/*` stops at one level, as GitHub's does.
  const tail = dir ? '/.*' : p.endsWith('*') ? '' : '(?:/.*)?';
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}${tail}$`);
}

export function ownedFiles(files, rules) {
  return files.filter((file) => {
    const path = String(file).replace(/\\/g, '/').replace(/^\/+/, '');
    let last = null;
    for (const rule of rules) if ((rule.re ?? toRegExp(rule.pattern)).test(path)) last = rule;
    return Boolean(last && last.owners.length > 0);
  });
}
