/**
 * Règles de détection de l'environnement (spec : docs/spec/environment.md).
 * Fonctions pures, sans accès au navigateur : toutes les règles sont ici,
 * pour être corrigées en un seul endroit quand un nouvel appareil sort.
 */

export type DeviceType = "mobile" | "tablet" | "desktop";
export type Pointer = "fine" | "coarse" | "none";
export type InputKind = "mouse" | "touch" | "pen" | "keyboard";
export type BrowserName = "chrome" | "edge" | "safari" | "firefox" | "samsung" | "opera" | "other";
export type Engine = "blink" | "webkit" | "gecko" | "other";
export type OS = "ios" | "ipados" | "android" | "macos" | "windows" | "linux" | "chromeos" | "other";
export type Tier = "low" | "medium" | "high";

export interface Environment {
  device: {
    type: DeviceType;
    /** Pointeur principal. */
    pointer: Pointer;
    /** Le pointeur principal peut survoler. */
    hover: boolean;
    /** L'écran accepte le toucher, même sur desktop. Ne décide pas du type. */
    touch: boolean;
    /** Dernier geste réel de l'utilisateur. */
    lastInput?: InputKind;
  };
  browser: {
    name: BrowserName;
    /** Version majeure. */
    version?: number;
    engine: Engine;
    os: OS;
    source: "client-hints" | "user-agent";
  };
  render: {
    /** `ready` une fois le canvas créé, au premier effet. */
    status: "pending" | "ready";
    /** API WebGPU présente (adaptateur non demandé). */
    webgpu: boolean;
    webgl2?: boolean;
    /** Nom du GPU, s'il est exposé. */
    gpu?: string;
    /** Rendu sans vrai GPU : fallback CSS. */
    software?: boolean;
  };
  performance: {
    tier: Tier;
    /** Pourquoi ce niveau (debug, lab). */
    reasons: string[];
  };
  preferences: {
    reducedMotion: boolean;
    saveData: boolean;
  };
}

/** Ce que le navigateur expose, lu une fois puis à chaque changement. */
export interface DetectionInput {
  userAgent: string;
  clientHints?: {
    mobile: boolean;
    platform: string;
    brands: ReadonlyArray<{ brand: string; version: string }>;
  };
  pointer: Pointer;
  hover: boolean;
  maxTouchPoints: number;
  screen: { width: number; height: number };
  hardwareConcurrency?: number;
  deviceMemory?: number;
  saveData: boolean;
  reducedMotion: boolean;
  webgpu: boolean;
  lastInput?: InputKind;
}

/** Ce que le canvas révèle à sa création. */
export interface RenderInfo {
  webgl2: boolean;
  gpu?: string;
}

// ── Navigateur ────────────────────────────────────────────────────────────

/** Ordre important : plusieurs navigateurs se déclarent « Chrome » ou « Safari ». */
const UA_BROWSERS: ReadonlyArray<[BrowserName, RegExp]> = [
  ["edge", /Edg(?:e|A|iOS)?\/(\d+)/],
  ["samsung", /SamsungBrowser\/(\d+)/],
  ["opera", /(?:OPR|OPT)\/(\d+)/],
  ["firefox", /(?:Firefox|FxiOS)\/(\d+)/],
  ["chrome", /(?:CriOS|Chrome)\/(\d+)/],
  ["safari", /Version\/(\d+)[\d.]*(?: Mobile\/\w+)? Safari\//],
];

const HINT_BROWSERS: ReadonlyArray<[BrowserName, RegExp]> = [
  ["edge", /^Microsoft Edge$/],
  ["opera", /^Opera$/],
  ["samsung", /^Samsung Internet$/],
  ["chrome", /^Google Chrome$/],
];

/** Marques factices ajoutées volontairement par Chromium (GREASE). */
const GREASE = /not.?a.?brand/i;

function osFromUserAgent(ua: string, input: DetectionInput): OS {
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/iPad/.test(ua)) return "ipados";
  if (/Android/.test(ua)) return "android";
  if (/CrOS/.test(ua)) return "chromeos";
  // iPadOS se présente comme un Mac : écran tactile + doigt comme pointeur principal
  if (/Macintosh|Mac OS X/.test(ua)) return input.maxTouchPoints > 1 && input.pointer === "coarse" ? "ipados" : "macos";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

function osFromPlatform(platform: string): OS {
  switch (platform.toLowerCase()) {
    case "android":
      return "android";
    case "macos":
      return "macos";
    case "windows":
      return "windows";
    case "linux":
      return "linux";
    case "chrome os":
    case "chromium os":
      return "chromeos";
    case "ios":
      return "ios";
    default:
      return "other";
  }
}

function engineOf(name: BrowserName, os: OS): Engine {
  // Sur iOS et iPadOS, tous les navigateurs tournent sur WebKit
  if (os === "ios" || os === "ipados") return "webkit";
  if (name === "safari") return "webkit";
  if (name === "firefox") return "gecko";
  if (name === "other") return "other";
  return "blink";
}

export function detectBrowser(input: DetectionInput): Environment["browser"] {
  const hints = input.clientHints;
  if (hints && hints.brands.length) {
    const brands = hints.brands.filter((b) => !GREASE.test(b.brand));
    let name: BrowserName = "other";
    let version: number | undefined;
    for (const [candidate, re] of HINT_BROWSERS) {
      const found = brands.find((b) => re.test(b.brand));
      if (found) {
        name = candidate;
        version = parseInt(found.version, 10) || undefined;
        break;
      }
    }
    if (name === "other") {
      const chromium = brands.find((b) => b.brand === "Chromium");
      version = chromium ? parseInt(chromium.version, 10) || undefined : undefined;
    }
    const os = osFromPlatform(hints.platform);
    // Seul Chromium implémente les Client Hints
    return { name, version, engine: os === "ios" ? "webkit" : "blink", os, source: "client-hints" };
  }

  const ua = input.userAgent;
  let name: BrowserName = "other";
  let version: number | undefined;
  for (const [candidate, re] of UA_BROWSERS) {
    const match = re.exec(ua);
    if (match) {
      name = candidate;
      version = Number(match[1]);
      break;
    }
  }
  const os = osFromUserAgent(ua, input);
  return { name, version, engine: engineOf(name, os), os, source: "user-agent" };
}

// ── Appareil ──────────────────────────────────────────────────────────────

export function detectDevice(input: DetectionInput, browser: Environment["browser"]): Environment["device"] {
  const base = {
    pointer: input.pointer,
    hover: input.hover,
    touch: input.maxTouchPoints > 0,
    lastInput: input.lastInput,
  };
  if (input.pointer !== "coarse") return { type: "desktop", ...base };

  const ua = input.userAgent;
  if (input.clientHints?.mobile || /iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua))) {
    return { type: "mobile", ...base };
  }
  if (/iPad/.test(ua) || /Android/.test(ua) || browser.os === "ipados") return { type: "tablet", ...base };

  const shortSide = Math.min(input.screen.width, input.screen.height);
  return { type: shortSide >= 600 ? "tablet" : "mobile", ...base };
}

