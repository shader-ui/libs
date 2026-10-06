"use client";

import { watchField } from "@shader-ui/core";
import { forwardRef, useEffect, type InputHTMLAttributes } from "react";
import { useLight, type LightProps, type ShaderElement } from "./use-light.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, LightProps {}

/**
 * `<input>` natif. L'état est lu dans le HTML (`aria-busy`, `aria-invalid`, validité native),
 * jamais déclaré : la lumière en découle (spec Formulaire §3).
 */
export const Input = forwardRef<ShaderElement<HTMLInputElement>, InputProps>(function Input(
  { effects, onEffectEnd, ...props },
  forwardedRef,
) {
  const { ref, eventHandlers, element } = useLight<HTMLInputElement>({ effects, onEffectEnd }, forwardedRef, props);
  useEffect(() => {
    if (!element) return;
    const field = watchField(element);
    return () => field.destroy();
  }, [element]);
  return <input {...props} {...eventHandlers} ref={ref} />;
});
