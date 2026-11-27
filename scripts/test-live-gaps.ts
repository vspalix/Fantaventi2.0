import { parseFantacalcioIndisponibili } from "@/lib/availability-providers/fantacalcio";
import { matchAvailability, type KnownPlayer } from "@/lib/availability-providers/match";
import { apiFootballFailure } from "@/lib/availability-providers/api-football";
import { cronSecretAccepted, hostViewAllowed, leagueActor } from "@/lib/server/access-policy";
import { runAvailabilitySync } from "@/lib/server/availability";
import type { AvailabilitySettings } from "@/lib/server/availability";
import { deliverAvailabilityNotices, reconcileAutomaticRows } from "@/lib/server/availability-plan";
import { sendTelegramMessage } from "@/lib/server/telegram-alert";

type Case = { name: string; pass: boolean; detail: string };

const SETTINGS: AvailabilitySettings = {
  provider: "fantacalcio",
  leagueId: 135,
  season: 2026,
  jsonUrl: "",
  lastSyncAt: null,
  lastSyncNote: null,
  unmatched: [],
  aliases: [],
};

function card(club: string, injured: string[] = [], suspended: string[] = [], doubts: string[] = []) {
  const list = (title: string, names: string[]) => {
    const items = names.length
      ? names.map((name) => `<li><strong class="item-name">${name}</strong></li>`).join("")
      : `<li><div class="empty-list-message">Nessuno</div></li>`;
    return `<h3>${title}</h3><ul class="unstyled">${items}</ul>`;
  };
  return `<div id="team-1" class="card team-card"><span class="team-name">${club}</span>${list("Infortunati", injured)}${list("Squalificati", suspended)}${list("Diffidati", doubts)}</div>`;
}

function page(cards: string[]) {
  return cards.join("");
}

function pad(first: string) {
  const rest = Array.from({ length: 17 }, (_, index) => card(`Club ${index}`));
  return page([first, ...rest]);
}

function known(): KnownPlayer[] {
  return [
    { id: "juan", fullName: "Miranda J.", clubCode: "bologna", clubName: "Bologna" },
    { id: "other", fullName: "Miranda A.", clubCode: "bologna", clubName: "Bologna" },
    { id: "rossi-m", fullName: "Marco Rossi", clubCode: "milan", clubName: "Milan" },
    { id: "rossi-r", fullName: "Gianluca Rossi", clubCode: "roma", clubName: "Roma" },
    { id: "kone", fullName: "Kone", clubCode: "sassuolo", clubName: "Sassuolo" },
    { id: "diaz", fullName: "Brahim Diaz", clubCode: "fiorentina", clubName: "Fiorentina" },
  ];
}

function headers(values: Record<string, string>) {
  return new Headers(values);
}

