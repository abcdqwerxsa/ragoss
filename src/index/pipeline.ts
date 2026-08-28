/** Incremental index pipeline: detect changes -> chunk -> embed (all routes) -> SQLite -> sync db to remote storage. */
import type { Config } from "../core/config.js";
import { mimeFromKey, kindFromMime } from "../core/mime.js";
import type { Db } from "../db.js";
import { allObjects, deleteChunks, removeObject, upsertChunk, upsertObject, upsertVector } from "../db.js";
import type { EmbeddingProvider, StorageProvider } from "../core/types.js";
import { chunkText, mediaChunk } from "./chunker.js";
import { detectChanges } from "./detect.js";
import { syncDbToRemote } from "./dbsync.js";

export interface IndexReport {
  added: number;
  changed: number;
  removed: number;
  errors: { storage: string; key: string; error: string }[];
}

// ponytail: sequential API calls; add batching/parallelism if personal corpus grows past ~10k objects
export async function runIndex(
  cfg: Config,
  storages: StorageProvider[],
  embeddings: EmbeddingProvider[],
  db: Db,
  opts: { full?: boolean } = {},
): Promise<IndexReport> {
  const report: IndexReport = { added: 0, changed: 0, removed: 0, errors: [] };
  const indexed = opts.full ? [] : allObjects(db);

  for (const st of storages) {
    let listed;
    try {
      listed = await st.list();
    } catch (e) {
      report.errors.push({ storage: st.name, key: "(list)", error: String(e) });
      continue;
    }
    const { added, changed, removed } = detectChanges(listed, indexed);
    report.added += added.length;
    report.changed += changed.length;

    for (const o of removed) {
      removeObject(db, o.storage, o.key);
      report.removed++;
    }

    for (const o of [...added, ...changed]) {
      try {
        await indexObject(st, embeddings, db, o);
        upsertObject(db, o);
      } catch (e) {
        report.errors.push({ storage: o.storage, key: o.key, error: String(e).slice(0, 300) });
      }
    }
  }

  if (cfg.db?.remote) await syncDbToRemote(cfg, storages, db);
  return report;
}

async function indexObject(
  st: StorageProvider,
  embeddings: EmbeddingProvider[],
  db: Db,
  o: { storage: string; key: string; mime: string },
): Promise<void> {
  const { data } = await st.get(o.key);
  const kind = kindFromMime(o.mime || mimeFromKey(o.key));
  // re-embed from scratch on every change
  deleteChunks(db, o.storage, o.key);

  const chunks =
    kind === "text"
      ? chunkText(data.toString("utf8"), o.storage, o.key)
      : [mediaChunk(kind, o.storage, o.key)];

  for (const c of chunks) {
    upsertChunk(db, c);
    for (const emb of embeddings) {
      const input =
        c.kind === "text"
          ? { text: c.text }
          : c.kind === "image"
            ? { image: { mime: o.mime, dataBase64: data.toString("base64") } }
            : c.kind === "audio"
              ? { audio: { mime: o.mime, dataBase64: data.toString("base64") } }
              : { video: { mime: o.mime, dataBase64: data.toString("base64") } };
      const vec = await emb.embed(input);
      upsertVector(db, c.storage, c.key, c.ordinal, emb.name, new Float32Array(vec));
    }
  }
}
