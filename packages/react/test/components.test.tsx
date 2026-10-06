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

  it("double l'erreur dans le DOM : aria-invalid et data-sui-status", () => {
    const { getByRole, rerender } = render(<Input aria-describedby="e" />);
    expect(getByRole("textbox").getAttribute("aria-invalid")).toBeNull();
    rerender(<Input aria-describedby="e" status="error" />);
    expect(getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    expect(getByRole("textbox").dataset.suiStatus).toBe("error");
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

  it("signale en dev une erreur sans texte associé (WCAG 1.4.1)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Input status="error" />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("aria-describedby"));
    warn.mockRestore();
  });
});

describe("Button", () => {
  it("loading : aria-busy, garde le focus, ignore les clics", () => {
    const onClick = vi.fn();
    const { getByRole } = render(<Button status="loading" onClick={onClick}>Continuer</Button>);
    const button = getByRole("button");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Form", () => {
  it("n'allume que le premier champ invalide", () => {
    const { container } = render(
      <Form>
        <Input name="a" required />
        <Input name="b" required />
      </Form>,
    );
    act(() => container.querySelector("form")!.checkValidity());
    const [a, b] = container.querySelectorAll("input");
    expect(a!.dataset.suiFx).toBe("pulse");
    expect(b!.dataset.suiFx).toBeUndefined();
  });
});

describe("Light", () => {
  it("s'applique à un élément existant et conserve sa ref", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Light status="valid">
        <div ref={ref} className="card" />
      </Light>,
    );
    expect(ref.current).toBe(container.querySelector(".card"));
    expect(ref.current!.dataset.suiStatus).toBe("valid");
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
