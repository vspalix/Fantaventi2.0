import { NextResponse } from "next/server";
import { assertServiceEnv } from "@/lib/server/catalog";
import { assertExportMarkdown, loadRegulation } from "@/lib/server/regulation";
import { errorMessage, errorStatus, requireSessionUser } from "@/lib/server/session";
import { regulationPlainText } from "@/lib/rules/regulation-blocks";
import { attachmentHeader, regulationDocx, regulationFileName } from "@/lib/rules/regulation-export";

type RouteContext = { params: Promise<{ leagueId: string }> };

function formatOf(request: Request) {
  const format = new URL(request.url).searchParams.get("format");
  return format === "docx" ? "docx" : "txt";
}

async function fileResponse(leagueName: string, markdown: string, format: "txt" | "docx") {
  const fileName = regulationFileName(leagueName, format);
  if (format === "txt") {
    return new NextResponse(regulationPlainText(markdown), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": attachmentHeader(fileName),
      },
    });
  }
  const buffer = await regulationDocx(markdown);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": attachmentHeader(fileName),
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const document = await loadRegulation(user.id, leagueId);
    return fileResponse(document.leagueName, document.markdown, formatOf(request));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertServiceEnv();
    const user = await requireSessionUser();
    const { leagueId } = await context.params;
    const document = await loadRegulation(user.id, leagueId);
    const body = (await request.json()) as { markdown?: string };
    const markdown = typeof body.markdown === "string" ? assertExportMarkdown(body.markdown) : document.markdown;
    return fileResponse(document.leagueName, markdown, formatOf(request));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
  }
}
