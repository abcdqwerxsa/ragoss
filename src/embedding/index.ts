/** Build embedding providers from config. */
import type { Config, EmbeddingConfig } from "../core/config.js";
import { Registry } from "../core/registry.js";
import type { EmbeddingProvider } from "../core/types.js";
import { createDashscopeEmbedding } from "./dashscope.js";
import { createGoogleEmbedding } from "./google.js";

const registry = new Registry<EmbeddingConfig, EmbeddingProvider>();
registry.register("dashscope", createDashscopeEmbedding);
registry.register("google", createGoogleEmbedding);

export function buildEmbeddings(cfg: Config): EmbeddingProvider[] {
  return cfg.embeddings.map((e) => registry.build(e.provider, e));
}
