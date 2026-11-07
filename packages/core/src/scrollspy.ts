import { getEffect } from "./effects.js";
import { getEngine } from "./engine.js";
import { isBrowser } from "./env.js";
import { getEnvironment } from "./environment.js";
import { EFFECT_END_EVENT, light, lightOf, type EffectEndDetail, type Light } from "./light.js";
import { animateScroll, positionOf, scrollDuration, scrollerOf, type AnimatedScroll } from "./scroll.js";
import { canBeSeenAll } from "./visibility.js";

/**
 * Scrollspy (spec Scrollspy) : l'entrée du sommaire de la section en cours de lecture porte
 * `aria-current="location"`. À l'arrêt du défilement, la lumière va de l'ancienne entrée à la
 * nouvelle, par les entrées dépassées. Rien pendant le défilement, zéro frame au repos.
 */

export type ScrollMode = "none" | "smooth" | "fast";

export interface ScrollspyOptions {
  /** Conteneur qui défile : la fenêtre par défaut. */
  root?: Element;
  /** Défilement au clic sur une entrée (§6 bis) : `"none"` (défaut) laisse l'ancre native. */
  scroll?: ScrollMode;
  /** Dépassement puis retour sur la section, de 0 (défaut) à 1. */
  elasticity?: number;
  /** Défilement du dev (Lenis…), remplace `scroll` et `elasticity`. Une promesse renvoyée marque la fin. */
  scrollTo?: (target: Element, options: { behavior: "smooth" | "instant" }) => unknown;
}

/** Liseré (§6) : vitesse constante en px/s, durée bornée en ms. */
export const RAIL_SPEED = 1200;
export const RAIL_MIN = 250;
export const RAIL_MAX = 500;
/** Rémanence du liseré (§6), en ms, après le trajet : ce que le segment quitte s'éteint en douceur. */
export const RAIL_AFTERGLOW = 350;
/** Sans `scrollend` : fin du défilement après 150 ms sans événement `scroll`. */
export const SCROLL_IDLE = 150;

interface Entry {
  link: HTMLAnchorElement;
  section: Element;
  level: 1 | 2;
}

const attached = new WeakMap<Element, () => void>();
let trails = 0;

/** Lien vers la page affichée, avec un fragment : son `id`, ou rien. */
function fragmentOf(link: HTMLAnchorElement): string | undefined {
  let url: URL;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return undefined;
  }
  if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash.length < 2) return undefined;
  try {
    return decodeURIComponent(url.hash.slice(1));
  } catch {
    return url.hash.slice(1);
  }
}

/** Niveau 2 : dans une liste imbriquée (un `li` dans un `li` du sommaire). */
function levelOf(link: Element, container: Element): 1 | 2 {
  let items = 0;
  for (let el = link.parentElement; el && el !== container; el = el.parentElement) if (el.tagName === "LI") items++;
  return items > 1 ? 2 : 1;
}

/** Rail (§6) : la liste de premier niveau, ou le conteneur sans liste. */
function railOf(container: Element): Element {
  return container.querySelector("ul, ol") ?? container;
}

const isRtl = (el: Element) => getComputedStyle(el).direction === "rtl";

/** Abscisse du rail : bord de début de la liste. */
function railX(rail: Element): number {
  const r = rail.getBoundingClientRect();
  return isRtl(rail) ? r.right : r.left;
}

/** Décalage de l'entrée jusqu'au rail, pour y poser la marque CSS (§9). */
function railOffset(link: Element, rail: Element): number {
  const l = link.getBoundingClientRect();
  return isRtl(rail) ? railX(rail) - l.right : l.left - railX(rail);
}

function entriesOf(container: Element): Entry[] {
  const entries: Entry[] = [];
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (link.closest("[data-sui-ignore]")) continue;
    const id = fragmentOf(link);
    const section = id ? document.getElementById(id) : null;
    if (section) entries.push({ link, section, level: levelOf(link, container) });
  }
  return entries;
}

