import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canBeSeen, canBeSeenAll, getVisibility, observeVisibility, type Visibility } from "../src/index.js";
import { isClipClosed, resetVisibility, SEEN_DELAY, START_TIMEOUT } from "../src/visibility.js";

/** Tests de conformité : spec Visibilité §10. Les API absentes de jsdom sont simulées. */

const VIEWPORT = { width: 400, height: 800 };

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  readonly thresholds: number[];
  observed = 0;
  constructor(
    readonly callback: (entries: unknown[], observer: unknown) => void,
    options: { threshold: number[] },
  ) {
    this.thresholds = options.threshold;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
    this.observed++;
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(readonly callback: (entries: unknown[]) => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
}

const liveObservers = () => FakeIntersectionObserver.instances.filter((o) => o.targets.size > 0);
const observerOf = (el: Element) => liveObservers().find((o) => o.targets.has(el));
const liveResizeObservers = () => FakeResizeObserver.instances.filter((o) => o.targets.size > 0);

function rect(top: number, left: number, width: number, height: number): DOMRectReadOnly {
  return { top, left, width, height, x: left, y: top, right: left + width, bottom: top + height } as DOMRectReadOnly;
}

interface Shot {
  box: DOMRectReadOnly;
  ratio?: number;
  intersecting?: boolean;
  viewport?: number;
}

/** Rappel de l'observer qui suit l'élément, avec une entrée simulée. */
function fire(el: Element, { box, ratio = 1, intersecting = ratio > 0, viewport = VIEWPORT.height }: Shot) {
  const observer = observerOf(el);
  if (!observer) throw new Error("élément non observé");
  observer.callback(
    [
      {
        target: el,
        boundingClientRect: box,
        intersectionRatio: ratio,
        isIntersecting: intersecting,
        rootBounds: rect(0, 0, VIEWPORT.width, viewport),
      },
    ],
    observer,
  );
}

let idle: (() => void) | undefined;
let pageState: DocumentVisibilityState = "visible";
let hit: Element | null = null;
/** Éléments testables par elementFromPoint : le dernier ajouté qui contient le point l'emporte. */
let hitTargets: Array<[Element, DOMRectReadOnly]> = [];

function element(box = rect(100, 20, 200, 40)): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  el.getBoundingClientRect = () => box as DOMRect;
  return el;
}

function track(el: Element) {
  const calls: Visibility[] = [];
  const stop = observeVisibility(el, (v) => calls.push(v));
  return { calls, stop };
}

function setScroll(metrics: Partial<Record<"clientWidth" | "clientHeight" | "scrollWidth" | "scrollHeight" | "scrollLeft" | "scrollTop", number>>) {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(document.documentElement, key, { configurable: true, value });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  FakeIntersectionObserver.instances = [];
  FakeResizeObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
    idle = cb;
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", () => {});
  vi.stubGlobal("visualViewport", { offsetLeft: 0, offsetTop: 0, ...VIEWPORT });
  pageState = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => pageState });
  Element.prototype.checkVisibility = () => true;
  hit = null;
  document.elementFromPoint = vi.fn(() => hit);
  setScroll({ clientWidth: VIEWPORT.width, clientHeight: VIEWPORT.height, scrollWidth: VIEWPORT.width, scrollHeight: 3000, scrollLeft: 0, scrollTop: 0 });
  document.documentElement.style.direction = "";
});

afterEach(() => {
  resetVisibility();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
  idle = undefined;
  hitTargets = [];
});

/** Observe et passe le démarrage différé. */
function start(el: Element) {
  const t = track(el);
  idle?.();
  return t;
}

describe("démarrage et état inconnu (§4.1, §4.8)", () => {
  it("unknown avant le premier rappel, aucun observer avant le premier moment libre", () => {
    const el = element();
    const { calls } = track(el);
    expect(getVisibility(el).state).toBe("unknown");
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    idle!();
    expect(liveObservers()).toHaveLength(1);
    expect(getVisibility(el).state).toBe("unknown");
    expect(calls).toHaveLength(0);
  });

  it("sans requestIdleCallback (Safari) : load ou 1 000 ms au plus", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    const el = element();
    track(el);
    vi.advanceTimersByTime(START_TIMEOUT - 1);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(liveObservers()).toHaveLength(1);
    // @ts-expect-error retour au readyState de jsdom
    delete document.readyState;
  });

  it("sans requestIdleCallback : load arrivé avant, démarrage tout de suite après", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });
    const el = element();
    track(el);
    window.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(0);
    expect(liveObservers()).toHaveLength(1);
    // @ts-expect-error retour au readyState de jsdom
    delete document.readyState;
  });

  it("un élément non observé est unknown", () => {
    expect(getVisibility(element()).state).toBe("unknown");
  });
});

