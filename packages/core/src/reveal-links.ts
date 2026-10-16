import { getEffect } from "./effects.js";
import { getEngine, type Engine, type EndReason } from "./engine.js";
import { isBrowser } from "./env.js";
import { getEnvironment } from "./environment.js";
import { UNDERLINE_MAX, UNDERLINE_MIN, UNDERLINE_SPEED } from "./underline.js";
import { canBeSeen, observeVisibility } from "./visibility.js";

/**
 * Liens révélés : voir `docs/spec/reveal-links.md` (fait foi).
 * L'état du lien est posé en `data-sui-link`, son rendu est dans `styles.css` ; seules les valeurs
 * calculées sont en inline (`--sui-link-color`, `--sui-link-progress`).
 */

export type RevealState = "pending" | "revealing" | "revealed";
export type RevealInitial = "text" | "link";

export interface RevealLinksOptions {
  /** Sélecteur CSS des liens à ignorer. */
  ignore?: string;
  /** Apparence avant le passage (§6.4) : `"text"` par défaut. */
  initial?: RevealInitial;
}

/** Les liens mis en file à moins de 100 ms d'écart forment une même onde (§5.3). */
export const WAVE_GATHER = 100;
/** Durée max d'une onde (WCAG 2.2.2, §6.2). Au-delà, les liens restants passent en fondu. */
export const WAVE_MAX = 5000;
/** Tour du contour d'une image-lien : la durée d'un lien long (§3 bis). */
export const IMAGE_LINK_DURATION = UNDERLINE_MAX;
/** Fondu des décorations en fin de passage, et fondu sans mouvement (§6.4, §7). */
export const LINK_FADE = 200;

/**
 * Valeurs de `data-sui-link` : `probe` le temps de lire la couleur du site (sans transition),
 * `settling` fond les décorations, `fading` aussi la couleur.
 */
type Phase = "pending" | "probe" | "revealing" | "settling" | "fading";

