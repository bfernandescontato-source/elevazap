import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { reportPostSchema } from "@/modules/comunidade/schemas";
import { addReport } from "@/modules/comunidade/server/service";
import { serverError } from "@/shared/http/responses";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = reportPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Denúncia inválida." }, { status: 400 });
  const { id } = await params;
  try {
    await addReport(context.database, context.accountId, context.session.userId!, id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Object && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Você já denunciou esta publicação." }, { status: 409 });
    }
    return serverError(error, "Não foi possível enviar a denúncia.");
  }
}
