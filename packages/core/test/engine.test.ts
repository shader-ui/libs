import { afterEach, describe, expect, it, vi } from "vitest";
import { configureEnvironment, getEffect, light, resetEnvironment, EFFECT_END_EVENT, type EffectEndDetail } from "../src/index.js";
import { createTestEngine, flush } from "./helpers.js";

function element() {
  const el = document.createElement("input");
  document.body.appendChild(el);
  return el;
}

function endEvents(el: HTMLElement) {
  const events: EffectEndDetail[] = [];
  el.addEventListener(EFFECT_END_EVENT, (e) => events.push((e as CustomEvent<EffectEndDetail>).detail));
  return events;
}

afterEach(() => {
  document.body.innerHTML = "";
  resetEnvironment();
  vi.useRealTimers();
});

describe("zéro frame au repos", () => {
  it("ne crée rien et ne demande aucune frame tant qu'aucun effet n'est joué", () => {
    const t = createTestEngine();
    light(element(), { status: "error" });
    expect(t.pendingFrames).toBe(0);
    expect(t.engine.getStats()).toMatchObject({ frames: 0, renderer: "none" });
  });

  it("s'arrête après un effet : une seule frame d'effacement, puis plus rien", () => {
    const t = createTestEngine();
    const el = element();
    const events = endEvents(el);
    light(el).trigger("success");

    t.runUntilIdle();
    const frames = t.engine.getStats().frames;
    expect(frames).toBeGreaterThan(10);
    expect(t.clears).toBe(1);
    expect(t.pendingFrames).toBe(0);
    expect(events).toEqual([{ name: "success", reason: "complete" }]);

    t.advance(10_000);
    expect(t.engine.getStats().frames).toBe(frames);
  });

  it("arrête une boucle au bout de 5 s", () => {
    const t = createTestEngine();
    const el = element();
    const events = endEvents(el);
    light(el).trigger("loading");
    t.runUntilIdle();
    expect(t.pendingFrames).toBe(0);
    expect(t.engine.getStats().frames).toBeLessThanOrEqual(Math.ceil(5000 / 16) + 2);
    expect(events).toEqual([{ name: "loading", reason: "complete" }]);
  });
});

describe("règles", () => {
  it("un effet à la fois par élément : le nouveau interrompt l'ancien", () => {
    const t = createTestEngine();
    const el = element();
    const events = endEvents(el);
    const l = light(el);
    l.trigger("sweep");
    t.tick();
    t.advance(400);
    l.trigger("pulse");
    t.runUntilIdle();
    expect(events).toEqual([
      { name: "sweep", reason: "interrupted" },
      { name: "pulse", reason: "complete" },
    ]);
  });

  it("au plus 3 effets par seconde sur la page (WCAG 2.3.1)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = createTestEngine();
    const els = [element(), element(), element(), element()];
    const events = els.map(endEvents);
    els.forEach((el) => light(el).trigger("pulse"));
    await flush();
    expect(events[3]).toEqual([{ name: "pulse", reason: "skipped" }]);
    t.advance(1001);
    light(els[3]!).trigger("pulse");
    expect(t.engine.getStats().active).toBe(4);
  });

  it("interrupteur global : rien n'est rendu, mais la fin est toujours signalée", async () => {
    const t = createTestEngine();
    t.engine.setEnabled(false);
    const el = element();
    const events = endEvents(el);
    light(el).trigger("success");
    await flush();
    expect(events).toEqual([{ name: "success", reason: "skipped" }]);
    expect(t.pendingFrames).toBe(0);
  });

  it("mouvement réduit : pas de boucle, un simple fondu sans déplacement", async () => {
    configureEnvironment({ preferences: { reducedMotion: true } });
    const t = createTestEngine();
    const a = element();
    const b = element();
    const events = endEvents(a);
    light(a).trigger("loading");
    light(b).trigger("sweep");
    t.tick();
    await flush();
    expect(events).toEqual([{ name: "loading", reason: "skipped" }]);
    expect(t.rendered.at(-1)).toHaveLength(1);
    expect(t.rendered.at(-1)![0]).toMatchObject({ kind: 0, progress: 0 });
  });
});

describe("états", () => {
  it("l'état initial ne joue rien, seules les transitions allument", () => {
    const t = createTestEngine();
    const el = element();
    const l = light(el, { status: "error" });
    expect(el.dataset.suiStatus).toBe("error");
    expect(t.engine.getStats().active).toBe(0);
    l.setStatus("valid");
    expect(el.dataset.suiStatus).toBe("valid");
    expect(t.engine.getStats().active).toBe(1);
  });

  it("quitter loading éteint la boucle", () => {
    const t = createTestEngine();
    const el = element();
    const events = endEvents(el);
    const l = light(el);
    l.setStatus("loading");
    t.tick();
    t.advance(500);
    l.setStatus(undefined);
    t.runUntilIdle();
    expect(events).toEqual([{ name: "loading", reason: "interrupted" }]);
    expect(t.pendingFrames).toBe(0);
  });
});

describe("fallback CSS sans WebGL2", () => {
  it("pose l'animation sur l'élément puis la retire", () => {
    vi.useFakeTimers();
    const t = createTestEngine({ webgl: false });
    const el = element();
    const events = endEvents(el);
    light(el).trigger("error", { color: "#00ff00" });
    expect(el.dataset.suiFx).toBe("pulse");
    expect(el.style.getPropertyValue("--sui-fx-color")).toBe("rgb(0 255 0)");
    vi.advanceTimersByTime(getEffect("error")!.duration);
    expect(el.dataset.suiFx).toBeUndefined();
    expect(events).toEqual([{ name: "error", reason: "complete" }]);
    expect(t.engine.getStats()).toMatchObject({ frames: 0, renderer: "css" });
  });
});

describe("vérification avant effet (spec Visibilité §6)", () => {
  it("élément qui ne peut pas être vu : effet non joué, fin signalée skipped", async () => {
    const t = createTestEngine({ visible: () => false });
    const el = element();
    const events = endEvents(el);
    light(el).trigger("success");
    await flush();
    expect(t.pendingFrames).toBe(0);
    expect(events).toEqual([{ name: "success", reason: "skipped" }]);
  });
});
