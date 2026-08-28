/** Admin panel: view/edit config in browser, hot-reload providers, test connectivity, trigger index. */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { Context, Hono } from "hono";
import { configFilePath, validateConfig, type Config } from "../core/config.js";
import { runIndex } from "../index/pipeline.js";
import type { Runtime } from "./runtime.js";

const SECRET_FIELDS = new Set(["accessKeyId", "secretAccessKey", "username", "password", "apiKey"]);
const KEEP = "__KEEP__";

export function mountAdmin(
  app: Hono,
  getRt: () => Runtime,
  reload: (cfg: Config) => Promise<void>,
): void {
  app.use("/api/*", authMiddleware);
  app.use("/", authMiddleware);

  app.get("/", (c) => c.html(readFileSync(new URL("./panel.html", import.meta.url), "utf8")));
  app.get("/logo.svg", (c) =>
    c.body(readFileSync(new URL("./logo.svg", import.meta.url), "utf8"), 200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
    }),
  );

  // sanitized config: secrets -> "__KEEP__" unless they are env: references
  app.get("/api/config", (c) => c.json(sanitize(getRt().cfg)));

  app.put("/api/config", async (c) => {
    const incoming = (await c.req.json()) as Config;
    const merged = mergeSecrets(incoming, getRt().cfg);
    validateConfig(merged);
    await writeFile(configFilePath(), JSON.stringify(merged, null, 2) + "\n", "utf8");
    await reload(merged);
    return c.json({ ok: true, saved: configFilePath() });
  });

  app.post("/api/config/test", async (c) => {
    const rt = getRt();
    const results: { name: string; kind: string; ok: boolean; detail: string }[] = [];
    for (const st of rt.storages) {
      const [ok, detail] = await withTimeout(st.list().then((l) => `${l.length} objects`));
      results.push({ name: st.name, kind: "storage", ok, detail });
    }
    for (const emb of rt.embeddings) {
      const [ok, detail] = await withTimeout(
        emb.embed({ text: "ping" }).then((v) => `dims=${v.length}`),
      );
      results.push({ name: emb.name, kind: "embedding", ok, detail });
    }
    {
      const [ok, detail] = await withTimeout(
        rt.qa
          .chat([{ role: "user", parts: [{ type: "text", text: "回复:pong" }] }], { maxTokens: 16 })
          .then((a) => (a || "(empty)").slice(0, 60)),
      );
      results.push({ name: rt.qa.protocol, kind: "qa", ok, detail });
    }
    return c.json({ results });
  });

  app.post("/api/index", async (c) => {
    const rt = getRt();
    const report = await runIndex(rt.cfg, rt.storages, rt.embeddings, rt.db, {});
    return c.json(report);
  });
}

async function authMiddleware(c: Context, next: () => Promise<void>): Promise<Response | void> {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return void next();
  const provided =
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(c.req.url).searchParams.get("token") ??
    "";
  if (provided !== token) return c.json({ error: "unauthorized" }, 401);
  await next();
}

function sanitize(cfg: Config): unknown {
  return JSON.parse(
    JSON.stringify(cfg, (k, v) =>
      SECRET_FIELDS.has(k) && typeof v === "string" && v && !v.startsWith("env:") ? KEEP : v,
    ),
  );
}

/** Restore "__KEEP__" placeholders from the current config by walking both trees in lockstep. */
function mergeSecrets(incoming: Config, current: Config): Config {
  const walk = (inc: unknown, cur: unknown): unknown => {
    if (Array.isArray(inc)) return inc.map((v, i) => walk(v, (cur as unknown[] | undefined)?.[i]));
    if (inc !== null && typeof inc === "object") {
      const out: Record<string, unknown> = {};
      const curObj = (cur ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(inc as Record<string, unknown>)) {
        out[k] = SECRET_FIELDS.has(k) && v === KEEP ? curObj[k] : walk(v, curObj[k]);
      }
      return out;
    }
    return inc;
  };
  return walk(incoming, current) as Config;
}

function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<[boolean, string]> {
  return Promise.race([
    p.then((v) => [true, String(v)] as [boolean, string]).catch((e) => [false, String(e).slice(0, 200)] as [boolean, string]),
    new Promise<[boolean, string]>((res) => setTimeout(() => res([false, `timeout after ${ms}ms`]), ms)),
  ]);
}
