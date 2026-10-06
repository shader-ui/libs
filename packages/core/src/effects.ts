import type { ColorToken } from "./tokens.js";

/** Forme du mouvement le long du bord. */
export type EffectKind =
  | "pulse" // tout le contour s'allume puis s'éteint
  | "sweep" // un arc fait le tour une fois
  | "ripple" // deux arcs partent d'un point et se rejoignent en face
  | "orbit" // un arc tourne en boucle (état en cours uniquement)
  | "underline"; // un trait avance sous le texte, dans le sens de lecture (label, legend)

/** Un effet est une donnée : il se compile vers WebGL aujourd'hui, WGSL, HLSL ou matériaux demain. */
export interface EffectDefinition {
  kind: EffectKind;
  color: ColorToken | string;
  /** Durée en ms (un tour pour `orbit`). */
  duration: number;
  /** Longueur de la traîne, en fraction du périmètre. */
  tail?: number;
  /** Réservé aux états en cours (`loading`). */
  loop?: boolean;
  /** Durée max d'une boucle en ms (WCAG 2.2.2). 5000 par défaut, plafonnée à 5000. */
  maxLoopDuration?: number;
  /** Intensité, de 0 à 1 (1 par défaut) : une simple lueur, comme les radios traversés par le trajet. */
  intensity?: number;
}

export const MAX_LOOP_DURATION = 5000;
const FADE_OUT = 300;

const presets = new Map<string, EffectDefinition>([
  ["error", { kind: "pulse", color: "error", duration: 700 }],
  ["success", { kind: "sweep", color: "success", duration: 1100, tail: 0.22 }],
  ["loading", { kind: "orbit", color: "accent", duration: 1400, tail: 0.3, loop: true }],
  ["pulse", { kind: "pulse", color: "accent", duration: 600 }],
  ["sweep", { kind: "sweep", color: "accent", duration: 900, tail: 0.22 }],
  ["ripple", { kind: "ripple", color: "accent", duration: 700, tail: 0.14 }],
  // Lueur d'un radio traversé par le trajet (§5.3) : courte, faible, sans remplissage
  ["glimmer", { kind: "pulse", color: "neutral", duration: 220, intensity: 0.35 }],
  // Arrivée sur le radio choisi
  ["choice", { kind: "pulse", color: "neutral", duration: 360 }],
  // Trait sous un label ou une legend (§2.2, §5.4) ; la durée est ajustée à la largeur
  ["underline", { kind: "underline", color: "neutral", duration: 500, tail: 0.35 }],
]);

export function registerEffect(name: string, definition: EffectDefinition): void {
  presets.set(name, definition);
}

export function getEffect(name: string): EffectDefinition | undefined {
  return presets.get(name);
}

/** Lissage cubique (0 → 1). */
const ease = (x: number) => x * x * (3 - 2 * x);

/** Décélération exponentielle normalisée : 0 → 1, rapide puis lente. */
export function decelerate(x: number, lambda = 4): number {
  return (1 - Math.exp(-lambda * x)) / (1 - Math.exp(-lambda));
}

/** Décroissance exponentielle normalisée : 1 → 0, exactement 0 à la fin. */
export function decay(x: number, lambda = 5): number {
  return (Math.exp(-lambda * x) - Math.exp(-lambda)) / (1 - Math.exp(-lambda));
}

export interface EffectSample {
  intensity: number;
  /** Avance de la tête de lumière, en fraction du périmètre. */
  progress: number;
  done: boolean;
}

/**
 * État d'un effet à l'instant `t` (ms depuis le début).
 * `stoppedAt` : instant où la boucle a été arrêtée, pour l'éteindre en douceur.
 */
export function sampleEffect(def: EffectDefinition, t: number, stoppedAt?: number): EffectSample {
  if (def.loop) {
    const max = Math.min(def.maxLoopDuration ?? MAX_LOOP_DURATION, MAX_LOOP_DURATION);
    const end = Math.min(stoppedAt ?? Infinity, max - FADE_OUT);
    const fadeIn = ease(Math.min(t / FADE_OUT, 1));
    const fadeOut = t <= end ? 1 : ease(Math.max(1 - (t - end) / FADE_OUT, 0));
    return {
      intensity: fadeIn * fadeOut,
      progress: (t / def.duration) % 1,
      done: t >= end + FADE_OUT,
    };
  }

  const k = Math.min(Math.max(t / def.duration, 0), 1);
  const done = t >= def.duration;
  switch (def.kind) {
    case "pulse": {
      const attack = 0.15;
      return { intensity: k < attack ? ease(k / attack) : decay((k - attack) / (1 - attack)), progress: 0, done };
    }
    case "sweep":
    case "ripple":
    case "underline":
    case "orbit": {
      const span = def.kind === "ripple" ? 0.5 : 1;
      // Le trait sous le texte avance à vitesse constante : le sens de lecture se lit mieux
      if (def.kind === "underline") return { intensity: ease(Math.min(k / 0.1, 1)) * (k < 0.8 ? 1 : ease((1 - k) / 0.2)), progress: k, done };
      const intensity = ease(Math.min(k / 0.1, 1)) * (k < 0.6 ? 1 : ease((1 - k) / 0.4));
      // Sweep : décélération douce, le tour complet reste visible ; ripple et orbit gardent la leur
      return { intensity, progress: decelerate(k, def.kind === "sweep" ? 1.5 : 4) * span, done };
    }
  }
}

/** Mouvement réduit : plus de déplacement, un simple fondu du contour. Pas de boucle. */
export function reduceMotion(def: EffectDefinition): EffectDefinition | undefined {
  if (def.loop) return undefined;
  return { kind: "pulse", color: def.color, duration: Math.max(def.duration, 900) };
}
