"use client";

import { watchButton } from "@shader-ui/core";
import { forwardRef, useEffect, type ButtonHTMLAttributes } from "react";
import { useLight, type LightProps, type ShaderElement } from "./use-light.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, LightProps {}

/**
 * `<button>` natif, jamais désactivé par la lib. `aria-busy="true"` (posé par le Form pendant
 * un envoi, ou par le dev) allume l'orbit et la diode (spec Formulaire §4).
 */
export const Button = forwardRef<ShaderElement<HTMLButtonElement>, ButtonProps>(function Button(
  { effects, onEffectEnd, ...props },
  forwardedRef,
) {
  const { ref, eventHandlers, element } = useLight<HTMLButtonElement>({ effects, onEffectEnd }, forwardedRef, props);
  useEffect(() => {
    if (!element) return;
    const button = watchButton(element);
    return () => button.destroy();
  }, [element]);
  return <button {...props} {...eventHandlers} ref={ref} />;
});
