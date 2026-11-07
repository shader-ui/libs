import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureEnvironment, light, RAIL_AFTERGLOW, RAIL_MAX, RAIL_MIN, scrollspy, SCROLL_IDLE, type EffectDefinition, type ScrollspyOptions } from "../src/index.js";
import { resetVisibility } from "../src/visibility.js";
import { scrollDuration } from "../src/scroll.js";
import { createTestEngine } from "./helpers.js";

/** Tests de conformité : spec Scrollspy §10. */

const VIEW = 900;
/** Haut de la section k (1 à 8) dans le document ; la dernière est courte. */
const topOf = (k: number) => 500 + (k - 1) * 1000;
const HEIGHT = topOf(8) + 400;
/** Position qui place la ligne repère (tiers haut) dans la section k. */
const inside = (k: number) => topOf(k) - 200;

let y = 0;
let navVisible = true;
/** Écart vertical entre deux entrées du sommaire, en px. */
let gap = 24;
const log: string[] = [];
const boxes: DOMRect[] = [];
const durations: number[] = [];
const cleanups: Array<() => void> = [];

function rect(top: number, height = 20): DOMRect {
  return { top, left: 20, width: 100, height, right: 120, bottom: top + height, x: 20, y: top } as DOMRect;
}

/** Sommaire de 8 entrées ; `extra` s'ajoute à la fin du sommaire. */
function setup(options: ScrollspyOptions = {}, extra = "") {
  const items = Array.from({ length: 8 }, (_, i) => `<li><a href="#s${i + 1}">S${i + 1}</a></li>`).join("");
  const sections = Array.from({ length: 8 }, (_, i) => `<section id="s${i + 1}" data-top="${topOf(i + 1)}"></section>`).join("");
  document.body.innerHTML = `<nav><ul>${items}${extra}</ul></nav>${sections}`;
  const nav = document.querySelector("nav")!;
  nav.getBoundingClientRect = () => (navVisible ? rect(50, 400) : rect(-1000, 400));
  // Le rail : bord gauche de la liste de premier niveau, 10 px avant les entrées
  nav.querySelector("ul")!.getBoundingClientRect = () => ({ ...rect(50, 400), left: 10, x: 10 }) as DOMRect;
  const handle = light(nav);
  const trigger = handle.trigger.bind(handle);
  vi.spyOn(handle, "trigger").mockImplementation((effect, opts) => {
    const def = effect as EffectDefinition;
    log.push(`${def.kind}:${opts?.origin === 1 ? "up" : "down"}`);
    durations.push(def.duration);
    if (opts?.box) boxes.push(opts.box());
    trigger(effect, opts);
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-top]")) {
    el.getBoundingClientRect = () => rect(Number(el.dataset.top) - y, 1000);
  }
  const links = [...nav.querySelectorAll<HTMLAnchorElement>("a")];
  links.forEach((link, i) => {
    link.getBoundingClientRect = () => rect(60 + i * gap);
    // Les entrées ne jouent jamais rien elles-mêmes
    light(link).trigger = () => void log.push(`${link.textContent}:effect`);
  });
  const stop = scrollspy(nav, options);
  cleanups.push(stop);
  return { nav, links, stop };
}

/** Le lecteur fait défiler jusqu'à `to`, puis s'arrête. */
async function scrollTo(to: number, settle = true) {
  y = to;
  window.dispatchEvent(new Event("scroll"));
  if (settle) await vi.advanceTimersByTimeAsync(SCROLL_IDLE + RAIL_MAX);
}

const current = (links: HTMLAnchorElement[]) => links.filter((l) => l.getAttribute("aria-current") === "location").map((l) => l.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
  y = 0;
  navVisible = true;
  gap = 24;
  vi.stubGlobal("innerWidth", 1200);
  vi.stubGlobal("innerHeight", VIEW);
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, get: () => VIEW });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => HEIGHT });
  window.scrollTo = vi.fn((arg: ScrollToOptions | number) => {
    y = typeof arg === "number" ? arg : (arg.top ?? y);
    window.dispatchEvent(new Event("scroll"));
  }) as typeof window.scrollTo;
  Element.prototype.checkVisibility = () => true;
  createTestEngine();
});