// ── Rendu et performance ──────────────────────────────────────────────────

const SOFTWARE_GPU = /SwiftShader|llvmpipe|Software|Basic Render Driver/i;

/** Rendu sans vrai GPU : le shader passe au fallback CSS. */
export function isSoftwareGpu(gpu: string): boolean {
  return SOFTWARE_GPU.test(gpu);
}

const LOW_END_GPU = /Mali-(?:4\d\d|T\d+)|Adreno(?: \(TM\))? [34]\d\d|PowerVR SGX/i;

export function detectRender(input: DetectionInput, info?: RenderInfo): Environment["render"] {
  if (!info) return { status: "pending", webgpu: input.webgpu };
  return {
    status: "ready",
    webgpu: input.webgpu,
    webgl2: info.webgl2,
    gpu: info.gpu,
    software: info.gpu ? isSoftwareGpu(info.gpu) : false,
  };
}

const TIERS: readonly Tier[] = ["low", "medium", "high"];

/** `downgrades` : niveaux perdus à cause de frames lentes mesurées. */
export function detectPerformance(
  input: DetectionInput,
  device: Environment["device"],
  render: Environment["render"],
  downgrades = 0,
): Environment["performance"] {
  const low: string[] = [];
  const handheld = device.type !== "desktop";
  if (input.deviceMemory !== undefined && input.deviceMemory <= 2) low.push(`mémoire ${input.deviceMemory} Go`);
  if (handheld && input.hardwareConcurrency !== undefined && input.hardwareConcurrency <= 4) {
    low.push(`${input.hardwareConcurrency} cœurs sur ${device.type}`);
  }
  if (render.gpu && LOW_END_GPU.test(render.gpu)) low.push(`GPU d'entrée de gamme (${render.gpu})`);
  if (input.saveData) low.push("économie de données");

  let tier: Tier;
  let reasons: string[];
  if (low.length) {
    tier = "low";
    reasons = low;
  } else if (device.type === "desktop" && (input.hardwareConcurrency ?? 0) >= 8) {
    tier = "high";
    reasons = [`desktop, ${input.hardwareConcurrency} cœurs`];
  } else {
    tier = "medium";
    reasons = ["par défaut"];
  }

  if (downgrades > 0) {
    const index = Math.max(TIERS.indexOf(tier) - downgrades, 0);
    if (TIERS[index] !== tier) {
      tier = TIERS[index]!;
      reasons = [...reasons, "frames lentes mesurées"];
    }
  }
  return { tier, reasons };
}

export function detect(input: DetectionInput, info?: RenderInfo, downgrades = 0): Environment {
  const browser = detectBrowser(input);
  const device = detectDevice(input, browser);
  const render = detectRender(input, info);
  return {
    device,
    browser,
    render,
    performance: detectPerformance(input, device, render, downgrades),
    preferences: {
      reducedMotion: input.reducedMotion,
      saveData: input.saveData,
    },
  };
}
