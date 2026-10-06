import { getEngine } from "./engine.js";

export { light, lightOf, EFFECT_END_EVENT } from "./light.js";
export type { Light, TriggerOptions, EffectEndDetail } from "./light.js";
export { watchField, fieldOf, TYPING_PAUSE } from "./field.js";
export type { Field, FieldState } from "./field.js";
export { watchButton, buttonOf } from "./button.js";
export type { Button, SendResult } from "./button.js";
export { watchForm, formOf, INVALID_WAIT, ERROR_STAGGER, READY_REPEAT, GUIDE_HOVER } from "./form.js";
export type { FormController, FormOptions } from "./form.js";
export { watchChoice, TRAIL_MAX } from "./choice.js";
export type { Choice, ChoiceState } from "./choice.js";
export { legendOf, underline } from "./underline.js";
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
export { observeVisibility, getVisibility, canBeSeen, canBeSeenAll } from "./visibility.js";
export type { Visibility, VisibilityState } from "./visibility.js";
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
