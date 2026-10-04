# Shader UI

Light with purpose. Accessible UI components whose states are rendered by shaders: the light doesn't decorate, it informs.

[![license](https://img.shields.io/github/license/shader-ui/libs.svg)](https://github.com/shader-ui/libs/blob/main/LICENSE)

> ⚠️ **Early development**: the packages are not published on npm yet. Install them locally for now, see [Quick start](#quick-start).

Shader UI is a library, not a framework. You describe the state (`status="error"`), never the animation: the light lives on the border, doubles the information (text, icon, ARIA) and never carries it alone. At rest, the interface is still, with zero frames rendered.

## Table of contents

- [Packages](#packages)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Guarantees](#guarantees)
- [Customization](#customization)
- [Development](#development)
- [Tech stack](#tech-stack)
- [Contact](#contact)
- [Responsibility](#responsibility)
- [License](#license)

## Packages

| Package | Content |
|---|---|
| `@shader-ui/core` | TypeScript core, WebGL2 engine, CSS fallback. Works without any framework |
| `@shader-ui/react` | `Input`, `Button`, `Form`, `Light`, `ShaderProvider` (re-exports the core) |

The normative specification lives in [`docs/spec/`](docs/spec/README.md) and prevails over the code.

## Quick start

#### Requirements

- Node 22+ and npm
- React 18+ for `@shader-ui/react`

#### Install

Each project installs only the package for its framework, which brings the core along:

```sh
npm i @shader-ui/react     # React, Next.js
npm i @shader-ui/core      # no framework (vanilla, PHP, others)
```

Until the npm release, build the packages (`npm run build` in this repository) and install them from a local path:

```sh
npm i "file:/path/to/libs/packages/core" "file:/path/to/libs/packages/react"
```

The path to `core` is only needed locally: on npm, it will be resolved automatically.

#### Setup

```tsx
// app/layout.tsx (Next.js) or your entry point
import "@shader-ui/react/styles.css";
import { ShaderProvider } from "@shader-ui/react";

<ShaderProvider>{children}</ShaderProvider>
```

## Usage

```tsx
<Form onSubmit={save}>
  <Input name="email" status={errors.email ? "error" : "valid"} aria-describedby="email-error" />
  <Input name="password" effects={{ onPaste: "ripple" }} />
  <Button type="submit" status={saving ? "loading" : undefined}>Continue</Button>
</Form>

ref.current?.trigger("pulse", { color: "success" });
<Input onEffectEnd={(e) => e.name === "success" && next()} />
```

- `status`: `"error" | "valid" | "loading"`. Only transitions light up, never the initial state.
- `ref` receives the native element (compatible with react-hook-form), plus `trigger()`.
- `onEffectEnd` is always called, even when the effect is skipped (`reason: "skipped"`): choreographies never get stuck.
- `<Light>` adds the light border to any element: `<Light status="valid"><div className="card" /></Light>`.
- Without React: `light(element, { status })` from `@shader-ui/core`.

## Guarantees

| Rule | Implementation | Test |
|---|---|---|
| Zero frames at rest | rAF only during an effect, one clearing frame, hidden canvas | `engine.test.ts` |
| A single canvas, created on the first effect | shared `getEngine()`, lazy creation | `engine.test.ts` |
| Max 3 flashes/s (WCAG 2.3.1) | beyond that, effect skipped + dev warning | `engine.test.ts` |
| Loop ≤ 5 s (WCAG 2.2.2) | `loading` capped, fade out | `effects.test.ts` |
| `prefers-reduced-motion` (WCAG 2.3.3) | no movement, simple fade, no loop | `engine.test.ts` |
| Light doubles the information (WCAG 1.4.1) | `aria-invalid`, `aria-busy`, `data-sui-status`, warning if no linked error text | `components.test.tsx` |
| 3:1 borders without shader (WCAG 1.4.11) | `styles.css`, `light-dark()` colors | — |
| Without WebGL2 | CSS fallback, same meaning | `engine.test.ts` |

## Customization

CSS colors: `--sui-color-accent|success|error` (light), `--sui-border-*` (static borders), `--sui-focus`.

Custom effects, described as data:

```ts
registerEffect("brand", { kind: "sweep", color: "#ff00aa", duration: 800, tail: 0.3 });
```

## Development

```sh
npm install
npm test            # vitest
npm run build       # builds packages/*/dist
npm run typecheck
```

## Tech stack

- **Core**: TypeScript, WebGL2 (a single shared canvas, rendered on demand), CSS fallback
- **Bindings**: React (Vue and Angular planned)
- **Tests**: Vitest, jsdom, Testing Library
- **License**: MIT

## Contact

- Mail: [team@shader-ui.com](mailto:team@shader-ui.com)
- Website: <https://shader-ui.com>
- GitHub: <https://github.com/shader-ui/libs>

## Responsibility

Author disclaims any responsibility for the use that is made with this tool.

## License

Copyright © Shader UI contributors

Licensed under the [MIT License](./LICENSE).
