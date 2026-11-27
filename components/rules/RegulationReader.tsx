"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { parseRegulation, type RuleBlock } from "@/lib/rules/regulation-blocks";

type Chapter = { id: string; number: string; title: string; blocks: RuleBlock[]; search: string };

/** Senza maiuscole e accenti, per cercare «capitano» o «gia» senza badare a come è scritto. */
function plain(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("it");
}

function textOf(block: RuleBlock) {
  if (block.type === "ul" || block.type === "ol") return block.items.join(" ");
  if (block.type === "table") return [...block.headers, ...block.rows.flat()].join(" ");
  return block.text;
}

/** Divide il testo in introduzione e capitoli (ogni titolo «##» apre un capitolo). */
function split(markdown: string) {
  const intro: RuleBlock[] = [];
  const chapters: Chapter[] = [];
  for (const block of parseRegulation(markdown)) {
    if (block.type === "h2") {
      const numbered = /^(\d+)[.)]\s*(.+)$/.exec(block.text);
      chapters.push({
        id: chapters.some((chapter) => chapter.id === block.id) ? `${block.id}-${chapters.length}` : block.id,
        number: numbered?.[1] ?? "",
        title: numbered?.[2] ?? block.text,
        blocks: [],
        search: plain(block.text),
      });
      continue;
    }
    const current = chapters[chapters.length - 1];
    if (current) {
      current.blocks.push(block);
      current.search += ` ${plain(textOf(block).replace(/\*\*|`/g, ""))}`;
    } else if (block.type !== "h1") {
      intro.push(block);
    }
  }
  return { intro, chapters };
}

/** Evidenzia le parole cercate, anche quando nel testo hanno un accento. */
function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  // Il confronto è carattere per carattere: le posizioni restano quelle del testo originale.
  const flat = Array.from(text).map((letter) => plain(letter) || letter).join("");
  if (flat.length !== text.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = flat.indexOf(query); at >= 0; at = flat.indexOf(query, from)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + query.length)}</mark>);
    from = at + query.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function Inline({ text, query }: { text: string; query: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}><Marked text={part.slice(2, -2)} query={query} /></strong>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="code-inline"><Marked text={part.slice(1, -1)} query={query} /></code>;
        return <Marked key={index} text={part} query={query} />;
      })}
    </>
  );
}

function pointTone(value: string) {
  const trimmed = value.trim();
  if (/^[+＋]/.test(trimmed)) return "bonus-plus";
  if (/^[-−–]/.test(trimmed)) return "bonus-minus";
  return undefined;
}

function Block({ block, query }: { block: RuleBlock; query: string }) {
  if (block.type === "h1" || block.type === "h2" || block.type === "h3") return <h4><Marked text={block.text} query={query} /></h4>;
  if (block.type === "ul" || block.type === "ol") {
    const List = block.type;
    return (
      <List>
        {block.items.map((item, index) => <li key={index}><Inline text={item} query={query} /></li>)}
      </List>
    );
  }
  if (block.type === "table") {
    return (
      <div className="rg-table">
        <table>
          <thead>
            <tr>{block.headers.map((header, index) => <th key={index}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((value, cellIndex) => (
                  <td key={cellIndex} className={pointTone(value)}><Inline text={value} query={query} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <p><Inline text={block.text} query={query} /></p>;
}

/**
 * Regolamento da leggere: l'indice sono i capitoli stessi, che si aprono al tocco,
 * con la ricerca per trovare subito una regola.
 */
export function RegulationReader({ markdown }: { markdown: string }) {
  const { intro, chapters } = useMemo(() => split(markdown), [markdown]);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<string[]>([]);
  const wanted = plain(query.trim());
  const searching = wanted.length >= 2;
  const shown = searching ? chapters.filter((chapter) => chapter.search.includes(wanted)) : chapters;
  /** Chiusi a mano durante una ricerca. */
  const [folded, setFolded] = useState<string[]>([]);
  const allOpen = chapters.length > 0 && chapters.every((chapter) => opened.includes(chapter.id));

  // Un collegamento diretto a un capitolo (…#bonus-e-malus) lo apre.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && chapters.some((chapter) => chapter.id === id)) {
      setOpened((current) => (current.includes(id) ? current : [...current, id]));
      document.getElementById(id)?.scrollIntoView();
    }
  }, [chapters]);

  function toggle(id: string, open: boolean) {
    const change = (list: string[], include: boolean) => (include
      ? (list.includes(id) ? list : [...list, id])
      : list.filter((item) => item !== id));
    if (searching) setFolded((current) => change(current, !open));
    else setOpened((current) => change(current, open));
  }

  // Un testo senza capitoli (scritto a mano) si mostra per intero.
  if (chapters.length === 0) {
    return (
      <div className="card rg-body">
        {intro.map((block, index) => <Block key={index} block={block} query="" />)}
      </div>
    );
  }

  return (
    <div className="rg">
      <div className="rg-side">
        {intro.length > 0 ? (
          <div className="rg-intro">
            {intro.map((block, index) => <Block key={index} block={block} query="" />)}
          </div>
        ) : null}
        <div className="rg-tools">
          <input
            type="search"
            aria-label="Cerca nel regolamento"
            placeholder="Cerca una regola…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFolded([]);
            }}
          />
          {searching ? (
            <p className="rg-count" role="status">
              {shown.length === 0 ? "Nessun capitolo trovato." : shown.length === 1 ? "1 capitolo" : `${shown.length} capitoli`}
            </p>
          ) : (
            <button className="text-button" type="button" onClick={() => setOpened(allOpen ? [] : chapters.map((chapter) => chapter.id))}>
              {allOpen ? "Chiudi tutto" : "Apri tutto"}
            </button>
          )}
        </div>
      </div>
      <div className="rg-list">
        {shown.map((chapter) => {
          const open = searching ? !folded.includes(chapter.id) : opened.includes(chapter.id);
          return (
            <section className="rg-chapter" id={chapter.id} key={chapter.id} data-open={open}>
              <h3>
                <button type="button" aria-expanded={open} aria-controls={`${chapter.id}-testo`} onClick={() => toggle(chapter.id, !open)}>
                  {chapter.number ? <span className="rg-number">{chapter.number}</span> : null}
                  <span className="rg-title"><Marked text={chapter.title} query={searching ? wanted : ""} /></span>
                  <span className="rg-arrow" aria-hidden="true">›</span>
                </button>
              </h3>
              {open ? (
                <div className="rg-body" id={`${chapter.id}-testo`}>
                  {chapter.blocks.map((block, index) => <Block key={index} block={block} query={searching ? wanted : ""} />)}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
