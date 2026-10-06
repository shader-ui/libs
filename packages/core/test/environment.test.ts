import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureEnvironment,
  detect,
  getEnvironment,
  resetEnvironment,
  subscribeEnvironment,
  type DetectionInput,
  type Environment,
} from "../src/index.js";
import { reportFrameTime, reportRender } from "../src/environment.js";

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1",
  firefoxIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  chromeAndroidPhone:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  chromeAndroidTablet:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  samsungPhone:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
};

const brands = (name: string) => [
  { brand: "Not=A?Brand", version: "24" },
  { brand: "Chromium", version: "140" },
  { brand: name, version: "140" },
];

function input(overrides: Partial<DetectionInput>): DetectionInput {
  return {
    userAgent: "",
    pointer: "fine",
    hover: true,
    maxTouchPoints: 0,
    screen: { width: 1440, height: 900 },
    hardwareConcurrency: 8,
    saveData: false,
    reducedMotion: false,
    webgpu: false,
    ...overrides,
  };
}

type Expected = { device: Partial<Environment["device"]>; browser: Partial<Environment["browser"]> };

/** Table de conformité (spec §9). */
const cases: Array<[string, Partial<DetectionInput>, Expected]> = [
  [
    "Chrome Windows (Client Hints)",
    { userAgent: UA.chromeWindows, clientHints: { mobile: false, platform: "Windows", brands: brands("Google Chrome") } },
    { device: { type: "desktop" }, browser: { name: "chrome", version: 140, engine: "blink", os: "windows", source: "client-hints" } },
  ],
  [
    "Edge Windows (Client Hints)",
    { userAgent: UA.edgeWindows, clientHints: { mobile: false, platform: "Windows", brands: brands("Microsoft Edge") } },
    { device: { type: "desktop" }, browser: { name: "edge", engine: "blink", os: "windows" } },
  ],
  [
    "Edge Windows (user agent seul)",
    { userAgent: UA.edgeWindows },
    { device: { type: "desktop" }, browser: { name: "edge", version: 140, engine: "blink", source: "user-agent" } },
  ],
  [
    "PC portable tactile",
    { userAgent: UA.chromeWindows, maxTouchPoints: 10 },
    { device: { type: "desktop", touch: true }, browser: { name: "chrome", os: "windows" } },
  ],
  [
    "Safari macOS",
    { userAgent: UA.safariMac },
    { device: { type: "desktop", touch: false }, browser: { name: "safari", version: 26, engine: "webkit", os: "macos" } },
  ],
  [
    "MacBook tactile (attendu)",
    { userAgent: UA.safariMac, maxTouchPoints: 10 },
    { device: { type: "desktop", touch: true }, browser: { name: "safari", os: "macos" } },
  ],
  [
    "iPad (se présente comme un Mac)",
    { userAgent: UA.safariMac, maxTouchPoints: 5, pointer: "coarse", hover: false, screen: { width: 820, height: 1180 } },
    { device: { type: "tablet", touch: true }, browser: { name: "safari", engine: "webkit", os: "ipados" } },
  ],
  [
    "iPhone Safari",
    { userAgent: UA.safariIphone, maxTouchPoints: 5, pointer: "coarse", hover: false },
    { device: { type: "mobile" }, browser: { name: "safari", version: 18, engine: "webkit", os: "ios" } },
  ],
  [
    "iPhone Chrome (moteur WebKit)",
    { userAgent: UA.chromeIphone, maxTouchPoints: 5, pointer: "coarse", hover: false },
    { device: { type: "mobile" }, browser: { name: "chrome", version: 140, engine: "webkit", os: "ios" } },
  ],
  [
    "iPhone Firefox (moteur WebKit)",
    { userAgent: UA.firefoxIphone, maxTouchPoints: 5, pointer: "coarse", hover: false },
    { device: { type: "mobile" }, browser: { name: "firefox", engine: "webkit", os: "ios" } },
  ],
  [
    "Firefox Windows",
    { userAgent: UA.firefoxWindows },
    { device: { type: "desktop" }, browser: { name: "firefox", version: 140, engine: "gecko", os: "windows" } },
  ],
  [
    "Firefox Linux",
    { userAgent: UA.firefoxLinux },
    { device: { type: "desktop" }, browser: { name: "firefox", engine: "gecko", os: "linux" } },
  ],
  [
    "Téléphone Android, Chrome",
    {
      userAgent: UA.chromeAndroidPhone,
      clientHints: { mobile: true, platform: "Android", brands: brands("Google Chrome") },
      pointer: "coarse",
      hover: false,
      maxTouchPoints: 5,
    },
    { device: { type: "mobile" }, browser: { name: "chrome", engine: "blink", os: "android" } },
  ],
  [
    "Tablette Android, Chrome",
    {
      userAgent: UA.chromeAndroidTablet,
      clientHints: { mobile: false, platform: "Android", brands: brands("Google Chrome") },
      pointer: "coarse",
      hover: false,
      maxTouchPoints: 10,
    },
    { device: { type: "tablet" }, browser: { name: "chrome", os: "android" } },
  ],
  [
    "Téléphone Android, Samsung Internet (user agent seul)",
    { userAgent: UA.samsungPhone, pointer: "coarse", hover: false, maxTouchPoints: 5 },
    { device: { type: "mobile" }, browser: { name: "samsung", version: 28, engine: "blink", os: "android" } },
  ],
  [
    "Aucun indice, petit écran tactile",
    { pointer: "coarse", hover: false, screen: { width: 390, height: 844 } },
    { device: { type: "mobile" }, browser: { name: "other", engine: "other", os: "other" } },
  ],
  [
    "Aucun indice, grand écran tactile",
    { pointer: "coarse", hover: false, screen: { width: 800, height: 1280 } },
    { device: { type: "tablet" }, browser: { name: "other" } },
  ],
];

