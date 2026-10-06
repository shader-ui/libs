import { diodeOrigin, sweepStart } from "./diode.js";
import { warn } from "./env.js";
import { formOf } from "./form.js";
import { TYPING_PAUSE } from "./timing.js";
import { light, lightOf, type Light } from "./light.js";

/**
 * Contrôleur d'un champ (spec Formulaire §3). L'état est lu dans le HTML, jamais déclaré :
 * `aria-busy`, `aria-invalid`, puis la validité native après interaction. La lumière dépend
 * de la transition : récompenser tôt, signaler tard.
 */

export type FieldState = "neutral" | "error" | "valid" | "loading";

export interface Field {
  readonly element: HTMLInputElement;
  readonly state: FieldState;
  /** Tentative d'envoi : l'interaction compte, l'état est relu sans lumière (le Form choisit qui s'allume, §2.3). */
  attempt(): void;
  destroy(): void;
}

/** Types gérés par le champ (§3) ; les autres ont leur composant ou sont hors périmètre. */
const TEXT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number", "date", "time", "datetime-local", "month", "week"]);
/** Attributs relus dès qu'ils changent (§3.1). */
const WATCHED = ["aria-invalid", "aria-busy", "required", "disabled", "readonly"];
/** Effet joué en entrant dans un état (§3.2). */
const EFFECT: Record<Exclude<FieldState, "neutral">, string> = { error: "error", valid: "success", loading: "loading" };
export { TYPING_PAUSE };

/** Remplissage automatique du navigateur, avec le préfixe encore utilisé par Safari. */
const AUTOFILL = [":autofill", ":-webkit-autofill"];

const fields = new WeakMap<HTMLInputElement, Field>();

