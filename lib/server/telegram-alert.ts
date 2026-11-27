import {
  availabilitySummaryKind,
  availabilityWriteKind,
  kickoffAlertKind,
  unmatchedAlertKind,
  voteAlertKind,
} from "@/lib/server/telegram-decisions";
import { readSystemSettings, type SyncLogEntry } from "@/lib/server/system-settings";

export type TelegramResult = { sent: true; warning?: string } | { sent: false; reason: string };

export function telegramChatIds(raw = process.env.TELEGRAM_CHAT_ID ?? "") {
  return raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

function credentials() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatIds = telegramChatIds();
  if (!token || chatIds.length === 0) return null;
  return { token, chatIds };
}

function romeStamp(now = new Date()) {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(now);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function quiet(reason: string) {
  const safe = reason.includes("://") || reason.includes("api.telegram.org") ? "Invio Telegram non riuscito." : reason.slice(0, 180);
  console.info(`Alert Telegram non inviato: ${safe}`);
}

function safeDetail(value: string) {
  if (value.includes("://") || value.includes("api.telegram.org")) return "Telegram ha rifiutato il messaggio.";
  return value.slice(0, 160);
}

async function postToChat(token: string, chatId: string, text: string) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!response.ok || !body?.ok) {
      const reason = `Chat ${chatId}: ${safeDetail(body?.description || "Telegram ha rifiutato il messaggio.")}`;
      quiet(reason);
      return reason;
    }
    return null;
  } catch {
    const reason = `Chat ${chatId}: invio non riuscito.`;
    quiet(reason);
    return reason;
  }
}

export async function sendTelegramMessage(text: string): Promise<TelegramResult> {
  const keys = credentials();
  if (!keys) {
    quiet("Mancano TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.");
    return { sent: false, reason: "Mancano TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID." };
  }
  const failures = (await Promise.all(keys.chatIds.map((chatId) => postToChat(keys.token, chatId, text)))).filter((reason): reason is string => reason !== null);
  if (failures.length === keys.chatIds.length) {
    return { sent: false, reason: failures.join(" ") };
  }
  if (failures.length > 0) return { sent: true, warning: failures.join(" ") };
  return { sent: true };
}

function jobLabel(job: SyncLogEntry["jobType"]) {
  if (job === "votes") return "Voti";
  if (job === "kickoffs") return "Orari";
  if (job === "reminders") return "Promemoria";
  return "Indisponibili";
}

export type SyncDetail = {
  changed: number;
  samples: string[];
};

function summary(job: SyncLogEntry["jobType"], detail: SyncDetail, now: Date) {
  const lines = [
    "<b>Fantaventi — sync riuscito</b>",
    `Job: ${jobLabel(job)}`,
    `Quando: ${escapeHtml(romeStamp(now))}`,
    `Aggiornati: ${detail.changed}`,
  ];
  for (const sample of detail.samples.slice(0, 5)) lines.push(`• ${escapeHtml(sample)}`);
  return lines.join("\n");
}

async function successEnabled() {
  const settings = await readSystemSettings();
  return settings.notifyOnSyncSuccess;
}

export async function sendSyncTestAlert() {
  const text = [
    "<b>Fantaventi — messaggio di prova</b>",
    "Il canale di allerta dei sync è collegato.",
    `Quando: ${escapeHtml(romeStamp())}`,
  ].join("\n");
  return sendTelegramMessage(text);
}

/** Errore dell'app. `where` e `detail` arrivano già ripuliti da password, chiavi e dati personali. */
export async function alertAppError(input: { where: string; detail: string; repeats: number }, now = new Date()) {
  const lines = [
    "<b>Fantaventi — errore nell'app</b>",
    `Dove: ${escapeHtml(input.where)}`,
    `Cosa: ${escapeHtml(input.detail)}`,
    `Quando: ${escapeHtml(romeStamp(now))} (ora di Roma)`,
    `Ambiente: ${process.env.VERCEL_ENV === "production" ? "sito" : "prova"}`,
  ];
  if (input.repeats > 0) lines.push(`Ripetizioni non inviate dall'avviso precedente: ${input.repeats}`);
  lines.push("Errori uguali: al massimo un avviso all'ora.");
  return sendTelegramMessage(lines.join("\n"));
}

export async function alertVoteSync(entry: SyncLogEntry, force: boolean, now = new Date(), detail?: SyncDetail) {
  try {
    const changed = detail ? detail.changed : null;
    const successOn = entry.status === "success" && changed !== null && changed > 0 ? await successEnabled() : false;
    const base = {
      status: entry.status,
      jobType: entry.jobType,
      recordsWritten: entry.recordsWritten,
      force,
      changed,
      successEnabled: successOn,
    };
    // Le letture dei voti avvisano da sé (vote-engine): qui restano errori e riepiloghi.
    const kind = voteAlertKind({ ...base, morningClosing: false, playedDayStillOpen: false });
    if (kind === "error") {
      await sendTelegramMessage([
        "<b>Fantaventi — sync in errore</b>",
        `Job: ${jobLabel(entry.jobType)}`,
        `Quando: ${escapeHtml(romeStamp(now))}`,
        `Dettaglio: ${escapeHtml(entry.message || "Errore senza dettaglio.")}`,
      ].join("\n"));
      return;
    }
    if (kind === "success" && detail) {
      await sendTelegramMessage(summary(entry.jobType, detail, now));
      return;
    }
  } catch {
    quiet("Controllo allerta non riuscito.");
  }
}

