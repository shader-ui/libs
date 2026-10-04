const seen = new Set<string>();

export function warnOnce(message: string): void {
  let dev = false;
  try {
    dev = process.env.NODE_ENV !== "production";
  } catch {}
  if (!dev || seen.has(message)) return;
  seen.add(message);
  console.warn(`[shader-ui] ${message}`);
}
