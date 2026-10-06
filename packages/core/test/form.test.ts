import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_STAGGER, INVALID_WAIT, light, TYPING_PAUSE, watchButton, watchField, watchForm, type Button, type FormController } from "../src/index.js";
import { resetVisibility } from "../src/visibility.js";
import { createTestEngine } from "./helpers.js";

/** Horloge simulée dans ce fichier : on la fait avancer de 0 ms, ce qui vide aussi les microtâches. */
const flush = () => vi.advanceTimersByTimeAsync(0);

/** Tests de conformité : spec Formulaire §6.3 (envoi) et §6.5 (Button, hors pulse « prêt »). */

const played = new Map<Element, string[]>();
const cleanups: Array<() => void> = [];

/** Lumière créée et espionnée avant le contrôleur : chaque effet joué est noté. */
function spyLight(el: HTMLElement): void {
  const handle = light(el);
  const trigger = handle.trigger.bind(handle);
  played.set(el, []);
  vi.spyOn(handle, "trigger").mockImplementation((effect, options) => {
    played.get(el)!.push(String(effect));
    trigger(effect, options);
  });
}

const onScreen = (el: Element, top = 100) =>
  (el.getBoundingClientRect = () => ({ top, left: 20, width: 300, height: 44, right: 320, bottom: top + 44, x: 20, y: top }) as DOMRect);

function setup(html: string, onSubmit?: (e: SubmitEvent) => unknown, ready?: boolean) {
  document.body.innerHTML = html;
  const form = document.querySelector("form")!;
  form.addEventListener("submit", (e) => e.preventDefault());
  const controller = watchForm(form, { onSubmit, ready });
  cleanups.push(() => controller.destroy());
  for (const el of form.querySelectorAll<HTMLInputElement>("input")) {
    onScreen(el);
    spyLight(el);
    const f = watchField(el);
    cleanups.push(() => f.destroy());
  }
  const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")].map((el) => {
    onScreen(el, 400);
    spyLight(el);
    const b = watchButton(el);
    cleanups.push(() => b.destroy());
    return b;
  });
  return { form, controller, buttons };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  // jsdom : pas d'IntersectionObserver ni de checkVisibility, la visibilité est calculée à la demande
  vi.stubGlobal("innerWidth", 400);
  vi.stubGlobal("innerHeight", 800);
  Element.prototype.checkVisibility = () => true;
});

afterEach(() => {
  cleanups.splice(0).forEach((c) => c());
  resetVisibility();
  played.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // @ts-expect-error retour à jsdom
  delete Element.prototype.checkVisibility;
});

