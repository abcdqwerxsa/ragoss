/** OpenAI Responses API adapter (streaming when onDelta provided). */
import type { ChatMessage, ChatOpts, ChatPart } from "../../core/types.js";
import { readSse } from "../sse.js";

interface ResponsesOutput {
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { message?: string };
}

export async function openaiResponses(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ChatOpts,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/responses`;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const input = messages.map((m) => ({ role: m.role, content: toInput(m.parts) }));

  if (opts?.onDelta) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: true,
        input,
        ...(opts.maxTokens ? { max_output_tokens: opts.maxTokens } : {}),
      }),
    });
    if (!res.ok) throw new Error(`openai responses(stream) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    let acc = "";
    await readSse(res, (j) => {
      const e = j as { type?: string; delta?: string };
      if (e.type === "response.output_text.delta" && e.delta) { acc += e.delta; opts.onDelta!(e.delta); }
    });
    return acc;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input, ...(opts?.maxTokens ? { max_output_tokens: opts.maxTokens } : {}) }),
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
