"use client";

import { scrollspy, type ScrollspyOptions } from "@shader-ui/core";
import { Children, cloneElement, forwardRef, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { childRefOf, setRef } from "./child-ref.js";

export interface ScrollspyProps extends ScrollspyOptions {
  /** Un seul élément DOM : le sommaire (en général un `<nav>`). */
  children: ReactElement;
}

/** Marque la section en cours de lecture dans son unique enfant, un sommaire (spec Scrollspy). */
export const Scrollspy = forwardRef<HTMLElement, ScrollspyProps>(function Scrollspy({ children, root, scroll, elasticity, scrollTo }, forwardedRef) {
  const child = Children.only(children) as ReactElement<Record<string, unknown>>;
  const refs = useRef({ forwardedRef, childRef: childRefOf<HTMLElement>(child), scrollTo });
  refs.current = { forwardedRef, childRef: childRefOf<HTMLElement>(child), scrollTo };
  const [element, setElement] = useState<HTMLElement | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    setElement(el);
    setRef(refs.current.forwardedRef, el);
    setRef(refs.current.childRef, el);
  }, []);

  // Une fonction écrite en ligne change à chaque rendu : seule sa présence rebranche le sommaire
  const custom = scrollTo !== undefined;
  // Après l'hydratation seulement : rien n'est ajouté au HTML du serveur
  useEffect(
    () =>
      element
        ? scrollspy(element, {
            root,
            scroll,
            elasticity,
            scrollTo: custom ? (target, options) => refs.current.scrollTo?.(target, options) : undefined,
          })
        : undefined,
    [element, root, scroll, elasticity, custom],
  );

  return cloneElement(child, { ref });
});
