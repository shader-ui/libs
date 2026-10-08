import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canBeSeen, canBeSeenAll, getVisibility, observeVisibility, type Visibility } from "../src/index.js";
import { resetVisibility, SEEN_DELAY, START_TIMEOUT } from "../src/visibility.js";

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

});

describe("règles du §4.2", () => {
  it("5 fois plus haut que l'écran, occupant 55 % de sa hauteur → visible", () => {
    const el = element();
    start(el);
    fire(el, { box: rect(360, 0, 400, 4000), ratio: 440 / 4000 });
    expect(getVisibility(el).state).toBe("visible");
  });

});

describe("hors d'atteinte (§4.7)", () => {
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

});

describe("seuils et observers (§4.3)", () => {

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

  it("champ caché sous le clavier virtuel → canBeSeen faux", () => {
    vi.stubGlobal("visualViewport", { offsetLeft: 0, offsetTop: 0, width: 400, height: 450 });
    const el = element(rect(600, 20, 200, 40));
    hit = el;
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

});
