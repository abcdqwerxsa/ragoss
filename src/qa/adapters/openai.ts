/** OpenAI Chat Completions adapter (streaming when onDelta provided). */
import type { ChatMessage, ChatOpts, ChatPart } from "../../core/types.js";
import { readSse } from "../sse.js";

interface OpenAiResponse {
  choices?: { message?: { content?: string }; delta?: { content?: string } }[];
  error?: { message?: string };
}

export async function openaiChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ChatOpts,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  if (opts?.onDelta) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: toContent(m.parts) })),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
    });
    if (!res.ok) throw new Error(`openai chat(stream) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    let acc = "";
    await readSse(res, (j) => {
      const t = (j as OpenAiResponse).choices?.[0]?.delta?.content;
      if (t) { acc += t; opts.onDelta!(t); }
    });
    return acc;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: toContent(m.parts) })),
      ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  });
  const body = (await res.json()) as OpenAiResponse;
  if (!res.ok) throw new Error(`openai chat failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body.choices?.[0]?.message?.content ?? "";
}

function toContent(parts: ChatPart[]): string | { type: string; text?: string; image_url?: { url: string } }[] {
  if (parts.every((p) => p.type === "text")) return parts.map((p) => p.text).join("\n");
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.dataBase64}` } },
  );
}
