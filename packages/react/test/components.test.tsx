import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { getEngine, Engine, resetEnvironment, setEngine } from "@shader-ui/core";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Form, Input, Light, ShaderProvider, useEnvironment, type ShaderElement } from "../src/index.js";

beforeEach(() => {
  // Rendu CSS (jsdom n'a pas WebGL), horloge réelle
  setEngine(new Engine({ createBackend: () => undefined, canBeSeen: () => true }));
});
afterEach(cleanup);

describe("Input", () => {
  it("transmet l'élément natif dans la ref, avec trigger() en plus", () => {
    const ref = createRef<ShaderElement<HTMLInputElement>>();
    render(<Input ref={ref} name="email" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(typeof ref.current!.trigger).toBe("function");
  });

  it("accepte une ref fonction (react-hook-form)", () => {
    const register = vi.fn();
    render(<Input ref={register} name="email" />);
    expect(register).toHaveBeenCalledWith(expect.any(HTMLInputElement));
  });

  it("lit l'état dans le HTML : aria-invalid posé par le dev → data-sui-state", async () => {
    const { getByRole, rerender } = render(<Input aria-describedby="e" />);
    expect(getByRole("textbox").dataset.suiState).toBeUndefined();
    rerender(<Input aria-describedby="e" aria-invalid />);
    await act(() => Promise.resolve());
    expect(getByRole("textbox").dataset.suiState).toBe("error");
  });

  it("joue l'effet d'un événement et garde le gestionnaire du dev", async () => {
    const onPaste = vi.fn();
    const onEffectEnd = vi.fn();
    getEngine().setEnabled(false);
    const { getByRole } = render(<Input onPaste={onPaste} effects={{ onPaste: "ripple" }} onEffectEnd={onEffectEnd} />);
    fireEvent.paste(getByRole("textbox"));
    await act(() => Promise.resolve());
    expect(onPaste).toHaveBeenCalledOnce();
    expect(onEffectEnd).toHaveBeenCalledWith({ name: "ripple", reason: "skipped" });
  });

});


describe("Form", () => {
  it("champs invalides : onde, le premier d'abord, une fois visible (1 s au plus)", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <Form>
        <Input name="a" required aria-describedby="e" />
        <Input name="b" required aria-describedby="e" />
      </Form>,
    );
    act(() => container.querySelector("form")!.checkValidity());
    // jsdom ne calcule pas la visibilité : l'onde attend son plafond (1 s), puis 150 ms par champ
    await act(() => vi.advanceTimersByTimeAsync(1200));
    const [a, b] = container.querySelectorAll("input");
    expect(a!.dataset.suiFx).toBe("pulse");
    expect(b!.dataset.suiFx).toBe("pulse");
    vi.useRealTimers();
  });

  it("onSubmit qui renvoie une promesse : aria-busy sur le bouton, double envoi ignoré", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn((e: { preventDefault(): void }) => {
      e.preventDefault();
      return new Promise<void>((r) => (resolve = r));
    });
    const { getByRole } = render(
      <Form onSubmit={onSubmit}>
        <Button type="submit">Envoyer</Button>
      </Form>,
    );
    const button = getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () => resolve());
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });
});

describe("Light", () => {
  it("s'applique à un élément existant et conserve sa ref", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Light>
        <div ref={ref} className="card" />
      </Light>,
    );
    expect(ref.current).toBe(container.querySelector(".card"));
    expect(ref.current!.dataset.sui).toBe("");
  });
});

describe("environnement", () => {
  afterEach(resetEnvironment);

  function Probe() {
    const env = useEnvironment();
    return <output>{env ? `${env.device.type}/${env.performance.tier}` : "inconnu"}</output>;
  }

  it("useEnvironment donne l'environnement, et ShaderProvider impose des valeurs", () => {
    const { getByRole, rerender, unmount } = render(
      <ShaderProvider environment={{ device: { type: "mobile" }, performance: { tier: "low" } }}>
        <Probe />
      </ShaderProvider>,
    );
    expect(getByRole("status").textContent).toBe("mobile/low");
    rerender(
      <ShaderProvider>
        <Probe />
      </ShaderProvider>,
    );
    expect(getByRole("status").textContent).toMatch(/^desktop\//);
    unmount();
  });
});
