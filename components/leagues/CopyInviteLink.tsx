"use client";

import { useState } from "react";
import { inviteUrl } from "@/lib/invite";
import { nativeShare, triggerHaptic } from "@/lib/native/bridge";

export function CopyInviteLink({ code, className = "primary" }: { code: string; className?: string }) {
  const [label, setLabel] = useState("Condividi invito");

  return (
    <button
      className={className}
      type="button"
      onClick={() => {
        void (async () => {
          try {
            const result = await nativeShare({
              title: "Invito FantaVenti",
              text: `Entra nella mia lega con il codice ${code}.`,
              url: inviteUrl(window.location.origin, code),
            });
            if (result === "cancelled" || result === "unavailable") return;
            void triggerHaptic();
            setLabel(result === "copied" ? "Link copiato" : "Invito condiviso");
            window.setTimeout(() => setLabel("Condividi invito"), 2000);
          } catch {
            setLabel("Condividi invito");
          }
        })();
      }}
    >
      {label}
    </button>
  );
}
