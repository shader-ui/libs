import { isBrowser, warn } from "./env.js";

/**
 * Visibilité : l'élément peut-il être vu ? Voir `docs/spec/visibility.md` (fait foi).
 * Événements seulement (IntersectionObserver, ResizeObserver, visibilitychange), aucune boucle.
 */

export type VisibilityState = "unknown" | "hidden" | "offscreen" | "partial" | "visible";

export interface Visibility {
  state: VisibilityState;
  /** Part de l'élément à l'écran, de 0 à 1, au dernier rappel. */
  ratio: number;
  /** Vrai pendant qu'une période « visible » a duré au moins SEEN_DELAY. */
  seen: boolean;
}

type Listener = (visibility: Visibility) => void;
/** Un abonnement : la même fonction passée deux fois donne deux abonnements indépendants. */
interface Subscription {
  listener: Listener;
}

/** Ratio à partir duquel un petit élément est entier à l'écran (§4.2, règle 6). */
export const FULLY_VISIBLE = 0.99;
/** Part de la hauteur de l'écran qu'un grand élément doit occuper (§4.2, règle 7). */
export const VIEWPORT_SHARE = 0.5;
/** En dessous, l'élément est masqué visuellement (`sr-only`, §4.6). */
export const MIN_VISIBLE_SIZE = 2;
/** Durée « visible » sans interruption pour être « vu » (§4.4). */
export const SEEN_DELAY = 500;
/** Variation de hauteur au-delà de laquelle un élément change d'observer (§4.3). */
export const RECLASSIFY_DELTA = 0.15;
/** Attente maximale du démarrage différé, avec ou sans requestIdleCallback (§4.8). Quasi invisible à l'œil. */
export const START_TIMEOUT = 1000;
/** `canBeSeen` : décalage des points vers l'intérieur, et taille sous laquelle seul le centre est testé (§6.1). */
const POINT_INSET = 2;
const MIN_POINTS_SIZE = 4;

const UNKNOWN: Visibility = Object.freeze({ state: "unknown", ratio: 0, seen: false });
const VISIBILITY_OPTIONS = { opacityProperty: true, visibilityProperty: true };

interface Entry {
  boundingClientRect: DOMRectReadOnly;
  intersectionRatio: number;
  isIntersecting: boolean;
  rootBounds: DOMRectReadOnly | null;
}

interface Record {
  element: Element;
  subscriptions: Set<Subscription>;
  visibility: Visibility;
  /** Dernier relevé de l'observer, pour recalculer quand la page redevient visible. */
  entry?: Entry;
  /** Observer courant (clé de groupe) et seuil « visible » qui lui correspond. */
  group?: string;
  threshold: number;
  /** Hauteurs ayant servi au classement ; `basisHeight` négatif : à classer au prochain rappel. */
  basisHeight: number;
  basisViewport: number;
  /** Instant où l'état est devenu `visible` (en attente de `seen`). */
  visibleSince?: number;
  masked: boolean;
}

interface Group {
  observer: IntersectionObserver;
  count: number;
}

const records = new WeakMap<Element, Record>();
/** Éléments suivis. Miroir des références que gardent déjà les observers, nettoyé avec eux. */
const active = new Set<Record>();
const groups = new Map<string, Group>();
/** En attente de « vu », dans l'ordre d'insertion, donc d'échéance : l'horloge est monotone. */
const awaitingSeen = new Set<Record>();
let resizeObserver: ResizeObserver | undefined;
/** Éléments masqués visuellement, suivis par le ResizeObserver. */
const maskedRecords = new Set<Record>();
let seenTimer: ReturnType<typeof setTimeout> | undefined;
let seenDeadline = Infinity;
let started = false;
let ready = false;
let queue: Record[] = [];
const cleanups: Array<() => void> = [];

/** Horloge monotone : un changement de l'heure système ne décale pas « vu ». */
const now = () => performance.now();
/** État de la page, figé pendant un rappel : lu une fois au lieu d'une fois par entrée. */
let batchHidden: boolean | undefined;
const pageHidden = () => batchHidden ?? document.visibilityState === "hidden";
const hasIntersectionObserver = () => typeof IntersectionObserver === "function";

