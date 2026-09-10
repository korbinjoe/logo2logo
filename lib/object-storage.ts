import type { Environment, ObjectStorage } from "./types.ts";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { fault } from "./accounts.ts";
import { createCloudinaryStorage } from "./cloudinary-storage.ts";

export function storageProvider(env: Environment = process.env) {
  const provider =
    env.STORAGE_PROVIDER || (env.CLOUDINARY_CLOUD_NAME ? "cloudinary" : "r2");
  return provider === "r2" || provider === "cloudinary"
    ? provider
    : "unconfigured";
}

export function storageReady(env: Environment = process.env) {
  if (storageProvider(env) === "unconfigured") return false;
  if (storageProvider(env) === "cloudinary")
    return [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ].every((key) => Boolean(env[key]));
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
  if (storageProvider(env) === "cloudinary")
    return createCloudinaryStorage(env);
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
