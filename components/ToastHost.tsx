"use client";

import { useEffect, useState } from "react";
import { subscribeToasts, type ToastItem } from "@/lib/toast";

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts((item) => {
    setItems((current) => [...current.slice(-2), item]);
    window.setTimeout(() => {
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    }, 4600);
  }), []);

  if (items.length === 0) return null;

  return (
    <div className="toast-stack">
      {items.map((item) => (
        <p key={item.id} className="toast" data-tone={item.tone} role={item.tone === "err" ? "alert" : "status"}>
          {item.text}
        </p>
      ))}
    </div>
  );
}
