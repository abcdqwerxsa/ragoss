/** Golden eval: hit@k over labeled queries. Usage: pnpm eval -- [--k 1,3,10]
 * golden.json: [{ "query": "...", "expected": ["storageName://path/key", ...] }]  (>= 30 entries recommended) */
import { loadConfig } from "../src/core/config.js";
import { openDb } from "../src/db.js";
import { buildEmbeddings } from "../src/embedding/index.js";
import { dbPath, pullDbIfMissing } from "../src/index/dbsync.js";
import { retrieve } from "../src/search/retrieve.js";
import { buildStorages } from "../src/storage/index.js";
import { readFileSync } from "node:fs";

function hitAt(hits: { storage: string; key: string }[], expected: Set<string>, k: number): boolean {
  return hits.slice(0, k).some((h) => expected.has(`${h.storage}://${h.key}`));
}

async function main() {
  const args = process.argv.slice(2);
  const ks = (args.find((a) => a.startsWith("--k"))?.split("=")[1] ?? "1,3,10")
    .split(",")
    .map(Number);
  const finalK = Math.max(...ks);

  const cfg = loadConfig();
  const storages = buildStorages(cfg);
  const embeddings = buildEmbeddings(cfg);
  await pullDbIfMissing(cfg, storages);
  const db = openDb(dbPath(cfg));

  const golden = JSON.parse(readFileSync("eval/golden.json", "utf8")) as {
    query: string;
    expected: string[];
  }[];
  if (golden.length < 30) console.warn(`warn: only ${golden.length} golden queries (target >=30)`);

  const hitsByK = new Map<number, number>();
  let done = 0;
  for (const g of golden) {
    const hits = await retrieve(db, embeddings, g.query, {}, { topK: 20, finalK });
    const expected = new Set(g.expected);
    for (const k of ks) if (hitAt(hits.map((h) => h.chunk), expected, k)) hitsByK.set(k, (hitsByK.get(k) ?? 0) + 1);
    done++;
    console.log(`[${done}/${golden.length}] ${g.query}`);
  }

  console.log("\n=== hit@k ===");
  for (const k of ks) {
    const n = hitsByK.get(k) ?? 0;
    console.log(`hit@${k}: ${n}/${golden.length} = ${(n / golden.length).toFixed(2)}`);
  }
  console.log("(baseline for future rerank trigger: eval shows retrieval-noise-dominated misses at small k)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
