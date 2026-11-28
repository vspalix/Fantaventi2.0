// Area superadmin: sezioni del menu, barra in basso e lega scelta. Usato sia dal server sia dal browser.

/** Cookie con la lega scelta nel selettore; assente = «Tutte le leghe». Non dà permessi. */
export const ADMIN_LEAGUE_COOKIE = "fv-admin-league";

export type AdminScope = "global" | "league";
export type AdminSection = { href: string; label: string; hint: string };
export type AdminGroup = { title: string; scope: AdminScope; sections: AdminSection[] };

export const ADMIN_HOME: AdminSection = { href: "/admin", label: "Dashboard", hint: "Cosa sta succedendo" };
export const ADMIN_MENU: AdminSection = { href: "/admin/menu", label: "Menu", hint: "Tutte le sezioni" };

const MATCHDAY: AdminGroup = {
  title: "Giornata",
  scope: "global",
  sections: [
    { href: "/admin/giornata", label: "Giornata", hint: "Partite, punteggi, rinvii" },
    { href: "/admin/import-voti", label: "Voti", hint: "Carica e correggi" },
    { href: "/admin/laboratorio/sincronizzazioni", label: "Letture e sveglie", hint: "Fonti e orari" },
    { href: "/admin/laboratorio/indisponibili", label: "Indisponibili", hint: "Infortuni, squalifiche" },
  ],
};

const MESSAGES: AdminGroup = {
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
};

export const ADMIN_GROUPS: AdminGroup[] = [
  MATCHDAY,
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
  MESSAGES,
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

/** Le sezioni che seguono la lega scelta: solo lì compare il selettore. */
export const LEAGUE_PAGES = ADMIN_GROUPS.filter((group) => group.scope === "league").flatMap((group) => group.sections.map((section) => section.href));

export type AdminTab = AdminSection & { /** Pagine che tengono accesa la voce. */ owns: string[] };

const hrefs = (group: AdminGroup) => group.sections.map((section) => section.href);

/** La barra in basso dell'area admin. Ogni voce porta il nome della pagina che apre. */
export const ADMIN_TABS: AdminTab[] = [
  { ...ADMIN_HOME, owns: [ADMIN_HOME.href] },
  { ...MATCHDAY.sections[0], owns: hrefs(MATCHDAY) },
  { href: "/admin/utenti", label: "Utenti", hint: "Account e ruoli", owns: ["/admin/utenti"] },
  { ...MESSAGES.sections[0], owns: hrefs(MESSAGES) },
  { ...ADMIN_MENU, owns: [ADMIN_MENU.href] },
];

/** Tutto quello che non ha una voce sua sta sotto «Menu». */
export function activeAdminTab(pathname: string) {
  return ADMIN_TABS.find((tab) => tab.owns.includes(pathname))?.href ?? ADMIN_MENU.href;
}
