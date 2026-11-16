"use client";

import { useEffect, useState } from "react";

type Notice = { id: string; title: string; body: string; created_at: string; read_at: string | null };

export function InboxBell() {
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    let cancel = false;
    void fetch("/api/notices")
      .then(async (response) => {
        const body = await response.json() as { notices?: Notice[] };
        if (!cancel && response.ok) setNotices(body.notices ?? []);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  const unread = notices.filter((item) => !item.read_at).length;

  async function openNotice(id: string) {
    setNotices((list) => list.map((item) => item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item));
    await fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  return (
    <div className="inbox">
      <button className="menu-pill" type="button" aria-label="Notifiche" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <BellIcon />
        {unread > 0 ? <span className="inbox-count">{unread}</span> : null}
      </button>
      {open ? (
        <div className="inbox-panel">
          {notices.length === 0 ? <p>Nessun messaggio.</p> : notices.map((item) => (
            <button key={item.id} type="button" data-read={Boolean(item.read_at)} onClick={() => void openNotice(item.id)}>
              <strong>{item.title}</strong>
              <span>{item.body}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
