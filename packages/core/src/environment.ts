import { detect, type DetectionInput, type Environment, type InputKind, type RenderInfo } from "./detect.js";
import { isBrowser } from "./env.js";

/** Valeurs imposées par le dev : elles l'emportent toujours sur la détection. */
export type EnvironmentOverrides = { [K in keyof Environment]?: Partial<Environment[K]> };

type Listener = (environment: Environment) => void;

interface NavigatorExtras {
  userAgentData?: { mobile: boolean; platform: string; brands: Array<{ brand: string; version: string }> };
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

const QUERIES = {
  fine: "(pointer: fine)",
  coarse: "(pointer: coarse)",
  hover: "(hover: hover)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  forcedColors: "(forced-colors: active)",
};

/** Mesure des frames : au-delà de 20 ms de médiane sur 30 frames, on baisse d'un niveau. */
const FRAME_SAMPLES = 30;
const SLOW_FRAME_MS = 20;

let started = false;
let input: DetectionInput | undefined;
let renderInfo: RenderInfo | undefined;
let downgrades = 0;
let frameTimes: number[] = [];
let overrides: EnvironmentOverrides = {};
let snapshot: Environment | undefined;
const listeners = new Set<Listener>();
const cleanups: Array<() => void> = [];

function matches(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}

function readInput(lastInput?: InputKind): DetectionInput {
  const nav = navigator as Navigator & NavigatorExtras;
  const hints = nav.userAgentData;
  return {
    userAgent: nav.userAgent,
    clientHints: hints ? { mobile: hints.mobile, platform: hints.platform, brands: hints.brands } : undefined,
    pointer: matches(QUERIES.fine) ? "fine" : matches(QUERIES.coarse) ? "coarse" : "none",
    hover: matches(QUERIES.hover),
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    screen: { width: screen.width, height: screen.height },
    hardwareConcurrency: nav.hardwareConcurrency || undefined,
    deviceMemory: nav.deviceMemory,
    saveData: nav.connection?.saveData === true,
    reducedMotion: matches(QUERIES.reducedMotion),
    forcedColors: matches(QUERIES.forcedColors),
    webgpu: "gpu" in nav,
    lastInput,
  };
}

function applyOverrides(detected: Environment): Environment {
  const env = { ...detected };
  for (const key of Object.keys(overrides) as Array<keyof Environment>) {
    // Chaque groupe est fusionné champ par champ
    (env as Record<string, unknown>)[key] = { ...detected[key], ...overrides[key] };
  }
  if (overrides.performance?.tier && !overrides.performance.reasons) {
    env.performance = { ...env.performance, reasons: ["forcé"] };
  }
  return env;
}

function update(): void {
  if (!input) return;
  snapshot = applyOverrides(detect(input, renderInfo, downgrades));
  for (const listener of listeners) listener(snapshot);
}

function start(): void {
  started = true;
  input = readInput();

  if (typeof matchMedia === "function") {
    for (const query of Object.values(QUERIES)) {
      const list = matchMedia(query);
      const onChange = () => {
        input = readInput(input?.lastInput);
        update();
      };
      list.addEventListener?.("change", onChange);
      cleanups.push(() => list.removeEventListener?.("change", onChange));
    }
  }

  const onInput = (kind: InputKind) => {
    if (!input || input.lastInput === kind) return;
    input = { ...input, lastInput: kind };
    update();
  };
  const onPointer = (e: PointerEvent) => onInput(e.pointerType === "touch" || e.pointerType === "pen" ? e.pointerType : "mouse");
  const onKey = () => onInput("keyboard");
  const options = { capture: true, passive: true };
  window.addEventListener("pointerdown", onPointer, options);
  window.addEventListener("keydown", onKey, options);
  cleanups.push(() => {
    window.removeEventListener("pointerdown", onPointer, options);
    window.removeEventListener("keydown", onKey, options);
  });

  snapshot = applyOverrides(detect(input, renderInfo, downgrades));
}

/**
 * Où suis-je : appareil, navigateur, rendu, performance, préférences.
 * `undefined` côté serveur (SSR). Le même objet est renvoyé tant que rien ne change.
 */
export function getEnvironment(): Environment | undefined {
  if (!isBrowser()) return undefined;
  if (!started) start();
  return snapshot;
}

/** Prévenu à chaque changement (souris branchée, réduction des animations, dernier geste…). */
export function subscribeEnvironment(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Impose des valeurs (tests, lab). Remplace les valeurs imposées précédemment ; `undefined` les retire. */
export function configureEnvironment(next: EnvironmentOverrides | undefined): void {
  overrides = next ?? {};
  if (started) update();
}

/** Appelé par le rendu à la création du canvas (phase 2 de la détection). */
export function reportRender(info: RenderInfo): void {
  renderInfo = info;
  if (!started) getEnvironment();
  update();
}

/** Appelé par le moteur à chaque frame d'effet, avec l'intervalle depuis la précédente. */
export function reportFrameTime(ms: number): void {
  frameTimes.push(ms);
  if (frameTimes.length < FRAME_SAMPLES) return;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  frameTimes = [];
  const median = sorted[Math.floor(sorted.length / 2)]!;
  // On baisse, on ne remonte jamais pendant la session
  if (median > SLOW_FRAME_MS && snapshot && snapshot.performance.tier !== "low") {
    downgrades++;
    update();
  }
}

/** Remet le module à zéro (tests). */
export function resetEnvironment(): void {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  started = false;
  input = undefined;
  renderInfo = undefined;
  downgrades = 0;
  frameTimes = [];
  overrides = {};
  snapshot = undefined;
}
