import { resolveColor, type RGB } from "./color.js";
import { reduceMotion, sampleEffect, MAX_LOOP_DURATION, type EffectDefinition } from "./effects.js";
import { isBrowser, warn } from "./env.js";
import { getEnvironment, reportFrameTime } from "./environment.js";
import { perimeterAt } from "./geometry.js";
import { canBeSeen } from "./visibility.js";
import { createWebGLBackend, KIND_ID, type Backend, type Instance } from "./webgl.js";

export type EndReason = "complete" | "interrupted" | "skipped";

/** Point de départ de la lumière : fraction du périmètre, ou point en coordonnées client. */
export type Origin = number | { x: number; y: number };

export interface PlayOptions {
  origin?: Origin;
  onEnd?: (reason: EndReason) => void;
}

export interface Stats {
  /** Frames dessinées depuis le chargement (mode dev). Doit rester stable au repos. */
  frames: number;
  /** Effets en cours. */
  active: number;
  renderer: "webgl2" | "css" | "none";
}

/** WCAG 2.3.1 : au plus 3 départs d'effet par seconde sur la page. */
const FLASH_WINDOW = 1000;
const FLASH_LIMIT = 3;

interface Active {
  el: Element;
  def: EffectDefinition;
  start: number;
  origin: number;
  color: RGB;
  radius: number;
  stoppedAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  onEnd?: (reason: EndReason) => void;
}

export interface EngineOptions {
  createBackend?: () => Backend | undefined;
  now?: () => number;
  requestFrame?: (cb: (time: number) => void) => number;
  /** Vérification avant effet (spec Visibilité §6). Remplaçable pour les tests. */
  canBeSeen?: (el: Element) => boolean;
}

export class Engine {
  private enabled = true;
  private backend: Backend | undefined | null = null; // null = pas encore créé
  private readonly active = new Map<Element, Active>();
  private readonly starts: number[] = [];
  private readonly listeners = new Set<(stats: Stats) => void>();
  private frames = 0;
  private scheduled = false;
  private inFrame = false;
  /** Le canvas contient encore de la lumière à effacer. */
  private dirty = false;
  /** Instant de la dernière frame d'effet, pour mesurer les performances. */
  private lastRender: number | undefined;
  private readonly createBackend: () => Backend | undefined;
  private readonly now: () => number;
  private readonly requestFrame: (cb: (time: number) => void) => number;
  private readonly canBeSeen: (el: Element) => boolean;

  constructor(options: EngineOptions = {}) {
    this.createBackend = options.createBackend ?? createWebGLBackend;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.canBeSeen = options.canBeSeen ?? canBeSeen;
  }

  /** Interrupteur global : coupe tous les effets. Les événements de fin sont toujours émis. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) for (const el of [...this.active.keys()]) this.end(el, "interrupted");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  play(el: Element, definition: EffectDefinition, options: PlayOptions = {}): void {
    const skip = () => queueMicrotask(() => options.onEnd?.("skipped"));
    if (!this.enabled || !isBrowser()) return skip();
    // Une lumière que personne ne voit n'est pas jouée ; sa fin est signalée quand même
    if (!this.canBeSeen(el)) return skip();

    // WCAG 2.3.3 : le mouvement est remplacé par un simple fondu
    const def = getEnvironment()?.preferences.reducedMotion ? reduceMotion(definition) : definition;
    if (!def) return skip();

    const now = this.now();
    while (this.starts.length && now - this.starts[0]! > FLASH_WINDOW) this.starts.shift();
    if (this.starts.length >= FLASH_LIMIT) {
      warn("plus de 3 effets par seconde : effet ignoré (WCAG 2.3.1).");
      return skip();
    }
    this.starts.push(now);

    // Un seul effet à la fois par élément : le nouveau remplace l'ancien
    this.end(el, "interrupted");

    const rect = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    const o = options.origin ?? { x: rect.left, y: rect.top + rect.height / 2 };
    const origin = typeof o === "number" ? o : perimeterAt(o.x - rect.left, o.y - rect.top, rect.width, rect.height, radius);
    const effect: Active = {
      el,
      def,
      start: now,
      origin,
      color: resolveColor(def.color, el),
      radius,
      onEnd: options.onEnd,
    };
    this.active.set(el, effect);

    const backend = this.getBackend();
    if (backend) this.schedule();
    else this.playCss(effect);
    this.emit();
  }

  /** Arrête la boucle en cours sur l'élément, avec un fondu. */
  stop(el: Element): void {
    const effect = this.active.get(el);
    if (!effect) return;
    if (effect.timer !== undefined) return this.end(el, "interrupted");
    effect.stoppedAt ??= this.now() - effect.start;
    this.schedule();
  }