// ——— Calcul de l'état (§4.2) ———

/** Non dessiné (niveau 2) : `checkVisibility`, ou le repli du §9. */
function isRendered(element: Element, style?: CSSStyleDeclaration): boolean {
  if (typeof element.checkVisibility === "function") return element.checkVisibility(VISIBILITY_OPTIONS);
  if (element.getClientRects().length === 0) return false;
  const own = style ?? getComputedStyle(element);
  return own.visibility !== "hidden" && own.opacity !== "0";
}

/** `clip` ou `clip-path: inset()` propre à l'élément, qui le ferme entièrement (§4.6). */
export function isClipClosed(style: Pick<CSSStyleDeclaration, "clip" | "clipPath" | "position">): boolean {
  // Cas de presque tous les éléments : ni clip ni clip-path, pas d'analyse
  const noClip = !style.clip || style.clip === "auto";
  const noClipPath = !style.clipPath || style.clipPath === "none";
  if (noClip && noClipPath) return false;
  // `clip` ne s'applique qu'aux éléments positionnés en absolu ; `auto` veut dire « pas de limite »
  const rect = /^rect\(([^)]*)\)$/.exec(style.clip?.trim() ?? "");
  if (rect && (style.position === "absolute" || style.position === "fixed")) {
    const [top, right, bottom, left] = rect[1]!.split(/[\s,]+/).map((v) => (v === "auto" ? undefined : parseFloat(v) || 0));
    if ((top !== undefined && bottom !== undefined && bottom <= top) || (left !== undefined && right !== undefined && right <= left)) {
      return true;
    }
  }
  const inset = /^inset\(([^)]*)\)$/.exec(style.clipPath?.trim() ?? "");
  if (inset) {
    // Valeurs à leur position (haut, droite, bas, gauche) ; seules les % comptent, une longueur peut ne pas fermer
    const tokens = inset[1]!.split(/\s+round\s+/)[0]!.trim().split(/\s+/);
    const values = tokens.map((v) => (v.endsWith("%") ? parseFloat(v) || 0 : 0));
    const [top = 0, right = top, bottom = top, left = right] = values;
    if (top + bottom >= 100 || left + right >= 100) return true;
  }
  return false;
}

/** Masqué visuellement par sa taille : gratuit, la taille vient de l'entrée (§4.2, règle 3). */
const tooSmall = (rect: DOMRectReadOnly) => rect.width < MIN_VISIBLE_SIZE || rect.height < MIN_VISIBLE_SIZE;

/** Zone atteignable par le défilement du document, en coordonnées de l'écran. Lue une fois par rappel. */
let reach: { left: number; top: number; right: number; bottom: number } | undefined;

function readReach() {
  const s = document.scrollingElement ?? document.documentElement;
  const { direction, writingMode } = getComputedStyle(s);
  const rtl = direction === "rtl";
  const horizontal = writingMode.startsWith("horizontal");
  // Axe dont l'origine est à la fin : le défilement y est négatif (RTL, écriture verticale de droite à gauche)
  const negativeX = horizontal ? rtl : writingMode === "vertical-rl" || writingMode === "sideways-rl";
  const negativeY = !horizontal && rtl;
  const maxX = Math.max(s.scrollWidth - s.clientWidth, 0);
  const maxY = Math.max(s.scrollHeight - s.clientHeight, 0);
  const toLeft = negativeX ? maxX + s.scrollLeft : s.scrollLeft;
  const toRight = negativeX ? -s.scrollLeft : maxX - s.scrollLeft;
  const toTop = negativeY ? maxY + s.scrollTop : s.scrollTop;
  const toBottom = negativeY ? -s.scrollTop : maxY - s.scrollTop;
  return { left: -toLeft, top: -toTop, right: s.clientWidth + toRight, bottom: s.clientHeight + toBottom };
}

/** Entièrement en dehors de la zone que le défilement du document peut afficher (§4.7). */
function isUnreachable(rect: DOMRectReadOnly): boolean {
  const r = (reach ??= readReach());
  return rect.right <= r.left || rect.left >= r.right || rect.bottom <= r.top || rect.top >= r.bottom;
}

