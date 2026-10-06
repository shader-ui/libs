import { sweepStart } from "./diode.js";
import { getEffect } from "./effects.js";
import { getEnvironment } from "./environment.js";
import { formOf } from "./form.js";
import { light, lightOf, type Light } from "./light.js";
import { legendOf, underline } from "./underline.js";
import { canBeSeen } from "./visibility.js";

/**
 * Contrôleur d'une case à cocher ou d'un bouton radio (spec Formulaire §5). L'allumage au clic
 * est en CSS, sans shader : cocher rend un état, ce n'est pas un message. Le shader joue les
 * erreurs, les corrections, et le trajet de lumière entre deux radios.
 */

export type ChoiceState = "neutral" | "error" | "valid";

export interface Choice {
  readonly element: HTMLInputElement;
  readonly state: ChoiceState;
  destroy(): void;
}

/** Trajet entre radios (§5.3) : 600 ms au plus au total, 180 ms au plus par saut. */
export const TRAIL_MAX = 600;
const HOP_MAX = 180;
/** Au-delà de 3 changements par seconde dans un groupe, plus de trajet : un simple fondu. */
const TRAIL_RATE = 3;
interface Group {
  last: HTMLInputElement | null;
  /** Dernière flèche du clavier dans le groupe : distingue le tour de liste d'un clic. */
  arrowAt: number;
  changes: number[];
  timers: Array<ReturnType<typeof setTimeout>>;
  pending: HTMLInputElement | null;
}

/** Groupes de radios : même `name`, même formulaire (ou même document sans formulaire). */
const groups = new Map<string, Group>();
const choices = new WeakMap<HTMLInputElement, Choice>();
let trails = 0;

const groupKey = (radio: HTMLInputElement) => `${radio.form ? formIndex(radio.form) : "doc"}:${radio.name}`;
const forms = new WeakMap<HTMLFormElement, number>();
let formCount = 0;
function formIndex(form: HTMLFormElement): number {
  let i = forms.get(form);
  if (i === undefined) forms.set(form, (i = ++formCount));
  return i;
}

/** Radios du groupe, dans l'ordre du HTML. */
function radiosOf(radio: HTMLInputElement): HTMLInputElement[] {
  const scope: ParentNode = radio.form ?? radio.ownerDocument;
  return [...scope.querySelectorAll<HTMLInputElement>(`input[type="radio"]`)].filter(
    (r) => r.name === radio.name && r.form === radio.form,
  );
}

