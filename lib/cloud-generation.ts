import type {
  DesignInput,
  Environment,
  ObjectStorage,
  Metadata,
  GenerationEvent,
} from "./types.ts";
import type { createCloudState } from "./cloud-state.ts";
import { asError } from "./errors.ts";
import { createFalClient } from "@fal-ai/client";
import sharp from "sharp";
import { join } from "node:path";
import { fault } from "./accounts.ts";
import { logoRoot, resolveReference } from "./gallery.ts";
import { historyConcept } from "./design-history.ts";
import { reviewImage } from "./visual-review.ts";

export const imageEndpoint = "fal-ai/flux-2/klein/4b/edit";
export const explorationEndpoint = "fal-ai/flux-2/klein/4b";
export interface CloudGenerationOptions {
  state: ReturnType<typeof createCloudState>;
  storage: ObjectStorage;
  env?: Environment;
  provider?: ReturnType<typeof createFalClient>;
  review?: typeof reviewImage;
  fetcher?: typeof fetch;
}
export function createCloudGeneration({
  state,
  storage,
  env = process.env,
  provider = createFalClient({
    credentials: env.FAL_KEY,
    retry: { maxRetries: 0 },
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(30000) }),
  }),
  review = reviewImage,
  fetcher = fetch,
}: CloudGenerationOptions) {
  return {
    async submit(userId: string, input: DesignInput) {
      if (
        typeof input.prompt !== "string" ||
        !input.prompt.trim() ||
        input.prompt.length > 16000
      )
        throw fault("INVALID_PROMPT");
      let source;
      if (input.sourceId) {
        const parent = await state.job(input.sourceId, userId);
        if (
          parent.status !== "complete" ||
          parent.metadata?.review?.status !== "pass"
        )
          throw fault("SOURCE_NOT_APPROVED");
        input = {
          ...input,
          designSpec: parent.metadata.designSpec,
          referenceId: parent.metadata.referenceId,
          referenceFile: parent.metadata.referenceFile,
        };
        source = await storage.read(input.sourceId!);
      } else {
        if (!input.referenceId) throw fault("REFERENCE_REQUIRED");
        const ref = await resolveReference(
          input.referenceId,
          input.referenceFile,
        );
        if (!ref) throw fault("INVALID_REFERENCE");
        input = { ...input, referenceFile: ref.file };
        source = join(logoRoot, "logos", ref.file);
      }
      const edit =
        Boolean(input.sourceId) || input.promptVersion !== "exploration-v2";
      const bytes = edit
        ? await sharp(source)
            .resize(768, 768, { fit: "contain", background: "#fff" })
            .flatten({ background: "#fff" })
            .png()
            .toBuffer()
        : null;
      const endpoint = edit ? imageEndpoint : explorationEndpoint;
      const { id, existing, callbackToken } = await state.reserve(
        userId,
        input,
        endpoint,
      );
      if (existing) return { jobId: id, stage: "editing" };
      try {
        // Exactly one submit per durable reservation; never resubmit on poll or cold start.
        const result = await provider.queue.submit(endpoint, {
          input: {
            prompt: input.prompt!,
            ...(bytes
              ? {
                  image_urls: [
                    `data:image/png;base64,${bytes.toString("base64")}`,
                  ],
                }
              : {}),
            image_size: { width: 1024, height: 1024 },
            num_images: 1,
            output_format: "png",
            enable_safety_checker: true,
            seed: Number(input.seed) || 42,
          },
          ...(env.APP_URL
            ? {
                webhookUrl: `${env.APP_URL.replace(/\/$/, "")}/api/generations/${id}/callback?token=${callbackToken}`,
              }
            : {}),
        });
        await state.submitted(id, result.request_id);
        return { jobId: id, stage: "editing" };
      } catch {
        // An ambiguous network failure may have reached fal. Refund this reservation;
        // never automatically send a second paid upstream request.
        await state.fail(id, "GENERATION_SUBMIT_FAILED");
        throw fault("GENERATION_SUBMIT_FAILED", 502);
      }
    },
    async poll(id: string, userId: string): Promise<GenerationEvent> {
      const job = await state.job(id, userId);
      const done = (metadata: Metadata | null) => ({
        done: true,
        id,
        imageUrl: `/outputs/${id}.png`,
        ...metadata,
      });
      if (job.status === "complete") return done(job.metadata);
      if (job.status === "released")
        throw fault(job.error || "GENERATION_FAILED", 422);
      if (!job.request_id) {
        if (Date.now() - job.created > 300000) {
          await state.fail(id, "GENERATION_INTERRUPTED");
          throw fault("GENERATION_INTERRUPTED", 422);
        }
        return { stage: "editing" };
      }
      let status;
      try {
        status = await provider.queue.status(job.endpoint, {
          requestId: job.request_id,
          logs: false,
        });
      } catch (cause) {
        const error = asError(cause);
        if (error.status === 404 && Date.now() - job.created > 86400000) {
          await state.fail(id, "GENERATION_EXPIRED");
          throw fault("GENERATION_EXPIRED", 422);
        }
        throw fault("GENERATION_POLL_UNAVAILABLE", 503);
      }
      if (status.status !== "COMPLETED") return { stage: "editing" };
      const lease = await state.claim(id);
      if (!lease) return { stage: "reviewing" };
      try {
        let result;
        try {
          result = await provider.queue.result(job.endpoint, {
            requestId: job.request_id,
          });
        } catch (cause) {
          const error = asError(cause);
          if (
            (error.status || 0) >= 400 &&
            (error.status || 0) < 500 &&
            error.status !== 429
          ) {
            await state.fail(id, "GENERATION_FAILED");
            throw fault("GENERATION_FAILED", 422);
          }
          throw error;
        }
        const data = result.data;
        if (data.has_nsfw_concepts?.some(Boolean) || !data.images?.[0]?.url) {
          await state.fail(id, "GENERATION_NO_IMAGE");
          throw fault("GENERATION_NO_IMAGE", 422);
        }
        const url = new URL(data.images[0].url);
        if (
          url.protocol !== "https:" ||
          !(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))
        )
          throw fault("INVALID_IMAGE_HOST", 502);
        const response = await fetcher(url, {
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        });
        if (!response.ok || !response.body)
          throw fault("IMAGE_DOWNLOAD_FAILED", 502);
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 16 * 1024 * 1024) throw fault("IMAGE_TOO_LARGE", 502);
          chunks.push(chunk);
        }
        const bytes = await sharp(Buffer.concat(chunks), {
          limitInputPixels: 4096 * 4096,
        })
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();
        const metadata = {
          backend: "fal",
          model: job.endpoint,
          renderMode: job.input.sourceId ? "edit" : "explore",
          sourceId: job.input.sourceId,
          referenceId: job.input.referenceId,
          referenceFile: job.input.referenceFile,
          concept: historyConcept(job.input),
          prompt: job.input.prompt,
          promptVersion: job.input.promptVersion,
          designSpec: job.input.designSpec,
          variation: job.input.variation,
          seed: job.input.seed,
          createdAt: new Date(job.created).toISOString(),
          review: await review(
            bytes,
            job.input.designSpec,
            "",
            job.input.locale,
          ),
        };
        await storage.put(id, bytes);
        await state.complete(id, lease, metadata);
        return done(metadata);
      } finally {
        await state.unlock(id, lease);
      }
    },
  };
}
