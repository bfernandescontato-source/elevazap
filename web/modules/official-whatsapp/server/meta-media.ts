import { supabaseAdmin } from "@/lib/supabase";
import { graphRequest, metaIdentifiers } from "./meta-client";
import { OfficialWhatsAppError } from "./errors";

// A mídia fica privada no bucket "whatsapp-media" (mesma infraestrutura de storage já usada
// pela Disparei). Nunca expomos URL pública — o backend baixa do Supabase Storage e sobe
// direto para a Meta, recebendo um media id de curta duração para usar no envio.
export async function uploadMediaFromStorage(bucket: string, path: string, mimeType: string, fileName: string): Promise<string> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new OfficialWhatsAppError("META_SEND_ERROR", "Não foi possível recuperar o arquivo do storage.");

  const { phoneNumberId } = metaIdentifiers();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", data, fileName);

  const response = await graphRequest(`/${phoneNumberId}/media`, { method: "POST", body: form });
  const mediaId = response?.id as string | undefined;
  if (!mediaId) throw new OfficialWhatsAppError("META_SEND_ERROR", "A Meta não retornou um media id.");
  return mediaId;
}
