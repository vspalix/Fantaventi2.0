"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ModeSwitch({ mode }: { mode: "player" | "host" }) {
  const router = useRouter();
  const [pending, setPending] = useState<"player" | "host" | null>(null);

  async function choose(next: "player" | "host") {
    if (next === mode || pending) return;
    setPending(next);
    try {
      const response = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (response.ok) router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mode-switch" role="group" aria-label="Vista">
      <button type="button" data-active={mode === "player"} disabled={pending !== null} onClick={() => void choose("player")}>
        Giocatore
      </button>
      <button type="button" data-active={mode === "host"} disabled={pending !== null} onClick={() => void choose("host")}>
        Admin
      </button>
    </div>
  );
}
