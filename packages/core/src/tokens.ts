/**
 * Tokens par défaut, au format W3C Design Tokens.
 * Chaque couleur est surchargeable en CSS via `--sui-color-<nom>`.
 */
export const defaultTokens = {
  color: {
    accent: { $type: "color", $value: "#8b5cf6" }, // violet : en cours, guidage
    success: { $type: "color", $value: "#22c55e" }, // vert : validé
    error: { $type: "color", $value: "#ff6f61" }, // corail : erreur
    neutral: { $type: "color", $value: "#ffffff" }, // blanc neutre : obligatoire, choix coché
  },
  duration: {
    short: { $type: "duration", $value: "600ms" },
    medium: { $type: "duration", $value: "900ms" },
    loop: { $type: "duration", $value: "1400ms" },
  },
} as const;

export type ColorToken = keyof typeof defaultTokens.color;
