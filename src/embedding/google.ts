/** Google (Gemini API) embedding — text and image via inlineData. */
import type { EmbeddingConfig } from "../core/config.js";
import { resolveSecret } from "../core/config.js";
import type { EmbeddingInput, EmbeddingProvider } from "../core/types.js";

interface GoogleEmbedResponse {
  embedding?: { values: number[] };
  error?: { message: string };
}

export function createGoogleEmbedding(cfg: EmbeddingConfig): EmbeddingProvider {
  const base = (cfg.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const key = resolveSecret(cfg.apiKey);
  const dims = cfg.dims ?? 3072;

  return {
    name: cfg.name,
    dims,

    async embed(input: EmbeddingInput): Promise<number[]> {
      const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
      if (input.text !== undefined) parts.push({ text: input.text });
      if (input.image)
        parts.push({ inlineData: { mimeType: input.image.mime, data: input.image.dataBase64 } });
      // ponytail: Gemini embedContent has no audio/video; degrade to filename text if provided
      if (input.audio || input.video)
        throw new Error(`google embedding does not support ${input.audio ? "audio" : "video"} (use dashscope route)`);

      const res = await fetch(`${base}/models/${cfg.model}:embedContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts },
          ...(cfg.dims ? { outputDimensionality: cfg.dims } : {}),
        }),
      });
      const body = (await res.json()) as GoogleEmbedResponse;
      if (!res.ok || !body.embedding?.values) {
        throw new Error(`google embed failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
      }
      return body.embedding.values;
    },
  };
}