afterEach(() => {
  cleanups.splice(0).forEach((c) => c());
  configureEnvironment(undefined);
  resetVisibility();
  log.length = 0;
  boxes.length = 0;
  durations.length = 0;
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // @ts-expect-error retour à jsdom
  delete Element.prototype.checkVisibility;
  // @ts-expect-error retour à jsdom
  delete window.onscrollend;
});

describe("Section courante (§4, §5)", () => {
  it("attachement au milieu de la page : entrée marquée, sans lumière", async () => {
    y = inside(3);
    const { links } = setup();
    await vi.advanceTimersByTimeAsync(RAIL_MAX);
    expect(current(links)).toEqual(["S3"]);
    expect(links[2]!.dataset.suiScrollspy).toBe("current");
    expect(log).toEqual([]);
  });

  it("pendant le défilement, rien ne change ; à l'arrêt, un saut et l'arrivée", async () => {
    y = inside(1);
    const { links } = setup();
    await scrollTo(inside(2), false);
    await vi.advanceTimersByTimeAsync(SCROLL_IDLE - 1);
    expect(current(links)).toEqual(["S1"]);
    expect(log).toEqual([]);
    await vi.advanceTimersByTimeAsync(RAIL_MAX);
    expect(current(links)).toEqual(["S2"]);
    expect(log).toEqual(["rail:down"]);
  });

  it("3 sections plus bas : un seul liseré sur le rail, rien sur les entrées, la marque attend la lumière", async () => {
    y = inside(1);
    const { links } = setup();
    await scrollTo(inside(4), false);
    await vi.advanceTimersByTimeAsync(SCROLL_IDLE);
    expect(current(links)).toEqual(["S4"]); // aria-current tout de suite
    expect(links[3]!.dataset.suiPending).toBe("");
    expect(log).toEqual(["rail:down"]);
    // Colonne du rail : de S1 à S4, 2 px centrés sur le bord de la liste
    expect(boxes[0]).toMatchObject({ left: 9, width: 2, top: 60, height: 3 * 24 + 20 });
    await vi.advanceTimersByTimeAsync(RAIL_MAX);
    expect(links[3]!.dataset.suiPending).toBeUndefined();
  });

  it("vitesse constante : durée bornée entre 250 et 500 ms", async () => {
    gap = 100;
    y = inside(1);
    setup();
    await scrollTo(inside(2));
    await vi.advanceTimersByTimeAsync(1000);
    await scrollTo(inside(8));
    // Trajet borné, puis la rémanence
    expect(durations).toEqual([RAIL_MIN + RAIL_AFTERGLOW, RAIL_MAX + RAIL_AFTERGLOW]);
  });

  it("arrêts rapides au-delà de 3 par seconde : liseré sauté, la marque apparaît aussitôt", async () => {
    y = inside(1);
    const { links } = setup();
    for (const k of [2, 3, 4, 5]) {
      await scrollTo(inside(k), false);
      await vi.advanceTimersByTimeAsync(SCROLL_IDLE);
    }
    expect(log).toHaveLength(4); // le 4e est demandé, puis sauté par le moteur (WCAG 2.3.1)
    expect(current(links)).toEqual(["S5"]);
    expect(links[4]!.dataset.suiPending).toBeUndefined();
  });

  it("nouvel arrêt pendant le glissement : le liseré repart de là où il est, sans sauter d'entrée", async () => {
    y = inside(1);
    setup();
    await scrollTo(inside(5), false);
    await vi.advanceTimersByTimeAsync(SCROLL_IDLE); // S1 → S5 : 96 px, 250 ms
    await scrollTo(inside(6), false);
    await vi.advanceTimersByTimeAsync(SCROLL_IDLE); // arrêt détecté à 150 ms : faisceau aux 3/5 du trajet
    expect(log).toEqual(["rail:down", "rail:down"]);
    // Le 2e part de la position du faisceau (top ≈ 118), pas de S5 (top 156)
    expect(boxes[1]!.top).toBeLessThan(156);
    expect(boxes[1]!.top).toBeGreaterThan(60);
  });

  it("remontée : le liseré monte", async () => {
    y = inside(5);
    setup();
    await scrollTo(inside(3));
    expect(log).toEqual(["rail:up"]);
  });

  it("marque de l'entrée courante posée sur le rail", () => {
    y = inside(2);
    const { links } = setup();
    expect(links[1]!.style.getPropertyValue("--sui-rail-offset")).toBe("10px");
  });

  it("défilement puis retour sur la même section : rien", async () => {
    y = inside(2);
    const { links } = setup();
    await scrollTo(inside(4), false);
    await scrollTo(inside(2));
    expect(current(links)).toEqual(["S2"]);
    expect(log).toEqual([]);
  });

  it("haut de page : aucune entrée ; bas de page : la dernière, même courte", async () => {
    const { links } = setup();
    expect(current(links)).toEqual([]);
    await scrollTo(HEIGHT - VIEW);
    expect(current(links)).toEqual(["S8"]);
  });

  it("en-tête fixe : la ligne repère est décalée de scroll-padding-top", async () => {
    document.documentElement.style.scrollPaddingTop = "150px";
    y = topOf(2) - 340; // ligne à 150 + 250 = 400 : S2 a passé la ligne
    const { links } = setup();
    expect(current(links)).toEqual(["S2"]);
    document.documentElement.style.scrollPaddingTop = "";
  });

  it("avec scrollend : la fin du défilement est l'événement, pas le délai", async () => {
    window.onscrollend = null;
    y = inside(1);
    const { links } = setup();
    await scrollTo(inside(2), false);
    await vi.advanceTimersByTimeAsync(SCROLL_IDLE * 3);
    expect(current(links)).toEqual(["S1"]);
    window.dispatchEvent(new Event("scrollend"));
    await vi.advanceTimersByTimeAsync(RAIL_MAX);
    expect(current(links)).toEqual(["S2"]);
  });
});

