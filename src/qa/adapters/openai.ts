/** OpenAI Chat Completions adapter. */
import type { ChatMessage, ChatPart } from "../../core/types.js";

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export async function openaiChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: toContent(m.parts) })),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
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
