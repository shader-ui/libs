import { buttonOf } from "./button.js";
import { lightOf } from "./light.js";
import { diodeOrigin } from "./diode.js";
import { TYPING_PAUSE } from "./timing.js";
import { getEnvironment } from "./environment.js";
import { warn } from "./env.js";
import { legendOf, underline } from "./underline.js";
import { canBeSeen, observeVisibility } from "./visibility.js";

/**
 * Contrôleur d'un formulaire (spec Formulaire §2.3) : les erreurs d'une même salve pulsent
 * en vague, dans l'ordre du formulaire ; un envoi par promesse pose `aria-busy` sur le bouton
 * cliqué et ignore les envois suivants, sans désactiver le bouton.
 */

export interface FormOptions {
  /** Gestionnaire d'envoi (sans framework). Une promesse renvoyée déclenche l'état d'envoi. */
  onSubmit?: (event: SubmitEvent) => unknown;
  /** Ce que la lib ne peut pas lire (captcha, paiement) : faux tant que ce n'est pas prêt (§2.3). */
  ready?: boolean;
  /** Mode init (§2.2) : au premier geste, un trait blanc sous le label de chaque champ obligatoire. */
  guide?: boolean;
}

export interface FormController {
  readonly element: HTMLFormElement;
  /** Vrai pendant un envoi en cours : les envois suivants sont ignorés. */
  readonly busy: boolean;
  /** Suit le résultat d'un envoi (bindings) : promesse → état d'envoi sur `submitter`. */
  track(result: unknown, submitter: HTMLElement | null): void;
  /** Pulse d'erreur d'un champ : regroupé avec ceux de la même salve, joué en vague. */
  queueError(field: HTMLElement): void;
  /** Formulaire prêt : champs valides et `ready` vrai (§2.3). */
  readonly ready: boolean;
  /** Met à jour ce que la lib ne peut pas lire (captcha, paiement). */
  setReady(ready: boolean): void;
  destroy(): void;
}

/** Attente maximale que le premier champ invalide soit visible (défilement, clavier), §3.2. */
export const INVALID_WAIT = 1000;
/** Décalage entre deux pulses de l'onde d'erreurs (§2.3). */
export const ERROR_STAGGER = 150;
/** Durée maximale d'une onde (WCAG 2.2.2) : au-delà, les champs restants ne pulsent pas. */
const WAVE_MAX = 5000;
/** Le pulse « prêt » est joué au plus une fois toutes les 10 s (§4.2). */
export const READY_REPEAT = 10_000;
/** Mode init : survol continu avant déclenchement ; une souris qui traverse ne déclenche rien (§2.2). */
export const GUIDE_HOVER = 300;

const controllers = new WeakMap<HTMLFormElement, FormController>();
let waves = 0;

/** Le contrôleur branché sur un formulaire, s'il en a un. */
export function formOf(element: HTMLFormElement | null): FormController | undefined {
  return element ? controllers.get(element) : undefined;
}

/** Cible de l'erreur : la legend d'un groupe (radios, fieldset), sinon le champ lui-même. */
function groupTarget(field: HTMLElement): HTMLElement {
  const grouped = field instanceof HTMLFieldSetElement || (field instanceof HTMLInputElement && field.type === "radio");
  if (!grouped) return field;
  const legend = legendOf(field);
  if (legend) return legend;
  // Sans legend : le premier radio du groupe
  if (field instanceof HTMLInputElement && field.form) {
    const first = [...field.form.elements].find((c) => c instanceof HTMLInputElement && c.type === "radio" && c.name === field.name);
    if (first instanceof HTMLElement) return first;
  }
  return field;
}

/** Ordre du formulaire (ordre du document). */
const documentOrder = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === "function";

