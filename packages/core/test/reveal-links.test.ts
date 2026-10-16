import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  autoInit,
  configureEnvironment,
  resetEnvironment,
  revealLinks,
  revealStateOf,
  setEnabled,
  LINK_FADE,
  WAVE_GATHER,
  type Visibility,
} from "../src/index.js";
import { resetRevealLinks } from "../src/reveal-links.js";
import { createTestEngine } from "./helpers.js";

/** Rappels du MutationObserver (microtâches) : les minuteurs sont simulés. */
const mutations = () => Promise.resolve();

/** Tests de conformité : spec Liens révélés §10. */

// Visibilité simulée : « vu » sur commande, `covered` pour un lien sous une modale
const watchers = new Map<Element, (v: Visibility) => void>();
const covered = new Set<Element>();
vi.mock("../src/visibility.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  observeVisibility: (el: Element, listener: (v: Visibility) => void) => {
    watchers.set(el, listener);
    return () => watchers.delete(el);
  },
  canBeSeen: (el: Element) => !covered.has(el),
}));

let t: ReturnType<typeof createTestEngine>;
const played: Array<{ el: Element; kind: string; origin: unknown; box?: DOMRect }> = [];
const stops: Array<() => void> = [];

const see = (...els: Element[]) => els.forEach((el) => watchers.get(el)?.({ state: "visible", ratio: 1, seen: true }));
/** Regroupement, puis l'onde jusqu'au repos ; l'horloge de la page avance avec les frames. */
function runWave() {
  vi.advanceTimersByTime(WAVE_GATHER);
  for (let i = 0; i < 2000 && t.pendingFrames; i++) {
    vi.advanceTimersByTime(16);
    t.tick(16);
  }
  vi.advanceTimersByTime(LINK_FADE);
}

/** Un lien de `width` px par ligne, sur `lines` lignes. */
function sized<T extends Element>(el: T, width = 120, lines = 1): T {
  const rects = Array.from({ length: lines }, (_, i) => new DOMRect(20, 100 + i * 24, width, 20));
  el.getClientRects = () => rects as unknown as DOMRectList;
  el.getBoundingClientRect = () => new DOMRect(20, 100, width, lines * 24);
  return el;
}