const viewportHeight = (entry: Entry) =>
  entry.rootBounds?.height || document.documentElement.clientHeight || window.innerHeight;

/** Seuil « visible » d'un élément : 0,99 s'il est petit, `t` arrondi au centième supérieur s'il est grand (§4.3). */
export function thresholdFor(height: number, viewport: number): number {
  if (height <= 0 || viewport <= 0 || height < VIEWPORT_SHARE * viewport) return FULLY_VISIBLE;
  return Math.min(FULLY_VISIBLE, Math.ceil(((VIEWPORT_SHARE * viewport) / height) * 100) / 100);
}

const groupKey = (threshold: number) => (threshold === FULLY_VISIBLE ? "small" : threshold.toFixed(2));

/**
 * Règles du §4.2, dans l'ordre. `threshold` : seuil « visible » de l'élément (§4.3).
 * Renvoie aussi si l'élément est masqué visuellement (§4.6).
 */
function compute(record: Record, entry: Entry, threshold: number): { state: VisibilityState; masked: boolean } {
  if (pageHidden()) return { state: "hidden", masked: record.masked };
  const rect = entry.boundingClientRect;
  if (rect.width === 0 && rect.height === 0) return { state: "hidden", masked: false };
  if (tooSmall(rect)) return { state: "hidden", masked: true };
  // Hors de l'écran, le style n'est pas lu : on ne sait pas si le clip a changé, on garde l'état « masqué »
  if (!entry.isIntersecting) return { state: isUnreachable(rect) ? "hidden" : "offscreen", masked: record.masked };
  const style = getComputedStyle(record.element);
  if (isClipClosed(style)) return { state: "hidden", masked: true };
  if (!isRendered(record.element, style)) return { state: "hidden", masked: false };
  return { state: entry.intersectionRatio >= threshold ? "visible" : "partial", masked: false };
}

// ——— Observers ———

function onIntersections(entries: IntersectionObserverEntry[], observer: IntersectionObserver): void {
  const changed: Record[] = [];
  reach = undefined;
  batchHidden = document.visibilityState === "hidden";
  try {
    for (const entry of entries) {
      const record = records.get(entry.target);
      if (!record) continue;
      if (!entry.target.isConnected) {
        forget(record, changed);
        continue;
      }
      // Relevé resté en file dans l'ancien observer après un changement de groupe : périmé
      if (groups.get(record.group!)?.observer !== observer) continue;
      classify(record, entry);
      if (update(record, entry)) changed.push(record);
    }
  } finally {
    // Caches valables le temps du rappel seulement, même en cas d'exception
    reach = undefined;
    batchHidden = undefined;
  }
  scheduleSeen();
  notify(changed);
}

/** Classe petit / grand au premier rappel, puis reclasse au-delà de 15 % de variation (§4.3). */
function classify(record: Record, entry: Entry): void {
  const height = entry.boundingClientRect.height;
  const viewport = viewportHeight(entry);
  if (
    record.basisHeight >= 0 &&
    variation(height, record.basisHeight) <= RECLASSIFY_DELTA &&
    variation(viewport, record.basisViewport) <= RECLASSIFY_DELTA
  ) {
    return;
  }
  record.basisHeight = height;
  record.basisViewport = viewport;
  const threshold = thresholdFor(height, viewport);
  if (threshold === record.threshold && record.group) return;
  record.threshold = threshold;
  const key = groupKey(threshold);
  // Changer d'observer provoque un nouveau premier rappel ; l'état courant est gardé d'ici là
  if (key !== record.group) attach(record, key);
}

/** Variation relative de `a` par rapport à `b`. */
const variation = (a: number, b: number) => (b > 0 ? Math.abs(a - b) / b : a > 0 ? Infinity : 0);

/** Désobserve puis réobserve sur le même observer : nouveau premier rappel, relevé neuf. */
function reobserve(record: Record): void {
  const observer = record.group ? groups.get(record.group)?.observer : undefined;
  if (!observer) return;
  observer.unobserve(record.element);
  observer.observe(record.element);
}

