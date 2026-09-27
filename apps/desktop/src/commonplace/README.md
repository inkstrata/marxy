# The Commonplace

A commonplace book is what a reader keeps: passages copied out by hand, each with where it came
from. This is Marxy's. When Marxy opens with nothing to read, it shows one of these, chosen at
random and set like a page of a well-made book, with its source beneath it.

The pieces are what Marxy is for. They are about truth as what is brought out of hiding
(*alētheia*), about mind and spirit (*Geist*), about the senses and the forming of them, about
people who read, think and make things together across centuries, and about the made book itself.
Some are code, because code that mattered is a text too, and some are about machines that
reckon, because Marxy reads what they write. Most are short enough to finish before you open
something else.

Every piece is a markdown file in [`pieces/`](pieces/), in the shape set out in
[`FORMAT.md`](FORMAT.md): front matter a machine can check, then the text, then a colophon a
reader can see. `node scripts/check-commonplace.mjs` checks all of it, and so does `pnpm test`.

## The rights rule

Marxy is MIT and free, and it ships this corpus inside the app, to anyone, anywhere. So every
word in it must be free to ship everywhere, not only where the author lives. A piece is admitted
on one of three bases, and the front matter names which:

1. **`public-domain`.** Both tests hold for every person whose words or editorial choices we
   reproduce (the author, and any translator or editor):
   - **life + 70:** they died on or before 31 December of the year 71 years before the current
     year (so, in 2026, in 1955 or earlier). This is the term in the EU, the UK and most of the
     world, and longer than most of the rest.
   - **United States:** the text was first published 95 or more years ago (in 2026, in 1930 or
     earlier). A text first published later needs a stated `us_basis`, which the check prints and a
     person reviews.
2. **`public-domain+marxy-translation`.** The original meets rule 1, and the English is a new
   translation made for this repository, licensed MIT with the rest of it. Translating a
   public-domain original ourselves is how the corpus reaches past English without borrowing
   anyone's translation.
3. **`public-domain-declared`.** The work carries an explicit public-domain declaration and no
   one has ever claimed it. Allowed only with a `rights_note`, and only once the decision to admit
   it is written down under "Judgement calls" below.

`scripts/check-commonplace.mjs` recomputes rules 1 and 2 from the years in the front matter, so a
piece cannot be let in by its label. The years only ever make more of the world's writing free,
so a piece that passes today passes forever.

What the rule excludes is as deliberate as what it admits. No one's modern translation of an
old text; no edition whose editor is still in copyright; no quotation leaning on fair use, which
is an American doctrine and a defence, not a licence. And no text transcribed from a site
without checking it against its edition: each `transcription` URL is where the words were
checked, and each `source` is the edition they follow.

## Judgement calls

Two pieces are in on reasoning rather than arithmetic. Each was admitted on 2026-09-26 by the
author's delegate, and either can be taken out by deleting the file and its row.

