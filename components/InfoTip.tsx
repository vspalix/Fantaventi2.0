"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(`[data-info="${id}"]`)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, id]);

  return (
    <span className="info-tip" data-info={id}>
      <button className="info-button" type="button" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>
        (i)
      </button>
      {open ? <span className="info-pop" id={id} role="note">{children}</span> : null}
    </span>
  );
}
