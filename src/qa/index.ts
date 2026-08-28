/** QA provider factory + RAG assembly with source citations and inline images. */
import type { QaConfig } from "../core/config.js";
import { resolveSecret } from "../core/config.js";
import type { ChatMessage, ChatPart, QaProvider, RetrievalHit, StorageProvider } from "../core/types.js";
import { openaiChat } from "./adapters/openai.js";
import { openaiResponses } from "./adapters/openai-responses.js";
import { googleChat } from "./adapters/google.js";
import { anthropicChat } from "./adapters/anthropic.js";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // skip larger inline images to protect token budget

export function createQaProvider(cfg: QaConfig): QaProvider {
  const apiKey = resolveSecret(cfg.apiKey);
  const chat = (messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<string> => {
    const m = opts?.maxTokens;
    switch (cfg.protocol) {
      case "openai":
        return openaiChat(cfg.baseUrl, apiKey, cfg.model, messages, m);
      case "openai-responses":
        return openaiResponses(cfg.baseUrl, apiKey, cfg.model, messages, m);
      case "google":
        return googleChat(cfg.baseUrl, apiKey, cfg.model, messages, m);
      case "anthropic":
        return anthropicChat(cfg.baseUrl, apiKey, cfg.model, messages, m);
    }
  };
  return { protocol: cfg.protocol, chat };
}

export interface AskResult {
  answer: string;
  sources: { n: number; storage: string; key: string; kind: string; textPreview: string }[];
}

export async function askWithSources(
  qa: QaProvider,
  storages: StorageProvider[],
  query: string,
  hits: RetrievalHit[],
  maxSources = 6,
): Promise<AskResult> {
  if (hits.length === 0) {
    return { answer: "知识库中未找到与问题相关的内容。请先在控制台完成索引,或换个问法。", sources: [] };
  }
  const used = hits.slice(0, maxSources);
  const parts: ChatPart[] = [];
  const sources: AskResult["sources"] = [];

  for (let i = 0; i < used.length; i++) {
    const h = used[i]!;
    const n = i + 1;
    sources.push({
      n,
      storage: h.chunk.storage,
      key: h.chunk.key,
      kind: h.chunk.kind,
      textPreview: h.chunk.text.slice(0, 120),
    });
    if (h.chunk.kind === "text") {
      parts.push({
        type: "text",
        text: `[${n}] ${h.chunk.storage}://${h.chunk.key}\n${h.chunk.text}`,
      });
    } else {
      parts.push({ type: "text", text: `[${n}] ${h.chunk.storage}://${h.chunk.key} (${h.chunk.kind},见附图)` });
      try {
        const st = storages.find((s) => s.name === h.chunk.storage);
        if (st) {
          const obj = await st.get(h.chunk.key);
          if (obj.data.length <= MAX_IMAGE_BYTES) {
            parts.push({ type: "image", mime: obj.mime, dataBase64: obj.data.toString("base64") });
          }
        }
      } catch {
        // image fetch failed: citation marker above still identifies the source
      }
    }
  }
  parts.push({ type: "text", text: `问题:${query}` });

  const answer = await qa.chat([
    {
      role: "system",
      parts: [
        {
          type: "text",
          text: "你是个人知识库问答助手。仅依据提供的编号资料回答,引用来源时使用 [n] 标记;资料不足以回答时明确说明。",
        },
      ],
    },
    { role: "user", parts },
  ]);
  return { answer, sources };
}