describe("règles du §4.2", () => {
  it("display: none (boîte nulle) → hidden", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(0, 0, 0, 0), ratio: 0 });
    expect(getVisibility(el).state).toBe("hidden");
  });

  it("parent en visibility: hidden ou opacity: 0, à l'écran → hidden", () => {
    const el = element();
    el.checkVisibility = () => false;
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(getVisibility(el).state).toBe("hidden");
  });

  it("sous l'écran → offscreen", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(1200, 20, 200, 40), ratio: 0 });
    expect(getVisibility(el).state).toBe("offscreen");
  });

  it("petit élément entièrement à l'écran → visible ; à moitié → partial", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40), ratio: 1 });
    expect(getVisibility(el).state).toBe("visible");
    fire(el, { box: rect(780, 20, 200, 40), ratio: 0.5 });
    expect(getVisibility(el).state).toBe("partial");
  });

  it("plus haut que l'écran, occupant 60 % de sa hauteur → visible", () => {
    const el = element();
    start(el);
    // 1 600 px de haut, 480 px visibles : ratio 0,3, seuil 0,25
    fire(el, { box: rect(320, 0, 400, 1600), ratio: 0.3 });
    expect(getVisibility(el).state).toBe("visible");
  });

  it("5 fois plus haut que l'écran, occupant 55 % de sa hauteur → visible", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(360, 0, 400, 4000), ratio: 440 / 4000 });
    expect(getVisibility(el).state).toBe("visible");
  });

  it("élément coupé, occupant 20 % de la hauteur de l'écran → partial", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(640, 0, 400, 1600), ratio: 160 / 1600 });
    expect(getVisibility(el).state).toBe("partial");
  });
});

describe("hors d'atteinte (§4.7)", () => {
  it("left: -9999px → hidden", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, -9999, 200, 40), ratio: 0 });
    expect(getVisibility(el).state).toBe("hidden");
  });

  it("page en overflow-x: hidden, élément au-delà du bord droit → hidden", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 500, 200, 40), ratio: 0 });
    expect(getVisibility(el).state).toBe("hidden");
  });

  it("écriture verticale (vertical-rl), élément à gauche atteignable → offscreen", () => {
    document.documentElement.style.writingMode = "vertical-rl";
    setScroll({ scrollWidth: 1200, scrollLeft: 0 });
    const el = element();
    start(el);
    fire(el, { box: rect(100, -500, 200, 40), ratio: 0 });
    expect(getVisibility(el).state).toBe("offscreen");
    document.documentElement.style.writingMode = "";
  });

  it("page en RTL, élément à gauche atteignable en défilant → offscreen", () => {
    document.documentElement.style.direction = "rtl";
    setScroll({ scrollWidth: 1200, scrollLeft: 0 });
    const el = element();
    start(el);
    fire(el, { box: rect(100, -500, 200, 40), ratio: 0 });
    expect(getVisibility(el).state).toBe("offscreen");
  });
});

