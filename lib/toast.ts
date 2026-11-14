export type ToastTone = "ok" | "err";

export type ToastItem = {
  id: number;
  tone: ToastTone;
  text: string;
};

type Listener = (item: ToastItem) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function pushToast(tone: ToastTone, text: string) {
  const item = { id: nextId, tone, text };
  nextId += 1;
  listeners.forEach((listener) => listener(item));
}

export function subscribeToasts(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
