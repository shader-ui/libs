"use client";

import type { RevealInitial } from "@shader-ui/core";
import { Children, cloneElement, forwardRef, type ReactElement, type Ref } from "react";
import { childRefOf, setRef } from "./child-ref.js";
import { RevealLinks } from "./RevealLinks.js";
import { useLight, type LightProps, type ShaderElement } from "./use-light.js";

export interface LightComponentProps extends LightProps {
  /** Un seul élément DOM, qui reçoit la bordure lumineuse. */
  children: ReactElement;
  /** Révèle le lien au lieu de lui ajouter une bordure : l'enfant doit être un `<a>` (spec Liens révélés §8). */
  reveal?: boolean;
  /** Avec `reveal` : apparence avant le passage, `"text"` par défaut. */
  initial?: RevealInitial;
  /** Avec `reveal` : vitesse de la pulsation en px/s, 600 par défaut. */
  speed?: number;
}

/** Ajoute la bordure lumineuse à n'importe quel élément existant, ou révèle un lien (`reveal`). */
export const Light = forwardRef<ShaderElement<HTMLElement>, LightComponentProps>(function Light(
  { children, effects, onEffectEnd, reveal, initial, speed },
  forwardedRef,
) {
  if (reveal) {
    return (
      <RevealLinks ref={forwardedRef as Ref<HTMLElement>} initial={initial} speed={speed}>
        {children}
      </RevealLinks>
    );
  }
  return (
    <BorderLight ref={forwardedRef} effects={effects} onEffectEnd={onEffectEnd}>
      {children}
    </BorderLight>
  );
});

const BorderLight = forwardRef<ShaderElement<HTMLElement>, LightComponentProps>(function BorderLight(
  { children, effects, onEffectEnd },
  forwardedRef,
) {
  const child = Children.only(children) as ReactElement<Record<string, unknown>>;
  const childRef = childRefOf<HTMLElement>(child);
  const { ref, eventHandlers } = useLight<HTMLElement>({ effects, onEffectEnd }, forwardedRef, child.props);
  return cloneElement(child, {
    ...eventHandlers,
    ref: (el: HTMLElement | null) => {
      ref(el);
      setRef(childRef, el);
    },
  });
});
