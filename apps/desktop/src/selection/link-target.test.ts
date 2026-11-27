// The one rule for following a relative link (a Markdown page's, a Word document's): a file under the document's folder
// or repository, never another machine, a drive, a scheme or a NUL, however the link spells it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINK_ELSEWHERE, LINK_MALFORMED, localLinkTarget } from './link-target.ts';

const BS = '\\';

test('a link naming another machine, a drive, a scheme or a NUL is refused before anything is read', () => {
  const elsewhere = [
    '%2F%2Fattacker%2Fshare%2Fx.md',
    '%5C%5Cattacker%5Cshare%5Cx.md',
    `${BS}${BS}attacker${BS}share${BS}x.md`,
    `/${BS}attacker/share/x.md`,
    '//attacker/share/x.md',
    '../..//attacker/share/x.md',
    `..${BS}..${BS}${BS}attacker${BS}x.md`,
    'C:/Windows/x.md',
    'c%3A%2Fx.md',
    'a%00b.md',
    'file:///etc/x.md',
  ];
  for (const root of ['/r', '/']) {
    for (const href of elsewhere) assert.deepEqual(localLinkTarget('/r/docs/a.md', href, root), { refused: LINK_ELSEWHERE }, `${href} under ${root}`);
  }
  assert.deepEqual(localLinkTarget('/r/docs/a.md', 'b%E0%A4%A.md', '/r'), { refused: LINK_MALFORMED });
  // A colon anywhere in the name: a hidden stream on NTFS, or another drive further along.
  for (const href of ['./x:y.md', 'x%3Ay.md', 'a/D:/x.md', 'sub/x.md:stream']) assert.deepEqual(localLinkTarget('/r/docs/a.md', href, '/r'), { refused: LINK_ELSEWHERE }, href);
  // On a POSIX folder a backslash is part of a name, not a separator.
  assert.deepEqual(localLinkTarget('/r/docs/a.md', 'odd%5Cname.md', '/r'), { target: `/r/docs/odd${BS}name.md`, fragment: undefined });
});

test('a link to a file beside the document, or in a folder beside it, still opens', () => {
  assert.deepEqual(localLinkTarget('/r/docs/a.md', 'b.md#part', '/r'), { target: '/r/docs/b.md', fragment: 'part' });
  assert.deepEqual(localLinkTarget('/r/docs/a.docx', '../notes/c.md', '/r'), { target: '/r/notes/c.md', fragment: undefined });
  // The target is the name on disk, decoded once: a space, and an underscore as a destination writes it.
  assert.deepEqual(localLinkTarget('/r/docs/a.md', 'my%20notes.md', '/r'), { target: '/r/docs/my notes.md', fragment: undefined });
  assert.deepEqual(localLinkTarget('/r/docs/a.docx', 'my%5Fnotes.md', '/r'), { target: '/r/docs/my_notes.md', fragment: undefined });
  // An encoded slash is a slash once decoded, and its climb is worked out before the folder is checked.
  assert.deepEqual(localLinkTarget('/r/docs/a.md', 'sub%2F..%2Fb.md', '/r'), { target: '/r/docs/b.md', fragment: undefined });
  assert.ok('refused' in localLinkTarget('/r/docs/a.md', '..%2F..%2F..%2Fetc%2Fx.md', '/r'));
  assert.ok('refused' in localLinkTarget('/r/docs/a.md', '../../etc/x.md', '/r'), 'outside the repository');
});

test('on a drive, as the Windows shell hands paths over, a link opens beside, below and above within the root', () => {
  for (const sep of ['/', BS]) {
    const doc = ['C:', 'r', 'docs', 'a.docx'].join(sep);
    const root = ['C:', 'r'].join(sep);
    const opens = (href: string, target: string, fragment?: string): void =>
      assert.deepEqual(localLinkTarget(doc, href, root), { target, fragment }, `${href} from ${doc}`);
    opens('b.md', 'C:/r/docs/b.md');
    opens('sub/a.md#frag', 'C:/r/docs/sub/a.md', 'frag');
    opens('../notes.md', 'C:/r/notes.md');
    opens(`..${BS}notes.md`, 'C:/r/notes.md');
    opens('my%20notes.md', 'C:/r/docs/my notes.md');
    for (const href of ['../../x.md', '../../../../Windows/x.md', `..${BS}..${BS}x.md`]) {
      const got = localLinkTarget(doc, href, root);
      assert.ok('refused' in got && /outside/.test(got.refused), `${href}: ${JSON.stringify(got)}`);
    }
    for (const href of ['D:/x.md', '/D:/x.md', '../../..//host/share/x.md', '%2F%2Fhost%2Fx.md', '..%5C..%5Cx.md', 'sub%5Cx.md', './x:y.md', 'x%3Ay.md', 'a/D:/x.md', 'a/D%3A/x.md']) {
      const got = localLinkTarget(doc, href, root);
      assert.ok('refused' in got, `${href}: ${JSON.stringify(got)}`);
    }
  }
  // The drive letter's case is not a different drive.
  assert.deepEqual(localLinkTarget('c:/r/docs/a.md', 'b.md', 'C:/r'), { target: 'c:/r/docs/b.md', fragment: undefined });
});

test('on a share, a link opens beside the document and never on another machine', () => {
  assert.deepEqual(localLinkTarget('//server/share/docs/a.md', 'b.md', '//server/share/docs'), { target: '//server/share/docs/b.md', fragment: undefined });
  for (const href of ['../../other/x.md', '//attacker/x.md', '../../..//attacker/x.md']) assert.ok('refused' in localLinkTarget('//server/share/docs/a.md', href, '//server/share/docs'), href);
  // A backslash decoded on a share is Windows' separator: it would climb out of the folder within the share.
  for (const href of ['..%5C..%5Cx.md', 'sub%5C..%5C..%5Cx.md', './x:y.md', 'a/D:/x.md']) {
    assert.deepEqual(localLinkTarget('//srv/share/docs/a.md', href, '//srv/share/docs'), { refused: LINK_ELSEWHERE }, href);
  }
});
