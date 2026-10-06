"use client";

import { watchChoice } from "@shader-ui/core";
import { forwardRef, useEffect, type InputHTMLAttributes } from "react";
import { useLight, type LightProps, type ShaderElement } from "./use-light.js";

export interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type">, LightProps {}

/** Case à cocher et bouton radio natifs : allumés en CSS, la lumière joue les erreurs et le trajet (spec Formulaire §5). */
function choice(type: "checkbox" | "radio", name: string) {
  const Component = forwardRef<ShaderElement<HTMLInputElement>, ChoiceProps>(function Choice({ effects, onEffectEnd, ...props }, forwardedRef) {
    const { ref, eventHandlers, element } = useLight<HTMLInputElement>({ effects, onEffectEnd }, forwardedRef, props);
    useEffect(() => {
      if (!element) return;
      const controller = watchChoice(element);
      return () => controller.destroy();
    }, [element]);
    return <input {...props} {...eventHandlers} type={type} ref={ref} />;
  });
  Component.displayName = name;
  return Component;
}

export const Checkbox = choice("checkbox", "Checkbox");
export const Radio = choice("radio", "Radio");
