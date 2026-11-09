import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SuiteStamp } from "@/lib/system-health";

const file = path.join(process.cwd(), "data", "engine-suite-last.json");

type SuiteBook = { ci: SuiteStamp | null; admin: SuiteStamp | null };

function emptyBook(): SuiteBook {
  return { ci: null, admin: null };
}

function readBook(): SuiteBook {
  try {
    if (!existsSync(file)) return emptyBook();
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SuiteBook>;
    return { ci: parsed.ci ?? null, admin: parsed.admin ?? null };
  } catch {
    return emptyBook();
  }
}

export function writeSuiteStamp(stamp: SuiteStamp) {
  const book = readBook();
  book[stamp.source] = stamp;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(book));
  } catch {
    return book;
  }
  return book;
}

export function readSuiteBook(): SuiteBook {
  return readBook();
}
