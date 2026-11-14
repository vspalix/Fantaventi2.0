"use client";

import { useState } from "react";
import { inviteUrl } from "@/lib/invite";

export function CopyInviteLink({ code, className = "primary" }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className={className}
      type="button"
      onClick={() => {
        const url = inviteUrl(window.location.origin, code);
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "Link copiato" : "Copia link invito"}
    </button>
  );
}
