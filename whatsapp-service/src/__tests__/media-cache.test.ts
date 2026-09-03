import { describe, expect, it, vi } from "vitest";
import { MediaCache } from "../utils/media-cache.js";

describe("MediaCache", () => {
  it("baixa uma única vez e reutiliza a mídia para muitos grupos concorrentes", async () => {
    const cache = new MediaCache(1024 * 1024, 60_000);
    const download = vi.fn(async () => Buffer.from("media"));
    const files = await Promise.all(Array.from({ length: 100 }, () => cache.getOrLoad("whatsapp-media:campaign/video.mp4", download)));
    expect(download).toHaveBeenCalledTimes(1);
    expect(files.every((file) => file.equals(files[0]))).toBe(true);
    expect(cache.snapshot()).toMatchObject({ downloads: 1, hits: 99, misses: 1 });
  });

  it("não mantém arquivos além do tempo de vida configurado", async () => {
    let time = 0;
    const cache = new MediaCache(1024, 100, () => time);
    const download = vi.fn(async () => Buffer.from("media"));
    await cache.getOrLoad("offer-media:offer.jpg", download);
    time = 101;
    await cache.getOrLoad("offer-media:offer.jpg", download);
    expect(download).toHaveBeenCalledTimes(2);
  });
});
