import { getEffect, type EffectDefinition } from "./effects.js";
import { getEngine, type EndReason, type Origin } from "./engine.js";
import { warn } from "./env.js";
import type { ColorToken } from "./tokens.js";

/** États décrits par le dev. La lumière en découle, jamais l'inverse. */
export type Status = "error" | "valid" | "loading";

/** Effet joué quand l'élément entre dans un état. */
const STATUS_EFFECT: Record<Status, string> = {
  error: "error",
  valid: "success",
  loading: "loading",
};

export const EFFECT_END_EVENT = "sui:effectend";

export interface EffectEndDetail {
  name: string;
  reason: EndReason;
}

export interface TriggerOptions {
  color?: ColorToken | string;
  origin?: Origin;
}

export interface Light {
  readonly element: HTMLElement;
  readonly status: Status | undefined;
  /** Joue un effet. La fin est signalée par l'événement `sui:effectend`, même s'il est ignoré. */
  trigger(effect: string | EffectDefinition, options?: TriggerOptions): void;
  /** Change d'état. Seules les transitions jouent un effet, jamais l'état initial. */
  setStatus(status: Status | undefined): void;
  /** Arrête l'effet en cours (fondu pour une boucle). */
  stop(): void;
  destroy(): void;
}

export interface LightOptions {
  status?: Status;
}

const lights = new WeakMap<Element, Light>();

/** Ajoute la bordure lumineuse à un élément existant. */
export function light(element: HTMLElement, options: LightOptions = {}): Light {
  lights.get(element)?.destroy();
  const engine = getEngine();
  let status: Status | undefined;

  const dispatchEnd = (name: string, reason: EndReason) => {
    const detail: EffectEndDetail = { name, reason };
    element.dispatchEvent(new CustomEvent(EFFECT_END_EVENT, { detail, bubbles: true }));
  };

  const applyStatus = (next: Status | undefined) => {
    status = next;
    if (next) element.dataset.suiStatus = next;
    else delete element.dataset.suiStatus;
  };

  const handle: Light = {
    element,

    get status() {
      return status;
    },

    trigger(effect, triggerOptions = {}) {
      const name = typeof effect === "string" ? effect : "custom";
      const base = typeof effect === "string" ? getEffect(effect) : effect;
      if (!base) {
        warn(`effet inconnu : « ${name} ».`);
        queueMicrotask(() => dispatchEnd(name, "skipped"));
        return;
      }
      const def = triggerOptions.color ? { ...base, color: triggerOptions.color } : base;
      engine.play(element, def, {
        origin: triggerOptions.origin,
        onEnd: (reason) => dispatchEnd(name, reason),
      });
    },

    setStatus(next) {
      if (next === status) return;
      const previous = status;
      applyStatus(next);
      if (previous === "loading") engine.stop(element);
      if (next) handle.trigger(STATUS_EFFECT[next]);
    },

    stop() {
      engine.stop(element);
    },

    destroy() {
      engine.cancel(element);
      delete element.dataset.sui;
      applyStatus(undefined);
      if (lights.get(element) === handle) lights.delete(element);
    },
  };

  element.dataset.sui = "";
  applyStatus(options.status);
  lights.set(element, handle);
  return handle;
}

/** La lumière attachée à un élément, s'il en a une. */
export function lightOf(element: Element): Light | undefined {
  return lights.get(element);
}
