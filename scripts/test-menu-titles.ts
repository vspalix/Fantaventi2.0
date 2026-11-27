// Il titolo di una pagina è la voce di menu che ci porta: chi cambia l'uno cambia anche l'altra.
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ADMIN_GROUPS, ADMIN_HOME } from "../lib/admin-area";

type Case = { name: string; pass: boolean; detail: string };

/** Dove sta il titolo, quando non è scritto nella pagina stessa. */
const TITLE_ELSEWHERE: Record<string, string> = {
  "/admin/laboratorio/colori": "components/admin/BadgeDesk.tsx",
};

/** Voci del menu del giocatore e file con il titolo della pagina che aprono. */
const PLAYER_PAGES: [string, string][] = [
  ["Formazione", "components/leagues/LeagueHub.tsx"],
  ["Regolamento", "components/leagues/LeagueHub.tsx"],
  ["Leghe", "components/leagues/LeaguesHeader.tsx"],
  ["Albo d&apos;oro", "app/albo/page.tsx"],
  ["Account", "app/account/page.tsx"],
];

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function headings(source: string) {
  return [...source.matchAll(/<h1[^>]*>([^<{]+)<\/h1>/g)].map((match) => match[1].trim());
}

export function runMenuTitleChecks() {
  const cases: Case[] = [];
  const add = (name: string, pass: boolean, detail: string) => cases.push({ name, pass, detail });

  for (const section of [ADMIN_HOME, ...ADMIN_GROUPS.flatMap((group) => group.sections)]) {
    const file = TITLE_ELSEWHERE[section.href] ?? `app${section.href}/page.tsx`;
    const found = headings(read(file));
    add(
      `Admin «${section.label}»: stesso titolo nella pagina`,
      found.length > 0 && found.every((title) => title === section.label),
      found.join(", ") || "titolo non trovato",
    );
  }

  const header = read("components/SiteHeader.tsx");
  for (const [label, file] of PLAYER_PAGES) {
    const inMenu = header.includes(`>${label}</Link>`);
    const inPage = headings(read(file)).includes(label);
    add(`Menu «${label.replace("&apos;", "'")}»: stesso titolo nella pagina`, inMenu && inPage, `menu ${inMenu}, pagina ${inPage}`);
  }
  const hub = read("components/leagues/LeagueHub.tsx");
  add(
    "Menu «Impostazioni lega»: stesso titolo nella pagina",
    header.includes(">Impostazioni lega</Link>") && hub.includes('shownTab === "lega" ? "Impostazioni lega"'),
    "titolo non trovato",
  );

  const failures = cases.filter((item) => !item.pass).map((item) => `${item.name}: ${item.detail}`);
  return { passed: cases.length - failures.length, total: cases.length, failures, cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runMenuTitleChecks();
  for (const failure of result.failures) console.log(`- ${failure}`);
  console.log(`Titoli come il menu: ${result.passed}/${result.total}`);
  if (result.failures.length > 0) process.exit(1);
}
