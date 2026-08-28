/** Build storage providers from config via the registry. */
import type { Config, StorageConfig } from "../core/config.js";
import { Registry } from "../core/registry.js";
import type { StorageProvider } from "../core/types.js";
import { createS3Storage } from "./s3.js";
import { createWebdavStorage } from "./webdav.js";

const registry = new Registry<StorageConfig, StorageProvider>();
registry.register("s3", (c) => createS3Storage(c as import("../core/config.js").S3StorageConfig));
registry.register("webdav", (c) =>
  createWebdavStorage(c as import("../core/config.js").WebdavStorageConfig),
);

export function buildStorages(cfg: Config): StorageProvider[] {
  return cfg.storages.map((s) => registry.build(s.type, s));
}

export function findStorage(providers: StorageProvider[], name: string): StorageProvider {
  const p = providers.find((s) => s.name === name);
  if (!p) throw new Error(`storage "${name}" not found`);
  return p;
}