function attach(record: Record, key: string): void {
  detach(record);
  let group = groups.get(key);
  if (!group) {
    const threshold = key === "small" ? FULLY_VISIBLE : Number(key);
    group = { observer: new IntersectionObserver(onIntersections, { threshold: [0, threshold] }), count: 0 };
    groups.set(key, group);
  }
  group.count++;
  group.observer.observe(record.element);
  record.group = key;
}

function detach(record: Record): void {
  const key = record.group;
  const group = key ? groups.get(key) : undefined;
  record.group = undefined;
  if (!group) return;
  group.observer.unobserve(record.element);
  // Le dernier élément d'un observer le déconnecte
  if (--group.count === 0) {
    group.observer.disconnect();
    groups.delete(key!);
  }
}

/** Suit la taille des seuls éléments masqués visuellement, pour voir leur réapparition sur place (§4.6). */
function setMasked(record: Record, masked: boolean): void {
  if (record.masked === masked) return;
  record.masked = masked;
  if (masked) {
    if (typeof ResizeObserver !== "function") return;
    maskedRecords.add(record);
    resizeObserver ??= new ResizeObserver(onResize);
    resizeObserver.observe(record.element);
    return;
  }
  if (!maskedRecords.delete(record)) return;
  resizeObserver?.unobserve(record.element);
  if (maskedRecords.size === 0) {
    resizeObserver?.disconnect();
    resizeObserver = undefined;
  }
}

function onResize(entries: ResizeObserverEntry[]): void {
  for (const entry of entries) {
    const record = records.get(entry.target);
    // La première notification arrive dès l'observation, sans changement de taille : on l'ignore
    if (!record || !resized(entry, record.entry?.boundingClientRect)) continue;
    // Pour relire position et intersection, l'élément est réobservé : nouveau premier rappel
    reobserve(record);
  }
}

/** La taille rapportée diffère-t-elle de la dernière taille connue ? */
function resized(entry: ResizeObserverEntry, last: DOMRectReadOnly | undefined): boolean {
  if (!last) return true;
  const box = entry.borderBoxSize?.[0];
  const width = box ? box.inlineSize : entry.contentRect.width;
  const height = box ? box.blockSize : entry.contentRect.height;
  return Math.abs(width - last.width) >= 0.5 || Math.abs(height - last.height) >= 0.5;
}

// ——— État, « vu », abonnés ———

/** Met à jour l'état ; renvoie vrai si `state` ou `seen` a changé. */
function update(record: Record, entry: Entry): boolean {
  record.entry = entry;
  const { state, masked } = compute(record, entry, record.threshold);
  setMasked(record, masked);
  return setState(record, state, entry.intersectionRatio);
}

function setState(record: Record, state: VisibilityState, ratio: number): boolean {
  const previous = record.visibility;
  let seen = previous.seen;
  if (state !== "visible") {
    seen = false;
    record.visibleSince = undefined;
    awaitingSeen.delete(record);
  } else if (previous.state !== "visible" && hasIntersectionObserver()) {
    record.visibleSince = now();
    awaitingSeen.add(record);
  }
  if (state === previous.state && seen === previous.seen && ratio === previous.ratio) return false;
  record.visibility = { state, ratio, seen };
  return state !== previous.state || seen !== previous.seen;
}

/**
 * Un seul minuteur pour tous les éléments, réglé sur la prochaine échéance (§4.4).
 * Le premier en attente est le plus urgent. Appelé une fois par lot de changements.
 */
function scheduleSeen(): void {
  const first: Record | undefined = pageHidden() ? undefined : awaitingSeen.values().next().value;
  const deadline = first ? first.visibleSince! + SEEN_DELAY : Infinity;
  if (deadline === seenDeadline) return;
  if (seenTimer !== undefined) clearTimeout(seenTimer);
  seenTimer = undefined;
  seenDeadline = deadline;
  // Arrondi vers le haut : un minuteur parti trop tôt ferait un réveil pour rien
  if (deadline !== Infinity) seenTimer = setTimeout(onSeenTimer, Math.max(Math.ceil(deadline - now()), 0));
}

