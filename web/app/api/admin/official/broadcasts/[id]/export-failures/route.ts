import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { listFailedRecipients } from "@/modules/official-whatsapp/server/broadcasts";

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;

  const failed = await listFailedRecipients(id);
  const lines = ["nome,telefone,erro"];
  for (const recipient of failed) {
    const rowData = recipient.row_data as { name: string | null } | null;
    lines.push([rowData?.name || "", recipient.phone, recipient.error || ""].map(csvEscape).join(","));
  }
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="falhas-${id}.csv"` }
  });
}