/** `matches` sans exception pour un sélecteur que le navigateur ne connaît pas. */
function matchesSafely(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** Branche le contrôleur sur un `<input>` natif. Un seul contrôleur par élément. */
export function watchField(element: HTMLInputElement): Field {
  fields.get(element)?.destroy();
  const own = lightOf(element) ? undefined : light(element);
  const lit = (): Light => (lightOf(element) ?? own)!;

  if (element.type === "checkbox" || element.type === "radio") {
    warn(`<input type="${element.type}"> : utilisez le composant Checkbox ou Radio.`);
  } else if (!TEXT_TYPES.has(element.type)) {
    warn(`<input type="${element.type}"> est hors périmètre : aucune lumière n'y est jouée.`);
  }

  /** Valeur modifiée depuis la dernière sortie du champ. */
  let dirty = false;
  /** Champ quitté avec une valeur (tapée, restaurée après F5, pré-remplie), ou tentative d'envoi. */
  let interacted = false;
  /** Le champ a été en erreur : un champ optionnel corrigé devient `valid`. */
  let wasError = false;
  /** Lumière en attente de la sortie du champ. */
  let pending: FieldState | undefined;
  let state: FieldState = "neutral";
  /** Relecture prévue à la fin de la pause de frappe. */
  let pause: ReturnType<typeof setTimeout> | undefined;
  const cancelPause = () => {
    if (pause !== undefined) clearTimeout(pause);
    pause = undefined;
  };

  const focused = () => element.ownerDocument.activeElement === element;
  const inert = () => element.disabled || element.readOnly;
  const filled = () => element.value !== "";

  /** Règles du §3.1, dans l'ordre. */
  function read(): FieldState {
    if (element.getAttribute("aria-busy") === "true") return "loading";
    const aria = element.getAttribute("aria-invalid");
    if (aria !== null && aria !== "false") return "error";
    // aria-invalid="false" : le dev a la main, la validité native est ignorée
    const nativeError = aria === null && !element.validity.valid;
    if (nativeError && interacted) return "error";
    if (!nativeError && interacted && element.required && filled()) return "valid";
    if (!nativeError && wasError) return "valid";
    return "neutral";
  }

  function play(next: FieldState): void {
    if (inert()) return;
    if (next === "neutral") return lit().stop();
    // Dans un formulaire suivi, l'erreur rejoint l'onde de sa salve (§2.3)
    const form = formOf(element.form);
    if (next === "error" && form) return form.queueError(element);
    // Validation : un tour complet depuis le coin haut gauche ; le reste part de la diode
    lit().trigger(EFFECT[next], next === "valid" ? sweepStart(element) : { origin: diodeOrigin(element) });
  }

  /**
   * Applique l'état lu. Le rendu au repos (bordure, diode) change tout de suite : c'est le sens.
   * La lumière suit le §3.2 ; `silent` : aucune lumière (état initial, autofill, reset, envoi).
   */
  function update(silent = false): void {
    const previous = state;
    const next = read();
    if (next === "error") wasError = true;
    if (next === previous) return;
    state = next;
    if (next === "neutral") delete element.dataset.suiState;
    else element.dataset.suiState = next;
    if (next === "error" && !element.getAttribute("aria-describedby") && !element.getAttribute("aria-errormessage")) {
      warn("champ en erreur sans texte associé : liez un message par aria-describedby ou aria-errormessage (WCAG 1.4.1).");
    }

    pending = undefined;
    if (silent) {
      if (previous === "loading") lit().stop();
      return;
    }
    // Signaler tard : une erreur, ou un champ obligatoire tout juste rempli, attend la sortie du champ
    const late = next === "error" || (next === "valid" && previous === "neutral");
    if (late && focused()) {
      pending = next;
      if (previous === "loading") lit().stop();
      return;
    }
    play(next);
  }

  const isAutofill = () => AUTOFILL.some((selector) => matchesSafely(element, selector));

  const onInput = () => {
    dirty = true;
    cancelPause();
    // Le remplissage automatique met l'état à jour sans lumière : ce n'est pas une frappe
    if (isAutofill()) return update(true);
    // Un état intermédiaire pendant la frappe n'est jamais montré : relecture après la pause
    pause = setTimeout(() => {
      pause = undefined;
      update();
    }, TYPING_PAUSE);
  };
  const onBlur = () => {
    cancelPause();
    // La valeur peut avoir été restaurée par le navigateur (F5) ou pré-remplie : aucun événement de saisie
    if (dirty || filled()) interacted = true;
    dirty = false;
    const waiting = pending;
    const before = state;
    pending = undefined;
    // Un état qui change ici joue sa lumière lui-même : le focus a déjà quitté le champ
    update();
    // Sinon, la lumière attendue jusqu'à la sortie du champ, si l'état est toujours le même
    if (waiting && state === before && state === waiting) play(state);
  };
  const onInvalid = () => {
    interacted = true;
    update(true);
  };
  const onReset = () => {
    // L'événement reset précède la remise à zéro des valeurs
    cancelPause();
    setTimeout(() => {
      dirty = interacted = wasError = false;
      update(true);
    });
  };

  element.addEventListener("input", onInput);
  element.addEventListener("change", onInput);
  element.addEventListener("blur", onBlur);
  element.addEventListener("invalid", onInvalid);
  const form = element.form;
  form?.addEventListener("reset", onReset);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(() => update()) : undefined;
  observer?.observe(element, { attributes: true, attributeFilter: WATCHED });

  element.dataset.suiField = "";
  // État initial : rendu au repos, jamais de lumière
  update(true);

  const field: Field = {
    element,
    get state() {
      return state;
    },
    attempt() {
      onInvalid();
    },
    destroy() {
      cancelPause();
      element.removeEventListener("input", onInput);
      element.removeEventListener("change", onInput);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("invalid", onInvalid);
      form?.removeEventListener("reset", onReset);
      observer?.disconnect();
      delete element.dataset.suiState;
      delete element.dataset.suiField;
      own?.destroy();
      if (fields.get(element) === field) fields.delete(element);
    },
  };
  fields.set(element, field);
  return field;
}

/** Le contrôleur branché sur un champ, s'il en a un. */
export function fieldOf(element: HTMLInputElement): Field | undefined {
  return fields.get(element);
}
