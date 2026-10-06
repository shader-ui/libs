import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EFFECT_END_EVENT, light, lightOf, TYPING_PAUSE, watchField, type EffectEndDetail, type Field } from "../src/index.js";
import { createTestEngine, flush } from "./helpers.js";

/** Tests de conformité : spec Formulaire §6.4 (Input). */

let field: Field | undefined;
let played: string[] = [];
let origins: Array<{ x: number; y: number }> = [];
let reverses: boolean[] = [];

function input(attrs: Record<string, string> = {}): HTMLInputElement {
  const form = document.createElement("form");
  const el = document.createElement("input");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.getBoundingClientRect = () => ({ top: 100, left: 20, width: 300, height: 44, right: 320, bottom: 144, x: 20, y: 100 }) as DOMRect;
  form.appendChild(el);
  document.body.appendChild(form);
  return el;
}

/** Branche le contrôleur et note les effets qu'il joue. */
function watch(el: HTMLInputElement): Field {
  // La lumière est créée et espionnée avant le contrôleur : un effet joué au branchement serait vu
  const handle = light(el);
  const trigger = handle.trigger.bind(handle);
  vi.spyOn(handle, "trigger").mockImplementation((effect, options) => {
    played.push(String(effect));
    if (options?.origin && typeof options.origin === "object") origins.push(options.origin);
    reverses.push(options?.reverse === true);
    trigger(effect, options);
  });
  field = watchField(el);
  expect(lightOf(el)).toBe(handle);
  return field;
}

function type(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  createTestEngine();
  played = [];
  origins = [];
  reverses = [];
});

