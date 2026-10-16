import { getEngine } from "./engine.js";
import { coversViewport, isBrowser, isDebug, setDebugMode, viewport } from "./env.js";
import { getEnvironment } from "./environment.js";
import { canBeSeen } from "./visibility.js";

/**
 * Diagnostic : voir `docs/spec/diagnostics.md` (fait foi). Tout passe par la console du navigateur :
 * `shaderUI.debug()`, `shaderUI.debug(false)`, `shaderUI.status()`. Rien dans le code du site.
 */

/** Mode diagnostic mémorisé pour l'onglet : il couvre aussi le rechargement suivant (§1). */
const STORAGE_KEY = "shader-ui-debug";
/** Au-delà, un fond est clair : les effets y sont peu visibles (§5). */
const LIGHT_LUMINANCE = 0.5;

type RGBA = [number, number, number, number];

/** Lit rgb(), rgba() et color(srgb …) ; `undefined` pour une autre notation. */
function parseRgba(value: string): RGBA | undefined {
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3]), srgb[4] === undefined ? 1 : Number(srgb[4])];
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!rgb) return undefined;
  const [r, g, b, a] = rgb[1]!.split(/[\s,/]+/).map(Number);
  return [r! / 255, g! / 255, b! / 255, a === undefined ? 1 : a];
}

/** Luminance relative (WCAG), de 0 (noir) à 1 (blanc). */
function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Le premier fond opaque des parents ; blanc par défaut (§5). Pas celui de l'élément : la lumière
 * se dessine autour de lui, et un champ a souvent un fond blanc par défaut du navigateur.
 */
function backgroundOf(element: Element): { css: string; luminance: number } {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const css = getComputedStyle(node).backgroundColor;
    const color = parseRgba(css);
    if (color && color[3] >= 0.5) return { css, luminance: luminance(color) };
  }
  return { css: "white (default)", luminance: 1 };
}

function typeOf(element: HTMLElement): string {
  const { dataset } = element;
  if (dataset.suiLink !== undefined) return "link";
  if (dataset.suiField !== undefined) return "field";
  if (dataset.suiChoice !== undefined) return "choice";
  if (dataset.suiButton !== undefined) return "button";
  return "light";
}

function describe(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const name = element.getAttribute("name");
  return `${element.tagName.toLowerCase()}${id}${!id && name ? `[name=${name}]` : ""}`;
}

/** Taille du canvas, et s'il est contraint par une règle du site (§4). */
function canvasState(): { size: string; constrained: boolean } {
  const canvas = document.querySelector("canvas[data-shader-ui]");
  if (!canvas) return { size: "not created yet (no effect played)", constrained: false };
  const r = canvas.getBoundingClientRect();
  return { size: `${Math.round(r.width)} × ${Math.round(r.height)}`, constrained: !coversViewport(r) };
}

const viewportSize = () => `${viewport().width} × ${viewport().height}`;

/** Analyse de la page, une fois, à chaque `shaderUI.debug()` (§5). */
export function analyze(): void {
  const elements = [...document.querySelectorAll<HTMLElement>("[data-sui], [data-sui-link]")];
  const light: HTMLElement[] = [];
  const rows = elements.map((element) => {
    const background = backgroundOf(element);
    const isLight = background.luminance > LIGHT_LUMINANCE;
    if (isLight) light.push(element);
    return {
      element: describe(element),
      type: typeOf(element),
      visible: canBeSeen(element),
      background: background.css,
      "light background": isLight,
    };
  });
  console.info(`[shader-ui] ${elements.length} element(s) handled by the library.`);
  if (rows.length) console.table(rows);
  if (light.length) {
    console.warn(`[shader-ui] light background behind ${light.length} element(s): Shader UI is designed for dark, effects will be hard to see.`, light);
  }
  const { size, constrained } = canvasState();
  (constrained ? console.warn : console.info)(
    `[shader-ui] canvas: ${size}, window: ${viewportSize()}${constrained ? " — a site rule constrains it, exclude canvas[data-shader-ui] from it." : "."}`,
  );
}

/** `shaderUI.debug()` : active le mode diagnostic et analyse la page ; `debug(false)` le coupe (§1). */
export function debug(on = true): void {
  setDebugMode(on);
  try {
    if (on) sessionStorage.setItem(STORAGE_KEY, "1");
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Stockage indisponible (navigation privée) : le mode vaut pour la page seulement
  }
  if (!on) return void console.info("[shader-ui] debug mode off.");
  console.info("[shader-ui] debug mode on, kept for this tab: every skipped effect is explained. shaderUI.debug(false) turns it off.");
  analyze();
}

/** `shaderUI.status()` : l'état de la lib en un tableau (§1). */
export function status(): void {
  const engine = getEngine();
  const stats = engine.getStats();
  const env = getEnvironment();
  console.table({
    enabled: engine.isEnabled(),
    debug: isDebug(),
    renderer: stats.renderer,
    "active effects": stats.active,
    frames: stats.frames,
    device: env?.device.type,
    performance: env?.performance.tier,
    gpu: env?.render.gpu,
    "reduced motion": env?.preferences.reducedMotion,
    "forced colors": env?.preferences.forcedColors,
    canvas: canvasState().size,
    window: viewportSize(),
  });
}

let installed = false;

/** Expose `shaderUI` dans la console, et reprend le mode diagnostic mémorisé pour l'onglet (§1). */
export function installConsole(): void {
  if (installed || !isBrowser()) return;
  installed = true;
  (globalThis as Record<string, unknown>).shaderUI = Object.freeze({ debug, status });
  let kept = false;
  try {
    kept = sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Stockage indisponible : mode diagnostic coupé
  }
  if (!kept) return;
  setDebugMode(true);
  // Annoncé, et l'analyse relancée une fois la page chargée : tous les éléments sont en place
  const announce = () =>
    setTimeout(() => {
      console.info("[shader-ui] debug mode still on for this tab. shaderUI.debug(false) turns it off.");
      analyze();
    });
  if (document.readyState === "complete") announce();
  else window.addEventListener("load", announce, { once: true });
}

/** Remet le module à zéro (tests). */
export function resetDiagnostics(): void {
  installed = false;
  delete (globalThis as Record<string, unknown>).shaderUI;
}
