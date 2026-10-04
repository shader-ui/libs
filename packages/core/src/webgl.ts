import { isSoftwareGpu, type Tier } from "./detect.js";
import { getEnvironment, reportRender } from "./environment.js";

/** Une bordure lumineuse à dessiner pendant une frame. Coordonnées en px CSS, relatives au viewport. */
export interface Instance {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  kind: number;
  origin: number;
  progress: number;
  tail: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export interface Backend {
  readonly lost: boolean;
  render(instances: readonly Instance[]): void;
  clear(): void;
  destroy(): void;
}

export const KIND_ID = { pulse: 0, sweep: 1, ripple: 2, orbit: 3 } as const;

/** Selon le niveau de performance : résolution max du canvas, zone dessinée autour du contour et largeur du halo (px CSS). */
const QUALITY: Record<Tier, { dpr: number; margin: number; halo: number }> = {
  low: { dpr: 1, margin: 12, halo: 3.5 },
  medium: { dpr: 1.5, margin: 24, halo: 7 },
  high: { dpr: 2, margin: 24, halo: 7 },
};
const FLOATS = 16;

const VERTEX = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;   // x, y, w, h
layout(location = 2) in vec4 aShape;  // radius, kind, origin, progress
layout(location = 3) in vec4 aColor;  // r, g, b, intensity
layout(location = 4) in vec4 aExtra;  // tail
uniform vec2 uViewport;
uniform float uMargin;
out vec2 vP;
flat out vec2 vB;
flat out vec4 vShape;
flat out vec4 vColor;
flat out float vTail;
void main() {
  vec2 pos = aRect.xy - uMargin + aCorner * (aRect.zw + 2.0 * uMargin);
  vP = pos - (aRect.xy + aRect.zw * 0.5);
  vB = aRect.zw * 0.5;
  vShape = aShape;
  vColor = aColor;
  vTail = aExtra.x;
  gl_Position = vec4(pos.x / uViewport.x * 2.0 - 1.0, 1.0 - pos.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec2 vB;
flat in vec4 vShape;
flat in vec4 vColor;
flat in float vTail;
uniform float uHalo;
out vec4 outColor;
const float HALF_PI = 1.5707963;

// Distance signée au rectangle arrondi (négative à l'intérieur)
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Abscisse curviligne sur le contour, en px. 0 = milieu du bord haut, sens horaire.
float perimeter(vec2 p, vec2 c, float r, float total) {
  float qa = HALF_PI * r;
  vec2 d = p - clamp(p, -c, c);
  if (d.x == 0.0 && d.y == 0.0) {
    if (c.x - abs(p.x) < c.y - abs(p.y)) d.x = p.x >= 0.0 ? 1.0 : -1.0;
    else d.y = p.y >= 0.0 ? 1.0 : -1.0;
  }
  if (d.x != 0.0 && d.y != 0.0) {
    float a = atan(abs(d.y), abs(d.x));
    if (d.x > 0.0 && d.y < 0.0) return c.x + (HALF_PI - a) * r;
    if (d.x > 0.0) return c.x + qa + 2.0 * c.y + a * r;
    if (d.y > 0.0) return 3.0 * c.x + 2.0 * qa + 2.0 * c.y + (HALF_PI - a) * r;
    return 3.0 * c.x + 3.0 * qa + 4.0 * c.y + a * r;
  }
  if (d.y < 0.0) return p.x >= 0.0 ? p.x : total + p.x;
  if (d.x > 0.0) return c.x + qa + p.y + c.y;
  if (d.y > 0.0) return c.x + 2.0 * qa + 2.0 * c.y + c.x - p.x;
  return 3.0 * c.x + 3.0 * qa + 2.0 * c.y + c.y - p.y;
}

// Arc qui avance vers les s croissants : front net, traîne exponentielle
float arc(float s, float head, float tail, float total) {
  float behind = fract(head - s) * total;
  float tailPx = max(tail * total, 1.0);
  return max(exp(-3.0 * behind / tailPx), exp(-(total - behind) / 8.0));
}

void main() {
  float r = min(vShape.x, min(vB.x, vB.y));
  vec2 c = vB - r;
  float total = max(4.0 * (c.x + c.y + HALF_PI * r), 1.0);
  float d = sdRoundRect(vP, vB, r);

  // Le bord, pas le fond : liseré fin, halo à l'extérieur, chute rapide à l'intérieur
  float line = exp(-(d * d) / 2.25);
  float halo = d > 0.0 ? exp(-d / uHalo) : exp(d / 1.5);
  float edge = line + 0.5 * halo;

  int kind = int(vShape.y + 0.5);
  float s = perimeter(vP, c, r, total) / total;
  float origin = vShape.z;
  float progress = vShape.w;
  float mask = 1.0;
  if (kind == 1) mask = arc(s, origin + progress, vTail, total);
  else if (kind == 2) mask = max(arc(s, origin + progress, vTail, total), arc(1.0 - s, 1.0 - origin + progress, vTail, total));
  else if (kind == 3) mask = arc(s, origin + progress, vTail, total);

  float a = clamp(edge * mask * vColor.a, 0.0, 1.0);
  outColor = vec4(vColor.rgb * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  }
  return shader;
}

/** Crée le canvas partagé. Renvoie `undefined` si WebGL2 est indisponible (fallback CSS). */
export function createWebGLBackend(): Backend | undefined {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.shaderUi = "";
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "2147483647",
    visibility: "hidden",
  });

  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) {
    reportRender({ webgl2: false });
    return undefined;
  }