interface LinkRecord {
  link: HTMLAnchorElement;
  /** Contour éclairé d'une image-lien (§3 bis). */
  image?: Element;
  initial: RevealInitial;
  state: RevealState;
  /** Attachements (conteneurs, liens seuls) : le lien n'est géré qu'une fois (§8). */
  owners: Set<object>;
  queued: boolean;
  cleanup: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

const records = new Map<HTMLAnchorElement, LinkRecord>();
/** Liens déjà révélés dans cet affichage : un lien `revealed` ne revient jamais à `pending` (§4). Rien n'est stocké. */
let revealedOnce = new WeakSet<Element>();

// ——— File unique pour toute la page (§5) ———

let gathering: LinkRecord[] = [];
let gatherTimer: ReturnType<typeof setTimeout> | undefined;
let wave: { id: string; links: LinkRecord[]; start: number } | undefined;
let waves = 0;
let listened: { engine: Engine; stop: () => void } | undefined;

/** Les liens peuvent être neutralisés : sinon, ils gardent le style du site (§7). */
function canNeutralize(): boolean {
  return (
    getEngine().isEnabled() &&
    !getEnvironment()?.preferences.forcedColors &&
    // Sans IntersectionObserver, un lien ne serait jamais « vu » : il resterait du texte
    typeof IntersectionObserver === "function"
  );
}

/** Interrupteur coupé : les liens `pending` passent `revealed` aussitôt (§7). */
function listenEnabled(): void {
  const engine = getEngine();
  if (listened?.engine === engine) return;
  listened?.stop();
  listened = {
    engine,
    stop: engine.onEnabledChange((enabled) => {
      if (enabled) return;
      if (gatherTimer !== undefined) clearTimeout(gatherTimer);
      gatherTimer = undefined;
      gathering = [];
      wave = undefined;
      for (const record of records.values()) finish(record);
    }),
  };
}

const byDocumentOrder = (a: LinkRecord, b: LinkRecord) =>
  a.link.compareDocumentPosition(b.link) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

function enqueue(record: LinkRecord): void {
  if (record.state !== "pending" || record.queued) return;
  // Mouvement réduit, ou pas de shader : la couleur se révèle seule, par un fondu (§7)
  if (getEnvironment()?.preferences.reducedMotion || !getEngine().hasShader()) return finish(record, "fading");
  record.queued = true;
  // Vu pendant une onde : ajouté à sa fin (§5.5)
  if (wave) return void wave.links.push(record);
  gathering.push(record);
  if (gatherTimer !== undefined) clearTimeout(gatherTimer);
  gatherTimer = setTimeout(startWave, WAVE_GATHER);
}

function startWave(): void {
  gatherTimer = undefined;
  const links = gathering.sort(byDocumentOrder);
  gathering = [];
  wave = { id: `sui-reveal-${++waves}`, links, start: Date.now() };
  next();
}

function next(): void {
  const current = wave;
  if (!current) return;
  for (let record = current.links.shift(); record; record = current.links.shift()) {
    record.queued = false;
    if (record.state !== "pending" || records.get(record.link) !== record) continue;
    if (Date.now() - current.start + durationOf(record) > WAVE_MAX) {
      // L'onde ne dépasse pas 5 s : les liens restants se révèlent par un fondu
      for (const rest of [record, ...current.links.splice(0)]) {
        rest.queued = false;
        if (rest.state === "pending") finish(rest, "fading");
      }
      break;
    }
    // Revérifié au dernier moment : un lien recouvert est sauté et reste `pending` (§5.6)
    if (!canBeSeen(record.image ?? record.link)) continue;
    return play(record, current.id);
  }
  if (wave === current) wave = undefined;
}

// ——— Rendu (§6) ———

/** Une boîte par ligne, dans l'ordre des lignes (§6.1). */
function lineRects(link: HTMLAnchorElement): DOMRect[] {
  const rects = [...link.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  return rects.length ? rects : [link.getBoundingClientRect()];
}

/** Vitesse constante, durée bornée entre 250 et 700 ms (§6.2). */
function durationOf(record: LinkRecord): number {
  if (record.image) return IMAGE_LINK_DURATION;
  const width = lineRects(record.link).reduce((sum, r) => sum + r.width, 0);
  return Math.min(Math.max((width / UNDERLINE_SPEED) * 1000, UNDERLINE_MIN), UNDERLINE_MAX);
}

/** Sens de lecture de la page (principe 6). */
const isRtl = () => getComputedStyle(document.documentElement).direction === "rtl";

/** Couleur de la pulsation : `--sui-link-light`, l'accent par défaut (§9). */
function lightColor(link: Element): string {
  return getComputedStyle(link).getPropertyValue("--sui-link-light").trim() || "accent";
}

function play(record: LinkRecord, waveId: string): void {
  const engine = getEngine();
  const { link } = record;
  const rtl = isRtl();
  record.state = "revealing";
  const done = (reason: EndReason) => {
    if (records.get(link) === record && record.state === "revealing") {
      // Interrupteur coupé : style du site aussitôt ; effet sauté ou interrompu : fondu
      finish(record, !engine.isEnabled() ? undefined : reason === "complete" ? "settling" : "fading");
    }
    next();
  };

  // Image-lien : un tour du contour de l'image, qui n'est jamais modifiée (§3 bis)
  if (record.image) {
    const sweep = { ...getEffect("sweep")!, color: lightColor(link), duration: IMAGE_LINK_DURATION };
    // Départ au milieu du bord gauche (ltr) ou droit (rtl) ; 0 = milieu du bord haut, sens horaire
    engine.play(record.image, sweep, { wave: waveId, origin: rtl ? 0.25 : 0.75, reverse: rtl, onEnd: done });
    return;
  }

  const lines = lineRects(link);
  const widths = lines.map((r) => r.width);
  const total = widths.reduce((sum, w) => sum + w, 0) || 1;
  const duration = durationOf(record);
  if (record.initial === "text") {
    // La couleur du site, lue sans nos styles : elle suit un changement de thème entre-temps.
    // Sans transition : celle du site (`transition: color`) donnerait la couleur de départ
    link.dataset.suiLink = "probe" satisfies Phase;
    link.style.setProperty("--sui-link-color", getComputedStyle(link).color);
    setProgress(link, 0);
    link.dataset.suiLink = "revealing" satisfies Phase;
  }
  const underline = { ...getEffect("underline")!, color: lightColor(link) };

  // Les lignes l'une après l'autre ; chacune prend sa part de la durée du lien
  let index = 0;
  let offset = 0;
  const step = (reason: EndReason) => {
    if (reason !== "complete" || index >= lines.length) return done(reason);
    const line = index++;
    const start = offset;
    offset += widths[line]!;
    engine.play(link, { ...underline, duration: (duration * widths[line]!) / total }, {
      wave: waveId,
      origin: rtl ? 1 : 0,
      // Relue à chaque frame : la page peut défiler (§6.1)
      box: () => lineRects(link)[line] ?? lines[line]!,
      onFrame: record.initial === "text" ? (p) => setProgress(link, (start + p * widths[line]!) / total) : undefined,
      onEnd: step,
    });
  };
  step("complete");
}

function setProgress(link: HTMLElement, progress: number): void {
  link.style.setProperty("--sui-link-progress", String(progress));
}

/** Retire tout ce que la lib a posé : le lien est exactement tel que le site l'a stylé. */
function unmark(record: LinkRecord): void {
  if (record.timer !== undefined) clearTimeout(record.timer);
  record.timer = undefined;
  const { link } = record;
  delete link.dataset.suiLink;
  link.style.removeProperty("--sui-link-color");
  link.style.removeProperty("--sui-link-progress");
  if (!link.getAttribute("style")) link.removeAttribute("style");
}

/** Passe `revealed`, aussitôt ou par un fondu. */
function finish(record: LinkRecord, fade?: "settling" | "fading"): void {
  if (record.state === "revealed") return;
  record.state = "revealed";
  record.queued = false;
  revealedOnce.add(record.link);
  record.cleanup();
  if (fade && record.link.dataset.suiLink) {
    unmark(record);
    record.link.dataset.suiLink = fade satisfies Phase;
    record.timer = setTimeout(() => unmark(record), LINK_FADE);
  } else unmark(record);
}

// ——— Attachement (§3, §8) ———

/** L'image d'un lien qui ne contient qu'une ou plusieurs images, sans texte (§3 bis). */
function imageOf(link: HTMLAnchorElement): Element | undefined {
  if (link.textContent?.trim()) return undefined;
  const image = link.querySelector("img, picture, svg");
  if (image instanceof HTMLPictureElement) return image.querySelector("img") ?? image;
  return image ?? undefined;
}

function attach(link: HTMLAnchorElement, owner: object, options: RevealLinksOptions): void {
  const existing = records.get(link);
  if (existing) return void existing.owners.add(owner);
  if (revealedOnce.has(link) || link.closest("[data-sui-ignore]")) return;
  if (options.ignore && link.matches(options.ignore)) return;
  const image = imageOf(link);
  // Un lien en bloc a une boîte : il relève des effets de contour (§3)
  if (!image && (!link.textContent?.trim() || getComputedStyle(link).display !== "inline")) return;

  const initial: RevealInitial = (link.dataset.suiInitial ?? options.initial) === "link" ? "link" : "text";
  const record: LinkRecord = { link, image, initial, state: "pending", owners: new Set([owner]), queued: false, cleanup: () => {} };
  records.set(link, record);
  if (!image && initial === "text") link.dataset.suiLink = "pending" satisfies Phase;

  const unobserve = observeVisibility(image ?? link, (visibility) => {
    if (visibility.seen) enqueue(record);
  });
  // Focus clavier : style du site aussitôt, sans pulsation (§7)
  const onFocus = () => {
    if (record.state === "pending") finish(record);
  };
  link.addEventListener("focus", onFocus);
  record.cleanup = () => {
    unobserve();
    link.removeEventListener("focus", onFocus);
    record.cleanup = () => {};
  };
}

function detach(link: HTMLAnchorElement, owner: object): void {
  const record = records.get(link);
  if (!record || !record.owners.delete(owner) || record.owners.size > 0) return;
  records.delete(link);
  record.cleanup();
  if (record.state === "revealing") getEngine().cancel(record.image ?? link);
  unmark(record);
}

function linksIn(node: Node): HTMLAnchorElement[] {
  if (!(node instanceof Element)) return [];
  const links = [...node.querySelectorAll<HTMLAnchorElement>("a[href]")];
  if (node.matches("a[href]")) links.unshift(node as HTMLAnchorElement);
  return links.filter((link) => link instanceof HTMLAnchorElement);
}

/**
 * Révèle les liens d'un conteneur, ou un lien seul, quand le lecteur arrive dessus.
 * Renvoie la fonction pour arrêter : tous les liens reprennent le style du site.
 */
export function revealLinks(container: Element, options: RevealLinksOptions = {}): () => void {
  // Rendu serveur : rien dans le HTML, la lib n'agit qu'après l'hydratation (§7)
  if (!isBrowser() || !canNeutralize()) return () => {};
  listenEnabled();
  const owner = {};
  const scan = (node: Node) => linksIn(node).forEach((link) => attach(link, owner, options));
  scan(container);

  // Liens ajoutés plus tard : défilement infini, contenu chargé à la demande (§3)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(scan);
      mutation.removedNodes.forEach((node) => {
        for (const link of linksIn(node)) if (!container.contains(link)) detach(link, owner);
      });
    }
  });
  observer.observe(container, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    for (const record of [...records.values()]) if (record.owners.has(owner)) detach(record.link, owner);
  };
}

/** État d'un lien suivi (`undefined` s'il ne l'est pas). */
export function revealStateOf(link: Element): RevealState | undefined {
  return records.get(link as HTMLAnchorElement)?.state ?? (revealedOnce.has(link) ? "revealed" : undefined);
}

/** Remet le module à zéro (tests). Rien n'est mémorisé d'un affichage à l'autre. */
export function resetRevealLinks(): void {
  for (const record of [...records.values()]) {
    record.owners.clear();
    record.cleanup();
    unmark(record);
  }
  records.clear();
  revealedOnce = new WeakSet();
  if (gatherTimer !== undefined) clearTimeout(gatherTimer);
  gatherTimer = undefined;
  gathering = [];
  wave = undefined;
  listened?.stop();
  listened = undefined;
}
