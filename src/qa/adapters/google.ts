/** Google Gemini generateContent adapter. */
import type { ChatMessage, ChatPart } from "../../core/types.js";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

type GPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function googleChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<string> {
  const system = messages.filter((m) => m.role === "system").flatMap((m) => toParts(m.parts));
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: toParts(m.parts),
    }));
  const res = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        ...(system.length ? { systemInstruction: { parts: system } } : {}),
        ...(maxTokens ? { generationConfig: { maxOutputTokens: maxTokens } } : {}),
      }),
    },
  );
  const body = (await res.json()) as GeminiResponse;
  if (!res.ok) throw new Error(`google chat failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

function toParts(parts: ChatPart[]): GPart[] {
  return parts.map((p) =>
    p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.dataBase64 } },
  );
}