function onSeenTimer(): void {
  seenTimer = undefined;
  seenDeadline = Infinity;
  // Page masquée avant que visibilitychange soit traité : personne ne voit rien
  if (pageHidden()) return;
  const changed: Record[] = [];
  const t = now();
  for (const record of awaitingSeen) {
    // Ordre d'échéance : le premier qui n'est pas dû arrête la boucle
    if (record.visibleSince! + SEEN_DELAY > t) break;
    if (!record.element.isConnected) {
      forget(record, changed);
      continue;
    }
    awaitingSeen.delete(record);
    record.visibility = { ...record.visibility, seen: true };
    changed.push(record);
  }
  scheduleSeen();
  notify(changed);
}

/** Tous les changements d'un rappel sont calculés avant le premier listener (§7). */
function notify(changed: Record[]): void {
  for (const record of changed) {
    for (const subscription of [...record.subscriptions]) notifyOne(subscription, record.visibility);
  }
}

/** Un abonné qui plante ne prive pas les autres ; l'erreur reste visible en console. */
function notifyOne({ listener }: Subscription, visibility: Visibility): void {
  try {
    listener(visibility);
  } catch (error) {
    report(error);
  }
}

function report(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else setTimeout(() => {
    throw error;
  });
}

/** Élément retiré du document sans appel à la fonction d'arrêt (§4.9). */
function forget(record: Record, changed: Record[]): void {
  release(record);
  if (setState(record, "hidden", 0)) changed.push(record);
}

function release(record: Record): void {
  detach(record);
  setMasked(record, false);
  awaitingSeen.delete(record);
  active.delete(record);
  records.delete(record.element);
  queue = queue.filter((r) => r !== record);
  scheduleSeen();
}

// ——— Page : onglet, cache de retour arrière, rotation (§4.3, §4.5) ———

function onPageVisibility(): void {
  const changed: Record[] = [];
  for (const record of active) {
    if (pageHidden()) {
      if (setState(record, "hidden", record.visibility.ratio)) changed.push(record);
    } else if (record.entry) {
      if (update(record, record.entry)) changed.push(record);
    } else if (setState(record, "unknown", 0)) changed.push(record);
  }
  scheduleSeen();
  notify(changed);
}

/** Réobserve tout : relevés neufs et seuils recalculés. */
function reobserveAll(): void {
  for (const record of active) {
    record.basisHeight = -1;
    reobserve(record);
  }
}

function start(): void {
  started = true;
  const onPageShow = (e: PageTransitionEvent) => e.persisted && reobserveAll();
  document.addEventListener("visibilitychange", onPageVisibility);
  window.addEventListener("pageshow", onPageShow);
  cleanups.push(() => {
    document.removeEventListener("visibilitychange", onPageVisibility);
    window.removeEventListener("pageshow", onPageShow);
  });
  if (typeof matchMedia === "function") {
    const orientation = matchMedia("(orientation: portrait)");
    orientation.addEventListener?.("change", reobserveAll);
    cleanups.push(() => orientation.removeEventListener?.("change", reobserveAll));
  }

  // Démarrage différé : rien avant le premier moment libre (§4.8)
  const flush = () => {
    if (ready) return;
    ready = true;
    warmUp();
    const pending = queue;
    queue = [];
    pending.forEach(begin);
  };
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(flush, { timeout: START_TIMEOUT });
    cleanups.push(() => cancelIdleCallback(id));
  } else {
    // Safari : load, ou START_TIMEOUT au plus, car load attend toutes les images
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const later = () => void timers.push(setTimeout(flush, 0));
    if (document.readyState === "complete") later();
    else {
      window.addEventListener("load", later, { once: true });
      timers.push(setTimeout(flush, START_TIMEOUT));
    }
    cleanups.push(() => {
      window.removeEventListener("load", later);
      timers.forEach(clearTimeout);
    });
  }
}

/**
 * Préchauffage, pendant le moment libre du démarrage : un passage dans le calcul avec des relevés
 * factices, pour que le navigateur compile le code avant le premier vrai rappel (§8).
 */
