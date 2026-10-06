"use client";

import {
  light,
  lightOf,
  EFFECT_END_EVENT,
  type EffectDefinition,
  type EffectEndDetail,
  type Light,
  type TriggerOptions,
} from "@shader-ui/core";
import { useCallback, useEffect, useRef, useState, type Ref, type SyntheticEvent } from "react";

/** L'élément natif, avec `trigger()` en plus : `ref` reste compatible react-hook-form. */
export type ShaderElement<T extends HTMLElement> = T & {
  trigger(effect: string | EffectDefinition, options?: TriggerOptions): void;
};

/** Effets déclenchés par des événements DOM : `{ onPaste: "ripple" }`. */
export type EffectMap = { [event: `on${string}`]: string | EffectDefinition | undefined };

export interface LightProps {
  effects?: EffectMap;
  onEffectEnd?: (event: EffectEndDetail) => void;
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/** Branche la lumière sur un élément. Renvoie la ref à poser et les gestionnaires d'effets. */
export function useLight<T extends HTMLElement>(
  { effects, onEffectEnd }: LightProps,
  forwardedRef: Ref<ShaderElement<T>> | undefined,
  handlers: Record<string, unknown> = {},
) {
  const [element, setElement] = useState<T | null>(null);
  const lightRef = useRef<Light | null>(null);
  const onEnd = useRef(onEffectEnd);
  onEnd.current = onEffectEnd;
  const forwarded = useRef(forwardedRef);
  forwarded.current = forwardedRef;

  const ref = useCallback((el: T | null) => {
    if (el && !("trigger" in el)) {
      Object.defineProperty(el, "trigger", {
        configurable: true,
        value: (effect: string | EffectDefinition, options?: TriggerOptions) => lightOf(el)?.trigger(effect, options),
      });
    }
    setElement(el);
    setRef(forwarded.current, el as ShaderElement<T> | null);
  }, []);

  useEffect(() => {
    if (!element) return;
    const handle = light(element);
    lightRef.current = handle;
    const listener = (e: Event) => {
      if (e.target === element) onEnd.current?.((e as CustomEvent<EffectEndDetail>).detail);
    };
    element.addEventListener(EFFECT_END_EVENT, listener);
    return () => {
      element.removeEventListener(EFFECT_END_EVENT, listener);
      handle.destroy();
      lightRef.current = null;
    };
  }, [element]);

  const eventHandlers: Record<string, (e: SyntheticEvent) => void> = {};
  for (const [event, effect] of Object.entries(effects ?? {})) {
    if (!effect) continue;
    const own = handlers[event] as ((e: SyntheticEvent) => void) | undefined;
    eventHandlers[event] = (e) => {
      own?.(e);
      const native = e.nativeEvent as Partial<MouseEvent>;
      const origin = typeof native.clientX === "number" && typeof native.clientY === "number" && (native.clientX || native.clientY)
        ? { x: native.clientX, y: native.clientY }
        : undefined;
      lightRef.current?.trigger(effect, { origin });
    };
  }

  return { ref, eventHandlers, element };
}
