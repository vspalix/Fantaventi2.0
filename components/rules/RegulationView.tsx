"use client";

import { useEffect, useState } from "react";
import { parseRegulation } from "@/lib/rules/regulation-blocks";

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
}: {
  leagueId: string;
  markdown?: string;
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
      setError(cause instanceof Error ? cause.message : "Scaricamento non riuscito.");
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="primary" type="button" onClick={() => void download("docx")}>Scarica regolamento (.docx)</button>
        <button className="text-button" type="button" onClick={() => void download("txt")}>Scarica regolamento (.txt)</button>
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
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Regolamento non disponibile.");
      });
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (error) return <p className="banner">{error}</p>;
  if (!document) return <p className="small muted">Carico il regolamento…</p>;

  const when = document.updatedAt
    ? new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(document.updatedAt))
    : null;

  return (
    <section className="card stack">
      <header>
        <h2>Regolamento ufficiale</h2>
        <p>{document.stored && when ? `Testo salvato il ${when}.` : "Testo ufficiale della lega."}</p>
      </header>
      <DownloadRegulation leagueId={leagueId} />
      <RegulationView markdown={document.markdown} />
    </section>
  );
}