describe("validation et envoi (§2.3, §6.3)", () => {
  it("envoi avec trois champs invalides : onde, l'un après l'autre, 150 ms d'écart", async () => {
    createTestEngine();
    const { form } = setup(`<form><input required aria-describedby="e"><input required aria-describedby="e"><input required aria-describedby="e"><button>Envoyer</button></form>`);
    const [a, b, c] = form.querySelectorAll("input");
    form.checkValidity();
    await vi.advanceTimersByTimeAsync(1);
    expect([played.get(a!), played.get(b!), played.get(c!)]).toEqual([["error"], [], []]);
    await vi.advanceTimersByTimeAsync(ERROR_STAGGER);
    expect(played.get(b!)).toEqual(["error"]);
    expect(played.get(c!)).toEqual([]);
    await vi.advanceTimersByTimeAsync(ERROR_STAGGER);
    expect(played.get(c!)).toEqual(["error"]);
  });

  it("événements invalid envoyés un par un par le navigateur (microtâches entre eux) : une seule onde", async () => {
    createTestEngine();
    const { form } = setup(`<form><input required aria-describedby="e"><input required aria-describedby="e"><button>Envoyer</button></form>`);
    const [a, b] = form.querySelectorAll("input");
    a!.dispatchEvent(new Event("invalid", { cancelable: true }));
    await Promise.resolve();
    b!.dispatchEvent(new Event("invalid", { cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(played.get(a!)).toEqual(["error"]);
    expect(played.get(b!)).toEqual([]);
    await vi.advanceTimersByTimeAsync(ERROR_STAGGER);
    expect(played.get(b!)).toEqual(["error"]);
  });

  it("trois aria-invalid posés d'un coup (react-hook-form) : même onde, dans l'ordre du formulaire", async () => {
    createTestEngine();
    const { form } = setup(`<form novalidate><input aria-describedby="e"><input aria-describedby="e"></form>`);
    // Champ ajouté plus tard, au début du formulaire : branché en dernier, mais premier dans l'onde
    const first = document.createElement("input");
    first.setAttribute("aria-describedby", "e");
    form.prepend(first);
    onScreen(first);
    spyLight(first);
    const f = watchField(first);
    cleanups.push(() => f.destroy());
    const [a, b, c] = form.querySelectorAll("input");
    for (const el of [a!, b!, c!]) el.setAttribute("aria-invalid", "true");
    await vi.advanceTimersByTimeAsync(1);
    expect([played.get(a!), played.get(b!), played.get(c!)]).toEqual([["error"], [], []]);
    await vi.advanceTimersByTimeAsync(2 * ERROR_STAGGER);
    expect([played.get(b!), played.get(c!)]).toEqual([["error"], ["error"]]);
  });

  it("onde de 5 champs : un seul effet pour la limite de 3 par seconde, aucun pulse ignoré", async () => {
    const { engine } = createTestEngine();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { form } = setup(`<form>${'<input required aria-describedby="e">'.repeat(5)}</form>`);
    const ends: string[] = [];
    form.addEventListener("sui:effectend", (e) => ends.push((e as CustomEvent).detail.reason));
    form.checkValidity();
    await vi.advanceTimersByTimeAsync(5 * ERROR_STAGGER);
    expect([...form.querySelectorAll("input")].every((el) => played.get(el)!.length === 1)).toBe(true);
    expect(ends).not.toContain("skipped");
    expect(warn).not.toHaveBeenCalled();
    expect(engine.getStats().active).toBeGreaterThan(0);
  });

  it("l'utilisateur saisit pendant l'onde : elle s'arrête", async () => {
    createTestEngine();
    const { form } = setup(`<form><input required aria-describedby="e"><input required aria-describedby="e"><input required aria-describedby="e"></form>`);
    const [a, , c] = form.querySelectorAll("input");
    form.checkValidity();
    await vi.advanceTimersByTimeAsync(1);
    a!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3 * ERROR_STAGGER);
    expect(played.get(c!)).toEqual([]);
  });

  it("premier champ invalide hors de l'écran (clavier mobile) : attend 1 s, puis skipped si toujours invisible", async () => {
    const t = createTestEngine({ visible: () => false });
    const { form } = setup(`<form><input required aria-describedby="e"><button>Envoyer</button></form>`);
    const input = form.querySelector("input")!;
    onScreen(input, 2000);
    const ends: string[] = [];
    input.addEventListener("sui:effectend", (e) => ends.push((e as CustomEvent).detail.reason));
    form.checkValidity();
    await vi.advanceTimersByTimeAsync(INVALID_WAIT - 10);
    expect(played.get(input)).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(played.get(input)).toEqual(["error"]);
    await flush();
    expect(ends).toEqual(["skipped"]);
    expect(t.pendingFrames).toBe(0);
  });

  it("onSubmit renvoie une promesse : aria-busy sur le bouton cliqué jusqu'à la réponse, puis sweep", async () => {
    // Repli CSS (sans WebGL) : c'est là qu'arrêter l'orbit couperait aussi le sweep
    const { engine } = createTestEngine({ webgl: false });
    let resolve!: () => void;
    const { form, buttons } = setup(`<form><button>Envoyer</button></form>`, () => new Promise<void>((r) => (resolve = r)));
    const button = buttons[0]!.element;
    form.requestSubmit(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await flush();
    expect(button.dataset.suiState).toBe("loading");
    expect(played.get(button)).toEqual(["loading"]);
    resolve();
    await flush();
    await flush();
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(button.dataset.suiState).toBeUndefined();
    expect(played.get(button)).toEqual(["loading", "success"]);
    // La fin d'aria-busy n'éteint pas le sweep qui vient de partir
    expect(engine.getStats().active).toBe(1);
  });

  it("réponse en échec : pulse corail, diode retirée", async () => {
    createTestEngine();
    let reject!: () => void;
    const { form, buttons } = setup(`<form><button>Envoyer</button></form>`, () => new Promise<void>((_, r) => (reject = r)));
    const button = buttons[0]!.element;
    form.requestSubmit(button);
    await flush();
    reject();
    await flush();
    await flush();
    expect(played.get(button)).toEqual(["loading", "error"]);
    expect(button.dataset.suiState).toBeUndefined();
  });

  it("deuxième envoi pendant l'attente : ignoré, bouton toujours actif et focusable", async () => {
    createTestEngine();
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    const { form, buttons } = setup(`<form><button>Envoyer</button></form>`, onSubmit);
    const button = buttons[0]!.element;
    form.requestSubmit(button);
    form.requestSubmit(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
  });

});

describe("Button (§4, §6.5)", () => {
  let button: Button;
  let el: HTMLButtonElement;

  beforeEach(() => {
    createTestEngine();
    el = document.createElement("button");
    onScreen(el);
    document.body.appendChild(el);
    spyLight(el);
    button = watchButton(el);
    cleanups.push(() => button.destroy());
  });

  it("formulaire invalide : jamais désactivé par la lib", () => {
    const form = document.createElement("form");
    form.innerHTML = `<input required>`;
    form.appendChild(el);
    document.body.appendChild(form);
    const controller: FormController = watchForm(form);
    cleanups.push(() => controller.destroy());
    form.checkValidity();
    expect(el.disabled).toBe(false);
  });

  it("bouton hors formulaire avec aria-busy : orbit et diode, puis extinction", async () => {
    el.setAttribute("aria-busy", "true");
    await flush();
    expect(el.dataset.suiState).toBe("loading");
    expect(played.get(el)).toEqual(["loading"]);
    el.removeAttribute("aria-busy");
    await flush();
    expect(el.dataset.suiState).toBeUndefined();
  });

});

describe("pulse « prêt » (§4.2, §6.5)", () => {
  const FORM = `<form><input required aria-describedby="e"><button>Brouillon</button><button>Publier</button></form>`;
  const fill = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("formulaire devenu prêt : pulse sur le premier bouton après 1 s sans frappe", async () => {
    createTestEngine();
    const { form, buttons } = setup(FORM);
    fill(form.querySelector("input")!, "Hani");
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE - 1);
    expect(played.get(buttons[0]!.element)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(played.get(buttons[0]!.element)).toEqual(["pulse"]);
    expect(played.get(buttons[1]!.element)).toEqual([]);
  });

  it("sortie du champ vers le bouton (clic, Tab) : pas de pulse", async () => {
    createTestEngine();
    const { form, buttons } = setup(FORM);
    const input = form.querySelector("input")!;
    fill(input, "Hani");
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: buttons[0]!.element }));
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE);
    expect(played.get(buttons[0]!.element)).toEqual([]);
  });

  it("prêt, pas prêt, prêt en 4 s : un seul pulse", async () => {
    createTestEngine();
    const { form, buttons } = setup(FORM);
    const input = form.querySelector("input")!;
    for (const value of ["a", "", "b"]) {
      fill(input, value);
      await vi.advanceTimersByTimeAsync(TYPING_PAUSE + 300);
    }
    expect(played.get(buttons[0]!.element)).toEqual(["pulse"]);
  });

  it("ready faux, champs valides : pas prêt ; ready passe à vrai en dernier : pulse à ce moment", async () => {
    createTestEngine();
    const { form, controller, buttons } = setup(FORM, undefined, false);
    fill(form.querySelector("input")!, "Hani");
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE);
    expect(controller.ready).toBe(false);
    expect(played.get(buttons[0]!.element)).toEqual([]);
    controller.setReady(true);
    expect(played.get(buttons[0]!.element)).toEqual(["pulse"]);
  });

  it("déjà prêt au chargement : rien (l'état initial ne s'allume jamais)", async () => {
    createTestEngine();
    // Ordre de React : le bouton est branché avant le formulaire qui le contient
    document.body.innerHTML = `<form><input value="Hani" required><button>Envoyer</button></form>`;
    const form = document.querySelector("form")!;
    const button = form.querySelector("button")!;
    onScreen(button, 400);
    spyLight(button);
    const b = watchButton(button);
    const controller = watchForm(form);
    cleanups.push(() => (controller.destroy(), b.destroy()));
    expect(controller.ready).toBe(true);
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE * 2);
    expect(played.get(button)).toEqual([]);
  });
});
