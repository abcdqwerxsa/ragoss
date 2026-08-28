/** Shared runtime state so the admin panel can hot-reload providers after config changes. */
import type { Config } from "../core/config.js";
import type { Db } from "../db.js";
import { openDb } from "../db.js";
import type { EmbeddingProvider, QaProvider, StorageProvider } from "../core/types.js";
import { buildEmbeddings } from "../embedding/index.js";
import { dbPath, pullDbIfMissing } from "../index/dbsync.js";
import { createQaProvider } from "../qa/index.js";
import { buildStorages } from "../storage/index.js";

export interface Runtime {
  cfg: Config;
  storages: StorageProvider[];
  embeddings: EmbeddingProvider[];
  qa: QaProvider;
  db: Db;
}

export async function buildRuntime(cfg: Config, prev?: Runtime): Promise<Runtime> {
  const storages = buildStorages(cfg);
  const embeddings = buildEmbeddings(cfg);
  const qa = createQaProvider(cfg.qa);
  await pullDbIfMissing(cfg, storages);
  const db = cfg.db?.path === prev?.cfg.db?.path || (!cfg.db?.path && !prev?.cfg.db?.path)
    ? (prev?.db ?? openDb(dbPath(cfg)))
    : (prev?.db.close(), openDb(dbPath(cfg)));
  return { cfg, storages, embeddings, qa, db };
}
