import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<Element, (v: unknown) => void>();
const stop = vi.fn();
vi.mock("@shader-ui/core", async (original) => ({
  ...(await original<typeof import("@shader-ui/core")>()),
  observeVisibility: vi.fn((element: Element, listener: (v: unknown) => void) => {
    listeners.set(element, listener);
    return stop;
  }),
}));

const { useVisibility } = await import("../src/index.js");

function Probe({ onRender }: { onRender: (state: string, seen: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { state, seen } = useVisibility(ref);
  onRender(state, seen);
  return <div ref={ref} data-testid="probe" />;
}

afterEach(() => {
  cleanup();
  listeners.clear();
  stop.mockClear();
});

describe("useVisibility", () => {
  it("unknown au premier rendu, puis suit les changements, désabonné au démontage", () => {
    const renders: Array<[string, boolean]> = [];
    const { getByTestId, unmount } = render(<Probe onRender={(s, v) => renders.push([s, v])} />);
    expect(renders[0]).toEqual(["unknown", false]);
    const listener = listeners.get(getByTestId("probe"))!;
    act(() => listener({ state: "visible", ratio: 1, seen: false }));
    act(() => listener({ state: "visible", ratio: 1, seen: true }));
    expect(renders.at(-1)).toEqual(["visible", true]);
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
