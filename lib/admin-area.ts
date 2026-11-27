// Area superadmin: sezioni del menu e lega scelta. Usato sia dal server sia dal browser.

/** Cookie con la lega scelta nel selettore; assente = «Tutte le leghe». Non dà permessi. */
export const ADMIN_LEAGUE_COOKIE = "fv-admin-league";

export type AdminScope = "global" | "league";
export type AdminSection = { href: string; label: string; hint: string };
export type AdminGroup = { title: string; scope: AdminScope; sections: AdminSection[] };

export const ADMIN_HOME: AdminSection = { href: "/admin", label: "Panoramica", hint: "Stato dell'app in un colpo d'occhio" };

export const ADMIN_GROUPS: AdminGroup[] = [
  {
    title: "Giornata",
    scope: "global",
    sections: [
      { href: "/admin/giornata", label: "Giornata in corso", hint: "Partite, punteggi, rinvii" },
      { href: "/admin/import-voti", label: "Voti", hint: "Carica e correggi" },
      { href: "/admin/laboratorio/sincronizzazioni", label: "Letture e sveglie", hint: "Fonti e orari" },
      { href: "/admin/laboratorio/indisponibili", label: "Indisponibili", hint: "Infortuni, squalifiche" },
    ],
  },
  {
    title: "Leghe",
    scope: "league",
    sections: [
      { href: "/admin/formazioni", label: "Formazioni", hint: "Chi ha consegnato" },
      { href: "/admin/leghe", label: "Impostazioni della lega", hint: "Admin, riapertura" },
      { href: "/admin/rules-editor", label: "Regolamento", hint: "Testo ufficiale" },
    ],
  },
  {
    title: "Persone",
    scope: "global",
    sections: [
      { href: "/admin/utenti", label: "Utenti", hint: "Account e ruoli" },
      { href: "/admin/registro", label: "Registro azioni", hint: "Chi ha fatto cosa" },
    ],
  },
  {
    title: "Calciatori",
    scope: "global",
    sections: [
      { href: "/admin/import-listone", label: "Importa listone", hint: "Quotazioni" },
      { href: "/admin/listone-view", label: "Listone caricato", hint: "Club e ruoli" },
    ],
  },
  {
    title: "Comunicazione",
    scope: "global",
    sections: [
      { href: "/admin/notifiche", label: "Notifiche", hint: "Messaggi e avvisi" },
      { href: "/admin/comunicazioni", label: "Comunicazioni", hint: "Messaggio a tutti" },
      { href: "/admin/annunci", label: "Annunci", hint: "All'apertura dell'app" },
      { href: "/admin/news", label: "News", hint: "Avvisi in home" },
      { href: "/admin/promo", label: "Banner", hint: "Immagine nella dashboard" },
      { href: "/admin/sponsor", label: "Sponsor", hint: "Striscia dei loghi" },
    ],
  },
  {
    title: "Sistema",
    scope: "global",
    sections: [
      { href: "/admin/laboratorio/diagnostica", label: "Diagnostica", hint: "Ultimi giri e anomalie" },
      { href: "/admin/laboratorio", label: "Collaudo", hint: "Prove e manutenzione" },
      { href: "/admin/laboratorio/colori", label: "Colori sociali", hint: "Colori e loghi dei club" },
      { href: "/admin/laboratorio/brand", label: "Brand e grafica", hint: "Logo, icone, accento" },
    ],
  },
];
