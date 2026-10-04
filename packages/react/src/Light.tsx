"use client";

import { Children, cloneElement, forwardRef, version, type ReactElement, type Ref } from "react";
import { useLight, type LightProps, type ShaderElement } from "./use-light.js";

export interface LightComponentProps extends LightProps {
  /** Un seul élément DOM, qui reçoit la bordure lumineuse. */
  children: ReactElement;
}

/** Ajoute la bordure lumineuse à n'importe quel élément existant. */
export const Light = forwardRef<ShaderElement<HTMLElement>, LightComponentProps>(function Light(
  { children, status, effects, onEffectEnd },
  forwardedRef,
) {
  const child = Children.only(children) as ReactElement<Record<string, unknown>>;
  const childRef = (Number(version.split(".")[0]) >= 19 ? child.props.ref : (child as unknown as { ref: unknown }).ref) as
    | Ref<HTMLElement>
    | undefined;
  const { ref, eventHandlers } = useLight<HTMLElement>({ status, effects, onEffectEnd }, forwardedRef, child.props);
  return cloneElement(child, {
    ...eventHandlers,
    ref: (el: HTMLElement | null) => {
      ref(el);
      if (typeof childRef === "function") childRef(el);
      else if (childRef) (childRef as { current: HTMLElement | null }).current = el;
    },
  });
});
