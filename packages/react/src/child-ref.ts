import { version, type ReactElement, type Ref } from "react";

export function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/** La ref posée sur l'enfant par le dev : dans ses props depuis React 19, sur l'élément avant. */
export function childRefOf<T>(child: ReactElement<Record<string, unknown>>): Ref<T> | undefined {
  return (Number(version.split(".")[0]) >= 19 ? child.props.ref : (child as unknown as { ref: unknown }).ref) as Ref<T> | undefined;
}