/** Branche le contrôleur sur un `<form>` natif. */
export function watchForm(element: HTMLFormElement, options: FormOptions = {}): FormController {
  controllers.get(element)?.destroy();
  let busy = false;
  /** Champs dont l'erreur attend la fin de la salve en cours. */
  const queued = new Set<HTMLElement>();
  let flush: ReturnType<typeof setTimeout> | undefined;
  /** Onde en cours : minuteurs et abonnement à annuler si une nouvelle salve arrive ou si l'on saisit. */
  let wave: Array<() => void> = [];

  const cancelWave = () => {
    wave.splice(0).forEach((cancel) => cancel());
  };

  /** Onde d'erreurs : le premier attend d'être visible (1 s au plus), puis un pulse tous les 150 ms. */
  function startWave(targets: HTMLElement[]): void {
    cancelWave();
    const id = `sui-wave-${++waves}`;
    // Une legend porte l'erreur de son groupe : un trait dessous ; un champ : un pulse depuis sa diode
    const pulse = (target: HTMLElement) =>
      target.tagName === "LEGEND"
        ? underline(target, "error", id)
        : lightOf(target)?.trigger("error", { origin: diodeOrigin(target), wave: id });
    const run = () => {
      targets.forEach((target, i) => {
        const delay = i * ERROR_STAGGER;
        if (delay > WAVE_MAX) return;
        if (delay === 0) return pulse(target);
        const timer = setTimeout(() => pulse(target), delay);
        wave.push(() => clearTimeout(timer));
      });
    };
    const first = targets[0];
    if (!first) return;
    // Le moteur revérifie au dernier moment (canBeSeen) : un champ invisible est skipped
    if (canBeSeen(first)) return run();
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      stop();
      run();
    };
    const timer = setTimeout(go, INVALID_WAIT);
    const stop = observeVisibility(first, (v) => v.state === "visible" && go());
    wave.push(() => {
      started = true;
      clearTimeout(timer);
      stop();
    });
  }

  /** Les erreurs d'une même tâche forment une salve : une tâche, pas une microtâche, car le navigateur
   * vide les microtâches entre chaque événement `invalid` d'une même tentative d'envoi. */
  function queueError(field: HTMLElement): void {
    queued.add(field);
    flush ??= setTimeout(() => {
      flush = undefined;
      // Les radios d'un groupe, et un fieldset en erreur, se regroupent sous leur legend
      const targets = [...new Set([...queued].map(groupTarget))].sort(documentOrder);
      queued.clear();
      startWave(targets);
    }, 0);
  }

  const onInvalid = (event: Event) => {
    if (event.target instanceof HTMLElement) queueError(event.target);
  };
  // ——— Pulse « prêt » (§4.2) ———

  let external = options.ready ?? true;
  let ready = false;
  let lastReady = -Infinity;
  let readyPause: ReturnType<typeof setTimeout> | undefined;
  /** Attente que le bouton soit « vu » (clavier, bas de page). */
  let waitSeen: (() => void) | undefined;

  /** Tous les champs valides, en direct (sans attendre une interaction), et ce qui est illisible prêt. */
  function readReady(): boolean {
    if (!external) return false;
    for (const control of element.elements) {
      const c = control as HTMLInputElement;
      if (c.willValidate && !c.validity.valid) return false;
      const aria = c.getAttribute("aria-invalid");
      if (aria !== null && aria !== "false") return false;
    }
    return true;
  }

  /** Le bouton d'envoi par défaut : le premier du formulaire. */
  const defaultButton = () =>
    [...element.elements].find((c): c is HTMLButtonElement => c instanceof HTMLButtonElement && c.type === "submit");

  function pulseReady(nextFocus: EventTarget | null = null): void {
    const button = defaultButton();
    if (!button || busy) return;
    // Déjà sur le bouton, ou en train d'y aller (clic, Tab) : « tu peux y aller » ne sert à rien
    if (nextFocus === button || button.ownerDocument.activeElement === button || button.matches(":active")) return;
    const now = performance.now();
    if (now - lastReady < READY_REPEAT) return;
    const play = () => {
      waitSeen?.();
      waitSeen = undefined;
      if (!ready || busy) return;
      lastReady = performance.now();
      lightOf(button)?.trigger("pulse", { origin: diodeOrigin(button) });
    };
    if (canBeSeen(button)) return play();
    waitSeen?.();
    waitSeen = observeVisibility(button, (v) => v.seen && play());
  }

  /** Relit l'état « prêt ». `silent` : à l'initialisation, jamais de lumière. */
  function evaluate(silent = false, nextFocus: EventTarget | null = null): void {
    const next = readReady();
    if (next === ready) return;
    ready = next;
    if (!ready) {
      waitSeen?.();
      waitSeen = undefined;
      return;
    }
    if (!silent) pulseReady(nextFocus);
  }

  const cancelReadyPause = () => {
    if (readyPause !== undefined) clearTimeout(readyPause);
    readyPause = undefined;
  };

  // ——— Mode init (§2.2) ———

  let guided = !options.guide;
  let hover: ReturnType<typeof setTimeout> | undefined;
  let guideTimers: Array<ReturnType<typeof setTimeout>> = [];
  const cancelGuide = () => guideTimers.splice(0).forEach(clearTimeout);

  /** Label visible d'un champ, ou legend de son groupe (radios). */
  function labelFor(control: HTMLInputElement): HTMLElement | null {
    if (control.type === "radio") return legendOf(control) ?? labelledBy(control.closest("[role=radiogroup]"));
    return (control.labels?.[0] as HTMLElement | undefined) ?? labelledBy(control);
  }
  function labelledBy(el: Element | null): HTMLElement | null {
    const id = el?.getAttribute("aria-labelledby")?.split(/\s+/)[0];
    return (id && el!.ownerDocument.getElementById(id)) || null;
  }
  const filled = (c: HTMLInputElement) =>
    c.type === "radio" ? [...element.elements].some((r) => r instanceof HTMLInputElement && r.type === "radio" && r.name === c.name && r.checked)
    : c.type === "checkbox" ? c.checked
    : c.value !== "";

  /** Lueurs suivies : label → champs qu'il signale (un groupe de radios partage sa legend). */
  const required = new Map<HTMLElement, HTMLInputElement[]>();

  /** Renseigné et sans erreur : un champ en erreur garde sa lueur (§2.2). */
  const done = (controls: HTMLInputElement[]) =>
    controls.some(filled) && !controls.some((c) => c.dataset.suiState === "error" || (c.getAttribute("aria-invalid") ?? "false") !== "false");

  /** Allume ou éteint chaque lueur selon que ses champs sont renseignés et sans erreur. */
  function syncRequired(): void {
    for (const [label, controls] of required) {
      if (label.dataset.suiRequired === "") continue; // pas encore apparue (cascade)
      label.dataset.suiRequired = done(controls) ? "off" : "on";
    }
  }

  /** Au premier geste : une lueur après le label de chaque champ obligatoire, en cascade. */
  function guide(): void {
    if (guided) return;
    guided = true;
    const found = new Map<HTMLElement, HTMLInputElement[]>();
    let unlabelled = false;
    for (const control of element.elements) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
      if (!control.required || control.disabled || (control as HTMLInputElement).readOnly) continue;
      const label = labelFor(control as HTMLInputElement);
      if (!label) unlabelled = true;
      else found.set(label, [...(found.get(label) ?? []), control as HTMLInputElement]);
    }
    // Un champ sans label visible est une erreur (WCAG 3.3.2) : pas de lueur, rien ne la remplace
    if (unlabelled) {
      warn("mode init : un champ obligatoire n'a pas de label visible (WCAG 3.3.2), les lueurs ne sont pas affichées.");
      return;
    }
    const reduced = getEnvironment()?.preferences.reducedMotion === true;
    for (const [label, controls] of found) {
      required.set(label, controls);
      label.dataset.suiRequired = "";
    }
    // L'état de départ (invisible, plus bas) doit être calculé avant l'allumage, sinon le premier
    // label s'allumerait sans transition : une lecture de mise en page force ce calcul
    void element.offsetWidth;
    [...found].forEach(([label, controls], i) => {
      const show = () => {
        label.dataset.suiRequired = done(controls) ? "off" : "on";
      };
      // Mouvement réduit : toutes d'un coup ; sinon en cascade, dans l'ordre du formulaire
      if (reduced || i === 0) show();
      else guideTimers.push(setTimeout(show, i * ERROR_STAGGER));
    });
  }

  const onPointerEnter = (event: Event) => {
    const e = event as PointerEvent;
    if (guided) return;
    if (e.pointerType === "mouse") hover = setTimeout(guide, GUIDE_HOVER);
  };
  const onPointerLeave = () => {
    if (hover !== undefined) clearTimeout(hover);
    hover = undefined;
  };
  const onPointerDown = (event: Event) => {
    if ((event as PointerEvent).pointerType !== "mouse") guide();
  };
  const onFocusIn = () => guide();

  // L'utilisateur commence à corriger : l'onde s'arrête ; « prêt » est relu après la pause de frappe
  const onInput = () => {
    cancelWave();
    syncRequired();
    cancelReadyPause();
    readyPause = setTimeout(() => {
      readyPause = undefined;
      evaluate();
    }, TYPING_PAUSE);
  };
  // À la sortie d'un champ, sans attendre la fin de la pause
  const onFocusOut = (event: Event) => {
    syncRequired();
    cancelReadyPause();
    evaluate(false, (event as FocusEvent).relatedTarget ?? null);
  };
  // Un fieldset en erreur (groupe de cases validé par react-hook-form, Zod) : trait sous sa legend
  const onAria = (records: MutationRecord[]) => {
    // L'état d'un champ a changé (erreur, correction après la pause de frappe) : les lueurs suivent
    syncRequired();
    for (const { target, oldValue, attributeName } of records) {
      if (attributeName !== "aria-invalid" || !(target instanceof HTMLFieldSetElement)) continue;
      const now = target.getAttribute("aria-invalid");
      const wasError = oldValue !== null && oldValue !== "false";
      const isError = now !== null && now !== "false";
      if (isError && !wasError) queueError(target);
      else if (!isError && wasError) {
        const legend = legendOf(target);
        if (legend) underline(legend, "success");
      }
    }
    evaluate();
  };
  const ariaObserver = typeof MutationObserver === "function" ? new MutationObserver(onAria) : undefined;

  function track(result: unknown, submitter: HTMLElement | null): void {
    if (!isThenable(result)) return;
    busy = true;
    // Le dev peut avoir posé aria-busy lui-même : on ne retire que ce qu'on a posé
    const ours = submitter !== null && submitter.getAttribute("aria-busy") !== "true";
    if (ours) submitter.setAttribute("aria-busy", "true");
    const end = (sent: "success" | "error") => {
      busy = false;
      if (ours) submitter.removeAttribute("aria-busy");
      const button = submitter instanceof HTMLButtonElement ? buttonOf(submitter) : undefined;
      button?.settle(sent);
    };
    result.then(
      () => end("success"),
      () => end("error"),
    );
  }

  const onSubmit = (event: Event) => {
    const submit = event as SubmitEvent;
    // Envoi en cours : les suivants sont ignorés (évite le double paiement), le bouton reste actif
    if (busy) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (options.onSubmit) track(options.onSubmit(submit), submit.submitter ?? null);
  };

  element.addEventListener("invalid", onInvalid, true);
  element.addEventListener("submit", onSubmit);
  element.addEventListener("input", onInput, true);
  element.addEventListener("change", onFocusOut, true);
  if (options.guide) {
    element.addEventListener("pointerenter", onPointerEnter);
    element.addEventListener("pointerleave", onPointerLeave);
    element.addEventListener("pointerdown", onPointerDown, true);
    element.addEventListener("focusin", onFocusIn);
  }
  element.addEventListener("focusout", onFocusOut, true);
  ariaObserver?.observe(element, { attributes: true, attributeOldValue: true, subtree: true, attributeFilter: ["aria-invalid", "data-sui-state"] });
  evaluate(true);

  const controller: FormController = {
    element,
    get busy() {
      return busy;
    },
    track,
    queueError,
    get ready() {
      return ready;
    },
    setReady(value) {
      external = value;
      evaluate();
    },
    destroy() {
      element.removeEventListener("invalid", onInvalid, true);
      element.removeEventListener("submit", onSubmit);
      element.removeEventListener("input", onInput, true);
      element.removeEventListener("pointerenter", onPointerEnter);
      element.removeEventListener("pointerleave", onPointerLeave);
      element.removeEventListener("pointerdown", onPointerDown, true);
      element.removeEventListener("focusin", onFocusIn);
      onPointerLeave();
      cancelGuide();
      for (const label of required.keys()) delete label.dataset.suiRequired;
      required.clear();
      element.removeEventListener("change", onFocusOut, true);
      element.removeEventListener("focusout", onFocusOut, true);
      ariaObserver?.disconnect();
      cancelReadyPause();
      waitSeen?.();
      if (flush !== undefined) clearTimeout(flush);
      cancelWave();
      if (controllers.get(element) === controller) controllers.delete(element);
    },
  };
  controllers.set(element, controller);
  return controller;
}