describe("détection (table de conformité)", () => {
  it.each(cases)("%s", (_, given, expected) => {
    const env = detect(input(given));
    expect(env.device).toMatchObject(expected.device);
    expect(env.browser).toMatchObject(expected.browser);
  });
});

describe("performance", () => {
  const phone = input({ userAgent: UA.chromeAndroidPhone, pointer: "coarse", hover: false, hardwareConcurrency: 8 });

  it.each([
    ["peu de mémoire", { deviceMemory: 2 }, undefined, "mémoire"],
    ["peu de cœurs sur mobile", { hardwareConcurrency: 4 }, undefined, "cœurs"],
    ["économie de données", { saveData: true }, undefined, "économie"],
    ["GPU d'entrée de gamme", {}, { webgl2: true, gpu: "Mali-T830 MP2" }, "GPU"],
  ] as const)("low : %s, avec la raison", (_, given, render, reason) => {
    const perf = detect({ ...phone, ...given }, render).performance;
    expect(perf.tier).toBe("low");
    expect(perf.reasons.join()).toContain(reason);
  });

  it("frames lentes : baisse d'un niveau, jamais sous low", () => {
    const desktop = input({ userAgent: UA.chromeWindows });
    expect(detect(desktop, undefined, 1).performance).toMatchObject({ tier: "medium" });
    expect(detect(desktop, undefined, 1).performance.reasons).toContain("frames lentes mesurées");
    expect(detect(desktop, undefined, 5).performance.tier).toBe("low");
  });
});

describe("rendu", () => {
  it("en attente tant que le canvas n'existe pas", () => {
    expect(detect(input({ webgpu: true })).render).toEqual({ status: "pending", webgpu: true });
  });

  it("GPU d'entrée de gamme récents (Galaxy A12, Helio, Snapdragon 4xx) : low ; haut de gamme : pas low", () => {
    const phone = input({ pointer: "coarse", hover: false, maxTouchPoints: 5, hardwareConcurrency: 8, deviceMemory: 3, userAgent: "Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" });
    for (const gpu of ["PowerVR Rogue GE8320", "Mali-G52 MC2", "Adreno (TM) 506"]) {
      expect(detect(phone, { webgl2: true, gpu }).performance.tier).toBe("low");
    }
    expect(detect(phone, { webgl2: true, gpu: "Adreno (TM) 740" }).performance.tier).not.toBe("low");
  });

  it("repère le rendu logiciel", () => {
    const render = detect(input({}), { webgl2: true, gpu: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))" }).render;
    expect(render).toMatchObject({ status: "ready", webgl2: true, software: true });
  });

  it("vrai GPU", () => {
    expect(detect(input({}), { webgl2: true, gpu: "Apple M2" }).render.software).toBe(false);
  });
});

describe("module en fonctionnement", () => {
  afterEach(resetEnvironment);

  it("les valeurs forcées l'emportent, et se retirent", () => {
    getEnvironment();
    configureEnvironment({ device: { type: "mobile" }, performance: { tier: "low" } });
    expect(getEnvironment()!.device.type).toBe("mobile");
    expect(getEnvironment()!.performance).toEqual({ tier: "low", reasons: ["forcé"] });
    configureEnvironment(undefined);
    expect(getEnvironment()!.device.type).toBe("desktop");
  });

  it("contraste élevé (forced-colors) : détecté, et suivi en direct", () => {
    let active = false;
    let onChange: (() => void) | undefined;
    vi.stubGlobal("matchMedia", (q: string) => ({
      get matches() {
        return q === "(forced-colors: active)" && active;
      },
      addEventListener: (_: string, cb: () => void) => q === "(forced-colors: active)" && (onChange = cb),
      removeEventListener() {},
    }));
    expect(getEnvironment()!.preferences.forcedColors).toBe(false);
    active = true;
    onChange!();
    expect(getEnvironment()!.preferences.forcedColors).toBe(true);
    vi.unstubAllGlobals();
  });

  it("suit le dernier geste et prévient les abonnés", () => {
    getEnvironment();
    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeEnvironment((env) => seen.push(env.device.lastInput));
    window.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
    window.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
    window.dispatchEvent(new Event("keydown"));
    unsubscribe();
    expect(seen).toEqual(["touch", "keyboard"]);
  });

  it("baisse le niveau après 30 frames lentes, sans jamais remonter", () => {
    const order = ["low", "medium", "high"];
    const start = getEnvironment()!.performance.tier;
    for (let i = 0; i < 29; i++) reportFrameTime(40);
    expect(getEnvironment()!.performance.tier).toBe(start);
    reportFrameTime(40);
    const after = getEnvironment()!.performance.tier;
    expect(order.indexOf(after)).toBe(Math.max(order.indexOf(start) - 1, 0));
    for (let i = 0; i < 30; i++) reportFrameTime(8);
    expect(getEnvironment()!.performance.tier).toBe(after);
  });

});
