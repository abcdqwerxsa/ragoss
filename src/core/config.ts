/** Config loading with fail-fast validation. Secrets support "env:VAR" indirection. */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface S3StorageConfig {
  type: "s3";
  name: string;
  endpoint?: string;
  region?: string;
  bucket: string;
  prefix?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface WebdavStorageConfig {
  type: "webdav";
  name: string;
  endpoint: string;
  username?: string;
  password?: string;
  prefix?: string;
}

export type StorageConfig = S3StorageConfig | WebdavStorageConfig;

export interface EmbeddingConfig {
  name: string;
  provider: "dashscope" | "google";
  baseUrl?: string;
  apiKey: string;
  model: string;
  dims?: number;
}

export type QaProtocol = "openai" | "openai-responses" | "google" | "anthropic";

export interface QaConfig {
  protocol: QaProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxSources?: number;
}

export interface RetrievalConfig {
  topK?: number;
  finalK?: number;
}

export interface DbConfig {
  path?: string;
  /** persist db file to this storage/key after index; pulled at startup if local file missing */
  remote?: { storage: string; key: string };
}

export interface Config {
  storages: StorageConfig[];
  embeddings: EmbeddingConfig[];
  qa: QaConfig;
  retrieval?: RetrievalConfig;
  db?: DbConfig;
}

export function resolveSecret(v: string): string {
  if (v.startsWith("env:")) {
    const val = process.env[v.slice(4)];
    if (!val) throw new Error(`env var ${v.slice(4)} not set`);
    return val;
  }
  return v;
}

function fail(msg: string): never {
  throw new Error(`config error: ${msg}`);
}

function req<T extends object>(o: T, field: keyof T & string, ctx: string): void {
  const v = o[field];
  if (v === undefined || v === null || v === "") fail(`${ctx}.${field} is required`);
}

function validate(c: Config): void {
  if (!Array.isArray(c.storages) || c.storages.length === 0) fail("storages[] must be non-empty");
  const names = new Set<string>();
  for (const s of c.storages) {
    req(s, "name", "storages[]");
    req(s, "type", `storage[${s.name}]`);
    if (names.has(s.name)) fail(`duplicate storage name ${s.name}`);
    names.add(s.name);
    if (s.type === "s3") req(s, "bucket", `storage[${s.name}]`);
    else if (s.type === "webdav") req(s, "endpoint", `storage[${s.name}]`);
    else fail(`storages[].type must be s3 or webdav (got ${String((s as { type?: string }).type)})`);
  }
  if (!Array.isArray(c.embeddings) || c.embeddings.length === 0) fail("embeddings[] must be non-empty");
  const enames = new Set<string>();
  for (const e of c.embeddings) {
    req(e, "name", "embeddings[]");
    req(e, "model", `embedding[${e.name}]`);
    req(e, "apiKey", `embedding[${e.name}]`);
    if (enames.has(e.name)) fail(`duplicate embedding name ${e.name}`);
    enames.add(e.name);
    if (e.provider !== "dashscope" && e.provider !== "google")
      fail(`embedding[${e.name}].provider must be dashscope or google`);
  }
  const q = c.qa;
  if (!q) fail("qa is required");
  req(q, "protocol", "qa");
  req(q, "baseUrl", "qa");
  req(q, "model", "qa");
  req(q, "apiKey", "qa");
  if (!["openai", "openai-responses", "google", "anthropic"].includes(q.protocol))
    fail("qa.protocol must be openai | openai-responses | google | anthropic");
  if (c.db?.remote) {
    req(c.db.remote, "storage", "db.remote");
    req(c.db.remote, "key", "db.remote");
    if (!names.has(c.db.remote.storage)) fail(`db.remote.storage ${c.db.remote.storage} not in storages[]`);
  }
}

export function loadConfig(p?: string): Config {
  const file = p ?? process.env.RAGOSS_CONFIG ?? "config.json";
  let raw: string;
  try {
    raw = readFileSync(path.resolve(file), "utf8");
  } catch {
    fail(`cannot read ${file} (set RAGOSS_CONFIG or create config.json, see config.example.json)`);
  }
  const c = JSON.parse(raw) as Config;
  validate(c);
  return c;
}