describe("Cibles et niveaux (§3)", () => {
  it("sous-section : l'entrée de niveau 1 reste courante, le niveau 2 n'est jamais marqué", async () => {
    y = inside(1);
    const { links } = setup({}, `<li><a href="#s8">S8</a><ul><li><a href="#sub">Sub</a></li></ul></li>`);
    const sub = document.createElement("div");
    sub.id = "sub";
    sub.getBoundingClientRect = () => rect(topOf(7) + 300 - y, 100);
    document.getElementById("s7")!.append(sub);
    await scrollTo(inside(7) + 300);
    const subLink = [...document.querySelectorAll("a")].find((a) => a.textContent === "Sub")!;
    expect(current(links)).toEqual(["S7"]);
    expect(subLink.hasAttribute("aria-current")).toBe(false);
  });

  it("lien avec chemin complet vers la page affichée : suivi ; autre page ou #id absent : ignorés", async () => {
    history.replaceState(null, "", "/docs/guide");
    y = inside(2);
    const { links } = setup({}, `<li><a href="/docs/autre#s2">Autre</a></li><li><a href="#absent">Absent</a></li>`);
    links[1]!.setAttribute("href", "/docs/guide#s2");
    await vi.advanceTimersByTimeAsync(0);
    expect(current([...document.querySelectorAll("a")])).toEqual(["S2"]);
  });
});

describe("aria-current (§4 bis)", () => {
  it("aria-current du site jamais touché ; stop() ne retire que ce que la lib a posé", async () => {
    y = inside(1);
    const { links, stop } = setup();
    links[1]!.setAttribute("aria-current", "page");
    await scrollTo(inside(2));
    expect(links[1]!.getAttribute("aria-current")).toBe("page");
    expect(links[1]!.hasAttribute("data-sui-scrollspy")).toBe(true);
    expect(log).toEqual(["rail:down"]);
    await scrollTo(inside(1));
    expect(links[0]!.getAttribute("aria-current")).toBe("location");
    stop();
    expect(links[0]!.hasAttribute("aria-current")).toBe(false);
    expect(links[1]!.getAttribute("aria-current")).toBe("page");
    expect(document.querySelectorAll("[data-sui-scrollspy]")).toHaveLength(0);
  });
});

