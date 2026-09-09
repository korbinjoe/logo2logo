import type { ModelRequest } from "./types.ts";
import { randomUUID } from "node:crypto";
import { localModel, DEFAULT_LOCAL_MODEL } from "./local-model.ts";

export const useGo = () => process.env.MODEL_PROVIDER === "opencode-go";
export const configuredModel = (role: string) =>
  useGo()
    ? process.env[
        role === "vision" ? "OPENCODE_GO_VISION" : "OPENCODE_GO_PLANNER"
      ] || "kimi-k2.6"
    : process.env[role === "vision" ? "OLLAMA_VISION" : "OLLAMA_PLANNER"] ||
      DEFAULT_LOCAL_MODEL;

export async function selectModel(url: string, role: string) {
  if (useGo()) {
    if (!process.env.OPENCODE_GO_API_KEY)
      throw new Error("缺少 OPENCODE_GO_API_KEY 配置");
    return configuredModel(role);
  }
  return localModel(
    url,
    [configuredModel(role)],
    role === "vision" ? "vision" : "completion",
  );
}

// Keep the existing validation pipeline independent of the transport provider.
export async function modelChat(
  url: string,
  init: RequestInit & { body: string; sessionId?: string },
) {
  if (!useGo()) return fetch(url, init);
  const input = JSON.parse(init.body) as ModelRequest;
  const messages = input.messages.map(({ images, ...message }) =>
    images?.length
      ? {
          ...message,
          content: [
            { type: "text", text: message.content },
            ...images.map((data) => ({
              type: "image_url",
              image_url: { url: `data:image/png;base64,${data}` },
            })),
          ],
        }
      : message,
  );
  // Kimi JSON mode plus the explicit schema retains application-side validation.
  messages.unshift({
    role: "system",
    content: `Return only a JSON object matching this schema: ${JSON.stringify(input.format)}`,
  });
  const response = await fetch(
    "https://opencode.ai/zen/go/v1/chat/completions",
    {
      method: "POST",
      signal: init.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "logo2logo/1.0",
        "x-opencode-session": init.sessionId || randomUUID(),
        authorization: `Bearer ${process.env.OPENCODE_GO_API_KEY}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages,
        stream: false,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        max_tokens: input.options?.num_predict || 1600,
      }),
    },
  );
  if (!response.ok)
    return new Response(
      JSON.stringify({ error: `OpenCode Go HTTP ${response.status}` }),
      { status: response.status },
    );
  const result = await response.json();
  const choice = result.choices?.[0];
  if (!choice?.message?.content) throw new Error("OpenCode Go 返回空内容");
  return new Response(
    JSON.stringify({
      message: { content: choice.message.content },
      done_reason: choice.finish_reason,
      eval_count: result.usage?.completion_tokens,
    }),
    { status: 200 },
  );
}
