// The package around an Office file's XML: its parts read by name, the relationships between them, and the properties
// every format keeps (title, author, dates). A relationship marked external (a link, a linked picture, a remote
// template) is kept as its address and nothing more: nothing here or after it fetches one. Pure.
import { emptyProps, type OfficeProps } from './model.ts';
import { kid, kidsOf, readXml, textOf, tooMuchXml, xmlText, type XmlBudget, type XmlElement } from './xml.ts';

/** A part's bytes by its name in the zip, or null when the file has no such part. */
export type PartRead = (name: string) => Promise<Uint8Array | null>;

export interface Rel {
  readonly type: string;
  /** The part it names, resolved against the part that holds the relationship; for an external one, the address. */
  readonly target: string;
  readonly external: boolean;
}

export interface Package {
  readonly budget: XmlBudget;
  /** A part read as XML, or null when it is not in the file. */
  xml(name: string): Promise<XmlElement | null>;
  /** The relationships of `part`, by id. */
  rels(part: string): Promise<ReadonlyMap<string, Rel>>;
}

/** `target` taken from the folder of `from`: `media/a.png` from `word/document.xml` is `word/media/a.png`. */
export function resolvePart(from: string, target: string): string {
  const base = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') base.pop();
    else base.push(seg);
  }
  return base.join('/');
}

const relsName = (part: string): string => {
  const at = part.lastIndexOf('/');
  return `${part.slice(0, at + 1)}_rels/${part.slice(at + 1)}.rels`;
};

export function openPackage(read: PartRead, budget: XmlBudget): Package {
  const relsKept = new Map<string, ReadonlyMap<string, Rel>>();
  // A part is read and parsed once, however many times the file names it (a deck can list one slide over and over).
  const xmlKept = new Map<string, Promise<XmlElement | null>>();
  const xml = (name: string): Promise<XmlElement | null> => {
    let kept = xmlKept.get(name);
    if (!kept) {
      kept = (async () => {
        const bytes = await read(name);
        if (!bytes) return null;
        budget.bytes -= bytes.length;
        if (budget.bytes < 0) throw tooMuchXml();
        return readXml(xmlText(bytes), budget, name);
      })();
      xmlKept.set(name, kept);
    }
    return kept;
  };
  return {
    budget,
    xml,
    async rels(part) {
      const kept = relsKept.get(part);
      if (kept) return kept;
      const out = new Map<string, Rel>();
      const root = await xml(relsName(part));
      for (const r of kidsOf(root, 'Relationship')) {
        const id = r.attrs.Id;
        const target = r.attrs.Target ?? '';
        if (!id) continue;
        const external = (r.attrs.TargetMode ?? '').toLowerCase() === 'external';
        out.set(id, { type: (r.attrs.Type ?? '').replace(/^.*\//, ''), target: external ? target : resolvePart(part, decodeTarget(target)), external });
      }
      relsKept.set(part, out);
      return out;
    },
  };
}

const decodeTarget = (t: string): string => {
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
};

/** The first relationship of `type` (its last path segment: `officeDocument`, `footnotes`). */
export const relOfType = (rels: ReadonlyMap<string, Rel>, type: string): Rel | null => [...rels.values()].find((r) => r.type === type && !r.external) ?? null;

const clean = (s: string): string | null => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

/** Title, author and dates from `docProps/core.xml` and `docProps/app.xml` (the Office formats). */
export async function officeProps(pkg: Package): Promise<OfficeProps> {
  const core = await pkg.xml('docProps/core.xml').catch(() => null);
  const app = await pkg.xml('docProps/app.xml').catch(() => null);
  const of = (root: XmlElement | null, name: string): string | null => clean(textOf(kid(root, name)));
  const pages = of(app, 'Pages');
  const application = [of(app, 'Application'), of(app, 'AppVersion')].filter(Boolean).join(' ');
  return {
    ...emptyProps(),
    title: of(core, 'title'),
    subject: of(core, 'subject'),
    creator: of(core, 'creator'),
    lastModifiedBy: of(core, 'lastModifiedBy'),
    created: of(core, 'created'),
    modified: of(core, 'modified'),
    application: application === '' ? null : application,
    pages: pages && /^\d+$/.test(pages) ? Number(pages) : null,
  };
}

/** Title, author and dates from an OpenDocument's `meta.xml`. */
export async function odfProps(pkg: Package): Promise<OfficeProps> {
  const meta = kid(await pkg.xml('meta.xml').catch(() => null), 'meta');
  const of = (name: string): string | null => clean(textOf(kid(meta, name)));
  const stats = kid(meta, 'document-statistic');
  const pages = stats?.attrs['page-count'];
  return {
    ...emptyProps(),
    title: of('title'),
    subject: of('subject'),
    creator: of('initial-creator') ?? of('creator'),
    lastModifiedBy: of('creator'),
    created: of('creation-date'),
    modified: of('date'),
    application: of('generator'),
    pages: pages && /^\d+$/.test(pages) ? Number(pages) : null,
  };
}
