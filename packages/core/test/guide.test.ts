import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_STAGGER, GUIDE_HOVER, watchForm } from "../src/index.js";
import { createTestEngine } from "./helpers.js";

/** Tests de conformité : spec Formulaire §6.2 (mode init : lueur après les labels obligatoires). */

const cleanups: Array<() => void> = [];

function setup(html: string) {
  document.body.innerHTML = html;
  const form = document.querySelector("form")!;
  const controller = watchForm(form, { guide: true });
  cleanups.push(() => controller.destroy());
  return form;
}

/** Labels dont la lueur est allumée. */
const glowing = () => [...document.querySelectorAll<HTMLElement>("[data-sui-required='on']")].map((el) => el.textContent);
const focusIn = (el: Element) => el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  vi.useFakeTimers();
  createTestEngine();
});

afterEach(() => {
  cleanups.splice(0).forEach((c) => c());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const FORM = `<form>
  <label for="a">Nom</label><input id="a" required>
  <label for="b">Ville</label><input id="b">
  <label for="c">E-mail</label><input id="c" required>
  <fieldset><legend>Livraison</legend><input type="radio" name="l" required><input type="radio" name="l" required></fieldset>
  <input id="go" type="submit">
</form>`;

describe("mode init (§2.2, §6.2)", () => {
  it("premier geste : une lueur après chaque label obligatoire, en cascade ; aucune avant ; une seule pour le groupe", async () => {
    const form = setup(FORM);
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(glowing()).toEqual([]);
    focusIn(form.querySelector("#go")!);
    expect(glowing()).toEqual(["Nom"]);
    vi.advanceTimersByTime(2 * ERROR_STAGGER);
    expect(glowing()).toEqual(["Nom", "E-mail", "Livraison"]);
  });

  it("place réservée dès le chargement (lueur éteinte) : l'allumer ne déplace pas la mise en page", () => {
    setup(FORM);
    const labels = [...document.querySelectorAll<HTMLElement>("label, legend")];
    expect(labels.filter((l) => l.dataset.suiRequired === "").map((l) => l.textContent)).toEqual(["Nom", "E-mail", "Livraison"]);
  });

  it("souris qui traverse en moins de 300 ms : rien ; survol continu : lueurs", () => {
    const form = setup(FORM);
    form.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    vi.advanceTimersByTime(GUIDE_HOVER - 50);
    form.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    vi.advanceTimersByTime(1000);
    expect(glowing()).toEqual([]);
    form.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    vi.advanceTimersByTime(GUIDE_HOVER);
    expect(glowing()).toContain("Nom");
  });

  it("champ renseigné, puis vidé : la lueur s'éteint, puis se rallume ; radio choisi : éteinte", () => {
    const form = setup(FORM);
    focusIn(form.querySelector("#go")!);
    vi.advanceTimersByTime(1000);
    const nom = form.querySelector<HTMLInputElement>("#a")!;
    type(nom, "Hani");
    expect(glowing()).not.toContain("Nom");
    expect(form.querySelector("label")!.dataset.suiRequired).toBe("off");
    type(nom, "");
    expect(glowing()).toContain("Nom");
    const radio = form.querySelector<HTMLInputElement>("[type=radio]")!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    expect(glowing()).not.toContain("Livraison");
  });

  it("champ renseigné mais en erreur : la lueur reste, puis s'éteint une fois corrigé", async () => {
    const form = setup(FORM);
    focusIn(form.querySelector("#go")!);
    vi.advanceTimersByTime(1000);
    const nom = form.querySelector<HTMLInputElement>("#a")!;
    type(nom, "pris");
    nom.setAttribute("aria-invalid", "true");
    await Promise.resolve();
    expect(glowing()).toContain("Nom");
    nom.removeAttribute("aria-invalid");
    await Promise.resolve();
    expect(glowing()).not.toContain("Nom");
  });

  it("champ obligatoire sans label visible : pas de lueur, avertissement en mode dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const form = setup(`<form><label for="a">Nom</label><input id="a" required><input id="x" required placeholder="Sans label"></form>`);
    focusIn(form);
    vi.advanceTimersByTime(1000);
    expect(glowing()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("WCAG 3.3.2"));
  });

  it("nouveau geste : pas de nouvelle apparition ; destroy retire les lueurs", () => {
    const form = setup(FORM);
    focusIn(form.querySelector("#go")!);
    vi.advanceTimersByTime(1000);
    const label = form.querySelector("label")!;
    label.dataset.suiRequired = "marqué";
    focusIn(form.querySelector("#go")!);
    vi.advanceTimersByTime(1000);
    expect(label.dataset.suiRequired).toBe("marqué");
    cleanups.splice(0).forEach((c) => c());
    expect(document.querySelectorAll("[data-sui-required]")).toHaveLength(0);
  });
});
