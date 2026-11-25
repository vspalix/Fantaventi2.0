const HUB_TABS = ["home", "live", "bacheca", "squadre", "formazione", "formazioni", "classifica", "risultati", "pagelle", "regolamento", "lega", "gestione"] as const;

export type HubTab = (typeof HUB_TABS)[number];

export const LEAGUE_TAB_EVENT = "fv-league-tab";

export function isHubTab(value: string | undefined): value is HubTab {
  return Boolean(value && (HUB_TABS as readonly string[]).includes(value));
}