  // Phase 2 de la détection : le nom du GPU. Chrome et Safari renvoient « WebKit WebGL »
  // dans RENDERER et exposent le vrai nom via l'extension ; Firefox le donne directement.
  let gpu = gl.getParameter(gl.RENDERER) as string | null;
  if (!gpu || gpu === "WebKit WebGL") {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    gpu = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : gpu;
  }
  reportRender({ webgl2: true, gpu: gpu ?? undefined });
  if (gpu && isSoftwareGpu(gpu)) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return undefined;
  }

  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
  } catch (e) {
    console.warn("[shader-ui] WebGL2 indisponible, fallback CSS.", e);
    return undefined;
  }

  const uViewport = gl.getUniformLocation(program, "uViewport");
  const uMargin = gl.getUniformLocation(program, "uMargin");
  const uHalo = gl.getUniformLocation(program, "uHalo");

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  for (let i = 0; i < 4; i++) {
    gl.enableVertexAttribArray(1 + i);
    gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
    gl.vertexAttribDivisor(1 + i, 1);
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  let data = new Float32Array(FLOATS * 4);
  let lost = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
  });
  document.body.appendChild(canvas);

  function resize(dprMax: number): [number, number] {
    const dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return [w, h];
  }

  return {
    get lost() {
      return lost;
    },

    render(instances) {
      if (lost) return;
      const quality = QUALITY[getEnvironment()?.performance.tier ?? "medium"];
      const [w, h] = resize(quality.dpr);
      if (data.length < instances.length * FLOATS) data = new Float32Array(instances.length * FLOATS * 2);
      instances.forEach((it, i) => {
        data.set(
          [it.x, it.y, it.w, it.h, it.radius, it.kind, it.origin, it.progress, it.r, it.g, it.b, it.intensity, it.tail, 0, 0, 0],
          i * FLOATS,
        );
      });
      canvas.style.visibility = "visible";
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uViewport, w, h);
      gl.uniform1f(uMargin, quality.margin);
      gl.uniform1f(uHalo, quality.halo);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, instances.length * FLOATS), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances.length);
    },

    clear() {
      if (lost) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      canvas.style.visibility = "hidden";
    },

    destroy() {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
