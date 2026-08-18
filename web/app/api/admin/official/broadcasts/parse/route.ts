import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { parseSpreadsheetFile } from "@/modules/official-whatsapp/server/spreadsheet";

// Nunca grava o arquivo em disco/Storage — parseia o upload em memória e descarta.
export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_broadcast_parse_ip");
  if (guard) return guard;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Envie um arquivo .csv ou .xlsx." }, { status: 400 });
  if (!/\.(csv|xlsx)$/i.test(file.name)) return NextResponse.json({ error: "Formato não suportado. Use .csv ou .xlsx." }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { headers, rows } = await parseSpreadsheetFile(buffer, file.name);
    return NextResponse.json({ headers, rows, totalRows: rows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao ler o arquivo." }, { status: 400 });
  }
}
