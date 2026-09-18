# Math-heavy document

Inline math like $E = mc^2$ and $\int_0^\infty e^{-x^2}\,dx = \tfrac{\sqrt{\pi}}{2}$ sits in the run of text and must land on the baseline.

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \cdot \mathbf{B} &= 0 \\
\nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
\nabla \times \mathbf{B} &= \mu_0\left(\mathbf{J} + \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}\right)
\end{aligned}
$$

A display block between paragraphs must occupy an integer number of line boxes. The badness of a line with stretch $t$ and available stretch $s$ is $100\,(t/s)^3$, which is why Knuth–Plass prefers many slightly loose lines to one very loose one.

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}, \qquad \prod_{p \text{ prime}} \frac{1}{1 - p^{-s}} = \zeta(s)
$$

Matrices: $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$ inline, and a fenced `math` block that some renderers accept:

```math
f(x) = \frac{1}{\sqrt{2\pi\sigma^2}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}
```
