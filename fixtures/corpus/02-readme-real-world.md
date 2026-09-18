<div align="center">
  <img src="https://example.invalid/logo.png" width="120" alt="logo">
  <h1>widgetlib</h1>
  <p><strong>Fast, tiny widgets for the terminal and the browser.</strong></p>
  <a href="https://example.invalid/ci"><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="build"></a>
  <a href="https://example.invalid/npm"><img src="https://img.shields.io/npm/v/widgetlib" alt="npm"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</div>

## Install

```sh
pnpm add widgetlib
```

> **Note**
> Node 20 or later is required. Bun works but is not tested in CI.

## Usage

```ts
import { widget } from 'widgetlib';

const w = widget({ title: 'Hello', width: 40 });
w.render(process.stdout);
```

### Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `title` | `string` | `""` | Title shown in the frame |
| `width` | `number` | `80` | Columns, clamped to the terminal |
| `border` | `'single' \| 'double' \| 'none'` | `'single'` | Frame style |

## Features

- Zero dependencies
- Works in
  - Node
  - Bun
  - the browser, via
    - a `<canvas>` backend
    - a DOM backend
      - with CSS custom properties for theming
- Tiny: 3.1 kB gzipped

<details>
<summary>Why another widget library?</summary>

Because the existing ones are either enormous or abandoned. This one is neither, yet.

</details>

## Contributing

1. Fork
2. `pnpm install`
3. Make a change with a test
   - run `pnpm test`
   - run `pnpm lint`
4. Open a PR

## License

MIT © the widgetlib authors
