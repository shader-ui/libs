import { Engine, setEngine, type Backend, type Instance } from "../src/index.js";

/** Moteur piloté à la main : horloge et rAF simulés, backend espion. */
export function createTestEngine({ webgl = true } = {}) {
  let time = 0;
  let pending: Array<() => void> = [];
  const rendered: Instance[][] = [];
  let clears = 0;
  const backend: Backend = {
    lost: false,
    render: (instances) => void rendered.push([...instances]),
    clear: () => void clears++,
    destroy: () => {},
  };
  const engine = new Engine({
    createBackend: () => (webgl ? backend : undefined),
    now: () => time,
    requestFrame: (cb) => {
      pending.push(() => cb(time));
      return pending.length;
    },
  });
  setEngine(engine);

  return {
    engine,
    rendered,
    get clears() {
      return clears;
    },
    /** Rappels rAF en attente : doit valoir 0 au repos. */
    get pendingFrames() {
      return pending.length;
    },
    /** Avance l'horloge et exécute une frame. */
    tick(ms = 16) {
      time += ms;
      const run = pending;
      pending = [];
      run.forEach((cb) => cb());
    },
    advance(ms: number) {
      time += ms;
    },
    runUntilIdle(max = 1000) {
      for (let i = 0; i < max && pending.length; i++) this.tick();
    },
  };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
