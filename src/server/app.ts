/** ragoss HTTP server: /health, /index, /search, /ask + admin panel (config hot-reload). */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig, type Config } from "../core/config.js";
import { countVectors } from "../db.js";
import { runIndex } from "../index/pipeline.js";
import { askWithSources } from "../qa/index.js";
import { retrieve } from "../search/retrieve.js";
import type { RetrievalFilter } from "../core/types.js";
import { buildRuntime, type Runtime } from "./runtime.js";
import { mountAdmin } from "./admin.js";

export async function createApp(): Promise<{ app: Hono; runtime: Runtime }> {
  let rt = await buildRuntime(loadConfig());

  const app = new Hono();

  app.onError((err, c) => c.json({ error: String((err as Error)?.message ?? err).slice(0, 500) }, 500));

  app.get("/health", (c) =>
    c.json({ ok: true, vectors: countVectors(rt.db), routes: rt.embeddings.map((e) => e.name) }),
  );

  app.post("/index", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const report = await runIndex(rt.cfg, rt.storages, rt.embeddings, rt.db, { full: body?.full === true });
    return c.json(report);
  });

  app.post("/search", async (c) => {
    const body = await c.req.json();
    if (!body?.query) return c.json({ error: "query required" }, 400);
    const hits = await retrieve(rt.db, rt.embeddings, String(body.query), toFilter(body.filter), {
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
    const hits = await retrieve(rt.db, rt.embeddings, String(body.query), toFilter(body.filter), {
      topK: rt.cfg.retrieval?.topK,
      finalK: rt.cfg.retrieval?.finalK,
    });
    const result = await askWithSources(rt.qa, rt.storages, String(body.query), hits, rt.cfg.qa.maxSources);
    return c.json(result);
  });

  const reload = async (newCfg: Config): Promise<void> => {
    rt = await buildRuntime(newCfg, rt);
  };
  const getRt = (): Runtime => rt;
  mountAdmin(app, getRt, reload);

  return { app, get runtime() { return rt; } };
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