function setup(html: string, options?: Parameters<typeof revealLinks>[1]) {
  document.body.innerHTML = `<article>${html}</article>`;
  const article = document.querySelector("article")!;
  article.querySelectorAll("a, img").forEach((el) => sized(el));
  stops.push(revealLinks(article, options));
  return { article, links: [...article.querySelectorAll("a")] };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubGlobal("IntersectionObserver", class {});
  t = createTestEngine({ visible: (el) => !covered.has(el) });
  const play = t.engine.play.bind(t.engine);
  vi.spyOn(t.engine, "play").mockImplementation((el, def, options = {}) => {
    played.push({ el, kind: def.kind, origin: options.origin, box: options.box?.() });
    play(el, def, options);
  });
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetRevealLinks();
  resetEnvironment();
  watchers.clear();
  covered.clear();
  played.length = 0;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("dir");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("déclenchement (§5)", () => {
  it("lien vu (500 ms) : onde jouée sous le texte, puis revealed", () => {
    const { links } = setup(`Lire <a href="/a">la doc</a>.`);
    expect(revealStateOf(links[0]!)).toBe("pending");
    see(links[0]!);
    vi.advanceTimersByTime(WAVE_GATHER);
    t.tick();
    expect(revealStateOf(links[0]!)).toBe("revealing");
    expect(t.rendered.at(-1)![0]).toMatchObject({ kind: 4 });
    runWave();
    expect(revealStateOf(links[0]!)).toBe("revealed");
    expect(t.pendingFrames).toBe(0);
  });

  it("défilement rapide sur 20 liens : visibles sans être vus, aucune onde", () => {
    const { links } = setup(Array.from({ length: 20 }, (_, i) => `<a href="/${i}">lien</a>`).join(" "));
    links.forEach((link) => watchers.get(link)?.({ state: "visible", ratio: 1, seen: false }));
    runWave();
    expect(played).toEqual([]);
    expect(links.every((link) => revealStateOf(link) === "pending")).toBe(true);
  });

  it("3 liens vus en même temps : une seule onde, dans l'ordre du document", () => {
    const { links } = setup(`<a href="/1">un</a> <a href="/2">deux</a> <a href="/3">trois</a>`);
    see(links[2]!, links[0]!, links[1]!);
    runWave();
    expect(played.map((p) => p.el)).toEqual(links);
    expect(t.engine.play).toHaveBeenCalledTimes(3);
    const waves = new Set(vi.mocked(t.engine.play).mock.calls.map((call) => call[2]?.wave));
    expect(waves.size).toBe(1);
  });

  it("lien recouvert par une modale : sauté, reste pending", () => {
    const { links } = setup(`<a href="/1">un</a> <a href="/2">deux</a>`);
    covered.add(links[0]!);
    see(...links);
    runWave();
    expect(played.map((p) => p.el)).toEqual([links[1]]);
    expect(revealStateOf(links[0]!)).toBe("pending");
  });

  it("focus clavier sur un lien pending : revealed aussitôt, sans onde", () => {
    const { links } = setup(`<a href="/a">la doc</a>`);
    links[0]!.dispatchEvent(new FocusEvent("focus"));
    expect(revealStateOf(links[0]!)).toBe("revealed");
    expect(links[0]!.hasAttribute("data-sui-link")).toBe(false);
    see(links[0]!);
    runWave();
    expect(played).toEqual([]);
  });

  it("lien ajouté après coup : suivi comme les autres", async () => {
    const { article } = setup(`Début.`);
    article.insertAdjacentHTML("beforeend", ` <a href="/plus">la suite</a>`);
    await mutations();
    const link = sized(article.querySelector("a")!);
    expect(revealStateOf(link)).toBe("pending");
    see(link);
    runWave();
    expect(revealStateOf(link)).toBe("revealed");
  });
});

describe("cibles (§3, §3 bis)", () => {
  it("lien en display: block, ou sous un parent data-sui-ignore : ignoré", () => {
    const { links } = setup(`<a href="/a" style="display: block">carte</a><p data-sui-ignore><a href="/b">menu</a></p>`);
    expect(links.map((link) => revealStateOf(link))).toEqual([undefined, undefined]);
    expect(links.some((link) => link.hasAttribute("data-sui-link"))).toBe(false);
  });

  it("image-lien vue avec deux liens texte : une seule onde, dans l'ordre, tour de contour sur l'image jamais modifiée", () => {
    const { article, links } = setup(`<a href="/1">un</a> <a href="/img"><img src="data:," alt="Logo"></a> <a href="/2">deux</a>`);
    const img = article.querySelector("img")!;
    const before = links[1]!.outerHTML;
    see(...links.reverse(), img);
    runWave();
    expect(played.map((p) => p.el)).toEqual([links[2], img, links[0]]);
    expect(played[1]).toMatchObject({ kind: "sweep", origin: 0.75 });
    expect(links[1]!.outerHTML).toBe(before);
    expect(revealStateOf(links[1]!)).toBe("revealed");
  });
});

describe("rendu (§6)", () => {
  it("lien sur deux lignes en ltr : ligne 1 de gauche à droite, puis ligne 2", () => {
    const { links } = setup(`<a href="/a">un lien assez long</a>`);
    sized(links[0]!, 200, 2);
    see(links[0]!);
    runWave();
    expect(played.map((p) => [p.box!.top, p.origin])).toEqual([
      [100, 0],
      [124, 0],
    ]);
  });

  it("page en dir=rtl : pulsation de droite à gauche, sur chaque ligne", () => {
    document.documentElement.dir = "rtl";
    const { links } = setup(`<a href="/a">رابط طويل</a>`);
    sized(links[0]!, 200, 2);
    see(links[0]!);
    runWave();
    expect(played.map((p) => p.origin)).toEqual([1, 1]);
  });

  it("pending : apparence du texte, posée en attribut (rendu dans styles.css)", () => {
    const { links } = setup(`<a href="/a">la doc</a>`);
    expect(links[0]!.dataset.suiLink).toBe("pending");
    expect(links[0]!.getAttribute("style")).toBeNull();
  });

  it("pendant le passage : seules des valeurs calculées en inline, aucune propriété de mise en page", () => {
    const { links } = setup(`<a href="/a">la doc</a>`);
    see(links[0]!);
    vi.advanceTimersByTime(WAVE_GATHER);
    t.tick();
    t.tick();
    const style = links[0]!.style;
    expect(links[0]!.dataset.suiLink).toBe("revealing");
    expect([...Array(style.length).keys()].map((i) => style.item(i)).sort()).toEqual(["--sui-link-color", "--sui-link-progress"]);
    expect(Number(style.getPropertyValue("--sui-link-progress"))).toBeGreaterThan(0);
  });

  it("Custom Highlight API : trait tracé par graphème, DOM du lien inchangé, fin sans fondu", () => {
    const highlights = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    });
    // Un graphème = 10 px depuis son premier point de code : « é » en deux points de code (e + U+0301)
    // Absente de jsdom : installée le temps du test
    Range.prototype.getClientRects = function (this: Range) {
      return [new DOMRect(20 + this.startOffset * 10, 100, 10, 20)] as unknown as DOMRectList;
    };
    onTestFinished(() => void delete (Range.prototype as Partial<Range>).getClientRects);
    const { links } = setup(`<a href="/a">Cafe\u0301 ok</a>`);
    const link = sized(links[0]!, 80);
    const html = link.innerHTML;
    see(link);
    vi.advanceTimersByTime(WAVE_GATHER);
    const ends = new Set<number>();
    for (let i = 0; i < 200 && t.pendingFrames; i++) {
      vi.advanceTimersByTime(16);
      t.tick(16);
      const range = highlights.get("sui-link")?.ranges[0];
      if (range) ends.add(range.endOffset);
      if (t.pendingFrames) expect(link.dataset.suiLink).toBe("tracing");
    }
    // La plage avance graphème par graphème, sans jamais couper « é » (fin à 4) ; le DOM n'a pas bougé
    expect(ends.has(4)).toBe(false);
    expect(ends.has(5)).toBe(true);
    expect(link.innerHTML).toBe(html);
    // Le vrai soulignement prend le relais : plage retirée, aucun attribut ni fondu
    expect(highlights.has("sui-link")).toBe(false);
    expect(link.hasAttribute("data-sui-link")).toBe(false);
    expect(revealStateOf(link)).toBe("revealed");
  });

  it("revealed : attributs et style inline du site rendus à l'identique", () => {
    const { links } = setup(`<a href="/a" style="color: red" class="x">la doc</a>`);
    see(links[0]!);
    runWave();
    expect(links[0]!.getAttributeNames()).toEqual(["href", "style", "class"]);
    expect(links[0]!.style.cssText).toBe("color: red;");
  });

  it("initial: link : style du site avant, pendant et après, la lumière passe", () => {
    const { links } = setup(`<a href="/a">la doc</a> <a href="/b" data-sui-initial="text">texte</a>`, { initial: "link" });
    const attrs: Array<string | undefined> = [];
    see(links[0]!);
    vi.advanceTimersByTime(WAVE_GATHER);
    while (t.pendingFrames) {
      attrs.push(links[0]!.dataset.suiLink);
      t.tick();
    }
    expect(attrs.every((a) => a === undefined)).toBe(true);
    expect(played).toHaveLength(1);
    expect(links[1]!.dataset.suiLink).toBe("pending");
  });
});

