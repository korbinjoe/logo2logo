import { asError } from "./errors.ts";

// Provider responses may contain submitted input. Return only classified codes
// and a status for logging; never send raw upstream bodies to clients or logs.
export function imageProviderError(cause: unknown) {
  const error = asError(cause);
  const body = (error as Error & { body?: { detail?: unknown } }).body;
  const detail = typeof body?.detail === "string" ? body.detail : "";
  if (
    error.status === 402 ||
    (error.status === 403 &&
      /TOP_UP|exhausted balance|insufficient (balance|credits)/i.test(detail))
  )
    return { code: "IMAGE_PROVIDER_BILLING_REQUIRED", status: 503 };
  if (error.status === 401 || error.status === 403)
    return { code: "IMAGE_PROVIDER_ACCESS_DENIED", status: 503 };
  if (error.status === 429) return { code: "IMAGE_PROVIDER_BUSY", status: 503 };
  return { code: "GENERATION_SUBMIT_FAILED", status: 502 };
}
