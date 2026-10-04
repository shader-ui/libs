import { getEngine } from "./engine.js";

export { light, lightOf, EFFECT_END_EVENT } from "./light.js";
export type { Light, LightOptions, Status, TriggerOptions, EffectEndDetail } from "./light.js";
export { getEngine, setEngine, Engine } from "./engine.js";
export type { EndReason, Origin, PlayOptions, Stats, EngineOptions } from "./engine.js";
export { registerEffect, getEffect, sampleEffect, MAX_LOOP_DURATION } from "./effects.js";
export type { EffectDefinition, EffectKind, EffectSample } from "./effects.js";
export type { Backend, Instance } from "./webgl.js";
export { defaultTokens } from "./tokens.js";
export type { ColorToken } from "./tokens.js";
export { perimeterAt } from "./geometry.js";
export { getEnvironment, subscribeEnvironment, configureEnvironment, resetEnvironment } from "./environment.js";
export type { EnvironmentOverrides } from "./environment.js";
export { detect } from "./detect.js";
export type {
  Environment,
  DetectionInput,
  RenderInfo,
  DeviceType,
  Pointer,
  InputKind,
  BrowserName,
  Engine as BrowserEngine,
  OS,
  Tier,
} from "./detect.js";

/** Interrupteur global : coupe toute la lumière de la page. */
export function setEnabled(enabled: boolean): void {
  getEngine().setEnabled(enabled);
}
