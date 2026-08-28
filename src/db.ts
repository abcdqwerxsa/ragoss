/** SQLite storage for index state: objects, chunks, vectors (brute-force scan). */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Chunk, MediaKind, ObjectRecord, RetrievalFilter } from "./core/types.js";
import type { Database as SqliteDatabase } from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS objects(
  storage TEXT NOT NULL, key TEXT NOT NULL, size INTEGER NOT NULL,
  mime TEXT NOT NULL, mtime TEXT NOT NULL, etag TEXT NOT NULL,
  PRIMARY KEY(storage, key)
);
CREATE TABLE IF NOT EXISTS chunks(
  storage TEXT NOT NULL, key TEXT NOT NULL, ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(storage, key, ordinal)
);
CREATE TABLE IF NOT EXISTS vectors(
  storage TEXT NOT NULL, key TEXT NOT NULL, ordinal INTEGER NOT NULL,
  route TEXT NOT NULL, vec BLOB NOT NULL, dims INTEGER NOT NULL,
  PRIMARY KEY(storage, key, ordinal, route)
);
CREATE INDEX IF NOT EXISTS idx_vectors_route ON vectors(route);
`;

export type Db = SqliteDatabase & { pragma: SqliteDatabase["pragma"] };

export function openDb(file: string): Db {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file) as Db;
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function allObjects(db: Db): ObjectRecord[] {
  return db
    .prepare("SELECT storage, key, size, mime, mtime, etag FROM objects")
    .all() as ObjectRecord[];
}

export function upsertObject(db: Db, o: ObjectRecord): void {
  db.prepare(
    `INSERT INTO objects(storage,key,size,mime,mtime,etag) VALUES(?,?,?,?,?,?)
     ON CONFLICT(storage,key) DO UPDATE SET size=excluded.size, mime=excluded.mime, mtime=excluded.mtime, etag=excluded.etag`,
  ).run(o.storage, o.key, o.size, o.mime, o.mtime, o.etag);
}

export function removeObject(db: Db, storage: string, key: string): void {
  db.prepare("DELETE FROM objects WHERE storage=? AND key=?").run(storage, key);
  deleteChunks(db, storage, key);
}

export function deleteChunks(db: Db, storage: string, key: string): void {
  db.prepare("DELETE FROM chunks WHERE storage=? AND key=?").run(storage, key);
  db.prepare("DELETE FROM vectors WHERE storage=? AND key=?").run(storage, key);
}

export function upsertChunk(db: Db, c: Chunk): void {
  db.prepare(
    `INSERT INTO chunks(storage,key,ordinal,kind,text) VALUES(?,?,?,?,?)
     ON CONFLICT(storage,key,ordinal) DO UPDATE SET kind=excluded.kind, text=excluded.text`,
  ).run(c.storage, c.key, c.ordinal, c.kind, c.text);
}

/** Vector is stored L2-normalized so cosine == dot product. */
export function upsertVector(
  db: Db,
  storage: string,
  key: string,
  ordinal: number,
  route: string,
  vec: Float32Array,
): void {
  const norm = new Float32Array(vec.length);
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i]! * vec[i]!;
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < vec.length; i++) norm[i] = vec[i]! * inv;
  db.prepare(
    `INSERT INTO vectors(storage,key,ordinal,route,vec,dims) VALUES(?,?,?,?,?,?)
     ON CONFLICT(storage,key,ordinal,route) DO UPDATE SET vec=excluded.vec, dims=excluded.dims`,
  ).run(storage, key, ordinal, route, Buffer.from(norm.buffer), norm.length);
}

export interface ScanRow {
  storage: string;
  key: string;
  ordinal: number;
  kind: MediaKind;
  text: string;
  mime: string;
  vec: Float32Array;
}

function filterClauses(f: RetrievalFilter): { where: string; params: (string | number)[] } {
  const c: string[] = [];
  const p: (string | number)[] = [];
  if (f.storage) { c.push("v.storage = ?"); p.push(f.storage); }
  if (f.mimePrefix) { c.push("o.mime LIKE ?"); p.push(f.mimePrefix + "%"); }
  if (f.pathPrefix) { c.push("v.key LIKE ?"); p.push(f.pathPrefix + "%"); }
  if (f.since) { c.push("o.mtime >= ?"); p.push(f.since); }
  return { where: c.length ? " AND " + c.join(" AND ") : "", params: p };
}

/** Brute-force scan of one embedding route with metadata prefilter. */
export function scanVectors(db: Db, route: string, filter: RetrievalFilter = {}): ScanRow[] {
  const { where, params } = filterClauses(filter);
  const rows = db
    .prepare(
      `SELECT v.storage, v.key, v.ordinal, c.kind, c.text, o.mime, v.vec
       FROM vectors v
       JOIN chunks c ON c.storage=v.storage AND c.key=v.key AND c.ordinal=v.ordinal
       JOIN objects o ON o.storage=v.storage AND o.key=v.key
       WHERE v.route = ?${where}`,
    )
    .all(route, ...params) as (Omit<ScanRow, "vec"> & { vec: Buffer })[];
  return rows.map((r) => ({ ...r, vec: new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4) }));
}

export function countVectors(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM vectors").get() as { n: number }).n;
}
