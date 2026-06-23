import axios from "axios";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { supabase } from "../supabase.js";

export async function downloadMedia(bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error("Não foi possível assinar download de mídia.");
  const response = await axios.get<ArrayBuffer>(data.signedUrl, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

export async function convertVoiceToOpus(input: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "elevazap-"));
  const inFile = join(dir, "input");
  const outFile = join(dir, "voice.ogg");
  try {
    await writeFile(inFile, input);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-y", "-i", inFile, "-c:a", "libopus", "-b:a", "32k", outFile]);
      ff.on("exit", (code) => code === 0 ? resolve() : reject(new Error("Falha ao converter áudio de voz.")));
      ff.on("error", reject);
    });
    return await readFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function buildBaileysMessage(item: any, media?: Buffer, mentions: string[] = []) {
  const caption = item.legenda || item.texto || undefined;
  if (item.tipo === "texto") return { text: item.texto || "", mentions };
  if (!media) throw new Error("Mídia ausente.");
  if (item.tipo === "imagem") return { image: media, caption, mentions };
  if (item.tipo === "video") return { video: media, caption, mentions };
  if (item.tipo === "audio") return { audio: media, mimetype: item.mime_type || "audio/mpeg" };
  if (item.tipo === "audio_voz") return { audio: media, mimetype: "audio/ogg; codecs=opus", ptt: true };
  return { document: media, mimetype: item.mime_type || "application/octet-stream", fileName: item.file_name || "documento" };
}
