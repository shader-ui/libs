/** Vrai hors production. Les bundlers remplacent `process.env.NODE_ENV` à la compilation. */
export function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function warn(message: string): void {
  if (isDev()) console.warn(`[shader-ui] ${message}`);
}
