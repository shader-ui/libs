import { isBrowser } from "./env.js";
import { revealLinks, type RevealInitial } from "./reveal-links.js";

/** Attributs HTML pour un CMS, du PHP ou du Markdown : `<article data-shader-ui="reveal-links">`. */
const SELECTOR = '[data-shader-ui~="reveal-links"]';

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
      const initial = (el as HTMLElement).dataset.suiInitial as RevealInitial | undefined;
      stops.set(el, revealLinks(el, { initial }));
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
