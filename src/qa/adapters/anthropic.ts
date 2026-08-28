/** Anthropic Messages adapter. */
import type { ChatMessage, ChatPart } from "../../core/types.js";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
}

export async function anthropicChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<string> {
  const base = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const system = messages
    .filter((m) => m.role === "system")
    .flatMap((m) => m.parts)
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");
  const msgs = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: toContent(m.parts) }));
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: msgs,
      max_tokens: maxTokens ?? 4096,
      ...(system ? { system } : {}),
    }),
  });
  const body = (await res.json()) as AnthropicResponse;
  if (!res.ok) throw new Error(`anthropic chat failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

function toContent(parts: ChatPart[]): { type: string; text?: string; source?: unknown }[] {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.mime, data: p.dataBase64 } },
  );
}
