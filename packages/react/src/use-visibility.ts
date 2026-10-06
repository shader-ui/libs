"use client";

import { observeVisibility, type Visibility } from "@shader-ui/core";
import { useEffect, useState, type RefObject } from "react";

/** État de départ, identique côté serveur et au premier rendu : pas d'écart d'hydratation. */
const UNKNOWN: Visibility = { state: "unknown", ratio: 0, seen: false };

/**
 * Visibilité d'un élément (spec Visibilité). Nouveau rendu seulement quand `state` ou `seen`
 * change, jamais à chaque défilement ; `ratio` est celui du dernier changement.
 */
export function useVisibility(ref: RefObject<Element | null>): Visibility {
  const [visibility, setVisibility] = useState<Visibility>(UNKNOWN);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Un élément déjà observé ailleurs envoie son état courant à ce nouvel abonné
    return observeVisibility(element, setVisibility);
  }, [ref]);
  return visibility;
}
