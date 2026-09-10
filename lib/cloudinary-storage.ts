import { v2 as cloudinary } from "cloudinary";
import type { Environment, ObjectStorage } from "./types.ts";
import { fault } from "./accounts.ts";

// Never publish provider URLs: the app checks ownership before reading bytes.
export function createCloudinaryStorage(env: Environment): ObjectStorage {
  const options = {
    cloud_name: env.CLOUDINARY_CLOUD_NAME!,
    api_key: env.CLOUDINARY_API_KEY!,
    api_secret: env.CLOUDINARY_API_SECRET!,
    resource_type: "image" as const,
    type: "authenticated" as const,
    secure: true,
  };
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(options.cloud_name)}`;
  const publicId = (id: string) => {
    if (!/^[a-z0-9-]{1,100}$/i.test(id)) throw fault("OUTPUT_NOT_FOUND", 404);
    return `logo2logo/outputs/${id}`;
  };
  return {
    async put(id, bytes) {
      const body = new FormData();
      body.set("public_id", publicId(id));
      body.set("type", "authenticated");
      body.set("overwrite", "true");
      body.set(
        "file",
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        "output.png",
      );
      const response = await cloudinaryRequest(`${endpoint}/image/upload`, {
        method: "POST",
        headers: { Authorization: cloudinaryAuthorization(env) },
        body,
      });
      const uploaded = await response.json().catch(() => null);
      if (
        uploaded?.type !== "authenticated" ||
        uploaded?.public_id !== publicId(id)
      )
        throw fault("STORAGE_UNAVAILABLE", 503);
    },
    async read(id) {
      const url = cloudinary.utils.private_download_url(publicId(id), "png", {
        ...options,
        expires_at: Math.floor(Date.now() / 1000) + 60,
        attachment: false,
      });
      const response = await cloudinaryRequest(url, {}, true);
      try {
        return Buffer.from(await response.arrayBuffer());
      } catch {
        throw fault("STORAGE_UNAVAILABLE", 503);
      }
    },
  };
}

function cloudinaryAuthorization(env: Environment) {
  return `Basic ${Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString("base64")}`;
}

async function cloudinaryRequest(
  url: string,
  init: RequestInit,
  reading = false,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    // Fetch errors may contain a signed URL; keep credentials out of logs/API errors.
    throw fault("STORAGE_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (reading && response.status === 404)
      throw fault("OUTPUT_NOT_FOUND", 404);
    throw fault("STORAGE_UNAVAILABLE", 503);
  }
  return response;
}

export async function checkCloudinaryAccess(env: Environment = process.env) {
  const response = await cloudinaryRequest(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME!)}/ping`,
    { headers: { Authorization: cloudinaryAuthorization(env) } },
  );
  await response.body?.cancel();
}