describe("cas où l'onde n'est pas jouée (§7)", () => {
  it("prefers-reduced-motion : fondu de 200 ms, sans déplacement ni lumière", () => {
    configureEnvironment({ preferences: { reducedMotion: true } });
    const { links } = setup(`<a href="/a">la doc</a>`);
    see(links[0]!);
    expect(links[0]!.dataset.suiLink).toBe("fading");
    vi.advanceTimersByTime(LINK_FADE);
    expect(links[0]!.hasAttribute("data-sui-link")).toBe(false);
    expect(played).toEqual([]);
  });

  it("onde de plus de 5 s : arrêtée, liens restants en fondu", () => {
    // speed: 800 : un lien de 560 px dure 700 ms (§6.2)
    const { links } = setup(Array.from({ length: 10 }, (_, i) => `<a href="/${i}">lien long</a>`).join(" "), { speed: 800 });
    links.forEach((link) => sized(link, 560));
    see(...links);
    vi.advanceTimersByTime(WAVE_GATHER);
    while (t.pendingFrames) {
      vi.advanceTimersByTime(16);
      t.tick(16);
    }
    // Chaque lien dure 700 ms : 6 ou 7 tiennent dans 5 s selon le pas des frames, jamais plus
    const n = played.length;
    expect(n * 700).toBeLessThanOrEqual(5000);
    expect(n).toBeGreaterThanOrEqual(6);
    expect(links.slice(n).every((link) => link.dataset.suiLink === "fading")).toBe(true);
    expect(links.every((link) => revealStateOf(link) === "revealed")).toBe(true);
  });

  it("interrupteur coupé avec des liens pending : tous revealed aussitôt", () => {
    const { links } = setup(`<a href="/1">un</a> <a href="/2">deux</a>`);
    see(links[0]!);
    vi.advanceTimersByTime(WAVE_GATHER);
    t.tick();
    setEnabled(false);
    expect(links.map((link) => revealStateOf(link))).toEqual(["revealed", "revealed"]);
    expect(links.some((link) => link.hasAttribute("data-sui-link") || link.hasAttribute("style"))).toBe(false);
  });

  it("interrupteur déjà coupé, ou forced-colors : rien n'est neutralisé", () => {
    configureEnvironment({ preferences: { forcedColors: true } });
    const a = setup(`<a href="/a">la doc</a>`).links[0]!;
    expect(a.hasAttribute("data-sui-link")).toBe(false);
    resetEnvironment();
    setEnabled(false);
    const b = setup(`<a href="/b">la doc</a>`).links[0]!;
    expect(b.hasAttribute("data-sui-link")).toBe(false);
    setEnabled(true);
  });
});

