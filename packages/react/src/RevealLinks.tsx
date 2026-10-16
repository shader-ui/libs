"use client";

import { revealLinks, type RevealLinksOptions } from "@shader-ui/core";
import { Children, cloneElement, forwardRef, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { childRefOf, setRef } from "./child-ref.js";

export interface RevealLinksProps extends RevealLinksOptions {
  /** Un seul élément DOM : le conteneur des liens (article, description), ou un lien seul. */
  children: ReactElement;
}

/** Révèle les liens de son unique enfant quand le lecteur arrive dessus (spec Liens révélés). */
export const RevealLinks = forwardRef<HTMLElement, RevealLinksProps>(function RevealLinks({ children, ignore, initial }, forwardedRef) {
  const child = Children.only(children) as ReactElement<Record<string, unknown>>;
  const refs = useRef({ forwardedRef, childRef: childRefOf<HTMLElement>(child) });
  refs.current = { forwardedRef, childRef: childRefOf<HTMLElement>(child) };
  const [element, setElement] = useState<HTMLElement | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    setElement(el);
    setRef(refs.current.forwardedRef, el);
    setRef(refs.current.childRef, el);
  }, []);

  // Après l'hydratation seulement : rien n'est ajouté au HTML du serveur
  useEffect(() => (element ? revealLinks(element, { ignore, initial }) : undefined), [element, ignore, initial]);

  return cloneElement(child, { ref });
});
