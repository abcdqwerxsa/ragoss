/** WebDAV storage provider. */
import { createClient } from "webdav";
import type { WebdavStorageConfig } from "../core/config.js";
import { resolveSecret } from "../core/config.js";
import { mimeFromKey } from "../core/mime.js";
import type { FetchedObject, ObjectRecord, StorageProvider } from "../core/types.js";

interface DavStat {
  type: "file" | "directory";
  filename: string;
  basename: string;
  size: number;
  lastmod: string;
  etag?: string;
  mime?: string;
}

export function createWebdavStorage(cfg: WebdavStorageConfig): StorageProvider {
  const client = createClient(cfg.endpoint, {
    ...(cfg.username ? { username: resolveSecret(cfg.username) } : {}),
    ...(cfg.password ? { password: resolveSecret(cfg.password) } : {}),
  });
  const root = (cfg.prefix ?? "").replace(/\/+$/, "");

  return {
    name: cfg.name,

    async list(): Promise<ObjectRecord[]> {
      const stats = (await client.getDirectoryContents(root, {
        deep: true,
      })) as DavStat[];
      return stats
        .filter((s) => s.type === "file")
        .map((s) => ({
          storage: cfg.name,
          key: s.filename,
          size: s.size,
          mime: s.mime ?? mimeFromKey(s.filename),
          mtime: new Date(s.lastmod).toISOString(),
          etag: s.etag ?? `${s.size}-${s.lastmod}`,
        }));
    },

    async get(key: string): Promise<FetchedObject> {
      const data = Buffer.from(await client.getFileContents(key) as ArrayBuffer);
      return { mime: mimeFromKey(key), data };
    },

    async put(key: string, data: Buffer, _mime: string): Promise<void> {
      await client.putFileContents(key, data, { overwrite: true });
    },
  };
}
