"use client";

import { lightOf } from "@shader-ui/core";
import { forwardRef, useRef, type FormEvent, type FormHTMLAttributes } from "react";

export type FormProps = FormHTMLAttributes<HTMLFormElement>;

/**
 * `<form>` natif. À la validation native, seul le premier champ invalide s'allume :
 * un effet à la fois, et c'est celui qui reçoit le focus.
 */
export const Form = forwardRef<HTMLFormElement, FormProps>(function Form({ onInvalidCapture, ...props }, ref) {
  const busy = useRef(false);
  return (
    <form
      {...props}
      ref={ref}
      onInvalidCapture={(e: FormEvent<HTMLFormElement>) => {
        onInvalidCapture?.(e);
        if (busy.current) return;
        busy.current = true;
        queueMicrotask(() => (busy.current = false));
        lightOf(e.target as Element)?.trigger("error");
      }}
    />
  );
});
