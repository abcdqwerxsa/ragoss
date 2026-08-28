/** Markdown/text chunking by headings; media objects become a single chunk. */
import type { Chunk, MediaKind } from "../core/types.js";

const MAX_LEN = 2000;
const MIN_LEN = 200;

export function chunkText(text: string, storage: string, key: string): Chunk[] {
  const lines = text.split("\n");
  const sections: { title: string; body: string[] }[] = [];
  let cur = { title: "", body: [] as string[] };
  for (const line of lines) {
    if (/^#{1,6} /.test(line)) {
      if (cur.title || cur.body.some((l) => l.trim())) sections.push(cur);
      cur = { title: line, body: [] };
    } else {
      cur.body.push(line);
    }
  }
  if (cur.title || cur.body.some((l) => l.trim())) sections.push(cur);

  // merge tiny sections into predecessor, split oversized ones
  const out: string[] = [];
  for (const s of sections) {
    const t = `${s.title}\n${s.body.join("\n")}`.trim();
    if (!t) continue;
    if (out.length && t.length < MIN_LEN && out[out.length - 1]!.length + t.length <= MAX_LEN) {
      out[out.length - 1] = `${out[out.length - 1]}\n\n${t}`;
    } else if (t.length <= MAX_LEN) {
      out.push(t);
    } else {
      for (let i = 0; i < t.length; i += MAX_LEN) out.push(t.slice(i, i + MAX_LEN));
    }
  }
  if (out.length === 0 && text.trim()) out.push(text.slice(0, MAX_LEN));
  return out.map((t, i) => ({ storage, key, ordinal: i, kind: "text" as const, text: t }));
}

export function mediaChunk(kind: MediaKind, storage: string, key: string): Chunk {
  const filename = key.split("/").pop() ?? key;
  return { storage, key, ordinal: 0, kind, text: filename };
}
