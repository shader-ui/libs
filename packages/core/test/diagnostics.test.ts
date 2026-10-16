import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEngine, light, resetEnvironment, EFFECT_END_EVENT, type EffectEndDetail } from "../src/index.js";
import { resetDiagnostics } from "../src/diagnostics.js";
import { resetMessages } from "../src/env.js";
import { createTestEngine } from "./helpers.js";

/** Tests de conformité : spec Diagnostic §6. */

type Console = { debug(on?: boolean): void; status(): void };
const shaderUI = () => (globalThis as unknown as { shaderUI: Console }).shaderUI;
const flush = () => new Promise((resolve) => setTimeout(resolve));

function element(style = "") {
  const el = document.createElement("input");
  el.setAttribute("style", style);
  document.body.appendChild(el);
  return el;
}

function endEvents(el: HTMLElement) {
  const events: EffectEndDetail[] = [];
  el.addEventListener(EFFECT_END_EVENT, (e) => events.push((e as CustomEvent<EffectEndDetail>).detail));
  return events;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "table").mockImplementation(() => {});
  getEngine(); // installe shaderUI
});

afterEach(() => {
  shaderUI()?.debug(false);
  resetDiagnostics();
  resetMessages();
  resetEnvironment();
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const skipped = () => warn.mock.calls.filter(([message]) => String(message).includes("skipped ("));

describe("causes d'un effet sauté (§3)", () => {
  it("élément couvert : skipped, cause not-visible", async () => {
    createTestEngine({ visible: () => false });
    const el = element();
    const events = endEvents(el);
    light(el).trigger("success");
    await flush();
    expect(events).toEqual([{ name: "success", reason: "skipped", cause: "not-visible" }]);
  });
});

describe("activation par la console (§1, §2)", () => {
  it("mode diagnostic coupé, hors dev : aucun message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const t = createTestEngine({ visible: () => false });
    const el = element();
    el.focus();
    light(el).trigger("success");
    t.engine.play(element(), { kind: "pulse", color: "accent", duration: 100 });
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });

  it("shaderUI.debug() : chaque effet sauté expliqué, une seule fois par élément et par cause ; debug(false) : plus rien", async () => {
    createTestEngine({ visible: () => false });
    shaderUI().debug();
    const el = element();
    light(el).trigger("success");
    light(el).trigger("success");
    await flush();
    expect(skipped()).toEqual([[expect.stringContaining("(not-visible)"), el]]);

    shaderUI().debug(false);
    light(element()).trigger("success");
    await flush();
    expect(skipped()).toHaveLength(1);
  });

  it("shaderUI.debug() puis rechargement, sans bundler : mode repris dès le chargement", async () => {
    vi.stubEnv("NODE_ENV", "production");
    shaderUI().debug();
    // Rechargement : un nouveau chargement de la lib dans le même onglet
    resetDiagnostics();
    resetMessages();
    getEngine();
    createTestEngine({ visible: () => false });
    light(element()).trigger("success");
    await flush();
    expect(skipped()).toHaveLength(1);
  });
});

describe("anomalies (§4)", () => {
  it("champ cliqué puis couvert : anomalie signalée", async () => {
    createTestEngine({ visible: () => false });
    const el = element();
    // Sans interaction : un élément couvert est normal, rien n'est signalé
    light(el).trigger("success");
    expect(warn).not.toHaveBeenCalled();
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    light(el).trigger("error");
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("covered while the user interacts"), el);
  });

  it("canvas réduit par une règle du site : anomalie signalée ; barre de défilement : rien", () => {
    // Zone visible sans la barre de défilement verticale (15 px), celle que couvre le canvas fixe
    const [width, height] = [window.innerWidth - 15, window.innerHeight];
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(width);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(height);
    const canvas = document.createElement("canvas");
    canvas.dataset.shaderUi = "";
    document.body.appendChild(canvas);

    canvas.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
    createTestEngine();
    light(element()).trigger("success");
    expect(warn).not.toHaveBeenCalled();

    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 380, height);
    createTestEngine();
    light(element()).trigger("success");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`380 × ${height} instead of ${width} × ${height}`), canvas);
  });
});

describe("analyse de la page (§5)", () => {
  it("shaderUI.debug() avec un champ sur fond blanc et un sur fond noir : le premier seul signalé", () => {
    createTestEngine();
    const dark = document.createElement("div");
    dark.style.backgroundColor = "rgb(11, 11, 13)";
    document.body.appendChild(dark);
    const onWhite = element();
    // Fond blanc du champ lui-même : c'est celui de ses parents qui compte
    const onDark = document.createElement("input");
    onDark.style.backgroundColor = "rgb(255, 255, 255)";
    dark.appendChild(onDark);
    light(onWhite);
    light(onDark);
    shaderUI().debug();
    const light_ = warn.mock.calls.find(([message]) => String(message).includes("light background"));
    expect(light_).toEqual([expect.stringContaining("behind 1 element"), [onWhite]]);
  });
});
