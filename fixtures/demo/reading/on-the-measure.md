---
title: On the measure
author: Ruth Calloway
date: 2026-09-14
sample: constructed for the reader prototype
---

# On the measure

> The reader does not notice good line breaks. They notice bad ones, and they blame themselves for losing their place.
>
> M. Okafor, *The case for ragged lines*

Typesetters call the length of a line the measure. It is the oldest decision in typography and the one screens have made hardest, because on paper it was made once, by someone who knew what they were doing, and on a screen it is remade every time somebody resizes a window.

The usual advice is that a line of prose should hold between 45 and 80 characters, counting spaces and punctuation. The advice is right, but it is usually given without its reasons, and the reasons are what tell you what to do when the advice cannot be followed.

## The way back

Reading is not a smooth glide along the line. The eye moves in jumps, called saccades, of seven or eight characters at a time, and takes in the text during the pauses between them. Each jump is short and lands on a word the reader can already half see.

The jump at the end of a line is different. It runs the whole width of the column, right to left and down one line, to a target the reader can see only in the corner of the eye. This return sweep often falls a little short, and the eye makes a small correction once it lands.[^3] When it falls on the wrong line altogether, the reader reads a line twice, or skips one, and has to stop and find their place.

A long line makes the way back long, and a long sweep is more likely to go astray. Leading is the usual defence: the more space between lines, the bigger the target. That is why a wide column needs more generous line spacing than a narrow one, and why the two should be set together rather than one at a time.

A short line has the opposite trouble. The sweeps are easy, but there are many more of them, and the line ends before the phrase does. Words that belong together are split across lines, and the ragged right edge, which on a comfortable measure is a gentle irregularity, becomes a jagged one when the longest word on a line is a fifth of its length.

> You set the line for the eye on its way back, not on its way out. Anyone can read to the end of a line. Finding the start of the next one is the work.
>
> Frank Ellery, who set type for a regional newspaper for thirty-one years, in conversation with the author

## Where the numbers come from

The figures come from two directions. Bringhurst, writing for print, gives 45 to 75 characters as satisfactory for a single column of text, with 66 as the ideal,[^1] and the accessibility guidelines for the web set 80 as the most a line should hold.[^2] They agree because they describe the same thing from different sides: not a point at which reading is best, but a plateau on which it is good enough that the reader stops noticing.

That plateau was found long ago. Legibility studies in the first half of the last century found that very short and very long lines both slowed readers down, and that across a broad range in between the length made little difference.[^4] Work on reading from screens found something subtler: people can read long lines quickly, because there are fewer sweeps per page, but they understand moderate ones better.[^5] Speed and comprehension pull in slightly different directions, and the familiar range is where they are both acceptable.

None of this is a law. It is a description of where most readers are comfortable, and like all such descriptions it is wrong for somebody.

## Working it out

On a screen the number of characters in a line is not set directly. It follows from three things the designer does set:

$$
\text{cpl} = \frac{w}{s \cdot a}
$$

Here $w$ is the measure in pixels, $s$ is the font size in pixels, and $a$ is the average width of a character, spaces included, as a fraction of the font size. For most text faces $a$ is close to one half.[^6] A column 640 pixels wide set at 18 pixels gives $640 / (18 \times 0.5) \approx 71$ characters, comfortably inside the range.

The formula makes the trade visible. Make the type larger and the line holds fewer characters unless the column grows with it. The measure in characters is the thing the reader feels; the width in pixels is only the means of getting it.

## Small screens

A phone breaks the rule, and there is little to be done about it. A screen 375 pixels wide, less a 16-pixel margin on each side, leaves $w = 343$. At 17 pixels, that is $343 / 8.5 \approx 40$ characters, a little below the floor. The only way to reach 66 would be to shrink the type until it was too small to read, which would trade a minor discomfort for a major one.

So on a phone you accept the short line and deal with its consequences. Justified text is the first casualty: with only six or seven words a line, there is nowhere to hide the extra space, and the gaps open into rivers. A ragged edge with hyphenation does far better. The leading can come in a little, because the sweeps are short and rarely miss. Paragraphs should be kept short, because a long one on a narrow column looks like a wall.

## Large screens, and large type

The opposite problem is newer and more common than it should be. A window filling a large monitor can be 2,560 pixels wide, and text allowed to run its full width at 18 pixels would hold $2560 / 9 \approx 284$ characters to the line. No one can read that comfortably, and the fix is simply to cap the column and let the margins take the rest.

The cap is best set in characters rather than pixels, so that it follows the type. CSS has a unit for this, the ch, which is the width of the digit zero. It is a fair proxy, though the zero is usually wider than the average letter, so a column of 66 ch holds rather more than 66 characters of prose.

Large type, whether chosen or zoomed, is the case that tests a layout most honestly. A reader who doubles the size of the text wants bigger letters, not shorter lines. A measure set in ems or ch keeps the same number of characters as the type grows, and widens the column until it meets the edge of the window. Only then should the line begin to shorten, and at that point the reader has chosen the trade themselves.

## What I do now

I set the measure in characters and let everything else follow from it: about 66 for prose, never more than 80, and as many as the screen allows when it allows fewer than 45. I open the leading as the measure grows. I leave the right edge ragged and let the browser hyphenate.

None of this is visible when it is done well. The reader simply reads, reaches the end of a line, and finds the next one waiting.

[^1]: Robert Bringhurst, *The Elements of Typographic Style* (1992). The range is for a single column of serif text at an ordinary reading size.

[^2]: Web Content Accessibility Guidelines 2.0 (2008), success criterion 1.4.8, Visual Presentation. It is a Level AAA criterion, the strictest level, and allows 40 characters for Chinese, Japanese and Korean text.

[^3]: Keith Rayner's review of twenty years of eye-movement research, published in *Psychological Bulletin* in 1998, is the usual starting point for the mechanics of saccades, fixations and return sweeps.

[^4]: The best known are those of Miles Tinker and Donald Paterson, summarised in Tinker's *Legibility of Print* (1963).

[^5]: Mary Dyson's studies of reading from screens are the clearest here. In one, with Mark Haselgrove (2001, in the *International Journal of Human-Computer Studies*), a line of about 55 characters gave the best comprehension and was read faster than short lines.

[^6]: A half is a rough figure. Condensed faces come in below it, and wide ones above it: the same column set in Verdana, which was drawn for small sizes on early screens, holds several fewer characters than it does in a book face.
