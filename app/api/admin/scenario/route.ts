import { NextResponse } from "next/server";
import { readWorkbook } from "@/lib/adapters/excel/workbook";
import { parseScenarioGrid, parseScenarioText } from "@/lib/scenario/script";
import { assertServiceEnv } from "@/lib/server/catalog";
import { requireSuperAdmin } from "@/lib/server/platform-role";
import { runScenario } from "@/lib/server/scenario-runner";
import { errorMessage, errorStatus } from "@/lib/server/session";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertServiceEnv();
    await requireSuperAdmin();
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Allega un file JSON, CSV o Excel." }, { status: 400 });
      }
      const name = file.name || "scenario";
      const lower = name.toLowerCase();
      const script = lower.endsWith(".xlsx") || lower.endsWith(".xls")
        ? parseScenarioGrid(name, (await readWorkbook(Buffer.from(await file.arrayBuffer())))[0]?.rows ?? [])
        : parseScenarioText(name, await file.text());
      const report = await runScenario(script);
      return NextResponse.json(report, { status: report.passed ? 200 : 409 });
    }
    const body = (await request.json()) as { text?: string; fileName?: string; name?: string; steps?: unknown };
    const script = body.steps
      ? parseScenarioText(body.fileName || "scenario.json", JSON.stringify({ name: body.name, steps: body.steps }))
      : parseScenarioText(body.fileName || "scenario.json", body.text ?? "");
    const report = await runScenario(script);
    return NextResponse.json(report, { status: report.passed ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
