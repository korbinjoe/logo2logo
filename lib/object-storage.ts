import type { Environment, ObjectStorage } from "./types.ts";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { fault } from "./accounts.ts";

export function storageReady(env: Environment = process.env) {
  return [
    "R2_ENDPOINT",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ].every((key) => Boolean(env[key]));
}
export function createObjectStorage(
  env: Environment = process.env,
): ObjectStorage {
  if (!storageReady(env)) throw fault("STORAGE_UNAVAILABLE", 503);
  const client = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    maxAttempts: 2,
  });
  const key = (id: string) => {
    if (!/^[a-z0-9-]{1,100}$/i.test(id)) throw fault("OUTPUT_NOT_FOUND", 404);
    return `outputs/${id}.png`;
  };
  const args = (id: string) => ({ Bucket: env.R2_BUCKET, Key: key(id) });
  return {
    async put(id, bytes) {
      await client.send(
        new PutObjectCommand({
          ...args(id),
          Body: bytes,
          ContentType: "image/png",
          CacheControl: "private, max-age=0",
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    },
    async read(id) {
      const result = await client.send(new GetObjectCommand(args(id)), {
        abortSignal: AbortSignal.timeout(30000),
      });
      if (!result.Body) throw fault("OUTPUT_NOT_FOUND", 404);
      return Buffer.from(await result.Body.transformToByteArray());
    },
  };
}
