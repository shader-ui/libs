import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { light, TRAIL_MAX, watchChoice, watchForm } from "../src/index.js";
import { resetVisibility } from "../src/visibility.js";
import { createTestEngine } from "./helpers.js";

/** Tests de conformité : spec Formulaire §6.6 (Checkbox et Radio). */

const played = new Map<Element, string[]>();
const cleanups: Array<() => void> = [];
const flush = () => vi.advanceTimersByTimeAsync(0);

function spyLight(el: HTMLElement): void {
  const handle = light(el);
  const trigger = handle.trigger.bind(handle);
  played.set(el, []);
  vi.spyOn(handle, "trigger").mockImplementation((effect, options) => {
    played.get(el)!.push(typeof effect === "string" ? effect : `${effect.kind}:${String(effect.color)}`);
    trigger(effect, options);
  });
}

function setup(html: string, withForm = true) {
  document.body.innerHTML = html;
  const form = document.querySelector("form")!;
  if (withForm) {
    form.addEventListener("submit", (e) => e.preventDefault());
    const controller = watchForm(form);
    cleanups.push(() => controller.destroy());
  }
  for (const el of document.querySelectorAll<HTMLElement>("input, legend")) {
    el.getBoundingClientRect = () => ({ top: 100, left: 20, width: 20, height: 20, right: 40, bottom: 120, x: 20, y: 100 }) as DOMRect;
    spyLight(el);
  }
  for (const el of document.querySelectorAll<HTMLInputElement>("input")) {
    const c = watchChoice(el);
    cleanups.push(() => c.destroy());
  }
  return [...document.querySelectorAll<HTMLInputElement>("input")];
}

const choose = (radio: HTMLInputElement) => {
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  vi.stubGlobal("innerWidth", 400);
  vi.stubGlobal("innerHeight", 800);
  Element.prototype.checkVisibility = () => true;
  createTestEngine();
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

const RADIOS = `<form><fieldset><legend>Livraison</legend>${["a", "b", "c", "d"].map((v) => `<input type="radio" name="l" value="${v}" required>`).join("")}</fieldset></form>`;

describe("Checkbox et Radio (§5, §6.6)", () => {
  it("cocher une case : allumée en CSS, aucun effet de shader", async () => {
    const [box] = setup(`<form><input type="checkbox"></form>`);
    box!.click();
    await flush();
    expect(box!.checked).toBe(true);
    expect(played.get(box!)).toEqual([]);
  });

  it("radio 1 → 4 : lumière par 2 et 3, puis 4 s'allume à l'arrivée, 400 ms au plus", async () => {
    const [a, b, c, d] = setup(RADIOS);
    choose(a!);
    await vi.advanceTimersByTimeAsync(2000);
    choose(d!);
    expect(d!.checked).toBe(true); // le natif, tout de suite
    expect(d!.dataset.suiPending).toBe(""); // l'allumage, à l'arrivée
    await vi.advanceTimersByTimeAsync(1);
    expect(played.get(b!)).toEqual(["glimmer"]);
    expect(played.get(c!)).toEqual([]);
    await vi.advanceTimersByTimeAsync(TRAIL_MAX);
    expect(played.get(c!)).toEqual(["glimmer"]);
    expect(played.get(d!)).toEqual(["pulse:success"]); // groupe obligatoire : arrivée verte
    expect(d!.dataset.suiPending).toBeUndefined();
  });

  it("flèche du clavier du dernier au premier (le navigateur fait le tour) : saut direct", async () => {
    const [a, b, c, d] = setup(RADIOS);
    choose(d!);
    await vi.advanceTimersByTimeAsync(2000);
    d!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    choose(a!);
    await vi.advanceTimersByTimeAsync(TRAIL_MAX);
    expect([...played.get(b!)!, ...played.get(c!)!]).toEqual([]);
    expect(played.get(a!)).toEqual(["pulse:success"]);
  });

  it("premier choix d'un groupe obligatoire : pas de trajet, trait vert sous la legend, point vert", async () => {
    const [, b, , d] = setup(RADIOS);
    const legend = document.querySelector("legend")!;
    choose(d!);
    await vi.advanceTimersByTimeAsync(TRAIL_MAX);
    expect(played.get(b!)).toEqual([]);
    expect(played.get(d!)).toEqual([]);
    expect(played.get(legend)).toEqual(["underline:success"]);
    expect(d!.dataset.suiState).toBe("valid");
  });

  it("plus de 3 changements par seconde : fondu, sans trajet", async () => {
    const [a, , , d] = setup(RADIOS);
    for (const r of [a!, d!, a!]) choose(r);
    choose(d!); // 4e changement dans la même seconde
    expect(d!.dataset.suiPending).toBeUndefined();
    await vi.advanceTimersByTimeAsync(TRAIL_MAX);
    expect(played.get(d!)).toEqual([]);
  });

  it("cocher une case obligatoire : sweep vert court, puis case verte ; facultative : blanche, sans effet", async () => {
    const [req, opt] = setup(`<form><input type="checkbox" required><input type="checkbox"></form>`);
    req!.click();
    opt!.click();
    await flush();
    expect(req!.dataset.suiState).toBe("valid");
    expect(played.get(req!)).toEqual(["sweep:success"]);
    expect(opt!.dataset.suiState).toBeUndefined();
    expect(played.get(opt!)).toEqual([]);
  });

  it("case obligatoire non cochée à l'envoi : pulse corail sur la case", async () => {
    const [box] = setup(`<form><input type="checkbox" required></form>`);
    box!.form!.checkValidity();
    await vi.advanceTimersByTimeAsync(1);
    expect(box!.dataset.suiState).toBe("error");
    expect(played.get(box!)).toEqual(["error"]);
  });

  it("groupe de radios en erreur, puis corrigé : un trait corail, puis vert, sous la legend", async () => {
    const radios = setup(RADIOS);
    const legend = document.querySelector("legend")!;
    radios[0]!.form!.checkValidity();
    await vi.advanceTimersByTimeAsync(1);
    expect(played.get(legend)).toEqual(["underline:error"]);
    expect(radios.every((r) => played.get(r)!.length === 0)).toBe(true);
    choose(radios[2]!);
    await flush();
    expect(played.get(legend)).toEqual(["underline:error", "underline:success"]);
  });
});
