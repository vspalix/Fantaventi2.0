"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { clubByName, colorsFor, type ClubBadgeOverride } from "@/lib/club-colors";

export type { ClubBadgeOverride };

const BadgeContext = createContext<ClubBadgeOverride[]>([]);

export function ClubBadgeProvider({ badges, children }: { badges: ClubBadgeOverride[]; children: ReactNode }) {
  return <BadgeContext.Provider value={badges}>{children}</BadgeContext.Provider>;
}

export function TeamBadge({
  teamName,
  size = 16,
  colors,
  logoUrl,
}: {
  teamName: string;
  size?: number;
  colors?: [string, string];
  logoUrl?: string | null;
}) {
  const overrides = useContext(BadgeContext);
  const club = clubByName(teamName);
  const custom = club ? overrides.find((badge) => badge.code === club.code) : undefined;
  const clip = useId().replace(/:/g, "");
  const picture = logoUrl !== undefined ? logoUrl : custom?.logoUrl;
  if (picture) {
    return (
      <img
        className="team-badge"
        src={picture}
        alt=""
        width={size}
        height={size}
      />
    );
  }
  const [left, right] = colors ?? (custom ? [custom.primary, custom.secondary] as [string, string] : colorsFor(teamName));
  return (
    <svg className="team-badge" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x="0.8" y="0.8" width="14.4" height="14.4" rx="4" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="0" width="8" height="16" fill={left} />
        <rect x="8" y="0" width="8" height="16" fill={right} />
      </g>
      <rect x="0.8" y="0.8" width="14.4" height="14.4" rx="4" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.8" />
    </svg>
  );
}
