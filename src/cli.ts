/** CLI: `pnpm index` (build index), `pnpm ask -- "question"` (terminal QA). */
import { loadConfig } from "./core/config.js";
import { openDb } from "./db.js";
import { buildEmbeddings } from "./embedding/index.js";
import { dbPath, pullDbIfMissing } from "./index/dbsync.js";
import { runIndex } from "./index/pipeline.js";
import { askWithSources, createQaProvider } from "./qa/index.js";
import { retrieve } from "./search/retrieve.js";
import { buildStorages } from "./storage/index.js";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  const storages = buildStorages(cfg);
  const embeddings = buildEmbeddings(cfg);

  if (cmd === "index") {
    const db = openDb(dbPath(cfg));
    const report = await runIndex(cfg, storages, embeddings, db, { full: rest.includes("--full") });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (cmd === "ask") {
    const query = rest.filter((a) => !a.startsWith("--")).join(" ");
    if (!query) throw new Error("usage: pnpm ask -- \"question\"");
    await pullDbIfMissing(cfg, storages);
    const db = openDb(dbPath(cfg));
    const hits = await retrieve(db, embeddings, query, {}, {
      topK: cfg.retrieval?.topK,
      finalK: cfg.retrieval?.finalK,
    });
    const qa = createQaProvider(cfg.qa);
    const result = await askWithSources(qa, storages, query, hits, cfg.qa.maxSources);
    console.log(result.answer);
    console.log("\n来源:");
    for (const s of result.sources) console.log(` [${s.n}] ${s.storage}://${s.key}`);
    return;
  }

  throw new Error("usage: ragoss <index [--full] | ask -- \"question\">  (or `pnpm dev` for the server)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
