import { isBrowser } from "./env.js";
import { watchForm } from "./form.js";
import { revealLinks, type RevealInitial } from "./reveal-links.js";
import { scrollspy, type ScrollMode } from "./scrollspy.js";

/**
 * Attributs HTML pour un CMS, du PHP ou du Markdown : `<article data-shader-ui="reveal-links">`,
 * `<form data-shader-ui="form" data-sui-guide>` (spec Formulaire §2.4), `<nav data-shader-ui="scrollspy">` (spec Scrollspy §8).
 */
const LINKS = '[data-shader-ui~="reveal-links"]';
const FORM = 'form[data-shader-ui~="form"]';
const SPY = '[data-shader-ui~="scrollspy"]';
const SELECTOR = `${LINKS}, ${FORM}, ${SPY}`;

let stopAll: (() => void) | undefined;

/**
 * Active la lib depuis le HTML : cherche les attributs `data-shader-ui` dans la page,
 * et surveille ceux ajoutés plus tard. Un deuxième appel ne fait rien. Renvoie la fonction pour arrêter.
 */
export function autoInit(): () => void {
  if (!isBrowser()) return () => {};
  if (stopAll) return stopAll;
  const stops = new Map<Element, () => void>();

  const attach = (node: Node) => {
    if (!(node instanceof Element)) return;
    const found = [...node.querySelectorAll(SELECTOR)];
    if (node.matches(SELECTOR)) found.unshift(node);
    for (const el of found) {
      if (stops.has(el)) continue;
      const { suiInitial, suiSpeed, suiScroll, suiElasticity } = (el as HTMLElement).dataset;
      const parts: Array<() => void> = [];
      if (el.matches(LINKS)) parts.push(revealLinks(el, { initial: suiInitial as RevealInitial | undefined, speed: suiSpeed ? Number(suiSpeed) : undefined }));
      if (el.matches(SPY)) parts.push(scrollspy(el, { scroll: suiScroll as ScrollMode | undefined, elasticity: suiElasticity ? Number(suiElasticity) : undefined }));
      if (el instanceof HTMLFormElement && el.matches(FORM)) {
        const form = watchForm(el, { guide: el.hasAttribute("data-sui-guide") });
        parts.push(() => form.destroy());
      }
      stops.set(el, () => parts.forEach((stop) => stop()));
    }
  };
  const release = (el: Element) => {
    stops.get(el)?.();
    stops.delete(el);
  };

  attach(document.documentElement);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const el = mutation.target as Element;
        if (el.matches(SELECTOR)) attach(el);
        else release(el);
        continue;
      }
      mutation.addedNodes.forEach(attach);
      if (mutation.removedNodes.length) for (const el of [...stops.keys()]) if (!el.isConnected) release(el);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-shader-ui"] });

  stopAll = () => {
    observer.disconnect();
    for (const el of [...stops.keys()]) release(el);
    stopAll = undefined;
  };
  return stopAll;
}
