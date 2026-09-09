import type { ApiFailure, GenerationEvent } from "../types.ts";
export class ApiError extends Error {
  data: ApiFailure;
  constructor(data: ApiFailure) {
    super(data.error || data.message || "Request failed");
    this.data = data;
  }
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init),
    data: unknown = await response.json();
  if (!response.ok) throw new ApiError(data as ApiFailure);
  return data as T;
}
export const post = <T>(url: string, body: unknown): Promise<T> =>
  request<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
export async function readGeneration(
  response: Response,
  onEvent: (event: GenerationEvent) => void,
): Promise<GenerationEvent> {
  if (!response.ok) throw new ApiError((await response.json()) as ApiFailure);
  if (response.status === 202) {
    const data = (await response.json()) as { jobId: string };
    return pollGeneration(data.jobId, onEvent);
  }
  if (!response.body) throw new Error("No response stream");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result: GenerationEvent | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as GenerationEvent;
    if (event.error)
      throw new ApiError({
        ...event,
        requestId:
          event.requestId || response.headers.get("x-request-id") || undefined,
      });
    onEvent(event);
    if (event.imageUrl) result = event;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(consume);
      if (done) {
        consume(buffer);
        break;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!result?.imageUrl || !result.id)
    throw new Error("没有返回图片，请重试。");
  return result;
}

export async function pollGeneration(
  jobId: string,
  onEvent: (event: GenerationEvent) => void,
): Promise<GenerationEvent> {
  if (!/^[a-z0-9-]{1,100}$/i.test(jobId))
    throw new Error("Invalid generation job");
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    let event: GenerationEvent;
    try {
      event = await post<GenerationEvent>(`/api/generations/${jobId}`, {});
    } catch (error) {
      // Resume polling this same durable job; never create another paid request.
      if (
        !(error instanceof ApiError) ||
        [
          "GENERATION_POLL_UNAVAILABLE",
          "SERVICE_UNAVAILABLE",
          "IMAGE_DOWNLOAD_FAILED",
        ].includes(error.data.code || "")
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      throw error;
    }
    onEvent(event);
    if (event.id && event.imageUrl) return event;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new ApiError({
    code: "GENERATION_PENDING",
    error:
      "This design is still processing. Open History to resume checking it.",
  });
}
