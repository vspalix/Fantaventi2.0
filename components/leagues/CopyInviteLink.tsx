"use client";

import { useState } from "react";
import { inviteUrl } from "@/lib/invite";
import { nativeShare, shareJoinCode, triggerHaptic } from "@/lib/native/bridge";

export function CopyInviteLink({ code, className = "primary" }: { code: string; className?: string }) {
  const [label, setLabel] = useState("Condividi invito");
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="stack">
      <button
        className={className}
        type="button"
        onClick={() => {
          void (async () => {
            setNote(null);
            try {
              const result = await nativeShare({
                title: "Invito FantaVenti",
                text: `Entra nella mia lega con il codice ${code}.`,
                url: inviteUrl(window.location.origin, code),
              });
              if (result === "cancelled") return;
              if (result === "unavailable") {
                setNote("Condivisione non disponibile. Il codice resta visibile qui sopra: copialo a mano.");
                return;
              }
              void triggerHaptic();
              setLabel(result === "copied" ? "Link copiato" : "Invito condiviso");
              window.setTimeout(() => setLabel("Condividi invito"), 2000);
            } catch {
              setNote("Condivisione non riuscita. Il codice resta visibile qui sopra: copialo a mano.");
            }
          })();
        }}
      >
        {label}
      </button>
      {note ? <p className="small">{note}</p> : null}
    </div>
  );
}

export function ShareJoinCode({ code }: { code: string }) {
  const [label, setLabel] = useState("Condividi codice");
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="stack">
      <button
        className="ghost"
        type="button"
        onClick={() => {
          void (async () => {
            setNote(null);
            try {
              const result = await shareJoinCode(code);
              if (result === "cancelled") return;
              if (result === "unavailable") {
                setNote("Condivisione non disponibile. Il codice resta visibile: copialo a mano.");
                return;
              }
              setLabel(result === "copied" ? "Codice copiato" : "Codice condiviso");
              window.setTimeout(() => setLabel("Condividi codice"), 2000);
            } catch {
              setNote("Condivisione non riuscita. Il codice resta visibile: copialo a mano.");
            }
          })();
        }}
      >
        {label}
      </button>
      {note ? <p className="small">{note}</p> : null}
    </div>
  );
}
