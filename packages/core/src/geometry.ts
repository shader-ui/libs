/**
 * Position le long du périmètre d'un rectangle arrondi, entre 0 et 1.
 * 0 = milieu du bord haut, sens horaire. Même calcul que `perimeter()` dans le shader.
 */
export function perimeterAt(x: number, y: number, w: number, h: number, radius: number): number {
  const r = Math.min(radius, w / 2, h / 2);
  const cx = w / 2 - r;
  const cy = h / 2 - r;
  const qa = (Math.PI / 2) * r;
  const total = Math.max(4 * (cx + cy + qa), 1e-6);
  const px = x - w / 2;
  const py = y - h / 2;

  let dx = px - Math.min(Math.max(px, -cx), cx);
  let dy = py - Math.min(Math.max(py, -cy), cy);
  if (dx === 0 && dy === 0) {
    // À l'intérieur : projection sur le bord le plus proche
    if (cx - Math.abs(px) < cy - Math.abs(py)) dx = px >= 0 ? 1 : -1;
    else dy = py >= 0 ? 1 : -1;
  }

  let s: number;
  if (dx !== 0 && dy !== 0) {
    const a = Math.atan2(Math.abs(dy), Math.abs(dx)); // 0 = horizontal, π/2 = vertical
    if (dx > 0 && dy < 0) s = cx + (Math.PI / 2 - a) * r;
    else if (dx > 0) s = cx + qa + 2 * cy + a * r;
    else if (dy > 0) s = 3 * cx + 2 * qa + 2 * cy + (Math.PI / 2 - a) * r;
    else s = 3 * cx + 3 * qa + 4 * cy + a * r;
  } else if (dy < 0) s = px >= 0 ? px : total + px;
  else if (dx > 0) s = cx + qa + (py + cy);
  else if (dy > 0) s = cx + 2 * qa + 2 * cy + (cx - px);
  else s = 3 * cx + 3 * qa + 2 * cy + (cy - py);

  return s / total;
}
