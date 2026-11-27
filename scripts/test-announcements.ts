// Annunci «una sola volta»: ricordati sull'account e non sul telefono. Solo dati inventati.
import {
  queueAnnouncements,
  seenAnnouncements,
  SEEN_ANNOUNCEMENTS_MAX,
  unseenAnnouncements,
  withSeenAnnouncement,
  type Announcement,
} from "../lib/announcements";

function announcement(id: string, oncePerUser = true): Announcement {
  return { id, kind: "text", title: id, body: null, imageUrl: null, ctaLabel: null, ctaHref: null, isActive: true, oncePerUser };
}

export function runAnnouncementChecks() {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    total += 1;
    if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  };
  const ids = (list: Announcement[]) => list.map((item) => item.id).join(",");
  const items = [announcement("a"), announcement("b", false)];
  const seenA = { provider: "email", seen_announcements: ["a"] };

  check("account nuovo: si vedono tutti", ids(unseenAnnouncements(items, {})) === "a,b");
  check("account senza dati: si vedono tutti", ids(unseenAnnouncements(items, undefined)) === "a,b");
  check("già visto sull'account: non torna", ids(unseenAnnouncements(items, seenA)) === "b");
  check(
    "annuncio «sempre»: torna anche se segnato",
    ids(unseenAnnouncements(items, { seen_announcements: ["b"] })) === "a,b",
  );
  check("dati rovinati ignorati", seenAnnouncements({ seen_announcements: "a" }).length === 0);
  check("solo testi nell'elenco", seenAnnouncements({ seen_announcements: ["a", 3, null] }).join() === "a");
  check("primo visto", withSeenAnnouncement({}, "a")?.join() === "a");
  check("si aggiunge in coda", withSeenAnnouncement(seenA, "c")?.join() === "a,c");
  check("già visto: niente da salvare", withSeenAnnouncement(seenA, "a") === null);
  const full = { seen_announcements: Array.from({ length: SEEN_ANNOUNCEMENTS_MAX }, (_, index) => `old${index}`) };
  const capped = withSeenAnnouncement(full, "new") ?? [];
  check("l'elenco resta corto", capped.length === SEEN_ANNOUNCEMENTS_MAX && capped.at(-1) === "new" && !capped.includes("old0"));

  const none = new Set<string>();
  const open = queueAnnouncements([], items, none);
  check("si apre la coda", ids(open) === "a,b");
  check("ricarica della parte comune: quello a video resta", ids(queueAnnouncements(open, [announcement("b", false)], none)) === "a,b");
  check("nessun doppione", queueAnnouncements(open, items, none) === open);
  check("chiuso: non torna nella stessa visita", ids(queueAnnouncements([], items, new Set(["b"]))) === "a");
  check("annuncio nuovo aggiunto in coda", ids(queueAnnouncements(open, [announcement("c")], none)) === "a,b,c");

  return { total, passed: total - failures.length, failures };
}
