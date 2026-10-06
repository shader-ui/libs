"use client";

import { watchForm, type FormController } from "@shader-ui/core";
import { forwardRef, useCallback, useEffect, useRef, useState, type FormEvent, type FormHTMLAttributes, type Ref } from "react";

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  /** Une promesse renvoyée pose aria-busy sur le bouton cliqué jusqu'à la réponse (spec Formulaire §2.3). */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => unknown;
  /** Ce que la lib ne peut pas lire (captcha, paiement) : faux tant que ce n'est pas prêt (§2.3). */
  ready?: boolean;
  /** Mode init (§2.2) : au premier geste, un trait blanc sous le label de chaque champ obligatoire. */
  guide?: boolean;
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/**
 * `<form>` natif. À la validation native, seul le premier champ invalide s'allume ; un envoi
 * par promesse ignore les envois suivants, sans désactiver le bouton.
 */
export const Form = forwardRef<HTMLFormElement, FormProps>(function Form({ onSubmit, ready = true, guide = false, ...props }, forwardedRef) {
  const [element, setElement] = useState<HTMLFormElement | null>(null);
  const controller = useRef<FormController | null>(null);
  const forwarded = useRef(forwardedRef);
  forwarded.current = forwardedRef;

  const ref = useCallback((el: HTMLFormElement | null) => {
    setElement(el);
    setRef(forwarded.current, el);
  }, []);

  useEffect(() => {
    if (!element) return;
    const handle = watchForm(element, { ready, guide });
    controller.current = handle;
    return () => {
      handle.destroy();
      controller.current = null;
    };
    // `ready` et `guide` lus au branchement ; les changements de `ready` passent par l'effet suivant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element]);

  useEffect(() => {
    controller.current?.setReady(ready);
  }, [ready]);

  return (
    <form
      {...props}
      ref={ref}
      onSubmit={(event) => {
        // Envoi en cours : ignoré, le bouton reste actif et focusable
        if (controller.current?.busy) return event.preventDefault();
        const result = onSubmit?.(event);
        controller.current?.track(result, (event.nativeEvent as SubmitEvent).submitter ?? null);
      }}
    />
  );
});
