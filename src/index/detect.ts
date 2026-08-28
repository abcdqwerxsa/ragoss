/** Change detection: diff storage listing against indexed objects. */
import type { ObjectRecord } from "../core/types.js";

export interface Changes {
  added: ObjectRecord[];
  changed: ObjectRecord[];
  removed: { storage: string; key: string }[];
}

export function detectChanges(listed: ObjectRecord[], indexed: ObjectRecord[]): Changes {
  const byKey = new Map(indexed.map((o) => [`${o.storage}\u0000${o.key}`, o]));
  const seen = new Set<string>();
  const added: ObjectRecord[] = [];
  const changed: ObjectRecord[] = [];
  for (const o of listed) {
    const id = `${o.storage}\u0000${o.key}`;
    seen.add(id);
    const prev = byKey.get(id);
    if (!prev) added.push(o);
    else if (prev.etag !== o.etag || prev.size !== o.size || prev.mtime !== o.mtime) changed.push(o);
  }
  const removed = indexed
    .filter((o) => !seen.has(`${o.storage}\u0000${o.key}`))
    .map((o) => ({ storage: o.storage, key: o.key }));
  return { added, changed, removed };
}