describe("API (§8)", () => {
  it("stop() : style du site rendu sur tous les liens", () => {
    const { links } = setup(`<a href="/1">un</a> <a href="/2">deux</a>`);
    see(links[0]!);
    vi.advanceTimersByTime(WAVE_GATHER);
    t.tick();
    stops.pop()!();
    expect(links.some((link) => link.hasAttribute("data-sui-link") || link.hasAttribute("style"))).toBe(false);
    expect(links.map((link) => revealStateOf(link))).toEqual([undefined, undefined]);
    runWave();
    expect(played).toHaveLength(1);
  });

  it("lien attaché seul dans un article attaché : révélé une seule fois", () => {
    const { links } = setup(`<a href="/a">la doc</a>`);
    stops.push(revealLinks(links[0]!));
    see(links[0]!);
    runWave();
    expect(played).toHaveLength(1);
    stops.splice(0).forEach((stop) => stop());
    expect(revealStateOf(links[0]!)).toBe("revealed");
  });

  it("un lien seul et un lien d'article vus ensemble : une seule onde, dans l'ordre du document", () => {
    document.body.innerHTML = `<p><a href="/seul">seul</a></p><article><a href="/b">article</a></article>`;
    const [alone, inArticle] = [...document.querySelectorAll("a")].map((a) => sized(a));
    stops.push(revealLinks(document.querySelector("article")!), revealLinks(alone!));
    see(inArticle!, alone!);
    runWave();
    expect(played.map((p) => p.el)).toEqual([alone, inArticle]);
    expect(new Set(vi.mocked(t.engine.play).mock.calls.map((call) => call[2]?.wave)).size).toBe(1);
  });

  it("lien revealed qui sort puis revient à l'écran : rien ne se rejoue, même rattaché", () => {
    const { article, links } = setup(`<a href="/a">la doc</a>`);
    see(links[0]!);
    runWave();
    see(links[0]!);
    stops.push(revealLinks(article));
    runWave();
    expect(played).toHaveLength(1);
    expect(links[0]!.hasAttribute("data-sui-link")).toBe(false);
  });

  it("rechargement de la page : l'onde rejoue (rien n'est mémorisé)", () => {
    const { links } = setup(`<a href="/a">la doc</a>`);
    see(links[0]!);
    runWave();
    stops.splice(0).forEach((stop) => stop());
    resetRevealLinks(); // nouvel affichage
    const again = setup(`<a href="/a">la doc</a>`).links[0]!;
    expect(revealStateOf(again)).toBe("pending");
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it("autoInit : data-shader-ui et data-sui-initial, y compris ajoutés plus tard", async () => {
    document.body.innerHTML = `<article data-shader-ui="reveal-links"><a href="/a">un</a></article>`;
    stops.push(autoInit());
    const first = document.querySelector("a")!;
    expect(first.dataset.suiLink).toBe("pending");
    document.body.insertAdjacentHTML("beforeend", `<section data-shader-ui="reveal-links" data-sui-initial="link"><a href="/b">deux</a></section>`);
    await mutations();
    const second = document.querySelector("section a")!;
    expect(revealStateOf(second)).toBe("pending");
    expect(second.hasAttribute("data-sui-link")).toBe(false);
  });
});
