"use client";

import { useEffect, useState } from "react";
import { RegulationReader } from "@/components/rules/RegulationReader";
import { parseRegulation } from "@/lib/rules/regulation-blocks";
import { readableError } from "@/lib/feedback";

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="code-inline">{part.slice(1, -1)}</code>;
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function pointClass(value: string) {
  const trimmed = value.trim();
  if (/^[+＋]/.test(trimmed)) return "bonus-plus";
  if (/^[-−–]/.test(trimmed)) return "bonus-minus";
  return undefined;
}

export function RegulationView({ markdown }: { markdown: string }) {
  const blocks = parseRegulation(markdown);
  const chapters = blocks.flatMap((block) => (block.type === "h2" ? [block] : []));
  return (
    <div className="rule-layout">
      <nav className="rule-index" aria-label="Indice del regolamento">
        <strong>Indice</strong>
        {chapters.map((chapter) => (
          <a key={chapter.id} href={`#${chapter.id}`}>{chapter.text}</a>
        ))}
      </nav>
      <article className="rule-doc">
        {blocks.map((block, index) => {
          if (block.type === "h1") return <h2 key={index}>{block.text}</h2>;
          if (block.type === "h2") return <h3 key={index} id={block.id}>{block.text}</h3>;
          if (block.type === "h3") return <h4 key={index} id={block.id}>{block.text}</h4>;
          if (block.type === "ul" || block.type === "ol") {
            const List = block.type === "ul" ? "ul" : "ol";
            return (
              <List key={index}>
                {block.items.map((item) => <li key={item}><Inline text={item} /></li>)}
              </List>
            );
          }
          if (block.type === "table") {
            return (
              <table key={index} className="standings">
                <thead>
                  <tr>{block.headers.map((header) => <th key={header}>{header}</th>)}</tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={row.join("|")}>
                      {row.map((value, cellIndex) => (
                        <td key={`${value}-${cellIndex}`} className={pointClass(value)}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
          if (block.type === "p") return <p key={index}><Inline text={block.text} /></p>;
          return null;
        })}
      </article>
    </div>
  );
}

export function DownloadRegulation({
  leagueId,
  markdown,
  quiet = false,
}: {
  leagueId: string;
  markdown?: string;
  /** Due pulsanti secondari uguali, per quando scaricare non è l'azione principale. */
  quiet?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  async function download(format: "txt" | "docx") {
    setError(null);
    const href = `/api/leagues/${leagueId}/regulation/export?format=${format}`;
    try {
      const response = markdown === undefined
        ? await fetch(href)
        : await fetch(href, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown }),
        });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Scaricamento non riuscito.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const named = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "");
      link.href = url;
      link.download = named?.[1] ?? `regolamento.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(readableError(cause, "Scaricamento non riuscito."));
    }
  }

  return (
    <div className="stack">
      <div className={quiet ? "rg-download" : "row"}>
        <button className={quiet ? "ghost" : "primary"} type="button" onClick={() => void download("docx")}>{quiet ? "Word (.docx)" : "Scarica regolamento (.docx)"}</button>
        <button className={quiet ? "ghost" : "text-button"} type="button" onClick={() => void download("txt")}>{quiet ? "Testo (.txt)" : "Scarica regolamento (.txt)"}</button>
      </div>
      {error ? <p className="banner">{error}</p> : null}
    </div>
  );
}

type LoadedRegulation = {
  markdown: string;
  officialMarkdown: string;
  stored: boolean;
  schemaReady: boolean;
  updatedAt: string | null;
  canEdit: boolean;
};

export function RegulationPanel({ leagueId }: { leagueId: string }) {
  const [document, setDocument] = useState<LoadedRegulation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/leagues/${leagueId}/regulation`)
      .then(async (response) => {
        const payload = (await response.json()) as LoadedRegulation & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Regolamento non disponibile.");
        if (!cancelled) setDocument(payload);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(readableError(cause, "Regolamento non disponibile."));
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (error) return <p className="banner">{error}</p>;
  if (!document) {
    return (
      <div className="stack rg-page" role="status" aria-label="Carico il regolamento">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  const when = document.updatedAt
    ? new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(document.updatedAt))
    : null;

  return (
    <div className="rg-page">
      {document.stored && when ? <p className="rg-saved">Testo salvato il {when}.</p> : null}
      <RegulationReader markdown={document.markdown} />
      <section className="card rg-foot">
        <h2>Scarica il regolamento</h2>
        <DownloadRegulation leagueId={leagueId} quiet />
      </section>
    </div>
  );
}
