import https from "node:https";
import type { AvailabilityProvider, AvailabilityStatus, ExternalAvailability } from "@/lib/availability-providers/types";

export const FANTACALCIO_INDISPONIBILI_URL = "https://www.fantacalcio.it/indisponibili-serie-a";

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: "\"",
  apos: "'",
  agrave: "à",
  egrave: "è",
  eacute: "é",
  igrave: "ì",
  ograve: "ò",
  ugrave: "ù",
};

function decode(value: string) {
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+);/gi, (all, name: string) => ENTITIES[name.toLowerCase()] ?? all)
    .replace(/&#x([0-9a-f]+);/gi, (all, code: string) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : all;
    })
    .replace(/&#(\d+);/g, (all, code: string) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : all;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function listedName(value: string) {
  const parts = value.replace(/\./g, " ").split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 1].length <= 2) parts.pop();
  return parts.join(" ");
}

function namesIn(section: string, club: string, status: AvailabilityStatus): ExternalAvailability[] {
  const lists = section.match(/<ul class="unstyled">[\s\S]*?<\/ul>/gi) ?? [];
  const rows: ExternalAvailability[] = [];
  for (const list of lists) {
    const items = list.match(/<li\b[\s\S]*?<\/li>/gi) ?? [];
    for (const item of items) {
      const raw = decode(item.match(/class="item-name">([^<]+)/i)?.[1] ?? "");
      const name = listedName(raw);
      if (!name || /^nessuno$/i.test(name)) continue;
      const reason = decode(item.match(/class="item-description">([\s\S]*?)<\/div>/i)?.[1] ?? "");
      rows.push({
        name,
        club,
        status,
        playProbability: null,
        reason: reason ? reason.slice(0, 240) : null,
      });
    }
  }
  return rows;
}

export function parseFantacalcioIndisponibili(html: string): ExternalAvailability[] {
  const cards = html.split(/<div id="team-\d+" class="card team-card">/i).slice(1);
  if (cards.length < 18) {
    throw new Error("Pagina indisponibili senza l'elenco delle squadre. Nessun aggiornamento.");
  }
  const rows: ExternalAvailability[] = [];
  for (const card of cards) {
    const club = decode(card.match(/<span class="team-name">([^<]+)/i)?.[1] ?? "");
    if (!club) throw new Error("Pagina indisponibili senza il nome di una squadra. Nessun aggiornamento.");
    const injuredAt = card.search(/Infortunati/i);
    const suspendedAt = card.search(/Squalificati/i);
    if (injuredAt < 0 || suspendedAt < injuredAt) {
      throw new Error("Pagina indisponibili senza le sezioni attese. Nessun aggiornamento.");
    }
    const doubtAt = card.search(/Diffidati/i);
    const suspendedEnd = doubtAt > suspendedAt ? doubtAt : card.length;
    rows.push(...namesIn(card.slice(injuredAt, suspendedAt), club, "injured"));
    rows.push(...namesIn(card.slice(suspendedAt, suspendedEnd), club, "suspended"));
  }
  if (!html.includes("item-name") && !html.includes("empty-list-message")) {
    throw new Error("Pagina indisponibili senza calciatori. Nessun aggiornamento.");
  }
  return rows;
}

const PAGE_HEADERS = {
  Accept: "text/html",
  "Accept-Language": "it-IT,it;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

function readPage(url: string, redirects = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: PAGE_HEADERS }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 3) {
        response.resume();
        const next = new URL(location, url).toString();
        if (!next.startsWith("https://www.fantacalcio.it/")) {
          reject(new Error("redirect"));
          return;
        }
        readPage(next, redirects + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error("timeout"));
    });
    request.on("error", () => reject(new Error("network")));
  });
}

export const fantacalcioAvailabilityProvider: AvailabilityProvider = {
  id: "fantacalcio",
  async load() {
    let failure = "Pagina indisponibili non raggiungibile. Nessun aggiornamento.";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const page = await readPage(FANTACALCIO_INDISPONIBILI_URL);
        if (page.status < 200 || page.status >= 300) {
          failure = `Pagina indisponibili ha risposto ${page.status}. Nessun aggiornamento.`;
          continue;
        }
        return parseFantacalcioIndisponibili(page.body);
      } catch {
        failure = "Pagina indisponibili non raggiungibile. Nessun aggiornamento.";
      }
    }
    throw new Error(failure);
  },
};