export async function runLiveGapChecks() {
  const cases: Case[] = [];
  const add = (name: string, pass: boolean, detail: string) => cases.push({ name, pass, detail });

  const compound = parseFantacalcioIndisponibili(pad(card("Napoli", ["André-Frank Zambo Anguissa", "D&#237;az"])));
  add(
    "Nomi composti e accenti numerici restano nel parser",
    compound.some((item) => item.name === "André-Frank Zambo Anguissa" && item.status === "injured")
      && compound.some((item) => item.name === "Díaz"),
    compound.map((item) => item.name).join(", "),
  );
  const spaced = parseFantacalcioIndisponibili(pad(card("  Bologna  ", ["Miranda"])));
  add("Il nome squadra con spazi resta Bologna", spaced.some((item) => item.club === "Bologna" && item.name === "Miranda"), spaced.map((item) => item.club).join(", "));

  let missingClub = "";
  try {
    parseFantacalcioIndisponibili(pad(`<div id="team-1" class="card team-card"><h3>Infortunati</h3><h3>Squalificati</h3>`));
    missingClub = "non ha lanciato";
  } catch (error) {
    missingClub = error instanceof Error ? error.message : "errore";
  }
  add("Una card senza squadra non aggiorna", missingClub.includes("Nessun aggiornamento"), missingClub);

  let onlyDoubts = "";
  try {
    parseFantacalcioIndisponibili(pad(`<div id="team-1" class="card team-card"><span class="team-name">Lecce</span><h3>Diffidati</h3><ul class="unstyled"><li><strong class="item-name">Veiga</strong></li></ul></div>`));
    onlyDoubts = "non ha lanciato";
  } catch (error) {
    onlyDoubts = error instanceof Error ? error.message : "errore";
  }
  add("Solo la sezione diffidati non aggiorna", onlyDoubts.includes("Nessun aggiornamento"), onlyDoubts);

  let truncated = "";
  try {
    const bare = Array.from({ length: 18 }, (_, index) => `<div id="team-${index}" class="card team-card"><span class="team-name">Club ${index}</span><h3>Infortunati</h3><ul class="unstyled"></ul><h3>Squalificati</h3><ul class="unstyled"></ul></div>`).join("");
    parseFantacalcioIndisponibili(bare);
    truncated = "non ha lanciato";
  } catch (error) {
    truncated = error instanceof Error ? error.message : "errore";
  }
  add("HTML senza elenchi né messaggio vuoto non aggiorna", truncated.includes("Nessun aggiornamento"), truncated);

  const players = known();
  const kone = matchAvailability([{ name: "Konè", club: "Sassuolo", status: "injured", playProbability: null, reason: null }], players, []);
  add("Konè accentato trova l'unico Kone del Sassuolo", kone.matched[0]?.playerId === "kone" && kone.unmatched.length === 0, kone.matched.map((item) => item.playerId).join(","));

  const compoundSurname = matchAvailability([{ name: "Juan Miranda González", club: "Bologna", status: "injured", playProbability: null, reason: null }], players, []);
  add("Il cognome composto non si attacca a Miranda", compoundSurname.unmatched.length === 1, compoundSurname.matched.map((item) => item.playerId).join(",") || "non abbinato");

  const homonyms = matchAvailability([{ name: "Rossi", club: "", status: "injured", playProbability: null, reason: null }], players, []);
  add("Due Rossi senza club restano non abbinati", homonyms.unmatched.length === 1 && homonyms.matched.length === 0, `matched ${homonyms.matched.length}`);

  const milan = matchAvailability([{ name: "Rossi", club: "Milan", status: "suspended", playProbability: null, reason: null }], players, []);
  add("Il club sceglie l'omonimo giusto", milan.matched[0]?.playerId === "rossi-m", milan.matched.map((item) => item.playerId).join(","));

  const alias = matchAvailability(
    [{ name: "Miranda", club: "Bologna", status: "injured", playProbability: null, reason: null }],
    players,
    [{ name: "Miranda", club: "Bologna", playerId: "juan" }],
  );
  add("L'alias sceglie Juan tra i due Miranda", alias.matched[0]?.playerId === "juan", alias.matched.map((item) => item.playerId).join(","));

  const gone = matchAvailability(
    [{ name: "Miranda", club: "Bologna", status: "injured", playProbability: null, reason: null }],
    players,
    [{ name: "Miranda", club: "Bologna", playerId: "uscito" }],
  );
  add("Un alias verso un id fuori listone non abbina", gone.matched.length === 0 && gone.unmatched.length === 1, `matched ${gone.matched.length}`);

  const moved = matchAvailability(
    [{ name: "Miranda", club: "Bologna", status: "injured", playProbability: null, reason: null }],
    players.map((player) => player.id === "juan" ? { ...player, clubCode: "milan", clubName: "Milan" } : player),
    [{ name: "Miranda", club: "Bologna", playerId: "juan" }],
  );
  add("Se l'id è ancora nel listone l'alias resta valido anche dopo un cambio club", moved.matched[0]?.playerId === "juan", moved.matched.map((item) => item.playerId).join(","));

  const wrongClub = matchAvailability(
    [{ name: "Miranda", club: "Milan", status: "injured", playProbability: null, reason: null }],
    players,
    [{ name: "Miranda", club: "Bologna", playerId: "juan" }],
  );
  add("L'alias di Bologna non vale per un Miranda del Milan", wrongClub.matched.length === 0, `matched ${wrongClub.matched.length}`);

  const diaz = matchAvailability([{ name: "Díaz", club: "Fiorentina", status: "injured", playProbability: null, reason: null }], players, []);
  add("Díaz e Diaz sono lo stesso cognome", diaz.matched[0]?.playerId === "diaz", diaz.matched.map((item) => item.playerId).join(","));

  const listed: KnownPlayer[] = [
    { id: "davis", fullName: "Davis K.", clubCode: "udinese", clubName: "Udinese" },
    { id: "pellegrini-lo", fullName: "Pellegrini Lo.", clubCode: "roma", clubName: "Roma" },
    { id: "pellegrini-lu", fullName: "Pellegrini Lu.", clubCode: "lazio", clubName: "Lazio" },
    { id: "azzouzi", fullName: "El Azzouzi O.", clubCode: "bologna", clubName: "Bologna" },
    { id: "kone-i", fullName: "Konè I.", clubCode: "sassuolo", clubName: "Sassuolo" },
    { id: "kone-m", fullName: "Konè M.", clubCode: "roma", clubName: "Roma" },
    { id: "martinez-l", fullName: "Martinez L.", clubCode: "inter", clubName: "Inter" },
    { id: "martinez-jo", fullName: "Martinez Jo.", clubCode: "inter", clubName: "Inter" },
    { id: "verdi", fullName: "Verdi", clubCode: "como", clubName: "Como" },
    { id: "verdi-s", fullName: "Verdi S.", clubCode: "como", clubName: "Como" },
    { id: "bianchi", fullName: "Neri L.", clubCode: "torino", clubName: "Torino" },
  ];
  const pick = (name: string, club: string) => matchAvailability(
    [{ name, club, status: "injured", playProbability: null, reason: null }],
    listed,
    [],
  ).matched[0]?.playerId ?? "non abbinato";
  const expect = (title: string, name: string, club: string, playerId: string) => {
    const got = pick(name, club);
    add(title, got === playerId, got);
  };
  expect("Davis si abbina a Davis K. del suo club", "Davis", "Udinese", "davis");
  expect("Pellegrini della Roma è Lo.", "Pellegrini", "Roma", "pellegrini-lo");
  expect("Pellegrini della Lazio è Lu.", "Pellegrini", "Lazio", "pellegrini-lu");
  expect("Cognome in due parole con iniziale", "El Azzouzi", "Bologna", "azzouzi");
  expect("Konè sceglie quello del club", "Konè", "Sassuolo", "kone-i");
  expect("Due Martinez nello stesso club restano da scegliere", "Martinez", "Inter", "non abbinato");
  expect("L'iniziale della fonte distingue due omonimi", "Martinez L.", "Inter", "martinez-l");
  expect("Il cognome senza iniziale ha la precedenza", "Verdi", "Como", "verdi");
  expect("Con l'iniziale non vale un altro club", "Davis", "Roma", "non abbinato");
  expect("Un'iniziale non si scambia per cognome", "Rossi L.", "Torino", "non abbinato");
  expect("Senza club un nome con iniziale in listone resta da scegliere", "Davis", "", "non abbinato");

  add("API-Football con errors non è una lista vuota", (apiFootballFailure({ plan: "season not covered" }) ?? "").includes("plan"), apiFootballFailure({ plan: "season not covered" }) ?? "vuoto");
  add("API-Football senza errors non è un fallimento", apiFootballFailure(null) === null && apiFootballFailure({}) === null, "null");

  const future = Date.parse("2026-11-25T12:00:00.000Z");
  const started = Date.parse("2026-11-27T20:00:00.000Z");
  const calls = { load: 0, commit: 0, opened: 0 };
  const harness = (ready = true, provider: AvailabilitySettings["provider"] = "fantacalcio", load: () => Promise<{ name: string; club: string; status: "injured"; playProbability: null; reason: null }[] | never> = async () => []) => ({
    read: async () => ({ ready, settings: { ...SETTINGS, provider } }),
    open: async () => {
      calls.opened += 1;
      return { seasonId: "season", open: { number: 13, deadlineAt: "2026-11-27T19:44:00.000Z", status: "open" } };
    },
    load: async () => {
      calls.load += 1;
      return load();
    },
    commit: async (_settings: AvailabilitySettings, _seasonId: string, _open: { number: number }, rows: unknown[]) => {
      calls.commit += 1;
      return { skipped: false as const, reason: `righe ${Array.isArray(rows) ? rows.length : -1}`, matchday: 13, written: 0, unmatched: 0, changed: 0, samples: [] as string[] };
    },
  });

  calls.load = 0;
  calls.commit = 0;
  calls.opened = 0;
  const skipped = await runAvailabilitySync(false, harness(), started);
  add("Dopo la deadline, senza force, non chiama il provider", skipped.skipped && skipped.reason.includes("già partita") && calls.load === 0, `${skipped.reason} load ${calls.load}`);

  calls.load = 0;
  const forced = await runAvailabilitySync(true, harness(), started);
  add("Il force chiama il provider anche a deadline passata", forced.skipped === false && calls.load === 1 && calls.commit === 1, `load ${calls.load}`);

  calls.load = 0;
  calls.commit = 0;
  const manual = await runAvailabilitySync(false, harness(true, "manual"), future);
  add("Il provider manuale non fa chiamate esterne", manual.skipped && calls.load === 0, manual.reason ?? "");

  calls.opened = 0;
  let missing = "";
  try {
    await runAvailabilitySync(false, harness(false), future);
  } catch (error) {
    missing = error instanceof Error ? error.message : "errore";
  }
  add("Senza tabella il sync fallisce prima di aprire la giornata", missing.includes("player_availability") && calls.opened === 0, `${missing} open ${calls.opened}`);

  calls.commit = 0;
  let providerError = "";
  try {
    await runAvailabilitySync(false, harness(true, "fantacalcio", async () => {
      throw new Error("Pagina indisponibili non raggiungibile. Nessun aggiornamento.");
    }), future);
  } catch (error) {
    providerError = error instanceof Error ? error.message : "errore";
  }
  add("Una pagina anomala non scrive e non viene trattata come successo", providerError.includes("Nessun aggiornamento") && calls.commit === 0, providerError);

  let emptyCount = -1;
  await runAvailabilitySync(false, {
    ...harness(),
    commit: async (_settings, _season, _open, rows) => {
      emptyCount = rows.length;
      return { skipped: false as const, reason: "vuoto", matchday: 13, written: 0, unmatched: 0, changed: 0, samples: [] };
    },
  }, future);
  add("Una risposta vuota arriva al commit come zero righe", emptyCount === 0, String(emptyCount));

  const same = reconcileAutomaticRows({
    matched: [{ playerId: "juan", status: "injured", playProbability: null }],
    existing: [{ playerId: "juan", sourceProvider: "fantacalcio", status: "injured", playProbability: null }],
  });
  add("Una riga identica non è una variazione reale", same.changed === 0 && same.stale.length === 0 && same.written === 1, `changed ${same.changed}`);

  const changed = reconcileAutomaticRows({
    matched: [{ playerId: "juan", status: "suspended", playProbability: null }],
    existing: [{ playerId: "juan", sourceProvider: "fantacalcio", status: "injured", playProbability: null }],
  });
  add("Un cambio di stato è una variazione", changed.changed === 1 && changed.changedIds[0] === "juan", `changed ${changed.changed}`);

  const wiped = reconcileAutomaticRows({
    matched: [],
    existing: [
      { playerId: "juan", sourceProvider: "fantacalcio", status: "injured", playProbability: null },
      { playerId: "manual", sourceProvider: "manual", status: "suspended", playProbability: null },
    ],
  });
  add("Una lista vuota toglie solo le righe automatiche e tiene quelle manuali", wiped.stale.join(",") === "juan" && wiped.written === 0, wiped.stale.join(","));

  let noticed = false;
  await deliverAvailabilityNotices(async () => {
    throw new Error("timeout");
  });
  noticed = true;
  add("Un timeout di Telegram non fa fallire la consegna", noticed, "consegnato");

  const previousFetch = globalThis.fetch;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "token-di-prova";
  process.env.TELEGRAM_CHAT_ID = "1";
  globalThis.fetch = () => Promise.reject(new DOMException("The operation was aborted", "AbortError"));
  let telegram = "";
  try {
    const sent = await sendTelegramMessage("controllo");
    telegram = sent.sent ? "inviato" : sent.reason;
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = previousChat;
  }
  add("L'invio abortito restituisce un rifiuto senza il token", telegram.includes("non riuscito") && !telegram.includes("token-di-prova"), telegram);

  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  const missingEnv = await sendTelegramMessage("controllo");
  if (previousToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = previousToken;
  if (previousChat !== undefined) process.env.TELEGRAM_CHAT_ID = previousChat;
  add("Senza variabili Telegram il messaggio non parte e non lancia", missingEnv.sent === false, missingEnv.sent ? "inviato" : missingEnv.reason);

  const secret = "segreto-di-prova";
  add("Il Bearer del cron è accettato", cronSecretAccepted(headers({ authorization: "Bearer segreto-di-prova" }), secret), "bearer");
  add("Anche x-cron-secret è accettato", cronSecretAccepted(headers({ "x-cron-secret": secret }), secret), "header");
  add("Un segreto sbagliato è rifiutato", !cronSecretAccepted(headers({ authorization: "Bearer altro" }), secret), "rifiuto");
  add("Senza segreto configurato il cron è chiuso", !cronSecretAccepted(headers({ authorization: "Bearer segreto-di-prova" }), undefined), "chiuso");

  const member = leagueActor({ userId: "member", ownerId: "owner", delegateIds: ["delegate"], isMember: true, platformAdmin: false });
  const delegate = leagueActor({ userId: "delegate", ownerId: "owner", delegateIds: ["delegate"], isMember: true, platformAdmin: false });
  const owner = leagueActor({ userId: "owner", ownerId: "owner", delegateIds: [], isMember: true, platformAdmin: false });
  const outsider = leagueActor({ userId: "altro", ownerId: "owner", delegateIds: [], isMember: false, platformAdmin: false });
  const platform = leagueActor({ userId: "super", ownerId: "owner", delegateIds: [], isMember: false, platformAdmin: true });
  add("Il partecipante entra e non modifica la lega né il Laboratorio", member.canEnter && !member.canEditLeague && !member.canOpenLaboratorio && !member.canSwitchHost, "member");
  add("L'admin delegato modifica la lega e non apre il Laboratorio", delegate.canEditLeague && !delegate.canOpenLaboratorio, "delegate");
  add("Il proprietario modifica la lega e non ha lo switch globale", owner.canEditLeague && !owner.canSwitchHost, "owner");
  add("Chi è fuori dalla lega non entra", !outsider.canEnter && !outsider.canEditLeague, "outsider");
  add("Il super admin entra, apre il Laboratorio e può passare ad Admin", platform.canEnter && platform.canOpenLaboratorio && platform.canSwitchHost && platform.canEditLeague, "super");
  add("Lo switch Admin è negato a un admin di lega", !hostViewAllowed(false, "host") && hostViewAllowed(true, "host") && hostViewAllowed(false, "player"), "vista");

  return {
    passed: cases.filter((item) => item.pass).length,
    total: cases.length,
    failures: cases.filter((item) => !item.pass).map((item) => `FAIL ${item.name}: ${item.detail}`),
  };
}
