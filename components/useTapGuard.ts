"use client";

import { useRef, useState } from "react";

export function useTapGuard() {
  const lock = useRef<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function release(id: string) {
    if (lock.current === id) lock.current = null;
    setBusyId((current) => (current === id ? null : current));
  }

  function occupy(id: string, action: () => void) {
    if (lock.current) return;
    lock.current = id;
    setBusyId(id);
    window.setTimeout(() => {
      action();
      release(id);
    }, 180);
  }

  function hold(id: string, action: () => void) {
    if (lock.current) return;
    lock.current = id;
    setBusyId(id);
    action();
    window.setTimeout(() => release(id), 280);
  }

  return { busyId, locked: busyId !== null, occupy, hold };
}
