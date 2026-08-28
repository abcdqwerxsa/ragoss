/** DashScope multimodal embedding (one-peace / qwen family; supports text/image/audio/video). */
import type { EmbeddingConfig } from "../core/config.js";
import { resolveSecret } from "../core/config.js";
import type { EmbeddingInput, EmbeddingProvider } from "../core/types.js";

interface DashscopeResponse {
  output?: { embeddings?: { index: number; vector: number[] }[] };
  code?: string;
  message?: string;
}

export function createDashscopeEmbedding(cfg: EmbeddingConfig): EmbeddingProvider {
  const base = cfg.baseUrl ?? "https://dashscope.aliyuncs.com/api/v1";
  const key = resolveSecret(cfg.apiKey);
  const dims = cfg.dims ?? 1024;

  return {
    name: cfg.name,
    dims,

    async embed(input: EmbeddingInput): Promise<number[]> {
      const content: Record<string, string> = {};
      if (input.text !== undefined) content.text = input.text;
      if (input.image) content.image = `data:${input.image.mime};base64,${input.image.dataBase64}`;
      if (input.audio) content.audio = `data:${input.audio.mime};base64,${input.audio.dataBase64}`;
      if (input.video) content.video = `data:${input.video.mime};base64,${input.video.dataBase64}`;
      if (Object.keys(content).length === 0) throw new Error("empty embedding input");

      const res = await fetch(
        `${base}/services/embeddings/multimodal-embedding/multimodal-embedding`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.model, input: { contents: [content] } }),
        },
      );
      const body = (await res.json()) as DashscopeResponse;
      if (!res.ok || !body.output?.embeddings?.[0]) {
        throw new Error(`dashscope embed failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
      }
      return body.output.embeddings[0]!.vector;
    },
  };
}
