import ExcelJS from "exceljs";

export type SheetGrid = {
  name: string;
  rows: (string | number | null)[][];
};

function plain(value: ExcelJS.CellValue): string | number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") {
      const text = value.text.trim();
      if ("result" in value && text === "") return plain(value.result as ExcelJS.CellValue);
      return text;
    }
    if ("result" in value) return plain(value.result as ExcelJS.CellValue);
  }
  return String(value).trim();
}

export async function readWorkbook(buffer: Buffer): Promise<SheetGrid[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook.worksheets.map((sheet) => {
    const rows: (string | number | null)[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      let last = 0;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const column = Number(cell.col);
        if (column > last) last = column;
      });
      if (last === 0) return;
      const line: (string | number | null)[] = [];
      for (let column = 1; column <= last; column += 1) {
        line.push(plain(row.getCell(column).value));
      }
      rows.push(line);
    });
    return { name: sheet.name.trim(), rows };
  });
}

export function cellText(value: string | number | null | undefined) {
  if (value == null) return "";
  return String(value).trim();
}

export function headerKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "");
}

export function requireBytes(source: { bytes?: Buffer }, label: string) {
  if (!source.bytes || source.bytes.length === 0) {
    throw new Error(`${label} legge un file .xlsx.`);
  }
  return source.bytes;
}
