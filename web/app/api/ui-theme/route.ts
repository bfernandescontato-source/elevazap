import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { getAccountUiTheme, UI_THEME_COOKIE } from "@/lib/ui-theme";

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  const theme = await getAccountUiTheme(context.accountId);
  const response = NextResponse.json({ theme });
  response.cookies.set(UI_THEME_COOKIE, theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false });
  return response;
}
