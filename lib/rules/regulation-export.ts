import {
  Document,
  type FileChild,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseRegulation } from "@/lib/rules/regulation-blocks";

function runs(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    const bold = part.startsWith("**") && part.endsWith("**");
    return new TextRun({ text: bold ? part.slice(2, -2) : part, bold });
  });
}

function cell(text: string, header = false) {
  return new TableCell({
    width: { size: 3000, type: WidthType.DXA },
    children: [new Paragraph({ children: runs(header ? `**${text}**` : text) })],
  });
}

export async function regulationDocx(markdown: string) {
  const children: FileChild[] = [];
  for (const block of parseRegulation(markdown)) {
    if (block.type === "h1") children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runs(block.text) }));
    else if (block.type === "h2") children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(block.text) }));
    else if (block.type === "h3") children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(block.text) }));
    else if (block.type === "ul") {
      for (const item of block.items) children.push(new Paragraph({ bullet: { level: 0 }, children: runs(item) }));
    } else if (block.type === "ol") {
      block.items.forEach((item, itemIndex) => {
        children.push(new Paragraph({ children: runs(`${itemIndex + 1}. ${item}`) }));
      });
    } else if (block.type === "table") {
      const rows = [
        new TableRow({ children: block.headers.map((header) => cell(header, true)), tableHeader: true }),
        ...block.rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) })),
      ];
      children.push(new Table({ rows, width: { size: 9360, type: WidthType.DXA } }));
    } else children.push(new Paragraph({ spacing: { after: 160 }, children: runs(block.text) }));
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

export function regulationFileName(leagueName: string, extension: "txt" | "docx") {
  const slug = leagueName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "regolamento";
  return `regolamento-${slug}.${extension}`;
}

export function attachmentHeader(fileName: string) {
  const ascii = fileName.replace(/[^\w.-]+/g, "-");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