afterEach(() => {
  field?.destroy();
  field = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("état lu dans le HTML (§3.1)", () => {
  it("aria-busy=\"true\" → loading, orbit", async () => {
    const el = input();
    watch(el);
    el.setAttribute("aria-busy", "true");
    await flush();
    expect(field!.state).toBe("loading");
    expect(el.dataset.suiState).toBe("loading");
    expect(played).toEqual(["loading"]);
  });

  it("aria-invalid=\"true\" sur un champ natif valide → error", async () => {
    const el = input({ "aria-describedby": "e" });
    watch(el);
    el.setAttribute("aria-invalid", "true");
    await flush();
    expect(field!.state).toBe("error");
  });

  it("aria-invalid=\"false\" sur un champ natif invalide → pas d'erreur", () => {
    const el = input({ required: "", "aria-invalid": "false" });
    watch(el);
    field!.attempt();
    expect(field!.state).not.toBe("error");
  });

  it("champ invalide jamais touché → neutre", () => {
    const el = input({ required: "" });
    watch(el);
    expect(field!.state).toBe("neutral");
    expect(el.dataset.suiState).toBeUndefined();
  });

  it("valeur restaurée après F5, champ visité puis quitté sans saisie → vérifié", () => {
    const el = input({ type: "email", "aria-describedby": "e" });
    el.value = "pas-un-email"; // restauré par le navigateur : aucun événement input
    watch(el);
    expect(field!.state).toBe("neutral");
    el.focus();
    el.blur();
    expect(field!.state).toBe("error");
    expect(played).toEqual(["error"]);
  });

  it("champ vide traversé sans rien taper → reste neutre", () => {
    const el = input({ required: "" });
    watch(el);
    el.focus();
    el.blur();
    expect(field!.state).toBe("neutral");
  });

  it("rendu en erreur par le serveur → erreur au repos, sans pulse", () => {
    const el = input({ "aria-invalid": "true", "aria-describedby": "e" });
    watch(el);
    expect(el.dataset.suiState).toBe("error");
    expect(played).toEqual([]);
  });
});

describe("lumière selon la transition (§3.2)", () => {
  it("champ invalide quitté après saisie → error, pulse à la sortie", () => {
    const el = input({ type: "email", "aria-describedby": "e" });
    watch(el);
    el.focus();
    type(el, "pas-un-email");
    expect(played).toEqual([]);
    el.blur();
    expect(field!.state).toBe("error");
    expect(played).toEqual(["error"]);
  });

  it("erreur arrivée pendant la frappe → pulse à la sortie du champ, pas avant", async () => {
    const el = input({ "aria-describedby": "e" });
    watch(el);
    el.focus();
    type(el, "pris");
    el.setAttribute("aria-invalid", "true");
    await flush();
    expect(el.dataset.suiState).toBe("error"); // le sens, tout de suite
    expect(played).toEqual([]); // la lumière, plus tard
    el.blur();
    expect(played).toEqual(["error"]);
  });

  it("erreur arrivée sans focus (réponse serveur) → pulse tout de suite", async () => {
    const el = input({ "aria-describedby": "e" });
    watch(el);
    el.setAttribute("aria-invalid", "true");
    await flush();
    expect(played).toEqual(["error"]);
  });

  it("correction pendant la frappe → sweep vert après 1 s sans frappe", () => {
    vi.useFakeTimers();
    const el = input({ type: "email", required: "", "aria-describedby": "e" });
    watch(el);
    el.focus();
    type(el, "x");
    el.blur();
    el.focus();
    type(el, "x@y.fr");
    vi.advanceTimersByTime(TYPING_PAUSE - 1);
    expect(field!.state).toBe("error");
    expect(played).toEqual(["error"]);
    vi.advanceTimersByTime(1);
    expect(field!.state).toBe("valid");
    expect(played).toEqual(["error", "success"]);
    vi.useRealTimers();
  });

  it("états intermédiaires pendant la frappe : jamais montrés, un seul sweep", () => {
    vi.useFakeTimers();
    const el = input({ type: "email", "aria-describedby": "e" });
    watch(el);
    el.focus();
    type(el, "hani");
    el.blur();
    expect(played).toEqual(["error"]);
    el.focus();
    // Lettre par lettre, en passant par des états invalides (domaine qui finit par un tiret)
    for (const value of ["hani@s", "hani@shader-", "hani@shader-u", "hani@shader-ui.com"]) {
      type(el, value);
      vi.advanceTimersByTime(300);
      expect(field!.state).toBe("error");
    }
    vi.advanceTimersByTime(TYPING_PAUSE);
    expect(field!.state).toBe("valid");
    expect(played).toEqual(["error", "success"]);
    vi.useRealTimers();
  });

  it("obligatoire rempli, quitté → valid, diode verte, sweep", () => {
    const el = input({ required: "" });
    watch(el);
    el.focus();
    type(el, "Hani");
    expect(played).toEqual([]);
    el.blur();
    expect(el.dataset.suiState).toBe("valid");
    expect(played).toEqual(["success"]);
  });

  it("optionnel rempli et valide → neutre, pas de diode", () => {
    const el = input();
    watch(el);
    el.focus();
    type(el, "texte");
    el.blur();
    expect(field!.state).toBe("neutral");
    expect(played).toEqual([]);
  });

  it("tentative d'envoi : l'interaction compte, sans lumière (le Form choisit)", () => {
    const el = input({ required: "", "aria-describedby": "e" });
    watch(el);
    el.form!.checkValidity();
    expect(field!.state).toBe("error");
    expect(played).toEqual([]);
  });

  it("champ désactivé : aucun effet ; trigger() → skipped", async () => {
    const el = input({ "aria-describedby": "e", disabled: "" });
    watch(el);
    el.setAttribute("aria-invalid", "true");
    await flush();
    expect(el.dataset.suiState).toBe("error");
    expect(played).toEqual([]);
    const ends: EffectEndDetail[] = [];
    el.addEventListener(EFFECT_END_EVENT, (e) => ends.push((e as CustomEvent<EffectEndDetail>).detail));
    light(el).trigger("pulse");
    await flush();
    expect(ends).toEqual([{ name: "pulse", reason: "skipped" }]);
  });
});

describe("diode (§3.3)", () => {
  it("les effets partent de la diode, au bout du champ", async () => {
    const el = input({ "aria-describedby": "e" });
    watch(el);
    el.setAttribute("aria-invalid", "true");
    await flush();
    expect(origins[0]).toEqual({ x: 320 - 18, y: 122 });
  });

  it("validation : tour complet depuis le coin haut gauche ; en RTL, depuis le coin haut droit, dans l'autre sens", () => {
    const ltr = input({ required: "" });
    watch(ltr);
    ltr.focus();
    type(ltr, "Hani");
    ltr.blur();
    expect(origins.at(-1)).toEqual({ x: 20, y: 100 });
    expect(reverses.at(-1)).toBe(false);
    field!.destroy();
    const rtl = input({ required: "" });
    rtl.style.direction = "rtl";
    watch(rtl);
    rtl.focus();
    type(rtl, "نعم");
    rtl.blur();
    expect(origins.at(-1)).toEqual({ x: 320, y: 100 });
    expect(reverses.at(-1)).toBe(true);
  });

  it("RTL : diode et départ des effets à gauche", async () => {
    const el = input({ "aria-describedby": "e" });
    el.style.direction = "rtl";
    watch(el);
    el.setAttribute("aria-invalid", "true");
    await flush();
    expect(origins[0]).toEqual({ x: 20 + 18, y: 122 });
  });

});

describe("mode dev", () => {

  it("erreur sans texte associé : avertissement (WCAG 1.4.1)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = input();
    watch(el);
    el.setAttribute("aria-invalid", "true");
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("aria-describedby"));
  });
});