describe("masqué visuellement (§4.6)", () => {
  it("sr-only (1 × 1 px) à l'écran → hidden, suivi par un ResizeObserver", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 1, 1) });
    expect(getVisibility(el).state).toBe("hidden");
    expect(liveResizeObservers()).toHaveLength(1);
  });

  it("clip-path: inset(50%) sur l'élément, taille normale → hidden", () => {
    const el = element();
    el.style.clipPath = "inset(50%)";
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(getVisibility(el).state).toBe("hidden");
  });

  it("sr-only-focusable qui grandit sur place → visible, sans défilement", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 1, 1) });
    const observedBefore = observerOf(el)!.observed;
    // Au focus, il prend sa vraie taille : le ResizeObserver le fait réobserver
    liveResizeObservers()[0]!.callback([{ target: el, borderBoxSize: [{ inlineSize: 200, blockSize: 40 }] }]);
    expect(observerOf(el)!.observed).toBe(observedBefore + 1);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(getVisibility(el).state).toBe("visible");
    expect(liveResizeObservers()).toHaveLength(0);
  });

  it("lien d'évitement ramené à l'écran au focus → visible", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(0, -9999, 200, 40), ratio: 0 });
    expect(getVisibility(el).state).toBe("hidden");
    fire(el, { box: rect(0, 0, 200, 40), ratio: 1 });
    expect(getVisibility(el).state).toBe("visible");
  });

  it("masqué par son clip, sort de l'écran puis revient : un seul ResizeObserver", () => {
    const el = element();
    el.style.clipPath = "inset(50%)";
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(liveResizeObservers()).toHaveLength(1);
    fire(el, { box: rect(1200, 20, 200, 40), ratio: 0 });
    expect(liveResizeObservers()).toHaveLength(1);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(liveResizeObservers()[0]!.targets.has(el)).toBe(true);
  });

  it("notification du ResizeObserver à taille identique : pas de réobservation", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 1, 1) });
    const observed = observerOf(el)!.observed;
    const ro = liveResizeObservers()[0]!;
    ro.callback([{ target: el, borderBoxSize: [{ inlineSize: 1, blockSize: 1 }] }]);
    expect(observerOf(el)!.observed).toBe(observed);
    ro.callback([{ target: el, borderBoxSize: [{ inlineSize: 200, blockSize: 40 }] }]);
    expect(observerOf(el)!.observed).toBe(observed + 1);
  });

  it("analyse du clip : auto, élément non positionné, rectangle vide ou inversé", () => {
    const abs = { clipPath: "none", position: "absolute" };
    expect(isClipClosed({ ...abs, clip: "rect(0px, 0px, 0px, 0px)" })).toBe(true);
    expect(isClipClosed({ ...abs, clip: "rect(auto, auto, auto, auto)" })).toBe(false);
    expect(isClipClosed({ ...abs, clip: "rect(10px, 50px, 5px, 0px)" })).toBe(true); // inversé
    expect(isClipClosed({ ...abs, clip: "rect(0px, 50px, 20px, 0px)" })).toBe(false);
    expect(isClipClosed({ clip: "rect(0px, 0px, 0px, 0px)", clipPath: "none", position: "static" })).toBe(false);
  });

  it("analyse de inset() : valeurs à leur position", () => {
    const style = (clipPath: string) => ({ clip: "auto", clipPath, position: "static" });
    expect(isClipClosed(style("inset(50%)"))).toBe(true);
    expect(isClipClosed(style("inset(0px 50%)"))).toBe(true);
    expect(isClipClosed(style("inset(30% 0px 70%)"))).toBe(true);
    expect(isClipClosed(style("inset(50% round 4px)"))).toBe(true);
    expect(isClipClosed(style("inset(0px 0px 60%)"))).toBe(false);
    expect(isClipClosed(style("inset(10%)"))).toBe(false);
    expect(isClipClosed(style("inset(100px)"))).toBe(false);
  });

  it("aucun élément masqué → aucun ResizeObserver", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });
});