const AVAILABILITY_LABEL: Record<string, string> = {
  injured: "infortunato",
  suspended: "squalificato",
  doubt: "dubbio",
};

export async function alertUnmatchedAvailability(
  rows: { name: string; club: string; status: string }[],
  matchday: number,
) {
  try {
    if (unmatchedAlertKind(rows.length) === "none") return;
    const shown = rows.slice(0, 30).map((row) => {
      const status = AVAILABILITY_LABEL[row.status] ?? row.status;
      return `• ${escapeHtml(row.name)} · ${escapeHtml(row.club)} · ${escapeHtml(status)}`;
    });
    const rest = rows.length > shown.length ? [`… e altri ${rows.length - shown.length}`] : [];
    await sendTelegramMessage([
      "<b>Fantaventi — indisponibili non abbinati</b>",
      `Giornata ${matchday}: ${rows.length} da associare nel Laboratorio.`,
      ...shown,
      ...rest,
    ].join("\n"));
  } catch {
    quiet("Controllo allerta non riuscito.");
  }
}

export async function alertAvailabilityWrites(input: {
  matchday: number;
  written: number;
  changed: number;
  samples: string[];
}) {
  try {
    if (availabilityWriteKind(input.changed) === "none") return;
    const shown = input.samples.slice(0, 5).map((sample) => `• ${escapeHtml(sample)}`);
    await sendTelegramMessage([
      "<b>Fantaventi — indisponibili aggiornati</b>",
      `Giornata ${input.matchday}`,
      `Righe scritte: ${input.written}`,
      `Variate: ${input.changed}`,
      ...shown,
    ].join("\n"));
  } catch {
    quiet("Controllo allerta non riuscito.");
  }
}

export async function alertAvailabilitySync(entry: SyncLogEntry, detail?: SyncDetail, now = new Date()) {
  try {
    const changed = detail?.changed ?? 0;
    const successOn = entry.status === "success" && changed > 0 ? await successEnabled() : false;
    const kind = availabilitySummaryKind({ status: entry.status, changed, successEnabled: successOn });
    if (kind === "error") {
      await sendTelegramMessage([
        "<b>Fantaventi — sync in errore</b>",
        "Job: Indisponibili",
        `Quando: ${escapeHtml(romeStamp(now))}`,
        `Dettaglio: ${escapeHtml(entry.message || "Errore senza dettaglio.")}`,
      ].join("\n"));
      return;
    }
    if (kind === "success" && detail) await sendTelegramMessage(summary("availability", detail, now));
  } catch {
    quiet("Controllo allerta non riuscito.");
  }
}

export async function alertKickoffSync(input: { status: "success" | "error"; message: string; changed: number; samples: string[] }, now = new Date()) {
  try {
    const successOn = input.status === "success" && input.changed > 0 ? await successEnabled() : false;
    const kind = kickoffAlertKind({ status: input.status, changed: input.changed, successEnabled: successOn });
    if (kind === "error") {
      await sendTelegramMessage([
        "<b>Fantaventi — sync in errore</b>",
        "Job: Orari",
        `Quando: ${escapeHtml(romeStamp(now))}`,
        `Dettaglio: ${escapeHtml(input.message || "Errore senza dettaglio.")}`,
      ].join("\n"));
      return;
    }
    if (kind === "success") {
      await sendTelegramMessage(summary("kickoffs", { changed: input.changed, samples: input.samples }, now));
    }
  } catch {
    quiet("Controllo allerta non riuscito.");
  }
}

/** Riepilogo del promemoria formazioni: uno per giornata, solo quando è partito davvero. */
export async function alertLineupReminder(input: {
  gameweek: number;
  closing: string;
  teams: number;
  people: number;
  devices: number;
  late: boolean;
}, now = new Date()) {
  try {
    await sendTelegramMessage([
      "<b>Fantaventi — promemoria formazioni</b>",
      `Giornata ${input.gameweek}, chiude ${escapeHtml(input.closing)}.`,
      `Quando: ${escapeHtml(romeStamp(now))}${input.late ? " (in ritardo: sveglia persa)" : ""}`,
      `Squadre senza formazione: ${input.teams}`,
      `Persone con le notifiche attive: ${input.people}, dispositivi raggiunti: ${input.devices}`,
    ].join("\n"));
  } catch {
    quiet("Riepilogo promemoria non inviato.");
  }
}
