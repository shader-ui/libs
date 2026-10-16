/** Vrai hors production. Les bundlers remplacent `process.env.NODE_ENV` à la compilation. */
export function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// ——— Messages (spec Diagnostic §2) ———

let debug = false;
/** Messages déjà émis : une seule fois par élément et par cause. */
let said = new WeakMap<object, Set<string>>();
const page = {};

/** Mode diagnostic, activé depuis la console (`shaderUI.debug()`). */
export function isDebug(): boolean {
  return debug;
}

export function setDebugMode(on: boolean): void {
  debug = on;
}

function once(message: string, element?: object): boolean {
  const key = element ?? page;
  const done = said.get(key) ?? new Set<string>();
  said.set(key, done);
  if (done.has(message)) return false;
  done.add(message);
  return true;
}

/** Anomalie : en dev ou en mode diagnostic, une fois par élément. L'élément est donné à la console. */
export function warn(message: string, element?: Element): void {
  if (!isDev() && !debug) return;
  if (!once(message, element)) return;
  if (element) console.warn(`[shader-ui] ${message}`, element);
  else console.warn(`[shader-ui] ${message}`);
}

/** Détail (effet sauté et sa cause) : en mode diagnostic seulement, une fois par élément. */
export function detail(message: string, element?: Element): void {
  if (!debug || !once(message, element)) return;
  if (element) console.warn(`[shader-ui] ${message}`, element);
  else console.warn(`[shader-ui] ${message}`);
}

/** Remet les messages à zéro (tests). */
export function resetMessages(): void {
  debug = false;
  said = new WeakMap();
}
