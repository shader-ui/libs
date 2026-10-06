import { diodeOrigin, sweepStart } from "./diode.js";
import { light, lightOf, type Light } from "./light.js";

/**
 * Contrôleur d'un bouton (spec Formulaire §4). Un bouton n'a pas d'état durable : la lumière
 * ne joue que des moments. `aria-busy="true"` → envoi en cours (orbit, diode) ; le résultat
 * est donné par le Form (`settle`). La lib ne désactive jamais le bouton (§4.1).
 */

export type SendResult = "success" | "error";

export interface Button {
  readonly element: HTMLButtonElement;
  /** Vrai pendant que `aria-busy="true"`. */
  readonly busy: boolean;
  /** Fin de l'envoi : sweep vert ou pulse corail, la diode disparaît (§4.3). */
  settle(result: SendResult): void;
  destroy(): void;
}

const buttons = new WeakMap<HTMLButtonElement, Button>();

/** Branche le contrôleur sur un `<button>` natif. Un seul contrôleur par élément. */
export function watchButton(element: HTMLButtonElement): Button {
  buttons.get(element)?.destroy();
  const own = lightOf(element) ? undefined : light(element);
  const lit = (): Light => (lightOf(element) ?? own)!;
  const isBusy = () => element.getAttribute("aria-busy") === "true";

  let busy = false;
  /** Un résultat vient d'être joué : la fin d'aria-busy ne doit pas l'éteindre. */
  let settled = false;

  function sync(): void {
    const next = isBusy();
    if (next === busy) return;
    busy = next;
    if (busy) {
      settled = false;
      element.dataset.suiState = "loading";
      lit().trigger("loading", { origin: diodeOrigin(element) });
      return;
    }
    delete element.dataset.suiState;
    // Sans résultat connu (bouton hors formulaire), la boucle s'éteint simplement
    if (!settled) lit().stop();
    settled = false;
  }

  const observer = typeof MutationObserver === "function" ? new MutationObserver(sync) : undefined;
  observer?.observe(element, { attributes: true, attributeFilter: ["aria-busy"] });
  element.dataset.suiButton = "";
  // État initial : rendu au repos, jamais de lumière
  busy = isBusy();
  if (busy) element.dataset.suiState = "loading";

  const button: Button = {
    element,
    get busy() {
      return busy;
    },
    settle(result) {
      settled = busy;
      lit().trigger(result === "success" ? "success" : "error", result === "success" ? sweepStart(element) : { origin: diodeOrigin(element) });
    },
    destroy() {
      observer?.disconnect();
      delete element.dataset.suiState;
      delete element.dataset.suiButton;
      own?.destroy();
      if (buttons.get(element) === button) buttons.delete(element);
    },
  };
  buttons.set(element, button);
  return button;
}

/** Le contrôleur branché sur un bouton, s'il en a un. */
export function buttonOf(element: HTMLButtonElement): Button | undefined {
  return buttons.get(element);
}
