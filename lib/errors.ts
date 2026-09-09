export interface ServiceError extends Error {
  code?: string;
  status?: number;
  field?: string;
  userMessage?: string;
  missing?: string[];
  $metadata?: { httpStatusCode?: number };
}
export function asError(value: unknown): ServiceError {
  if (value instanceof Error) return value as ServiceError;
  return new Error(typeof value === "string" ? value : "Unexpected error");
}
