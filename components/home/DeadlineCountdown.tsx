"use client";

import { useEffect, useState } from "react";

export function DeadlineCountdown({ deadlineAt, label }: { deadlineAt: string; label: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const left = new Date(deadlineAt).getTime() - now;
  const ended = left <= 0;
  const total = Math.max(0, left);
  const days = Math.floor(total / 86400000);
  const hours = Math.floor((total % 86400000) / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const clock = ended
    ? "Chiusa"
    : [days > 0 ? `${days}g` : "", `${hours}h`, String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0")]
      .filter(Boolean)
      .join(" ");

  return (
    <div>
      <p className="small muted">{label}</p>
      <p className="countdown">{clock}</p>
      <p className="small muted">{new Intl.DateTimeFormat("it-IT", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Rome",
      }).format(new Date(deadlineAt))}</p>
    </div>
  );
}
