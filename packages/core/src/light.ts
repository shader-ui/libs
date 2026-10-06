import { getEffect, type EffectDefinition } from "./effects.js";
import { getEngine, type EndReason, type Origin } from "./engine.js";
import { warn } from "./env.js";
import type { ColorToken } from "./tokens.js";

export const EFFECT_END_EVENT = "sui:effectend";

export interface EffectEndDetail {
  name: string;
  reason: EndReason;
}

export interface TriggerOptions {
  color?: ColorToken | string;
  origin?: Origin;
  /** Identifiant de vague : les effets d'une même vague comptent pour un seul départ. */
  wave?: string;
  /** Boîte dessinée, si ce n'est pas celle de l'élément (l'étendue du texte pour un trait). */
  box?: () => DOMRect;
  /** Arc dans le sens antihoraire (RTL). */
  reverse?: boolean;
}

/**
 * Porteur d'effets d'un élément. L'état n'est jamais déclaré ici : il est lu dans le HTML
 * par les contrôleurs (`watchField`…), qui décident de la lumière (spec Formulaire, principe 9).
 */
export interface Light {
  readonly element: HTMLElement;
  /** Joue un effet. La fin est signalée par l'événement `sui:effectend`, même s'il est ignoré. */
  trigger(effect: string | EffectDefinition, options?: TriggerOptions): void;
  /** Arrête l'effet en cours (fondu pour une boucle). */
  stop(): void;
  destroy(): void;
}

const lights = new WeakMap<Element, Light>();

/** Ajoute la bordure lumineuse à un élément existant. */
export function light(element: HTMLElement): Light {
  lights.get(element)?.destroy();
  const engine = getEngine();

  const dispatchEnd = (name: string, reason: EndReason) => {
    const detail: EffectEndDetail = { name, reason };
    element.dispatchEvent(new CustomEvent(EFFECT_END_EVENT, { detail, bubbles: true }));
  };

  const handle: Light = {
    element,

    trigger(effect, triggerOptions = {}) {
      const name = typeof effect === "string" ? effect : "custom";
      // Élément désactivé ou en lecture seule : aucun effet, la fin est quand même signalée
      const control = element as Partial<HTMLInputElement>;
      if (control.disabled === true || control.readOnly === true) {
        queueMicrotask(() => dispatchEnd(name, "skipped"));
        return;
      }
      const base = typeof effect === "string" ? getEffect(effect) : effect;
      if (!base) {
        warn(`effet inconnu : « ${name} ».`);
        queueMicrotask(() => dispatchEnd(name, "skipped"));
        return;
      }
      const def = triggerOptions.color ? { ...base, color: triggerOptions.color } : base;
      engine.play(element, def, {
        origin: triggerOptions.origin,
        wave: triggerOptions.wave,
        box: triggerOptions.box,
        reverse: triggerOptions.reverse,
        onEnd: (reason) => dispatchEnd(name, reason),
      });
    },

    stop() {
      engine.stop(element);
    },

    destroy() {
      engine.cancel(element);
      delete element.dataset.sui;
      if (lights.get(element) === handle) lights.delete(element);
    },
  };

  element.dataset.sui = "";
  lights.set(element, handle);
  return handle;
}

/** La lumière attachée à un élément, s'il en a une. */
export function lightOf(element: Element): Light | undefined {
  return lights.get(element);
}
