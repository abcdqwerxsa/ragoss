/** Google Gemini generateContent adapter (streaming when onDelta provided). */
import type { ChatMessage, ChatOpts, ChatPart } from "../../core/types.js";
import { readSse } from "../sse.js";

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
  opts?: ChatOpts,
): Promise<string> {
  const base = baseUrl.replace(/\/+$/, "");
  const system = messages.filter((m) => m.role === "system").flatMap((m) => toParts(m.parts));
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: toParts(m.parts) }));
  const commonBody = {
    contents,
    ...(system.length ? { systemInstruction: { parts: system } } : {}),
    ...(opts?.maxTokens ? { generationConfig: { maxOutputTokens: opts.maxTokens } } : {}),
  };

  if (opts?.onDelta) {
    const res = await fetch(`${base}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commonBody),
    });
    if (!res.ok) throw new Error(`google chat(stream) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    let acc = "";
    await readSse(res, (j) => {
      const t = (j as GeminiResponse).candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
      if (t) { acc += t; opts.onDelta!(t); }
    });
    return acc;
  }

  const res = await fetch(`${base}/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(commonBody),
  });
  const body = (await res.json()) as GeminiResponse;
  if (!res.ok) throw new Error(`google chat failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

function toParts(parts: ChatPart[]): GPart[] {
  return parts.map((p) =>
    p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.dataBase64 } },
  );
}