function warmUp(): void {
  const element = document.createElement("div");
  const record: Record = {
    element,
    subscriptions: new Set(),
    visibility: UNKNOWN,
    threshold: FULLY_VISIBLE,
    basisHeight: -1,
    basisViewport: 0,
    masked: false,
  };
  const box = (top: number, width: number, height: number) =>
    ({ top, left: 0, width, height, right: width, bottom: top + height, x: 0, y: top }) as DOMRectReadOnly;
  const view = box(0, 400, 800);
  batchHidden = false;
  try {
    for (const [rect, ratio] of [[box(0, 0, 0), 0], [box(0, 1, 1), 1], [box(5000, 100, 40), 0], [box(100, 100, 40), 1]] as const) {
      const entry: Entry = { boundingClientRect: rect, intersectionRatio: ratio, isIntersecting: ratio > 0, rootBounds: view };
      thresholdFor(rect.height, view.height);
      groupKey(record.threshold);
      variation(rect.height, 40);
      compute(record, entry, record.threshold);
      setState(record, "visible", ratio);
      setState(record, "offscreen", 0);
    }
    isClipClosed({ clip: "rect(0px, 0px, 0px, 0px)", clipPath: "inset(50%)", position: "absolute" });
  } finally {
    reach = undefined;
    batchHidden = undefined;
    awaitingSeen.delete(record);
  }
}

function begin(record: Record): void {
  if (hasIntersectionObserver()) {
    attach(record, "small");
    return;
  }
  // Sans IntersectionObserver : calcul à la demande, `seen` reste faux (§9)
  if (remeasure(record)) notify([record]);
}

/** Relevé à la demande, quand il n'y a pas d'IntersectionObserver. Renvoie vrai si l'état a changé. */
function remeasure(record: Record): boolean {
  const { state, ratio } = measure(record);
  return setState(record, state, ratio);
}

/**
 * Mesure par `getBoundingClientRect()` face à la fenêtre. Limite assumée : le découpage
 * des conteneurs qui défilent est ignoré, `canBeSeen` le rattrape (§9).
 */
function measure(record: Record): { state: VisibilityState; ratio: number } {
  const rect = record.element.getBoundingClientRect();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const visibleHeight = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
  const visibleWidth = Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0));
  const area = rect.width * rect.height;
  const entry: Entry = {
    boundingClientRect: rect,
    intersectionRatio: area > 0 ? (visibleWidth * visibleHeight) / area : 0,
    isIntersecting: visibleWidth > 0 && visibleHeight > 0,
    rootBounds: null,
  };
  // Le cache des limites de défilement ne vaut que pour une mesure : la page a pu défiler depuis
  reach = undefined;
  const { state } = compute(record, entry, thresholdFor(rect.height, height));
  reach = undefined;
  return { state, ratio: entry.intersectionRatio };
}

// ——— API (§7) ———

/** Suit un élément. Renvoie la fonction pour arrêter. */
export function observeVisibility(element: Element, listener: Listener): () => void {
  if (!isBrowser()) return () => {};
  // Hors périmètre : un élément d'une iframe n'est ni observé ni éclairé (§6 bis)
  if (element.ownerDocument !== document) {
    warn("élément situé dans une iframe : il n'est ni observé ni éclairé depuis la page parente.");
    return () => {};
  }
  const subscription: Subscription = { listener };
  let record = records.get(element);
  if (record) {
    record.subscriptions.add(subscription);
    // Un abonné tardif reçoit l'état courant une fois, s'il est connu (§7)
    const owner = record;
    if (owner.visibility.state !== "unknown") {
      queueMicrotask(() => {
        if (owner.subscriptions.has(subscription)) notifyOne(subscription, owner.visibility);
      });
    }
  } else {
    record = {
      element,
      subscriptions: new Set([subscription]),
      visibility: UNKNOWN,
      threshold: FULLY_VISIBLE,
      basisHeight: -1,
      basisViewport: 0,
      masked: false,
    };
    records.set(element, record);
    active.add(record);
    if (!started) start();
    // L'abonnement est posé avant begin : sans IntersectionObserver, begin notifie tout de suite
    if (ready) begin(record);
    else queue.push(record);
  }
  const owner = record;
  return () => {
    if (!owner.subscriptions.delete(subscription) || owner.subscriptions.size > 0) return;
    if (records.get(element) === owner) release(owner);
  };
}

