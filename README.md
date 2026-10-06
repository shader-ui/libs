# Shader UI

Light with purpose. Accessible UI components whose states are rendered by shaders: the light doesn't decorate, it informs.

[![npm](https://img.shields.io/npm/v/@shader-ui/core.svg)](https://www.npmjs.com/package/@shader-ui/core) [![license](https://img.shields.io/github/license/shader-ui/libs.svg)](https://github.com/shader-ui/libs/blob/main/LICENSE)

> ⚠️ **Early development** (0.x): the API may change between minor versions.

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
| `@shader-ui/react` | `Input`, `Button`, `Form`, `Light`, `ShaderProvider`, `useVisibility` (re-exports the core) |

The normative specification lives in [`docs/spec/`](https://github.com/shader-ui/libs/blob/main/docs/spec/README.md) and prevails over the code.

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
- Server check (name already taken, promo code): set `aria-busy` while waiting and keep `aria-invalid` until the new answer, otherwise the field turns green before the server has confirmed. Start the check after the same typing pause as the library (`TYPING_PAUSE`, 1 s) or on blur.
- Visibility: an effect never plays on an element that cannot be seen (off screen, covered by a modal, under the virtual keyboard). The module is also available on its own: `const { state, seen } = useVisibility(ref)` in React, or `observeVisibility(element, listener)` and `canBeSeen(element)`.

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
| No light on what cannot be seen | effect skipped (`reason: "skipped"`), event-driven, zero frames | `visibility.test.ts` |

## Customization

CSS colors: `--sui-color-accent|success|error|neutral` (light), `--sui-border-*` (static borders), `--sui-focus`. Style your fields with `background-color` rather than the `background` shorthand: the shorthand resets the diode, which is drawn as a background image. Remove it with `--sui-diode: none`.

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

- Website: <https://shader-ui.com>
- GitHub: <https://github.com/shader-ui/libs>

## Responsibility

Author disclaims any responsibility for the use that is made with this tool.

```text
Al-Nu'man ibn Bashir reported,
The Messenger of Allah (Peace and Blessings be upon Him) said: « Verily, the lawful is clear and the unlawful is clear, and between the two of them they are doubtful matters about which many people don't know. Thus, he who avoids doubtful matters clears himself in regard to his religion and his honor, and he who falls into doubtful matters will fall into the unlawful as the shepherd who pastures near a sanctuary, all but grazing there in. Verily, every king has a sanctum and the sanctum of Allah is his prohibitions. Verily, in the body is a piece of flesh which, if sound, the entire body is sound, and if corrupt, the entire body is corrupt. Truly, it is the heart. »
Sahih al-Bukhārī 52, Sahih Muslim 1599
```

```text
D'après Nu'man Ibn Bachir (qu'Allah l'agrée),
Le Messager d'Allah (que La Prière d'Allah et Son Salut soient sur Lui) a dit : « Certes le halal est clair et certes le haram est clair et il y a entre les deux des choses ambiguës que peu de gens connaissent. Celui qui s'écarte des choses ambiguës a préservé sa religion et son honneur. Quant à celui qui tombe dans les choses ambiguës il tombe dans le haram comme le berger qui fait paitre ses bêtes près d'un enclos réservé et qui sont sur le point de rentrer dedans. Certes chaque roi a un domaine réservé et certes le domaine réservé d'Allah est ses interdits. Certes il y a dans le corps un morceau de chair, si il est bon alors l'ensemble du corps est bon tandis que si il est mauvais alors c'est l'ensemble du corps qui est mauvais, certes il s'agit du coeur. »
Sahih al-Bukhārī 52, Sahih Muslim 1599
```

## License

Copyright © Shader UI contributors

Licensed under the [MIT License](https://github.com/shader-ui/libs/blob/main/LICENSE).
