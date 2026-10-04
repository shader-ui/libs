"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { useErrorTextCheck, useLight, type LightProps, type ShaderElement } from "./use-light.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, LightProps {}

export const Input = forwardRef<ShaderElement<HTMLInputElement>, InputProps>(function Input(
  { status, effects, onEffectEnd, ...props },
  forwardedRef,
) {
  const { ref, eventHandlers, element } = useLight<HTMLInputElement>({ status, effects, onEffectEnd }, forwardedRef, props);
  useErrorTextCheck(status, element);
  return (
    <input
      {...props}
      {...eventHandlers}
      ref={ref}
      aria-invalid={status === "error" ? true : props["aria-invalid"]}
      aria-busy={status === "loading" ? true : props["aria-busy"]}
    />
  );
});