describe("seuils et observers (§4.3)", () => {
  it("petit élément : [0, 0.99]", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(observerOf(el)!.thresholds).toEqual([0, 0.99]);
  });

  it("élément de 3 écrans de haut : [0, 0.17], sur son propre observer", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(0, 0, 400, 2400), ratio: 800 / 2400 });
    expect(observerOf(el)!.thresholds).toEqual([0, 0.17]);
  });

  it("100 éléments : 2 seuils chacun, les petits sur un seul observer", () => {
    const els = Array.from({ length: 100 }, () => element());
    els.forEach((el) => track(el));
    idle!();
    els.forEach((el, i) => fire(el, { box: rect(i * 50, 0, 200, i % 10 === 0 ? 1600 : 40) }));
    for (const observer of liveObservers()) expect(observer.thresholds).toHaveLength(2);
    expect(liveObservers().filter((o) => o.thresholds[1] === 0.99)).toHaveLength(1);
  });

  it("hauteur de l'écran qui varie de 10 % (barre d'adresse) : pas de reclassement", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(0, 0, 400, 1600), ratio: 0.5 });
    const observer = observerOf(el)!;
    const observed = observer.observed;
    fire(el, { box: rect(0, 0, 400, 1600), ratio: 0.5, viewport: 880 });
    expect(observerOf(el)).toBe(observer);
    expect(observer.observed).toBe(observed);
    fire(el, { box: rect(0, 0, 400, 1600), ratio: 0.5, viewport: 1000 });
    expect(observerOf(el)!.thresholds).toEqual([0, 0.32]);
  });

  it("relevé périmé d'un ancien observer après changement de groupe : ignoré", () => {
    const other = element();
    const el = element();
    track(other);
    start(el);
    const small = observerOf(el)!;
    fire(el, { box: rect(0, 0, 400, 2400), ratio: 800 / 2400 }); // devient grand : change d'observer
    expect(observerOf(el)).not.toBe(small);
    fire(el, { box: rect(0, 0, 400, 2400), ratio: 800 / 2400 });
    expect(getVisibility(el).state).toBe("visible");
    // Un relevé resté en file dans l'ancien observer arrive après
    small.callback(
      [{ target: el, boundingClientRect: rect(1200, 0, 400, 2400), intersectionRatio: 0, isIntersecting: false, rootBounds: rect(0, 0, 400, 800) }],
      small,
    );
    expect(getVisibility(el).state).toBe("visible");
  });

  it("rotation de l'écran : éléments réobservés", () => {
    let onRotate: (() => void) | undefined;
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: (_: string, cb: () => void) => (onRotate = cb), removeEventListener() {} }));
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    const observed = observerOf(el)!.observed;
    onRotate!();
    expect(observerOf(el)!.observed).toBe(observed + 1);
  });

  it("retour arrière depuis le cache (pageshow persisté) : éléments réobservés", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    const observed = observerOf(el)!.observed;
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(observerOf(el)!.observed).toBe(observed + 1);
  });
});

