import { inspectVoteSyncWindow, playedDayStillOpen } from "@/lib/server/vote-sync-window";
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

export async function alertVoteSync(entry: SyncLogEntry, force: boolean, now = new Date(), detail?: SyncDetail) {
  try {
    if (entry.status === "error") {
      await sendTelegramMessage([
        "<b>Fantaventi — sync in errore</b>",
        `Job: ${jobLabel(entry.jobType)}`,
        `Quando: ${escapeHtml(romeStamp(now))}`,
        `Dettaglio: ${escapeHtml(entry.message || "Errore senza dettaglio.")}`,
      ].join("\n"));
      return;
    }
    if (entry.status === "success" && detail && detail.changed > 0 && await successEnabled()) {
      await sendTelegramMessage(summary(entry.jobType, detail, now));
      return;
    }
    if (force || entry.jobType !== "votes" || entry.status !== "success" || entry.recordsWritten !== 0) return;
    const gate = await inspectVoteSyncWindow(now);
    if (!gate.closing) return;
    if (!(await playedDayStillOpen(now))) return;
    await sendTelegramMessage([
      "<b>Fantaventi — finestra mattutina vuota</b>",
      "Job: Voti",
      `Quando: ${escapeHtml(romeStamp(now))}`,
      "La finestra mattutina si è chiusa senza voti scritti, ma ci sono ancora partite della giornata da calcolare.",
    ].join("\n"));
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
    if (rows.length === 0) return;
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
    if (input.changed <= 0) return;
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
    if (entry.status === "error") {
      await sendTelegramMessage([
        "<b>Fantaventi — sync in errore</b>",
        "Job: Indisponibili",
        `Quando: ${escapeHtml(romeStamp(now))}`,
        `Dettaglio: ${escapeHtml(entry.message || "Errore senza dettaglio.")}`,
      ].join("\n"));
      return;
    }
    if (entry.status !== "success" || !detail || detail.changed <= 0) return;
    if (!(await successEnabled())) return;
    await sendTelegramMessage(summary("availability", detail, now));
  } catch {
    quiet("Controllo allerta non riuscito.");
  }
}

export async function alertKickoffSync(input: { status: "success" | "error"; message: string; changed: number; samples: string[] }, now = new Date()) {
  try {
    if (input.status === "error") {
      await sendTelegramMessage([
        "<b>Fantaventi — sync in errore</b>",
        "Job: Orari",
        `Quando: ${escapeHtml(romeStamp(now))}`,
        `Dettaglio: ${escapeHtml(input.message || "Errore senza dettaglio.")}`,
      ].join("\n"));
      return;
    }
    if (input.changed <= 0) return;
    if (!(await successEnabled())) return;
    await sendTelegramMessage(summary("kickoffs", { changed: input.changed, samples: input.samples }, now));
  } catch {
    quiet("Controllo allerta non riuscito.");
  }
}
