"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function AppDrawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return createPortal(
    <>
      <button className="drawer-backdrop" type="button" aria-label="Chiudi menu" onClick={onClose} />
      <nav className="drawer" aria-label="Menu">
        <div className="drawer-head">
          <button className="drawer-close" type="button" onClick={onClose}>Chiudi</button>
        </div>
        <div className="drawer-body">{children}</div>
      </nav>
    </>,
    document.body,
  );
}