describe("Cas où le trajet n'est pas joué (§7)", () => {
  it("prefers-reduced-motion : marque déplacée, sans lumière", async () => {
    configureEnvironment({ preferences: { reducedMotion: true } });
    y = inside(1);
    const { links } = setup();
    await scrollTo(inside(3));
    expect(current(links)).toEqual(["S3"]);
    expect(log).toEqual([]);
  });

  it("sommaire hors de l'écran : aria-current change, aucun effet", async () => {
    y = inside(1);
    const { links } = setup();
    navVisible = false;
    await scrollTo(inside(3));
    expect(current(links)).toEqual(["S3"]);
    expect(log).toEqual([]);
  });
});

describe("Défilement au clic (§6 bis)", () => {
  const click = (link: HTMLAnchorElement) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    return event;
  };

  it("scroll: none : clic non intercepté, la lumière part au clic avec l'ancre native", async () => {
    y = inside(1);
    const { links } = setup();
    expect(click(links[3]!).defaultPrevented).toBe(false);
    expect(current(links)).toEqual(["S4"]);
    expect(log).toEqual(["rail:down"]);
    await scrollTo(inside(4)); // l'ancre native fait défiler
    expect(log).toEqual(["rail:down"]); // pas de deuxième trajet
  });

  it("scroll: smooth : la lumière part au clic, avec la durée du défilement ; hash et focus suivent", async () => {
    y = inside(1);
    const { links } = setup({ scroll: "smooth" });
    expect(click(links[3]!).defaultPrevented).toBe(true);
    expect(location.hash).toBe("#s4");
    expect(log).toEqual(["rail:down"]); // en même temps que le défilement
    expect(durations[0]).toBe(scrollDuration("smooth", topOf(4) - inside(1)) + RAIL_AFTERGLOW);
    await vi.advanceTimersByTimeAsync(2000);
    expect(y).toBe(topOf(4));
    expect(current(links)).toEqual(["S4"]);
    expect(log).toEqual(["rail:down"]);
    expect(document.activeElement).toBe(document.getElementById("s4"));
  });

  it("clic sur une sous-entrée : la lumière va sur son entrée de niveau 1", async () => {
    y = inside(1);
    const { links } = setup({ scroll: "fast" }, `<li><a href="#s8">S8</a><ul><li><a href="#s7">Sub</a></li></ul></li>`);
    click([...document.querySelectorAll("a")].find((a) => a.textContent === "Sub")!);
    expect(current(links)).toEqual(["S8"]);
  });

  it("prefers-reduced-motion, smooth et élasticité : défilement instantané", async () => {
    configureEnvironment({ preferences: { reducedMotion: true } });
    const { links } = setup({ scroll: "smooth", elasticity: 1 });
    click(links[3]!);
    expect(y).toBe(topOf(4));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrollTo : la lumière part au clic ; l'entrée cliquée reste courante à la résolution", async () => {
    y = inside(1);
    let resolve!: () => void;
    const custom = vi.fn((_target: Element, { behavior }: { behavior: string }) => {
      expect(behavior).toBe("smooth");
      return new Promise<void>((r) => (resolve = () => ((y = inside(3)), r())));
    });
    const { links } = setup({ scrollTo: custom });
    click(links[2]!);
    expect(custom).toHaveBeenCalledWith(document.getElementById("s3"), { behavior: "smooth" });
    expect(log).toEqual(["rail:down"]);
    resolve();
    await vi.advanceTimersByTimeAsync(RAIL_MAX);
    expect(current(links)).toEqual(["S3"]);
    expect(log).toEqual(["rail:down"]);
  });
});
