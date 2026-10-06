import { getEffect } from "./effects.js";
import { light, lightOf } from "./light.js";

/** Trait sous un texte : vitesse constante, durée bornée (spec Liens qui se dessinent §6.2). */
const UNDERLINE_SPEED = 1200;
const UNDERLINE_MIN = 250;
const UNDERLINE_MAX = 700;

/** La `<legend>` d'un groupe (radios, cases), qui porte ses messages : erreur, correction (§5.4). */
export function legendOf(element: Element): HTMLElement | null {
  const fieldset = element instanceof HTMLFieldSetElement ? element : element.closest("fieldset");
  const legend = fieldset?.querySelector(":scope > legend");
  return legend instanceof HTMLElement ? legend : null;
}

/** Étendue réelle du texte : un label en `display: block` est plus large que ses mots. */
function textBox(target: HTMLElement): DOMRect {
  const range = target.ownerDocument.createRange();
  range.selectNodeContents(target);
  const box = range.getBoundingClientRect?.();
  return box && box.width > 0 ? box : target.getBoundingClientRect();
}

/** Durée du trait sous un texte : vitesse constante, bornée entre 250 et 700 ms. */
export function underlineDuration(target: HTMLElement): number {
  const width = textBox(target).width;
  return Math.min(Math.max((width / UNDERLINE_SPEED) * 1000, UNDERLINE_MIN), UNDERLINE_MAX);
}

/** Trait de lumière sous un texte, dans le sens de lecture, à vitesse constante (§2.2, §5.4). */
export function underline(target: HTMLElement, color: string, wave?: string): void {
  const base = getEffect("underline")!;
  const duration = underlineDuration(target);
  const rtl = getComputedStyle(target).direction === "rtl";
  (lightOf(target) ?? light(target)).trigger({ ...base, color, duration }, { origin: rtl ? 1 : 0, wave, box: () => textBox(target) });
}
