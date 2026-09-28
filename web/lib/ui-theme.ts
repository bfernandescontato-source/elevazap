import { supabaseAdmin } from "./supabase";
import { UI_THEMES, type UiTheme } from "./ui-theme-shared";

export { UI_THEME_COOKIE, UI_THEMES, type UiTheme } from "./ui-theme-shared";

export async function getAccountUiTheme(accountId: string): Promise<UiTheme> {
  const { data } = await supabaseAdmin().from("accounts").select("ui_theme").eq("id", accountId).maybeSingle();
  return UI_THEMES.includes(data?.ui_theme) ? data!.ui_theme : "classic";
}