/** Dernier état connu (`unknown` si non observé). */
export function getVisibility(element: Element): Visibility {
  if (!isBrowser()) return UNKNOWN;
  const record = records.get(element);
  if (!record) return UNKNOWN;
  if (ready && !hasIntersectionObserver()) remeasure(record);
  return record.visibility;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Zone réellement affichée : exclut le clavier virtuel et le zoom (§6.1, étape 3). */
function shownArea(): Box {
  const vv = window.visualViewport;
  if (vv) return { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height };
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/** Étapes 2 à 4 du §6.1. `centerOnly` : un seul point, au centre (§6.2). */
function check(element: Element, area: Box, centerOnly: boolean): boolean {
  // Élément d'une iframe : hors périmètre, et ses coordonnées ne sont pas celles de la page (§6 bis)
  if (element.ownerDocument !== document) return false;
  // Dans un composant web, document.elementFromPoint renverrait l'hôte : on teste sur le shadow root
  const root = element.getRootNode() as Document | ShadowRoot;
  const surface: DocumentOrShadowRoot = typeof root.elementFromPoint === "function" ? root : document;
  const hitTest = typeof surface.elementFromPoint === "function";
  if (hitTest && typeof element.checkVisibility === "function") {
    // elementFromPoint respecte le clip : un élément fermé par son clip n'est jamais touché
    if (!element.checkVisibility(VISIBILITY_OPTIONS)) return false;
  } else {
    const style = getComputedStyle(element);
    if (!isRendered(element, style) || isClipClosed(style)) return false;
  }
  const rect = element.getBoundingClientRect();
  if (tooSmall(rect)) return false;
  const inArea = (x: number, y: number) => x >= area.left && x < area.right && y >= area.top && y < area.bottom;
  if (rect.right <= area.left || rect.left >= area.right || rect.bottom <= area.top || rect.top >= area.bottom) return false;
  if (!hitTest) return true;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const points: Array<[number, number]> = [[cx, cy]];
  if (!centerOnly && rect.width >= MIN_POINTS_SIZE && rect.height >= MIN_POINTS_SIZE) {
    points.push(
      [cx, rect.top + POINT_INSET],
      [cx, rect.bottom - POINT_INSET],
      [rect.left + POINT_INSET, cy],
      [rect.right - POINT_INSET, cy],
    );
  }
  let tested = 0;
  let free = 0;
  for (const [x, y] of points) {
    if (!inArea(x, y)) continue;
    tested++;
    const hit = surface.elementFromPoint(x, y);
    // Un ancêtre touché : la cible est en pointer-events: none, rien d'autre n'est par-dessus
    if (hit && (hit === element || element.contains(hit) || hit.contains(element))) free++;
  }
  return tested > 0 && free * 2 >= tested;
}

/** Vérification complète, au dernier moment (§6.1). */
export function canBeSeen(element: Element): boolean {
  if (!isBrowser() || pageHidden()) return false;
  return check(element, shownArea(), false);
}

/** Vérification groupée, en une seule phase de lecture (§6.2). Un résultat par élément, dans l'ordre. */
export function canBeSeenAll(elements: readonly Element[], options: { container?: Element } = {}): boolean[] {
  if (!isBrowser() || pageHidden()) return elements.map(() => false);
  const area = shownArea();
  const { container } = options;
  if (container && !check(container, area, false)) return elements.map(() => false);
  return elements.map((element) => check(element, area, container !== undefined));
}

/** Remet le module à zéro (tests). */
export function resetVisibility(): void {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  for (const group of groups.values()) group.observer.disconnect();
  groups.clear();
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  maskedRecords.clear();
  for (const record of active) {
    // Plus de notification après la remise à zéro, même déjà mise en microtâche
    record.subscriptions.clear();
    records.delete(record.element);
  }
  active.clear();
  awaitingSeen.clear();
  if (seenTimer !== undefined) clearTimeout(seenTimer);
  seenTimer = undefined;
  seenDeadline = Infinity;
  reach = undefined;
  batchHidden = undefined;
  started = false;
  ready = false;
  queue = [];
}
