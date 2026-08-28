/** Reciprocal Rank Fusion over multiple embedding routes (rank-based, score-scale free). */
import type { RetrievalHit } from "../core/types.js";

export function rrf(rankings: RetrievalHit[][], k = 60): RetrievalHit[] {
  const scores = new Map<string, { hit: RetrievalHit; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((hit, rank) => {
      const id = `${hit.chunk.storage}\u0000${hit.chunk.key}\u0000${hit.chunk.ordinal}`;
      const s = 1 / (k + rank + 1);
      const prev = scores.get(id);
      if (prev) prev.score += s;
      else scores.set(id, { hit, score: s });
    });
  }
  return [...scores.values()]
    .map(({ hit, score }) => ({ ...hit, score, route: "rrf" }))
    .sort((a, b) => b.score - a.score);
}
