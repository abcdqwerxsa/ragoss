/** Dependency-free self-checks for core logic: chunker, RRF, change detection, config, vector roundtrip. Run: pnpm test */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chunkText, mediaChunk } from "./index/chunker.js";
import { detectChanges } from "./index/detect.js";
import { rrf } from "./search/rrf.js";
import { noopReranker } from "./search/rerank/noop.js";
import { openDb, scanVectors, upsertChunk, upsertObject, upsertVector } from "./db.js";
import type { ObjectRecord, RetrievalHit } from "./core/types.js";

// --- chunker ---
{
  const md = ["# A", "x".repeat(50), "", "# B", "y".repeat(50), "", "# C", "z".repeat(50)].join("\n");
  const chunks = chunkText(md, "s", "a.md");
  // A,B,C each < MIN_LEN(200) so they merge into one chunk
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0]!.text.includes("# A") && chunks[0]!.text.includes("# C"));

  const big = ["# Big", "w".repeat(4500)].join("\n");
  const bigChunks = chunkText(big, "s", "b.md");
  assert.equal(bigChunks.length, 3); // 4500/2000 -> 3 parts
  assert.ok(bigChunks.every((c) => c.text.length <= 2000));

  const media = mediaChunk("image", "s", "dir/photo.png");
  assert.equal(media.ordinal, 0);
  assert.equal(media.text, "photo.png");
}

// --- RRF ---
{
  const hit = (storage: string, key: string, ordinal = 0): RetrievalHit => ({
    chunk: { storage, key, ordinal, kind: "text", text: "" },
    score: 0.9,
    route: "test",
  });
  const a = [hit("s", "a"), hit("s", "b"), hit("s", "c")];
  const b = [hit("s", "b"), hit("s", "d"), hit("s", "a")];
  const fused = rrf([a, b]);
  assert.equal(fused[0]!.chunk.key, "b"); // rank1+rank1
  assert.equal(fused[1]!.chunk.key, "a"); // rank1+rank3
  assert.ok(fused.every((h) => h.route === "rrf"));
  const single = rrf([a]);
  assert.deepEqual(single.map((h) => h.chunk.key), ["a", "b", "c"]);
}

// --- change detection ---
{
  const base: ObjectRecord[] = [
    { storage: "s", key: "same", size: 1, mime: "text/markdown", mtime: "2025-01-01T00:00:00Z", etag: "e1" },
    { storage: "s", key: "mod", size: 1, mime: "text/markdown", mtime: "2025-01-01T00:00:00Z", etag: "e1" },
    { storage: "s", key: "gone", size: 1, mime: "text/markdown", mtime: "2025-01-01T00:00:00Z", etag: "e1" },
  ];
  const listed: ObjectRecord[] = [
    base[0]!,
    { ...base[1]!, etag: "e2" },
    { storage: "s", key: "new", size: 2, mime: "image/png", mtime: "2025-06-01T00:00:00Z", etag: "n" },
  ];
  const { added, changed, removed } = detectChanges(listed, base);
  assert.deepEqual(added.map((o) => o.key), ["new"]);
  assert.deepEqual(changed.map((o) => o.key), ["mod"]);
  assert.deepEqual(removed.map((o) => o.key), ["gone"]);
}

// --- db vector roundtrip + filter ---
{
  const dir = mkdtempSync(path.join(tmpdir(), "ragoss-test-"));
  const db = openDb(path.join(dir, "t.db"));
  const o: ObjectRecord = { storage: "s", key: "a.md", size: 10, mime: "text/markdown", mtime: "2025-01-01T00:00:00Z", etag: "e" };
  upsertObject(db, o);
  upsertChunk(db, { storage: "s", key: "a.md", ordinal: 0, kind: "text", text: "hello" });
  upsertVector(db, "s", "a.md", 0, "routeA", new Float32Array([3, 4])); // normalized -> [0.6, 0.8]
  upsertVector(db, "s", "a.md", 0, "routeB", new Float32Array([1, 0]));

  const rowsA = scanVectors(db, "routeA");
  assert.equal(rowsA.length, 1);
  const dot = rowsA[0]!.vec[0]! * 0.6 + rowsA[0]!.vec[1]! * 0.8;
  assert.ok(Math.abs(dot - 1) < 1e-5, "normalized vector dot with itself == 1");

  const filtered = scanVectors(db, "routeA", { mimePrefix: "image/" });
  assert.equal(filtered.length, 0);

  // rerank no-op
  const hits: RetrievalHit[] = [{ chunk: { storage: "s", key: "a.md", ordinal: 0, kind: "text", text: "x" }, score: 1, route: "rrf" }];
  assert.equal((await noopReranker.rerank("q", hits)).length, 1);

  db.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log("selftest OK");
