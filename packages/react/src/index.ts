"use client";

export { Input } from "./Input.js";
export type { InputProps } from "./Input.js";
export { Button } from "./Button.js";
export type { ButtonProps } from "./Button.js";
export { Form } from "./Form.js";
export { Checkbox, Radio } from "./Choice.js";
export type { ChoiceProps } from "./Choice.js";
export type { FormProps } from "./Form.js";
export { Light } from "./Light.js";
export type { LightComponentProps } from "./Light.js";
export { ShaderProvider, useEnvironment, useShaderStats } from "./ShaderProvider.js";
export type { ShaderProviderProps } from "./ShaderProvider.js";
export { useLight } from "./use-light.js";
export { useVisibility } from "./use-visibility.js";
export type { EffectMap, LightProps, ShaderElement } from "./use-light.js";

// Le cœur, réexporté : un dev React n'installe et n'importe que @shader-ui/react
export {
  registerEffect,
  setEnabled,
  lightOf,
  defaultTokens,
  EFFECT_END_EVENT,
  getEnvironment,
  subscribeEnvironment,
  configureEnvironment,
  watchField,
  fieldOf,
  TYPING_PAUSE,
  watchButton,
  buttonOf,
  watchForm,
  watchChoice,
  observeVisibility,
  getVisibility,
  canBeSeen,
  canBeSeenAll,
} from "@shader-ui/core";
export type {
  ColorToken,
  EffectDefinition,
  EffectEndDetail,
  EffectKind,
  EndReason,
  Environment,
  EnvironmentOverrides,
  Light as LightHandle,
  Origin,
  Stats,
  Field,
  FieldState,
  Button as ButtonController,
  SendResult,
  FormController,
  FormOptions,
  TriggerOptions,
  Visibility,
  VisibilityState,
} from "@shader-ui/core";
