export type RuleBlock =
  | { type: "h1"; id: string; text: string }
  | { type: "h2"; id: string; text: string }
  | { type: "h3"; id: string; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

export function chapterId(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isDivider(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

export function parseRegulation(markdown: string): RuleBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: RuleBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const depth = heading[1].length;
      const text = heading[2];
      blocks.push({
        type: depth === 1 ? "h1" : depth === 2 ? "h2" : "h3",
        id: chapterId(text),
        text,
      });
      index += 1;
      continue;
    }
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        tableLines.push((lines[index] ?? "").trim());
        index += 1;
      }
      const content = tableLines.filter((row) => !isDivider(row));
      const headers = cells(content[0] ?? "");
      const rows = content.slice(1).map(cells);
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("- ")) {
        items.push((lines[index] ?? "").trim().slice(2));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = (lines[index] ?? "").trim();
      if (!next || next.startsWith("#") || next.startsWith("|") || next.startsWith("- ") || /^\d+\.\s+/.test(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return blocks;
}

export function regulationPlainText(markdown: string) {
  return parseRegulation(markdown).map((block) => {
    if (block.type === "h1") return block.text.toUpperCase();
    if (block.type === "h2" || block.type === "h3") return block.text;
    if (block.type === "ul") return block.items.map((item) => `• ${item.replace(/\*\*/g, "")}`).join("\n");
    if (block.type === "ol") return block.items.map((item, itemIndex) => `${itemIndex + 1}. ${item.replace(/\*\*/g, "")}`).join("\n");
    if (block.type === "table") {
      const head = block.headers.join("\t");
      const body = block.rows.map((row) => row.join("\t")).join("\n");
      return `${head}\n${body}`;
    }
    return block.text.replace(/\*\*/g, "");
  }).join("\n\n");
}
