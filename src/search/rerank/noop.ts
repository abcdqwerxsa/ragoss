/** Pluggable rerank hook. v1: identity (council decision — no rerank in v1, multimodal contract only). */
import type { RerankProvider, RetrievalHit } from "../../core/types.js";

export const noopReranker: RerankProvider = {
  name: "noop",
  async rerank(_query: string, hits: RetrievalHit[]): Promise<RetrievalHit[]> {
    return hits;
  },
};
