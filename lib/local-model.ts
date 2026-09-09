import type { ModelResponse } from "./types.ts";
export const DEFAULT_LOCAL_MODEL = "qwen3-vl:8b";

// Ollama 0.33.3 can put Qwen3-VL's entire schema-constrained JSON in
// message.thinking even with think:false. Accept only a complete JSON object;
// free-form reasoning and truncated output must never become a design response.
export function structuredModelText(result: ModelResponse, model: string) {
  if (result.message?.content?.trim()) return result.message.content;
  if (model.startsWith("qwen3-vl:") && result.done_reason === "stop") {
    const candidate = result.message?.thinking?.trim();
    if (candidate?.startsWith("{") && candidate.endsWith("}")) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && !Array.isArray(parsed)) return candidate;
      } catch {}
    }
  }
  return "";
}

export function thinkingOptions(model: string) {
  return model.startsWith("qwen3-vl:")
    ? { think: false }
    : /(?:^|\/)qwen3\.(?:8|5(?:-[\w.-]+)?)(?::|$)/.test(model)
      ? { think: false }
      : {};
}

export async function localModel(
  url: string,
  names: string[],
  capability: string,
) {
  const response = await fetch(`${url}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("无法读取本地模型列表。");
  const tags = (await response.json()) as {
    models?: {
      name: string;
      remote_host?: string;
      remote_model?: string;
      capabilities?: string[];
    }[];
  };
  for (const name of names) {
    const model = tags.models?.find((m) => m.name === name);
    if (
      !model ||
      model.remote_host ||
      model.remote_model ||
      name.endsWith(":cloud")
    )
      continue;
    let capabilities = model.capabilities;
    if (!capabilities) {
      const res = await fetch(`${url}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: name }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const details = await res.json();
      if (details.remote_host || details.remote_model) continue;
      capabilities = details.capabilities;
    }
    if (capabilities?.includes(capability)) return name;
  }
  return null;
}