- [`apollo-11-luminary.md`](pieces/apollo-11-luminary.md) is `public-domain-declared`. The code
  was written by the MIT Instrumentation Laboratory under a NASA contract, so it is not a work of
  the US government, which would settle it, and nothing on record releases it. What there is:
  every file of the Virtual AGC transcription says "Copyright: Public domain"; its maintainer calls
  Project Apollo software public domain "to the best of my non-lawyer understanding" and thanks the
  people at Draper Laboratory (the Instrumentation Laboratory's successor) and NASA who allowed the
  transcription; and in the years since, the only party who could claim it never has. The piece
  is three short excerpts, about twenty-five lines, from software that flew to the Moon in 1969
  and has been reproduced everywhere since. The risk is small and the piece is worth it; if Draper
  ever asks, it goes.
- [`marx-the-five-senses.md`](pieces/marx-the-five-senses.md) passes life + 70 (Marx died in
  1883) but was first published in 1932, after the United States' 95-year line, so it rests on its
  `us_basis`. A work first published abroad in 1932 is protected in the United States today only if
  it was either registered and renewed there, of which there is no sign for a German edition
  prepared by a Moscow institute, or restored in 1996 under 17 U.S.C. § 104A, which applied only to works still protected in their
  source country on 1 January 1996. In Germany Marx's term had run out in 1913, long before the
  manuscripts were printed. This is close to certain, and it will be arithmetic in 2028, when 1932
  passes the line.

## The pieces

### Alētheia: truth, and what is no longer hidden

| Piece | Author | Date | Languages |
| --- | --- | --- | --- |
| [The Way of Truth](pieces/parmenides-the-goddess.md) | Parmenides | early 5th c. BCE | Greek, English (Burnet) |
| [Fragments](pieces/heraclitus-fragments.md) | Heraclitus | c. 500 BCE | English (Burnet) |
| [The Cave](pieces/plato-the-cave.md) | Plato | c. 375 BCE | English (Jowett) |
| [I died for beauty](pieces/dickinson-i-died-for-beauty.md) | Emily Dickinson | c. 1862 | English |
| [Ode on a Grecian Urn](pieces/keats-ode-on-a-grecian-urn.md) | John Keats | 1819 | English |
| [A Defence of Poetry](pieces/shelley-defence-of-poetry.md) | Percy Bysshe Shelley | 1821 | English |
| [Theses on Feuerbach](pieces/marx-theses-on-feuerbach.md) | Karl Marx | 1845 | German, English |

### Geist: mind and spirit

| Piece | Author | Date | Languages |
| --- | --- | --- | --- |
| [I that is We](pieces/hegel-ich-das-wir.md) | G. W. F. Hegel | 1807 | German, English |
| [The owl of Minerva](pieces/hegel-owl-of-minerva.md) | G. W. F. Hegel | 1820 | German, English |
| [The Brain](pieces/dickinson-the-brain-is-wider.md) | Emily Dickinson | c. 1862 | English |
| [Tintern Abbey](pieces/wordsworth-tintern-abbey.md) | William Wordsworth | 1798 | English |
| [The thinking reed](pieces/pascal-roseau-pensant.md) | Blaise Pascal | 1670 | French, English |
| [Self-Reliance](pieces/emerson-self-reliance.md) | Ralph Waldo Emerson | 1841 | English |
| [The butterfly dream](pieces/zhuangzi-butterfly-dream.md) | Zhuangzi | 4th c. BCE | Classical Chinese, English |

### Sense: perceiving, and the forming of the senses

| Piece | Author | Date | Languages |
| --- | --- | --- | --- |
| [The forming of the five senses](pieces/marx-the-five-senses.md) | Karl Marx | 1844 | German, English |
| [Conclusion](pieces/pater-conclusion.md) | Walter Pater | 1873 | English |
| [Modern Fiction](pieces/woolf-modern-fiction.md) | Virginia Woolf | 1925 | English |
| [Auguries of Innocence](pieces/blake-auguries-of-innocence.md) | William Blake | c. 1803 | English |
| [Quiet Night Thought](pieces/li-bai-quiet-night-thought.md) | Li Bai | 8th c. | Classical Chinese, English |
| [The old pond](pieces/basho-old-pond.md) | Matsuo Bashō | 1686 | Japanese, English |
| [Archaic Torso of Apollo](pieces/rilke-archaischer-torso-apollos.md) | Rainer Maria Rilke | 1908 | German, English |

### Fellowship: the collective spirit

| Piece | Author | Date | Languages |
| --- | --- | --- | --- |
| [Crossing Brooklyn Ferry](pieces/whitman-crossing-brooklyn-ferry.md) | Walt Whitman | 1856 | English |
| [A Dream of John Ball](pieces/morris-dream-of-john-ball.md) | William Morris | 1888 | English |
| [The Song of the Reed](pieces/rumi-song-of-the-reed.md) | Rūmī | c. 1260 | Persian, English |
| [What is Enlightenment?](pieces/kant-was-ist-aufklarung.md) | Immanuel Kant | 1784 | German, English |

### Art and play

| Piece | Author | Date | Languages |
| --- | --- | --- | --- |
| [Man plays only where he is fully human](pieces/schiller-der-mensch-spielt.md) | Friedrich Schiller | 1795 | German, English |
| [Negative Capability](pieces/keats-negative-capability.md) | John Keats | 1817 | English |
| [Half of Life](pieces/holderlin-halfte-des-lebens.md) | Friedrich Hölderlin | 1804 | German, English |
| [Sonnet 55](pieces/shakespeare-sonnet-55.md) | William Shakespeare | 1609 | English |
| [Thirty spokes](pieces/laozi-thirty-spokes.md) | Laozi | 4th c. BCE | Classical Chinese, English |

### The reader and the made book

| Piece | Author | Date | Languages |
| --- | --- | --- | --- |
| [To the Reader](pieces/montaigne-to-the-reader.md) | Michel de Montaigne | 1580 | English (Cotton, Hazlitt) |
| [The Common Reader](pieces/woolf-the-common-reader.md) | Virginia Woolf | 1925 | English |
| [The Aims of the Kelmscott Press](pieces/morris-kelmscott-aims.md) | William Morris | 1895 | English |
| [The Ideal Book](pieces/morris-the-ideal-book.md) | William Morris | 1893 | English |
| [All things excellent](pieces/spinoza-omnia-praeclara.md) | Baruch Spinoza | 1677 | Latin, English |

### Machines that reckon, and code that mattered

| Piece | Author | Date | Languages |
| --- | --- | --- | --- |
| [Notes on the Analytical Engine](pieces/lovelace-notes.md) | Ada Lovelace | 1843 | English |
| [Calculemus](pieces/leibniz-calculemus.md) | Gottfried Wilhelm Leibniz | printed 1890 | Latin, English |
| [Luminary 1A, build 099](pieces/apollo-11-luminary.md) | MIT Instrumentation Laboratory | 1969 | AGC assembly |

## Considered and left out

Recorded so no one has to rediscover why.

- **Heidegger on *alētheia*.** The reason the word is here, but Heidegger died in 1976. Parmenides
  and Plato stand in for him, as he would perhaps have wanted.
- **Dickinson, "Tell all the truth but tell it slant."** First printed in 1945; its copyright is
  still live in the United States.
- **Turing, "Computing Machinery and Intelligence" (1950).** Public domain in the UK since 2025, but
  restored in the United States until 2045.
- **"You are not expected to understand this," Unix V6.** Released by Caldera in 2002 under a
  four-clause BSD licence whose advertising clause does not fit a corpus shown in an app.
- **The AI koans of the Jargon File.** The Jargon File is public domain, but the koans are Danny
  Hillis's, and a compiler cannot dedicate someone else's work.
- **Beatrice Warde, "The Crystal Goblet" (1932).** The best essay ever written on typography that
  disappears, and in copyright until 2040.
- **Any modern translation** of Sappho, Rilke, Rūmī or the *Daodejing*. Where no translation old
  enough exists, or none is good enough, the corpus makes its own.
