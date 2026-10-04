import { defaultTokens, type ColorToken } from "./tokens.js";

export type RGB = readonly [number, number, number];

/** Lit #rgb, #rrggbb, rgb() et rgba(). Renvoie des composantes entre 0 et 1. */
export function parseColor(value: string): RGB | undefined {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const n = parseInt(full, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return undefined;
}

/** Couleur d'un token, depuis la variable CSS de l'élément ou, à défaut, le token par défaut. */
export function resolveColor(color: ColorToken | string, el?: Element): RGB {
  if (color in defaultTokens.color) {
    const token = color as ColorToken;
    const css = el && getComputedStyle(el).getPropertyValue(`--sui-color-${token}`);
    return (css && parseColor(css)) || parseColor(defaultTokens.color[token].$value)!;
  }
  return parseColor(color) ?? parseColor(defaultTokens.color.accent.$value)!;
}
