"use client";

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { useLight, type LightProps, type ShaderElement } from "./use-light.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, LightProps {}

export const Button = forwardRef<ShaderElement<HTMLButtonElement>, ButtonProps>(function Button(
  { status, effects, onEffectEnd, onClick, ...props },
  forwardedRef,
) {
  const { ref, eventHandlers } = useLight<HTMLButtonElement>({ status, effects, onEffectEnd }, forwardedRef, { onClick, ...props });
  const loading = status === "loading";
  const click = (eventHandlers.onClick ?? onClick) as ((e: MouseEvent<HTMLButtonElement>) => void) | undefined;
  return (
    <button
      {...props}
      {...eventHandlers}
      ref={ref}
      aria-busy={loading ? true : props["aria-busy"]}
      // Pas de `disabled` pendant le chargement : le focus reste sur le bouton
      aria-disabled={loading ? true : props["aria-disabled"]}
      onClick={(e) => {
        if (loading) return e.preventDefault();
        click?.(e);
      }}
    />
  );
});