describe("« vu » (§4.4)", () => {
  it("visible 400 ms puis sorti : seen jamais vrai", () => {
    const el = element();
    const { calls } = start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    vi.advanceTimersByTime(400);
    fire(el, { box: rect(1200, 20, 200, 40), ratio: 0 });
    vi.advanceTimersByTime(1000);
    expect(calls.some((v) => v.seen)).toBe(false);
  });

  it("visible 600 ms : seen vrai, listener prévenu", () => {
    const el = element();
    const { calls } = start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    vi.advanceTimersByTime(SEEN_DELAY + 100);
    expect(getVisibility(el).seen).toBe(true);
    expect(calls.at(-1)).toMatchObject({ state: "visible", seen: true });
  });

  it("50 éléments en attente de seen : un seul minuteur actif", () => {
    const els = Array.from({ length: 50 }, () => element());
    els.forEach((el) => track(el));
    idle!();
    els.forEach((el) => {
      fire(el, { box: rect(100, 20, 200, 40) });
      vi.advanceTimersByTime(5);
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("le plus urgent sort : le minuteur passe au suivant", () => {
    const a = element();
    const b = element();
    const ta = track(a);
    const tb = track(b);
    idle!();
    fire(a, { box: rect(100, 20, 200, 40) });
    vi.advanceTimersByTime(200);
    fire(b, { box: rect(200, 20, 200, 40) });
    vi.advanceTimersByTime(100);
    fire(a, { box: rect(1200, 20, 200, 40), ratio: 0 });
    vi.advanceTimersByTime(250); // 550 ms depuis A, 350 ms depuis B
    expect(ta.calls.some((v) => v.seen)).toBe(false);
    expect(getVisibility(b).seen).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(150); // 500 ms depuis B
    expect(getVisibility(b).seen).toBe(true);
    expect(tb.calls.at(-1)).toMatchObject({ seen: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saut de l'heure système : seen arrive toujours après 500 ms", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    vi.setSystemTime(Date.now() - 3_600_000);
    vi.advanceTimersByTime(SEEN_DELAY - 1);
    expect(getVisibility(el).seen).toBe(false);
    vi.advanceTimersByTime(1);
    expect(getVisibility(el).seen).toBe(true);
  });

  it("délai arrondi vers le haut : pas de réveil pour rien", () => {
    // Les navigateurs tronquent les délais fractionnaires : 449,1 ms partent à 449 ms
    const fakeSetTimeout = globalThis.setTimeout;
    let scheduled = 0;
    vi.stubGlobal("setTimeout", (fn: () => void, ms = 0) => {
      scheduled++;
      return fakeSetTimeout(fn, Math.floor(ms));
    });
    // performance.now() est fractionnaire dans un vrai navigateur
    const fakeNow = performance.now.bind(performance);
    let fraction = 0;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow() + fraction);
    const a = element();
    const b = element();
    track(a);
    track(b);
    idle!();
    fire(a, { box: rect(100, 20, 200, 40) }); // échéance 500
    vi.advanceTimersByTime(50);
    fire(b, { box: rect(200, 20, 200, 40) }); // échéance 550
    vi.advanceTimersByTime(50);
    fraction = 0.9;
    fire(a, { box: rect(1200, 20, 200, 40), ratio: 0 }); // à 100,9 : prochaine échéance dans 449,1 ms
    const afterLeave = scheduled;
    vi.advanceTimersByTime(460);
    expect(getVisibility(b).seen).toBe(true);
    expect(scheduled).toBe(afterLeave);
  });

  it("minuteur déclenché alors que la page est masquée : seen reste faux", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    pageState = "hidden"; // visibilitychange pas encore traité
    vi.advanceTimersByTime(SEEN_DELAY + 10);
    expect(getVisibility(el).seen).toBe(false);
  });

  it("élément retiré pendant l'attente : jamais vu, oublié", () => {
    const el = element();
    const { calls } = start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    el.remove();
    vi.advanceTimersByTime(SEEN_DELAY + 10);
    expect(calls.some((v) => v.seen)).toBe(false);
    expect(calls.at(-1)?.state).toBe("hidden");
    expect(liveObservers()).toHaveLength(0);
  });

  it("onglet masqué → hidden et minuteur annulé ; de retour → recalculé", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    pageState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getVisibility(el).state).toBe("hidden");
    expect(vi.getTimerCount()).toBe(0);
    pageState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getVisibility(el).state).toBe("visible");
  });
});

describe("abonnés et mémoire (§4.9, §7)", () => {
  it("listener appelé aux changements d'état, pas aux changements de ratio", () => {
    const el = element();
    const { calls } = start(el);
    fire(el, { box: rect(790, 20, 200, 40), ratio: 0.25 });
    fire(el, { box: rect(780, 20, 200, 40), ratio: 0.5 });
    expect(calls.map((v) => v.state)).toEqual(["partial"]);
  });

  it("un abonné qui plante ne prive pas les autres", () => {
    const reported: unknown[] = [];
    vi.stubGlobal("reportError", (e: unknown) => reported.push(e));
    const el = element();
    observeVisibility(el, () => {
      throw new Error("boum");
    });
    const { calls } = track(el);
    idle!();
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(calls.map((v) => v.state)).toEqual(["visible"]);
    expect(reported).toHaveLength(1);
  });

  it("même fonction passée deux fois : deux abonnements indépendants", () => {
    const el = element();
    const calls: string[] = [];
    const listener = (v: Visibility) => calls.push(v.state);
    const stopFirst = observeVisibility(el, listener);
    observeVisibility(el, listener);
    idle!();
    stopFirst();
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(calls).toEqual(["visible"]);
  });

  it("abonné tardif : reçoit l'état courant une fois, en microtâche", async () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    const late: Visibility[] = [];
    observeVisibility(el, (v) => late.push(v));
    expect(late).toHaveLength(0);
    await Promise.resolve();
    expect(late).toEqual([expect.objectContaining({ state: "visible" })]);
  });

  it("abonné tardif sur un état inconnu : rien", async () => {
    const el = element();
    track(el);
    const late: Visibility[] = [];
    observeVisibility(el, (v) => late.push(v));
    await Promise.resolve();
    expect(late).toHaveLength(0);
  });

  it("élément d'une iframe : ni observé, avertissement en mode dev", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const inner = iframe.contentDocument!.createElement("div");
    iframe.contentDocument!.body.appendChild(inner);
    start(inner);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(getVisibility(inner).state).toBe("unknown");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("iframe"));
    warnSpy.mockRestore();
  });

  it("plusieurs abonnés partagent la même observation", () => {
    const el = element();
    track(el);
    track(el);
    idle!();
    expect(liveObservers()).toHaveLength(1);
    expect(observerOf(el)!.observed).toBe(1);
  });

  it("élément retiré sans arrêt : désobservé, abonnés prévenus une fois (hidden), arrêt sans erreur", () => {
    const el = element();
    const { calls, stop } = start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    el.remove();
    fire(el, { box: rect(0, 0, 0, 0), ratio: 0 });
    expect(calls.at(-1)?.state).toBe("hidden");
    expect(calls.filter((v) => v.state === "hidden")).toHaveLength(1);
    expect(liveObservers()).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });

  it("dernier élément désobservé : aucun observer ni minuteur restant", () => {
    const el = element();
    const { stop } = start(el);
    fire(el, { box: rect(100, 20, 1, 1) });
    fire(el, { box: rect(100, 20, 200, 40) });
    stop();
    expect(liveObservers()).toHaveLength(0);
    expect(liveResizeObservers()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("vérification avant effet (§6)", () => {
  it("rien par-dessus → canBeSeen vrai", () => {
    const el = element();
    hit = el;
    expect(canBeSeen(el)).toBe(true);
  });

  it("modale par-dessus → canBeSeen faux", () => {
    const el = element();
    hit = document.createElement("dialog");
    expect(canBeSeen(el)).toBe(false);
  });

  it("champ caché sous le clavier virtuel → canBeSeen faux", () => {
    vi.stubGlobal("visualViewport", { offsetLeft: 0, offsetTop: 0, width: 400, height: 450 });
    const el = element(rect(600, 20, 200, 40));
    hit = el;
    expect(canBeSeen(el)).toBe(false);
  });

  it("onglet masqué → canBeSeen faux", () => {
    const el = element();
    hit = el;
    pageState = "hidden";
    expect(canBeSeen(el)).toBe(false);
  });

  it("élément dans un composant web (shadow DOM) : testé sur le shadow root", () => {
    const host = element();
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    shadow.appendChild(inner);
    inner.getBoundingClientRect = () => rect(100, 20, 200, 40) as DOMRect;
    hit = host; // document.elementFromPoint ne voit que l'hôte
    (shadow as ShadowRoot & { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => inner;
    expect(canBeSeen(inner)).toBe(true);
  });

  it("cible en pointer-events: none : l'ancêtre touché compte comme libre", () => {
    const wrapper = element(rect(0, 0, 400, 400));
    const el = element(rect(100, 20, 200, 40));
    wrapper.appendChild(el);
    hit = wrapper;
    expect(canBeSeen(el)).toBe(true);
  });

  it("élément d'une iframe : canBeSeen faux, sans test de points", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const inner = iframe.contentDocument!.createElement("div");
    iframe.contentDocument!.body.appendChild(inner);
    inner.getBoundingClientRect = () => rect(100, 20, 200, 40) as DOMRect;
    inner.checkVisibility = () => true;
    expect(canBeSeen(inner)).toBe(false);
    expect(canBeSeenAll([inner])).toEqual([false]);
    expect(document.elementFromPoint).not.toHaveBeenCalled();
  });

  it("élément de moins de 4 px : seul le centre est testé", () => {
    const el = element(rect(100, 20, 3, 3));
    hit = el;
    expect(canBeSeen(el)).toBe(true);
    expect(document.elementFromPoint).toHaveBeenCalledTimes(1);
  });

  it("canBeSeenAll avec conteneur : conteneur complet, puis le centre de chaque élément", () => {
    const container = element(rect(0, 0, 400, 400));
    const links = Array.from({ length: 40 }, (_, i) => {
      const link = element(rect(10 + i * 9, 10, 80, 8));
      container.appendChild(link);
      return link;
    });
    hitTargets = [container, ...links].map((el) => [el, el.getBoundingClientRect()]);
    document.elementFromPoint = vi.fn((x: number, y: number) => {
      const found = hitTargets.filter(([, r]) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
      return found.at(-1)?.[0] ?? null;
    });
    expect(canBeSeenAll(links, { container })).toEqual(links.map(() => true));
    expect(document.elementFromPoint).toHaveBeenCalledTimes(5 + 40);
  });

  it("canBeSeenAll : conteneur recouvert → tout faux", () => {
    const container = element(rect(0, 0, 400, 400));
    const link = element(rect(10, 10, 80, 8));
    hit = document.createElement("div");
    expect(canBeSeenAll([link], { container })).toEqual([false]);
  });
});

describe("robustesse", () => {
  it("exception en plein rappel : l'état de la page n'est pas figé", () => {
    const a = element();
    const b = element();
    b.checkVisibility = () => {
      throw new Error("boum");
    };
    track(a);
    track(b);
    idle!();
    const observer = observerOf(a)!;
    // Page affichée pendant le rappel qui lève une exception…
    expect(() =>
      observer.callback(
        [{ target: b, boundingClientRect: rect(100, 20, 200, 40), intersectionRatio: 1, isIntersecting: true, rootBounds: rect(0, 0, 400, 800) }],
        observer,
      ),
    ).toThrow();
    // …puis masquée : canBeSeen doit le voir
    pageState = "hidden";
    hit = a;
    expect(canBeSeen(a)).toBe(false);
  });
});

describe("remise à zéro (tests)", () => {
  it("aucune notification après la remise à zéro, même déjà mise en microtâche", async () => {
    const el = element();
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    const late: Visibility[] = [];
    observeVisibility(el, (v) => late.push(v));
    resetVisibility();
    await Promise.resolve();
    expect(late).toHaveLength(0);
  });
});

describe("navigateurs sans certaines API (§9)", () => {
  it("WebKit sans checkVisibility : boîte vide ou opacity: 0 propre → hidden", () => {
    // @ts-expect-error simule Safari 16
    delete Element.prototype.checkVisibility;
    const el = element();
    el.getClientRects = () => [rect(100, 20, 200, 40)] as unknown as DOMRectList;
    start(el);
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(getVisibility(el).state).toBe("visible");
    el.style.opacity = "0";
    fire(el, { box: rect(100, 20, 200, 40) });
    expect(getVisibility(el).state).toBe("hidden");
  });

  it("sans IntersectionObserver : calcul à la demande, seen reste faux", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("innerWidth", VIEWPORT.width);
    vi.stubGlobal("innerHeight", VIEWPORT.height);
    const el = element(rect(100, 20, 200, 40));
    start(el);
    expect(getVisibility(el).state).toBe("visible");
    vi.advanceTimersByTime(1000);
    expect(getVisibility(el).seen).toBe(false);
  });

  it("sans IntersectionObserver : le ratio est mis à jour", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("innerWidth", VIEWPORT.width);
    vi.stubGlobal("innerHeight", VIEWPORT.height);
    const el = element(rect(780, 20, 200, 40)); // 20 px sur 40 à l'écran
    start(el);
    expect(getVisibility(el)).toMatchObject({ state: "partial", ratio: 0.5 });
  });

  it("sans IntersectionObserver : les limites de défilement sont relues à chaque mesure", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("innerWidth", VIEWPORT.width);
    vi.stubGlobal("innerHeight", VIEWPORT.height);
    const el = element(rect(-500, 20, 200, 40)); // au-dessus de l'écran
    start(el);
    expect(getVisibility(el).state).toBe("hidden"); // en haut de page : hors d'atteinte
    setScroll({ scrollTop: 1000 });
    expect(getVisibility(el).state).toBe("offscreen"); // la page a défilé : atteignable
  });

  it("sans IntersectionObserver : le premier état est notifié à l'abonné", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("innerWidth", VIEWPORT.width);
    vi.stubGlobal("innerHeight", VIEWPORT.height);
    const first = element(rect(100, 20, 200, 40));
    start(first); // passe le démarrage différé
    const el = element(rect(100, 20, 200, 40));
    const { calls } = track(el);
    expect(calls.map((v) => v.state)).toEqual(["visible"]);
  });
});
