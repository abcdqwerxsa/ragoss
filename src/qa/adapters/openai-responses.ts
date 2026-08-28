/** OpenAI Responses API adapter. */
import type { ChatMessage, ChatPart } from "../../core/types.js";

interface ResponsesOutput {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string };
}

export async function openaiResponses(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: messages.map((m) => ({ role: m.role, content: toInput(m.parts) })),
      ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
    }),
  });
  const body = (await res.json()) as ResponsesOutput;
  if (!res.ok) throw new Error(`openai responses failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return (body.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
}

function toInput(parts: ChatPart[]): { type: string; text?: string; image_url?: string }[] {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "input_text", text: p.text }
      : { type: "input_image", image_url: `data:${p.mime};base64,${p.dataBase64}` },
  );
}
