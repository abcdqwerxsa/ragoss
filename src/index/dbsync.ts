/** Persist db file to remote object storage; pull at startup when local file is absent. */
import { existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import type { Config } from "../core/config.js";
import type { Db } from "../db.js";
import type { StorageProvider } from "../core/types.js";

export function dbPath(cfg: Config): string {
  return cfg.db?.path ?? "ragoss.db";
}

export async function pullDbIfMissing(cfg: Config, storages: StorageProvider[]): Promise<boolean> {
  const remote = cfg.db?.remote;
  if (!remote || existsSync(dbPath(cfg))) return false;
  const st = storages.find((s) => s.name === remote.storage);
  if (!st) throw new Error(`db.remote.storage "${remote.storage}" not found`);
  try {
    const { data } = await st.get(remote.key);
    const fh = await open(dbPath(cfg), "w");
    try {
      await fh.writeFile(data);
    } finally {
      await fh.close();
    }
    return true;
  } catch (e) {
    // first deploy: remote db not uploaded yet -> start fresh; sync happens after first index
    console.warn(`[ragoss] remote db pull skipped (${String(e).slice(0, 120)}); starting with fresh local db`);
    return false;
  }
}

export async function syncDbToRemote(
  cfg: Config,
  storages: StorageProvider[],
  db: Db,
): Promise<void> {
  const remote = cfg.db?.remote;
  if (!remote) return;
  const st = storages.find((s) => s.name === remote.storage);
  if (!st) throw new Error(`db.remote.storage "${remote.storage}" not found`);
  // checkpoint WAL into the main file before upload
  db.pragma("wal_checkpoint(TRUNCATE)");
  const data = await readFile(dbPath(cfg));
  await st.put(remote.key, data, "application/octet-stream");
}
