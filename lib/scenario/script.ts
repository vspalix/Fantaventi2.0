import { isScenarioAction } from "@/lib/scenario/registry";

export const SANDBOX_WEEK_BASE = 800;
export const SANDBOX_WEEK_SPAN = 20;

export type ScenarioStep = {
  action: string;
  as?: string;
  params: Record<string, unknown>;
  expectError?: string;
};

export type ScenarioScript = {
  name: string;
  steps: ScenarioStep[];
};

export type ScenarioStepReport = {
  index: number;
  action: string;
  passed: boolean;
  detail: string;
};

export type ScenarioReport = {
  name: string;
  passed: boolean;
  steps: ScenarioStepReport[];
  narrative: string;
  sandboxRemoved: boolean;
};

export function sandboxWeek(scriptWeek: number) {
  if (!Number.isInteger(scriptWeek) || scriptWeek < 1 || scriptWeek > SANDBOX_WEEK_SPAN) {
    throw new Error(`La giornata di scenario deve essere tra 1 e ${SANDBOX_WEEK_SPAN}.`);
  }
  return SANDBOX_WEEK_BASE + scriptWeek;
}

function coerce(value: string) {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function rowToStep(raw: Record<string, unknown>, line: number): ScenarioStep | null {
  const action = String(raw.action ?? "").trim().toUpperCase();
  if (!action || action.startsWith("#")) return null;
  const params: Record<string, unknown> = {};
  if (raw.params && typeof raw.params === "object" && !Array.isArray(raw.params)) {
    Object.assign(params, raw.params as Record<string, unknown>);
  } else if (typeof raw.params === "string" && raw.params.trim()) {
    const parsed = JSON.parse(raw.params) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Riga ${line}: params deve essere un oggetto.`);
    }
    Object.assign(params, parsed as Record<string, unknown>);
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key === "action" || key === "as" || key === "params" || key === "expectError" || key === "expect_error") continue;
    if (value == null || value === "") continue;
    params[key] = value;
  }
  const asValue = raw.as == null ? "" : String(raw.as).trim();
  const expect = raw.expectError ?? raw.expect_error;
  if (!isScenarioAction(action)) {
    throw new Error(`Riga ${line}: azione ${action} fuori dal dizionario. Si aggiunge in lib/scenario/registry.ts.`);
  }
  return {
    action,
    as: asValue || undefined,
    params,
    expectError: expect == null || String(expect).trim() === "" ? undefined : String(expect),
  };
}

export function parseScenarioDocument(value: unknown, fallbackName = "Scenario"): ScenarioScript {
  const source = Array.isArray(value) ? { steps: value } : value;
  if (!source || typeof source !== "object") throw new Error("Lo script deve essere un oggetto o un elenco di passi.");
  const record = source as { name?: unknown; steps?: unknown };
  const steps = record.steps;
  if (!Array.isArray(steps)) throw new Error("Manca l'elenco steps.");
  const parsed = steps.flatMap((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`Passo ${index + 1}: serve un oggetto.`);
    }
    const ready = rowToStep(step as Record<string, unknown>, index + 1);
    return ready ? [ready] : [];
  });
  if (parsed.length === 0) throw new Error("Lo script non contiene passi.");
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : fallbackName;
  return { name, steps: parsed };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char ?? "";
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char ?? "";
  }
  row.push(cell);
  if (row.some((item) => item.trim() !== "")) rows.push(row);
  return rows;
}

export function parseScenarioGrid(fileName: string, rows: (string | number | null)[][]): ScenarioScript {
  const header = (rows[0] ?? []).map((cell) => String(cell ?? "").trim());
  if (!header.includes("action")) throw new Error("Il foglio deve avere la colonna action.");
  const records = rows.slice(1).map((line) => {
    const record: Record<string, unknown> = {};
    header.forEach((key, index) => {
      if (!key) return;
      const value = line[index];
      record[key] = typeof value === "number" ? value : coerce(String(value ?? ""));
    });
    return record;
  });
  return parseScenarioDocument({ name: fileName.replace(/\.[^.]+$/, ""), steps: records }, fileName);
}

export function parseScenarioText(fileName: string, text: string): ScenarioScript {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Il file è vuoto.");
  if (fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseScenarioDocument(JSON.parse(trimmed) as unknown, fileName.replace(/\.json$/i, ""));
  }
  return parseScenarioGrid(fileName, parseCsv(trimmed));
}

export function scenarioNarrative(report: Pick<ScenarioReport, "name" | "steps" | "sandboxRemoved">) {
  const passed = report.steps.filter((step) => step.passed);
  const failed = report.steps.filter((step) => !step.passed);
  const lines = [
    `${report.name}: ${report.steps.length} passi, ${passed.length} andati bene, ${failed.length} no.`,
  ];
  if (passed.length > 0) {
    lines.push(`Andato bene: ${passed.map((step) => `${step.index}. ${step.action}`).join(", ")}.`);
  }
  if (failed.length > 0) {
    lines.push("Non andato:");
    for (const step of failed) lines.push(`- ${step.index}. ${step.action}: ${step.detail}`);
  } else {
    lines.push("Nessun passo è fallito.");
  }
  lines.push(report.sandboxRemoved ? "La sandbox è stata rimossa." : "La sandbox è ancora sul database.");
  return lines.join("\n");
}