/** Branche le contrôleur sur un `<input type="checkbox">` ou `<input type="radio">` natif. */
export function watchChoice(element: HTMLInputElement): Choice {
  choices.get(element)?.destroy();
  const own = lightOf(element) ? undefined : light(element);
  const lit = (): Light => (lightOf(element) ?? own)!;
  const radio = element.type === "radio";

  let dirty = false;
  let interacted = false;
  let wasError = false;
  let state: ChoiceState = "neutral";

  const groupRequired = () => radiosOf(element).some((r) => r.required);

  /** Règles du §5.4, comme pour l'Input (§3.1). */
  function read(): ChoiceState {
    const aria = element.getAttribute("aria-invalid");
    if (aria !== null && aria !== "false") return "error";
    const nativeError = aria === null && !element.validity.valid;
    if (nativeError && interacted) return "error";
    // Obligatoire et rempli : vert, pour le distinguer d'un choix facultatif (blanc)
    if (!nativeError && !radio && element.required && element.checked) return "valid";
    if (!nativeError && radio && groupRequired() && radiosOf(element).some((r) => r.checked)) return "valid";
    if (!nativeError && wasError) return "valid";
    return "neutral";
  }

  function update(silent = false): void {
    const previous = state;
    const next = read();
    if (next === "error") wasError = true;
    if (next === previous) return;
    state = next;
    if (next === "neutral") delete element.dataset.suiState;
    else element.dataset.suiState = next;
    if (silent || element.disabled) return;
    // Un groupe de radios n'a qu'une voix : son premier radio porte ses messages, sous la legend
    const legend = radio ? legendOf(element) : null;
    if (radio && radiosOf(element)[0] !== element) return;
    if (next === "error") {
      const form = formOf(element.form);
      if (form) return form.queueError(element);
      return legend ? underline(legend, "error") : lit().trigger("error");
    }
    if (next === "valid") {
      // Rempli ou corrigé : sweep court sur la case, ou trait vert sous la legend d'un groupe
      if (legend) underline(legend, "success");
      else {
        const target = radio ? (radiosOf(element).find((r) => r.checked) ?? element) : element;
        (lightOf(target) ?? light(target)).trigger({ ...getEffect("success")!, duration: 700 }, sweepStart(target));
      }
    }
  }

  /** Les radios d'un groupe partagent leur validité : on les relit ensemble. */
  const updateGroup = (silent = false) => {
    if (!radio) return update(silent);
    for (const r of radiosOf(element)) {
      const c = choices.get(r);
      if (c) (c as Choice & { refresh(silent: boolean): void }).refresh(silent);
    }
  };

  /** Trajet de lumière de l'ancien radio au nouveau, par les intermédiaires (§5.3). */
  function trail(): void {
    const key = groupKey(element);
    const group = groups.get(key) ?? { last: null, arrowAt: -Infinity, changes: [], timers: [], pending: null };
    groups.set(key, group);
    const now = performance.now();
    group.changes = group.changes.filter((t) => now - t < 1000);
    group.changes.push(now);
    // Un nouveau trajet remplace celui en cours
    group.timers.splice(0).forEach(clearTimeout);
    if (group.pending) delete group.pending.dataset.suiPending;
    group.pending = null;

    const from = group.last;
    group.last = element;
    const radios = radiosOf(element);
    const i = from ? radios.indexOf(from) : -1;
    const j = radios.indexOf(element);
    const reduced = getEnvironment()?.preferences.reducedMotion === true;
    // Fondu CSS : premier choix, changements trop rapides, mouvement réduit, ou trajet invisible
    if (i < 0 || j < 0 || i === j || reduced || group.changes.length > TRAIL_RATE) return;
    if (!canBeSeen(from!) || !canBeSeen(element)) return;

    // Tour de la liste aux flèches (dernier ↔ premier) : saut direct. Un clic, lui, traverse tout
    const keyboard = now - group.arrowAt < 100;
    const wrap = keyboard && Math.abs(i - j) === radios.length - 1 && radios.length > 2;
    const step = wrap ? 1 : Math.sign(j - i);
    const between = wrap ? [] : radios.slice(Math.min(i, j) + 1, Math.max(i, j));
    if (step < 0) between.reverse();
    const hop = Math.min(HOP_MAX, TRAIL_MAX / (between.length + 1));
    const id = `sui-trail-${++trails}`;

    // Le nouveau radio s'allume quand la lumière arrive ; le `checked` natif, lui, est déjà à jour
    element.dataset.suiPending = "";
    group.pending = element;
    between.forEach((r, k) => {
      group.timers.push(setTimeout(() => (lightOf(r) ?? light(r)).trigger("glimmer", { wave: id }), hop * k));
    });
    group.timers.push(
      setTimeout(() => {
        delete element.dataset.suiPending;
        group.pending = null;
        // Groupe obligatoire : l'arrivée est verte, comme le point qui s'allume
        lit().trigger(groupRequired() ? { ...getEffect("choice")!, color: "success" } : "choice", { wave: id });
      }, hop * between.length),
    );
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!radio || !event.key.startsWith("Arrow")) return;
    const key = groupKey(element);
    const group = groups.get(key) ?? { last: null, arrowAt: -Infinity, changes: [], timers: [], pending: null };
    group.arrowAt = performance.now();
    groups.set(key, group);
  };
  const onChange = () => {
    dirty = true;
    if (radio) trail();
    updateGroup();
  };
  const onBlur = () => {
    if (dirty) interacted = true;
    dirty = false;
    updateGroup();
  };
  const onInvalid = () => {
    interacted = true;
    update(true);
  };

  element.addEventListener("change", onChange);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("blur", onBlur);
  element.addEventListener("invalid", onInvalid);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(() => update()) : undefined;
  observer?.observe(element, { attributes: true, attributeFilter: ["aria-invalid", "required", "disabled"] });
  element.dataset.suiChoice = "";
  if (radio && element.checked) {
    const key = groupKey(element);
    groups.set(key, { ...(groups.get(key) ?? { arrowAt: -Infinity, changes: [], timers: [], pending: null }), last: element });
  }
  // État initial : rendu au repos, jamais de lumière
  update(true);

  const choice: Choice & { refresh(silent: boolean): void } = {
    element,
    get state() {
      return state;
    },
    refresh(silent: boolean) {
      update(silent);
    },
    destroy() {
      element.removeEventListener("change", onChange);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("blur", onBlur);
      element.removeEventListener("invalid", onInvalid);
      observer?.disconnect();
      delete element.dataset.suiChoice;
      delete element.dataset.suiState;
      delete element.dataset.suiPending;
      own?.destroy();
      if (choices.get(element) === choice) choices.delete(element);
    },
  };
  choices.set(element, choice);
  return choice;
}
