/** Retrieval: embed query per route -> brute-force top-k per route -> RRF -> filter -> rerank hook. */
import type { Db } from "../db.js";
import { scanVectors } from "../db.js";
import type { EmbeddingProvider, RetrievalFilter, RetrievalHit, RerankProvider } from "../core/types.js";
import { rrf } from "./rrf.js";
import { noopReranker } from "./rerank/noop.js";

export interface RetrieveOpts {
  topK?: number | undefined;
  finalK?: number | undefined;
  reranker?: RerankProvider | undefined;
}

export async function retrieve(
  db: Db,
  embeddings: EmbeddingProvider[],
  query: string,
  filter: RetrievalFilter = {},
  opts: RetrieveOpts = {},
): Promise<RetrievalHit[]> {
  const topK = opts.topK ?? 20;
  const finalK = opts.finalK ?? 6;

  const rankings: RetrievalHit[][] = [];
  const failures: string[] = [];
  for (const emb of embeddings) {
    try {
      const qvec = new Float32Array(await emb.embed({ text: query }));
      const rows = scanVectors(db, emb.name, filter);
      const scored = rows
        .map((r) => ({
          chunk: { storage: r.storage, key: r.key, ordinal: r.ordinal, kind: r.kind, text: r.text },
          score: dot(qvec, r.vec),
          route: emb.name,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      if (scored.length > 0) rankings.push(scored);
    } catch (e) {
      failures.push(`${emb.name}: ${String(e).slice(0, 200)}`);
    }
  }
  // empty index (all routes scanned zero rows) is not an error; provider failures are
  if (rankings.length === 0) {
    if (failures.length === 0) return [];
    throw new Error(`all embedding routes failed: ${failures.join(" | ")}`);
  }

  const fused = rrf(rankings).slice(0, finalK);
  const reranker = opts.reranker ?? noopReranker;
  return reranker.rerank(query, fused);
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
