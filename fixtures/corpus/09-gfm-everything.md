---
title: Every GFM feature
tags: [fixture, gfm]
---

# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

Setext heading
==============

Another setext
--------------

Paragraph with *emphasis*, _emphasis_, **strong**, __strong__, ***both***, ~~strike~~, `code`, ``code with ` backtick``, a [link](https://example.invalid "title"), a [reference link][ref], an <https://example.invalid/autolink>, a bare https://example.invalid/bare, and a footnote[^1]. Hard break follows  
here. Backslash break follows\
here. Entities: &amp; &copy; &#x1F600; — and "smart quotes" with 'singles' -- and --- dashes... ellipsis.

[ref]: https://example.invalid/ref "Reference title"
[^1]: The footnote text, with *markup* and a second paragraph.

    Indented continuation of the footnote.

> Blockquote
> > nested blockquote
> with a lazy continuation line

* Bullet with star
+ Bullet with plus
- Bullet with dash

1. Ordered
2. List
   1. Nested ordered
   2. Second
10. Starts at ten? No, continues

3) Ordered with paren
4) Second

- [ ] Task unchecked
- [x] Task checked
- [X] Task checked, capital

- loose

- list

    indented code block

```
fenced, no language
```

~~~python
def tilde_fence():
    return "ok"
~~~

````md
```
nested fence
```
````

| Left | Center | Right | Default |
| :--- | :----: | ----: | ------- |
| a | b | c | d |
| longer cell content | `code` | **bold** | [link](x) |

***

---

___

![Image alt](image.png "Image title")
![Reference image][img]

[img]: image2.png

<details><summary>Raw HTML block</summary>

Content inside HTML.

</details>

Inline <kbd>Ctrl</kbd>+<kbd>C</kbd> HTML and <span style="color:red">styled span</span>.

Term
: Definition (not GFM; must render as a paragraph)

Escaped \*not emphasis\* and \# not heading.

$$
x^2
$$

Last paragraph, no trailing newline