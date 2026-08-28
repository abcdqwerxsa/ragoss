/** Anthropic Messages adapter (streaming when onDelta provided). */
import type { ChatMessage, ChatOpts, ChatPart } from "../../core/types.js";
import { readSse } from "../sse.js";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
}

export async function anthropicChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ChatOpts,
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
  const body = {
    model,
    messages: msgs,
    max_tokens: opts?.maxTokens ?? 4096,
    ...(system ? { system } : {}),
  };

  if (opts?.onDelta) {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!res.ok) throw new Error(`anthropic chat(stream) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    let acc = "";
    await readSse(res, (j) => {
      const e = j as { type?: string; delta?: { type?: string; text?: string } };
      if (e.type === "content_block_delta" && e.delta?.text) { acc += e.delta.text; opts.onDelta!(e.delta.text); }
    });
    return acc;
  }

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const resp = (await res.json()) as AnthropicResponse;
  if (!res.ok) throw new Error(`anthropic chat failed: ${res.status} ${JSON.stringify(resp).slice(0, 300)}`);
  return (resp.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

function toContent(parts: ChatPart[]): { type: string; text?: string; source?: unknown }[] {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.mime, data: p.dataBase64 } },
  );
}
