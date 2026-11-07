import { decelerate } from "./effects.js";

/**
 * Défilement animé (spec Scrollspy §6 bis). Module interne : décélération exponentielle,
 * élasticité, arrêt au premier geste du lecteur. Des frames seulement pendant l'animation.
 */

export type ScrollSpeed = "smooth" | "fast";

/** Durée selon la distance, en ms : atteinte du maximum à `FULL_DISTANCE` px. */
export const SCROLL_DURATION: Record<ScrollSpeed, { min: number; max: number }> = {
  smooth: { min: 400, max: 1000 },
  fast: { min: 200, max: 400 },
};
const FULL_DISTANCE = 3000;
/** Élasticité : dépassement en part de la distance, et plafond en px, à `elasticity: 1`. */
export const OVERSHOOT_RATIO = 0.04;
export const OVERSHOOT_MAX = 48;
/** Part de la durée consacrée à l'aller ; le reste au retour sur la section. */
const OUTWARD = 0.75;
/** Touches qui font défiler : le lecteur reprend la main. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** Ce qui défile : la fenêtre, ou un conteneur. Positions verticales en px. */
export interface Scroller {
  readonly target: EventTarget;
  position(): number;
  set(y: number): void;
  max(): number;
  /** Zone affichée, en coordonnées client. */
  area(): { top: number; height: number };
  /** `scroll-padding-top` du conteneur de défilement (en-tête fixe). */
  paddingTop(): number;
}

const px = (value: string) => parseFloat(value) || 0;

export function scrollerOf(root?: Element): Scroller {
  if (root) {
    return {
      target: root,
      position: () => root.scrollTop,
      set: (y) => root.scrollTo({ top: y, behavior: "instant" }),
      max: () => Math.max(root.scrollHeight - root.clientHeight, 0),
      area: () => ({ top: root.getBoundingClientRect().top, height: root.clientHeight }),
      paddingTop: () => px(getComputedStyle(root).scrollPaddingTop),
    };
  }
  const doc = document.documentElement;
  const height = () => doc.clientHeight || window.innerHeight;
  return {
    target: window,
    position: () => window.scrollY,
    // `instant` : le `scroll-behavior: smooth` du site ne doit pas lisser chaque frame une deuxième fois
    set: (y) => window.scrollTo({ top: y, behavior: "instant" }),
    max: () => Math.max(doc.scrollHeight - height(), 0),
    area: () => ({ top: 0, height: height() }),
    paddingTop: () => px(getComputedStyle(doc).scrollPaddingTop),
  };
}

/** Position qui amène le haut de la section sous l'en-tête fixe, comme l'ancre native. */
export function positionOf(section: Element, scroller: Scroller): number {
  const top = section.getBoundingClientRect().top - scroller.area().top;
  const margin = px(getComputedStyle(section).scrollMarginTop);
  const y = scroller.position() + top - scroller.paddingTop() - margin;
  return Math.min(Math.max(y, 0), scroller.max());
}

export function scrollDuration(speed: ScrollSpeed, distance: number): number {
  const { min, max } = SCROLL_DURATION[speed];
  return min + (max - min) * Math.min(Math.abs(distance) / FULL_DISTANCE, 1);
}

/** Dépassement en px, borné par la place restante (haut ou bas de page : pas d'élasticité). */
export function overshootOf(from: number, to: number, elasticity: number, max: number): number {
  const e = Math.min(Math.max(elasticity, 0), 1);
  const wanted = Math.min(Math.abs(to - from) * OVERSHOOT_RATIO, OVERSHOOT_MAX) * e;
  const room = to > from ? max - to : to;
  return Math.max(Math.min(wanted, room), 0);
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Position à l'instant `k` (0 → 1) : aller avec décélération, puis retour si dépassement. */
export function scrollAt(k: number, from: number, to: number, overshoot: number): number {
  if (overshoot <= 0) return from + (to - from) * decelerate(k);
  const peak = to + Math.sign(to - from) * overshoot;
  if (k < OUTWARD) return from + (peak - from) * decelerate(k / OUTWARD);
  return peak + (to - peak) * smooth((k - OUTWARD) / (1 - OUTWARD));
}

export interface AnimatedScroll {
  /** Résolue à la fin, à l'arrêt par le lecteur ou par `cancel()`. */
  readonly done: Promise<void>;
  cancel(): void;
}

const running = new WeakMap<EventTarget, AnimatedScroll>();

/** Fait défiler jusqu'à `to`. Une animation en cours sur le même conteneur est remplacée. */
export function animateScroll(scroller: Scroller, to: number, speed: ScrollSpeed, elasticity = 0): AnimatedScroll {
  running.get(scroller.target)?.cancel();
  const from = scroller.position();
  const overshoot = overshootOf(from, to, elasticity, scroller.max());
  const duration = scrollDuration(speed, to - from);
  const start = performance.now();
  let frame = 0;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));

  const onKey = (e: KeyboardEvent) => SCROLL_KEYS.has(e.key) && handle.cancel();
  const gestures: Array<[string, EventListener]> = [
    ["wheel", () => handle.cancel()],
    ["touchstart", () => handle.cancel()],
    ["keydown", onKey as EventListener],
  ];
  const handle: AnimatedScroll = {
    done,
    cancel() {
      cancelAnimationFrame(frame);
      for (const [type, fn] of gestures) window.removeEventListener(type, fn, true);
      if (running.get(scroller.target) === handle) running.delete(scroller.target);
      finish();
    },
  };

  if (from === to) {
    finish();
    return handle;
  }
  for (const [type, fn] of gestures) window.addEventListener(type, fn, { capture: true, passive: true });
  running.set(scroller.target, handle);
  const step = (now: number) => {
    const k = Math.min((now - start) / duration, 1);
    scroller.set(Math.round(scrollAt(k, from, to, overshoot)));
    if (k < 1) frame = requestAnimationFrame(step);
    else handle.cancel();
  };
  frame = requestAnimationFrame(step);
  return handle;
}
