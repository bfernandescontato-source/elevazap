import { NextRequest } from "next/server";
import { transitionLote } from "@/lib/lote-transition";

export async function POST(request: NextRequest) {
  return transitionLote(request, "pause");
}