  /** Coupe net, sans fondu (élément démonté). */
  cancel(el: Element): void {
    this.end(el, "interrupted");
  }

  getStats(): Stats {
    const renderer = this.backend === null ? "none" : this.backend && !this.backend.lost ? "webgl2" : "css";
    return { frames: this.frames, active: this.active.size, renderer };
  }

  /** Notifié à chaque frame et à chaque changement d'état (compteur de frames du lab). */
  subscribe(listener: (stats: Stats) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private getBackend(): Backend | undefined {
    if (this.backend === null) this.backend = this.createBackend();
    return this.backend && !this.backend.lost ? this.backend : undefined;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.requestFrame(() => this.frame());
  }

  private frame(): void {
    this.scheduled = false;
    this.inFrame = true;
    const backend = this.getBackend();
    const now = this.now();
    const instances: Instance[] = [];

    for (const effect of [...this.active.values()]) {
      if (effect.timer !== undefined) continue; // rendu CSS
      if (!effect.el.isConnected) {
        this.end(effect.el, "interrupted");
        continue;
      }
      const sample = sampleEffect(effect.def, now - effect.start, effect.stoppedAt);
      if (sample.done) {
        this.end(effect.el, effect.stoppedAt === undefined ? "complete" : "interrupted");
        continue;
      }
      const rect = effect.el.getBoundingClientRect();
      const [r, g, b] = effect.color;
      instances.push({
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        radius: effect.radius,
        kind: KIND_ID[effect.def.kind],
        origin: effect.origin,
        progress: sample.progress,
        tail: effect.def.tail ?? 0.2,
        r,
        g,
        b,
        intensity: sample.intensity,
      });
    }

    // Une dernière frame pour effacer, puis plus rien : zéro frame au repos
    if (backend && instances.length) {
      if (this.lastRender !== undefined) reportFrameTime(now - this.lastRender);
      this.lastRender = now;
      backend.render(instances);
      this.dirty = true;
      this.frames++;
    } else if (backend && this.dirty) {
      this.lastRender = undefined;
      backend.clear();
      this.dirty = false;
      this.frames++;
    }
    this.inFrame = false;
    if (instances.length) this.schedule();
    this.emit();
  }

  /** Fallback sans WebGL2 : animation CSS sur l'élément (voir styles.css). */
  private playCss(effect: Active): void {
    const el = effect.el as HTMLElement;
    const [r, g, b] = effect.color;
    el.dataset.suiFx = effect.def.kind;
    el.style.setProperty("--sui-fx-color", `rgb(${r * 255} ${g * 255} ${b * 255})`);
    el.style.setProperty("--sui-fx-duration", `${effect.def.duration}ms`);
    const max = Math.min(effect.def.maxLoopDuration ?? MAX_LOOP_DURATION, MAX_LOOP_DURATION);
    effect.timer = setTimeout(() => this.end(el, "complete"), effect.def.loop ? max : effect.def.duration);
  }

  private end(el: Element, reason: EndReason): void {
    const effect = this.active.get(el);
    if (!effect) return;
    this.active.delete(el);
    if (effect.timer !== undefined) {
      clearTimeout(effect.timer);
      const style = (el as HTMLElement).style;
      delete (el as HTMLElement).dataset.suiFx;
      style.removeProperty("--sui-fx-color");
      style.removeProperty("--sui-fx-duration");
    } else if (this.active.size === 0 && this.dirty && !this.inFrame) {
      this.schedule(); // frame d'effacement
    }
    effect.onEnd?.(reason);
    this.emit();
  }

  private emit(): void {
    if (!this.listeners.size) return;
    const stats = this.getStats();
    for (const listener of this.listeners) listener(stats);
  }
}

let engine: Engine | undefined;

/** Moteur partagé de la page : un seul canvas, créé au premier effet. */
export function getEngine(): Engine {
  return (engine ??= new Engine());
}

/** Remplace le moteur partagé (tests, configuration avancée). */
export function setEngine(next: Engine): void {
  engine = next;
}
