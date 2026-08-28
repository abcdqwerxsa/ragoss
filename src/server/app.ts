/** ragoss HTTP server: /health, /index, /search, /ask. */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "../core/config.js";
import { openDb, countVectors } from "../db.js";
import { buildEmbeddings } from "../embedding/index.js";
import { dbPath, pullDbIfMissing } from "../index/dbsync.js";
import { runIndex } from "../index/pipeline.js";
import { createQaProvider, askWithSources } from "../qa/index.js";
import { retrieve } from "../search/retrieve.js";
import { buildStorages } from "../storage/index.js";
import type { RetrievalFilter } from "../core/types.js";

export interface AppContext {
  app: Hono;
  storages: ReturnType<typeof buildStorages>;
  embeddings: ReturnType<typeof buildEmbeddings>;
}

export async function createApp(): Promise<AppContext> {
  const cfg = loadConfig();
  const storages = buildStorages(cfg);
  const embeddings = buildEmbeddings(cfg);
  const qa = createQaProvider(cfg.qa);

  await pullDbIfMissing(cfg, storages);
  const db = openDb(dbPath(cfg));

  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, vectors: countVectors(db), routes: embeddings.map((e) => e.name) }),
  );

  app.post("/index", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const report = await runIndex(cfg, storages, embeddings, db, { full: body?.full === true });
    return c.json(report);
  });

  app.post("/search", async (c) => {
    const body = await c.req.json();
    if (!body?.query) return c.json({ error: "query required" }, 400);
    const hits = await retrieve(db, embeddings, String(body.query), toFilter(body.filter), {
      topK: num(body.topK),
      finalK: num(body.finalK),
    });
    return c.json({
      hits: hits.map((h) => ({
        storage: h.chunk.storage,
        key: h.chunk.key,
        kind: h.chunk.kind,
        score: h.score,
        route: h.route,
        textPreview: h.chunk.text.slice(0, 200),
      })),
    });
  });

  app.post("/ask", async (c) => {
    const body = await c.req.json();
    if (!body?.query) return c.json({ error: "query required" }, 400);
    const hits = await retrieve(db, embeddings, String(body.query), toFilter(body.filter), {
      topK: cfg.retrieval?.topK,
      finalK: cfg.retrieval?.finalK,
    });
    const result = await askWithSources(qa, storages, String(body.query), hits, cfg.qa.maxSources);
    return c.json(result);
  });

  return { app, storages, embeddings };
}

function toFilter(f: unknown): RetrievalFilter {
  const o = (f ?? {}) as Record<string, unknown>;
  const out: RetrievalFilter = {};
  if (typeof o.storage === "string") out.storage = o.storage;
  if (typeof o.mimePrefix === "string") out.mimePrefix = o.mimePrefix;
  if (typeof o.pathPrefix === "string") out.pathPrefix = o.pathPrefix;
  if (typeof o.since === "string") out.since = o.since;
  return out;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && v > 0 ? v : undefined;
}

if (process.argv[1]?.endsWith("app.ts")) {
  createApp()
    .then(({ app }) => {
      const port = Number(process.env.PORT ?? 8787);
      serve({ fetch: app.fetch, port }, (info) => console.log(`ragoss listening on :${info.port}`));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
