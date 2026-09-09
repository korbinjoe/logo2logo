import type { DesignInput, Metadata, HistoryEntry } from "./types.ts";
import type { IncomingMessage } from "node:http";
import type { createCommerce } from "./commerce.ts";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
const validId = /^[a-zA-Z0-9_-]{1,100}$/;
export async function readHistoryItem(outputDir: string, entry: HistoryEntry) {
  const id = entry.output;
  if (!validId.test(id)) return null;
  try {
    const [raw] = await Promise.all([
      readFile(join(outputDir, `${id}.json`), "utf8"),
      stat(join(outputDir, `${id}.png`)),
    ]);
    return historyItem(id, JSON.parse(raw), entry.created);
  } catch {
    return {
      id,
      createdAt: new Date(entry.created).toISOString(),
      title: "",
      review: "unreviewed",
      phase: "explore",
      unavailable: true,
      c: {},
    };
  }
}
export async function historyPage({
  commerce,
  outputDir,
  req,
  page,
}: {
  commerce: ReturnType<typeof createCommerce>;
  outputDir: string;
  req: IncomingMessage;
  page: number;
}) {
  const index = Math.max(
      0,
      Math.min(100000, Number.isSafeInteger(page) ? page : 0),
    ),
    limit = 24;
  let entries, total;
  if (commerce.localMode) {
    const files = (await readdir(outputDir)).filter(
      (file) => file.endsWith(".json") && validId.test(file.slice(0, -5)),
    );
    const all = await Promise.all(
      files.map(async (file) => ({
        output: file.slice(0, -5),
        created: (await stat(join(outputDir, file))).mtimeMs,
      })),
    );
    all.sort(
      (a, b) => b.created - a.created || b.output.localeCompare(a.output),
    );
    total = all.length;
    entries = all.slice(index * limit, (index + 1) * limit);
  } else {
    const account = await commerce.requireUser(req),
      result = await commerce.store.history(account.id, index, limit);
    entries = result.items;
    total = result.total;
  }
  const items = (
    await Promise.all(entries.map((entry) => readHistoryItem(outputDir, entry)))
  ).filter(Boolean);
  return { items, total, page: index, hasMore: (index + 1) * limit < total };
}
export function historyConcept(
  input: DesignInput,
): DesignInput & { phase: string } {
  return {
    name: typeof input.name === "string" ? input.name.slice(0, 300) : "",
    thesis:
      typeof input.thesis === "string" ? input.thesis.slice(0, 10000) : "",
    referenceId: input.referenceId,
    referenceFile: input.referenceFile,
    sourceId: input.sourceId,
    locale: input.locale === "zh" ? "zh" : "en",
    phase: input.sourceId ? "refine" : "explore",
  };
}

export function historyItem(id: string, metadata: Metadata, created: number) {
  const spec = metadata.designSpec || {},
    stored = metadata.concept || {};
  const createdAt = Number.isFinite(Date.parse(metadata.createdAt || ""))
    ? metadata.createdAt
    : new Date(created).toISOString();
  return {
    id,
    createdAt,
    title: String(spec.brandName || stored.name || "").slice(0, 200),
    review: metadata.review?.status || "unreviewed",
    phase: metadata.sourceId || stored.sourceId ? "refine" : "explore",
    c: {
      ...stored,
      name: stored.name || spec.brandName || "",
      thesis: stored.thesis || spec.constructionZh || "",
      prompt: metadata.prompt,
      designSpec: spec,
      seed: metadata.seed,
      sourceId: metadata.sourceId || stored.sourceId,
      referenceId: metadata.referenceId || stored.referenceId,
      referenceFile: metadata.referenceFile || stored.referenceFile,
      promptVersion: metadata.promptVersion,
      locale: stored.locale || metadata.locale,
      phase: metadata.sourceId || stored.sourceId ? "refine" : "explore",
    },
  };
}
