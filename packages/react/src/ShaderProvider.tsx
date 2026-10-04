"use client";

import {
  configureEnvironment,
  getEngine,
  getEnvironment,
  subscribeEnvironment,
  type Environment,
  type EnvironmentOverrides,
  type Stats,
} from "@shader-ui/core";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

export interface ShaderProviderProps {
  /** Interrupteur global : `false` coupe toute la lumière. Les `onEffectEnd` restent émis. */
  enabled?: boolean;
  /** Valeurs imposées à la détection (tests, lab) : `{ device: { type: "mobile" } }`. */
  environment?: EnvironmentOverrides;
  children?: ReactNode;
}

/** Un seul canvas partagé par page, créé au premier effet seulement. */
export function ShaderProvider({ enabled = true, environment, children }: ShaderProviderProps) {
  useEffect(() => {
    getEngine().setEnabled(enabled);
  }, [enabled]);

  // Comparaison par contenu : un objet écrit en ligne change d'identité à chaque rendu
  const overrides = environment ? JSON.stringify(environment) : undefined;
  useEffect(() => {
    if (!overrides) return;
    configureEnvironment(JSON.parse(overrides) as EnvironmentOverrides);
    return () => configureEnvironment(undefined);
  }, [overrides]);

  return children;
}

const getServerEnvironment = () => undefined;

/**
 * Où suis-je : appareil, navigateur, rendu, performance, préférences.
 * `undefined` au rendu serveur et à l'hydratation : à utiliser pour les effets, jamais pour le HTML.
 */
export function useEnvironment(): Environment | undefined {
  return useSyncExternalStore(subscribeEnvironment, getEnvironment, getServerEnvironment);
}

/** Compteur de frames et effets en cours (mode dev, lab). */
export function useShaderStats(): Stats {
  const [stats, setStats] = useState<Stats>({ frames: 0, active: 0, renderer: "none" });
  useEffect(() => {
    setStats(getEngine().getStats());
    return getEngine().subscribe(setStats);
  }, []);
  return stats;
}
