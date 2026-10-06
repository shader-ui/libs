/**
 * Départ d'un sweep (spec Formulaire §3.2) : du coin haut gauche, dans l'ordre des règles CSS
 * (haut → droite → bas → gauche). En RTL, du coin haut droit, dans l'autre sens.
 */
export function sweepStart(element: Element): { origin: { x: number; y: number }; reverse: boolean } {
  const rect = element.getBoundingClientRect();
  const rtl = getComputedStyle(element).direction === "rtl";
  return { origin: { x: rtl ? rect.right : rect.left, y: rect.top }, reverse: rtl };
}

/** Décalage de la diode depuis le bord de fin, quand `--sui-diode-inset` n'est pas défini. */
const DIODE_INSET = 18;

/**
 * Point de départ des effets : la diode, au bout de l'élément côté fin de ligne (LTR / RTL),
 * ou le milieu du bord de fin quand elle est retirée (`--sui-diode: none`). Spec Formulaire §3.3.
 */
export function diodeOrigin(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const rtl = style.direction === "rtl";
  const diode = style.getPropertyValue("--sui-diode").trim() !== "none";
  const inset = diode ? parseFloat(style.getPropertyValue("--sui-diode-inset")) || DIODE_INSET : 0;
  return { x: rtl ? rect.left + inset : rect.right - inset, y: rect.top + rect.height / 2 };
}