/** Suit la section en cours de lecture dans un sommaire. Renvoie la fonction pour arrêter. */
export function scrollspy(container: Element, options: ScrollspyOptions = {}): () => void {
  if (!isBrowser()) return () => {};
  attached.get(container)?.();

  const scroller = scrollerOf(options.root);
  const mode = options.scroll ?? "none";
  /** `aria-current` posés par la lib : les seuls qu'elle retire (§4 bis). */
  const owned = new Set<HTMLAnchorElement>();
  const created = new Set<Light>();
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let current: HTMLAnchorElement | null = null;
  /** Entrée courante au départ du défilement, ou `undefined` hors défilement. */
  let from: HTMLAnchorElement | null | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  /** Défilement piloté (lib ou dev) : la fin est connue, les `scroll` sont ignorés. */
  let driven: Promise<unknown> | undefined;
  let animation: AnimatedScroll | undefined;
  /** Liseré en route : d'où, vers où (relatif au rail), depuis quand, pour combien de temps. */
  let moving: { from: { top: number; height: number }; to: { top: number; height: number }; start: number; travel: number } | undefined;
  const hasScrollEnd = "onscrollend" in window;

  const top = (): Entry[] => entriesOf(container).filter((e) => e.level === 1);

  /** Section courante (§4) : la dernière dont le haut a passé la ligne repère ; en bas de page, la dernière. */
  function compute(): HTMLAnchorElement | null {
    const entries = top();
    if (!entries.length) return null;
    const max = scroller.max();
    if (max > 0 && scroller.position() >= max - 1) return entries[entries.length - 1]!.link;
    const { top: areaTop, height } = scroller.area();
    const padding = scroller.paddingTop();
    const line = areaTop + padding + (height - padding) / 3;
    let found: Entry | undefined;
    let best = -Infinity;
    for (const entry of entries) {
      const y = entry.section.getBoundingClientRect().top;
      if (y <= line && y > best) {
        best = y;
        found = entry;
      }
    }
    return found?.link ?? null;
  }

  function mark(next: HTMLAnchorElement | null): void {
    if (next === current) return;
    if (current) {
      delete current.dataset.suiScrollspy;
      delete current.dataset.suiPending;
      current.style.removeProperty("--sui-rail-offset");
      if (owned.delete(current)) current.removeAttribute("aria-current");
    }
    current = next;
    if (!next) return;
    next.dataset.suiScrollspy = "current";
    next.style.setProperty("--sui-rail-offset", `${Math.round(railOffset(next, railOf(container)))}px`);
    // Un `aria-current` du site n'est jamais touché
    if (!next.hasAttribute("aria-current")) {
      next.setAttribute("aria-current", "location");
      owned.add(next);
    }
  }

  const lightFor = (el: HTMLElement): Light => {
    const existing = lightOf(el);
    if (existing) return existing;
    const handle = light(el);
    created.add(handle);
    return handle;
  };

  /** Entrée de niveau 1 d'une entrée : elle-même, ou la dernière qui la précède dans le sommaire. */
  function topOf(link: HTMLAnchorElement): HTMLAnchorElement | null {
    let found: HTMLAnchorElement | null = null;
    for (const { link: l } of top()) {
      if (l === link || l.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) found = l;
      else break;
    }
    return found;
  }

  /**
   * Liseré (§6) : un segment droit glisse sur le rail, de l'entrée de départ à l'arrivée.
   * `duration` : celle du défilement au clic, pour arriver ensemble (§5.5) ; sinon vitesse constante.
   */
  function trail(start: HTMLAnchorElement | null, end: HTMLAnchorElement, duration?: number): void {
    timers.splice(0).forEach(clearTimeout);
    const links = top().map((e) => e.link);
    const rail = railOf(container);
    const railTop = () => rail.getBoundingClientRect().top;
    const now = performance.now();
    // Un liseré encore en route : le nouveau part de là où il est, pas de l'entrée qu'il visait
    const beam = beamAt(now);
    moving = undefined;
    // Sans départ, mouvement réduit, sans shader, ou sommaire invisible : la marque CSS suffit (fondu)
    if (!links.includes(end) || (!beam && (!start || !links.includes(start)))) return;
    if (getEnvironment()?.preferences.reducedMotion || !getEngine().hasShader()) return;
    if (!canBeSeenAll([end], { container })[0]) return;

    // Positions relatives au rail : le sommaire peut bouger pendant le trajet
    const a = start!.getBoundingClientRect();
    const from = beam ?? { top: a.top - railTop(), height: a.height };
    const toNow = () => {
      const r = end.getBoundingClientRect();
      return { top: r.top - railTop(), height: r.height };
    };
    const to = toNow();
    const distance = Math.abs(to.top + to.height / 2 - (from.top + from.height / 2));
    duration ??= Math.min(Math.max((distance / RAIL_SPEED) * 1000, RAIL_MIN), RAIL_MAX);
    const span = Math.max(from.top + from.height, to.top + to.height) - Math.min(from.top, to.top);
    // Colonne du rail, relue à chaque frame
    const box = () => {
      const offset = railTop();
      const t = toNow();
      const top = Math.min(from.top, t.top) + offset;
      const height = Math.max(from.top + from.height, t.top + t.height) + offset - top;
      return { left: railX(rail) - 1, top, width: 2, height, right: railX(rail) + 1, bottom: top + height, x: railX(rail) - 1, y: top } as DOMRect;
    };

    // La marque arrive avec la lumière ; `aria-current`, lui, est déjà à jour
    end.dataset.suiPending = "";
    moving = { from, to, start: now, travel: duration };
    lightFor(container as HTMLElement).trigger(
      { ...getEffect("rail")!, duration: duration + RAIL_AFTERGLOW, afterglow: RAIL_AFTERGLOW, tail: span > 0 ? to.height / span : 1 },
      { box, origin: to.top < from.top ? 1 : 0, wave: `sui-spy-${++trails}` },
    );
    // Arrivée : la marque prend le relais de la lumière, sans fondu
    timers.push(
      setTimeout(() => {
        moving = undefined;
        delete end.dataset.suiPending;
        if (end.dataset.suiScrollspy) end.dataset.suiScrollspy = "arrived";
      }, duration),
    );
  }

  /** Position du segment en route (relative au rail), à vitesse constante entre départ et arrivée. */
  function beamAt(now: number): { top: number; height: number } | undefined {
    if (!moving) return undefined;
    const k = (now - moving.start) / moving.travel;
    if (k >= 1) return undefined;
    const { from, to } = moving;
    // Le segment a la hauteur de l'arrivée ; il part aligné sur le haut ou le bas du départ
    const down = to.top >= from.top;
    const startTop = down ? from.top : from.top + from.height - to.height;
    return { top: startTop + (to.top - startTop) * Math.max(k, 0), height: to.height };
  }

  /** Fin du défilement (§5.4) : rien si la section n'a pas changé. `pinned` : l'entrée cliquée, déjà éclairée. */
  function settle(pinned?: HTMLAnchorElement | null): void {
    clearTimeout(idle);
    idle = undefined;
    const start = from === undefined ? current : from;
    from = undefined;
    if (pinned !== undefined) return mark(pinned);
    const next = compute();
    if (next === start) return mark(next);
    mark(next);
    if (next) trail(start, next);
  }

  const onScroll = () => {
    if (driven) return;
    if (from === undefined) from = current;
    if (!hasScrollEnd) {
      clearTimeout(idle);
      idle = setTimeout(settle, SCROLL_IDLE);
    }
  };
  const onScrollEnd = () => {
    if (!driven && from !== undefined) settle();
  };

  /**
   * Clic sur une entrée (§5.5) : la lumière part tout de suite, en même temps que le défilement.
   * Défilement intercepté seulement avec `scroll` ou `scrollTo` (§6 bis).
   */
  const onClick = (event: Event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element | null)?.closest?.("a[href]");
    const entry = link && entriesOf(container).find((x) => x.link === link);
    if (!entry) return;
    const target = topOf(entry.link);
    const start = from === undefined ? current : from;
    const go = (duration?: number) => {
      // `aria-current` tout de suite, la lumière avec le défilement
      from = target;
      mark(target);
      if (target && target !== start) trail(start, target, duration);
    };

    // Ancre native : le navigateur fait défiler, la lumière part avec lui
    if (mode === "none" && !options.scrollTo) return go();
    e.preventDefault();
    history.pushState(history.state, "", entry.link.hash);

    const reduced = getEnvironment()?.preferences.reducedMotion === true;
    let done: Promise<unknown>;
    if (options.scrollTo) {
      go();
      const result = options.scrollTo(entry.section, { behavior: reduced ? "instant" : "smooth" });
      // Sans promesse, la fin est détectée comme un défilement du lecteur
      if (!isThenable(result)) return;
      done = Promise.resolve(result).catch(() => {});
    } else if (reduced) {
      go();
      scroller.set(positionOf(entry.section, scroller));
      done = Promise.resolve();
    } else {
      const to = positionOf(entry.section, scroller);
      const speed = mode as "smooth" | "fast";
      // Même durée que le défilement : la lumière et la page arrivent ensemble
      go(scrollDuration(speed, to - scroller.position()));
      animation = animateScroll(scroller, to, speed, options.elasticity ?? 0);
      done = animation.done;
    }
    const token = (driven = done);
    void done.then(() => {
      if (driven !== token) return;
      driven = animation = undefined;
      focusSection(entry.section);
      // L'entrée cliquée reste courante, même si la section est trop courte pour passer la ligne repère
      settle(target);
    });
  };

  // Liseré sauté par le moteur (plus de 3 effets par seconde, interrupteur coupé…) : la marque
  // n'attend pas une lumière qui ne viendra pas, elle apparaît aussitôt, en fondu
  const onEffectEnd = (event: Event) => {
    if (event.target !== container || (event as CustomEvent<EffectEndDetail>).detail.reason !== "skipped") return;
    const waiting = current?.dataset.suiPending !== undefined ? current : null;
    if (!waiting) return;
    timers.splice(0).forEach(clearTimeout);
    // L'ancien liseré, s'il est encore là, ne doit pas finir sa course vers une entrée qui n'est plus la bonne
    if (moving) getEngine().cancel(container);
    moving = undefined;
    delete waiting.dataset.suiPending;
  };
  container.addEventListener(EFFECT_END_EVENT, onEffectEnd);

  // Changement d'entrées : l'état est remis à jour, sans lumière
  const observer = typeof MutationObserver === "function" ? new MutationObserver(() => from === undefined && mark(compute())) : undefined;
  observer?.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

  scroller.target.addEventListener("scroll", onScroll, { passive: true });
  scroller.target.addEventListener("scrollend", onScrollEnd);
  container.addEventListener("click", onClick);
  // Attachement : marqué sans lumière (§5.1)
  mark(compute());

  const stop = () => {
    observer?.disconnect();
    scroller.target.removeEventListener("scroll", onScroll);
    scroller.target.removeEventListener("scrollend", onScrollEnd);
    container.removeEventListener("click", onClick);
    container.removeEventListener(EFFECT_END_EVENT, onEffectEnd);
    clearTimeout(idle);
    timers.splice(0).forEach(clearTimeout);
    driven = undefined;
    animation?.cancel();
    mark(null);
    for (const handle of created) handle.destroy();
    created.clear();
    if (attached.get(container) === stop) attached.delete(container);
  };
  attached.set(container, stop);
  return stop;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

/** Comme l'ancre native : la navigation au clavier reprend depuis la section atteinte. */
function focusSection(section: Element): void {
  if (!(section instanceof HTMLElement)) return;
  if (!section.hasAttribute("tabindex")) {
    section.setAttribute("tabindex", "-1");
    section.addEventListener("blur", () => section.removeAttribute("tabindex"), { once: true });
  }
  section.focus({ preventScroll: true });
}
