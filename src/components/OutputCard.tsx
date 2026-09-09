import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state";
import { request } from "../lib/api";
import type { Concept, OutputMetadata, SavedOutput } from "../types";
import { Disclosure } from "./Disclosure";
export interface DesignItem {
  key: string;
  c: Concept;
  record?: SavedOutput;
  status?: string;
  failure?: string;
}
export function OutputCard({
  item,
  scope,
  busy,
  onGenerate,
  onRetry,
}: {
  item: DesignItem;
  scope: string | null;
  busy: boolean;
  onGenerate: (c: Concept) => void;
  onRetry: () => void;
}) {
  const { t, error, preferences, saveOutput } = useAppState();
  const record =
    scope && item.record
      ? preferences.workspaces[scope]?.find((r) => r.id === item.record?.id) ||
        item.record
      : item.record;
  const canvas = useRef<HTMLCanvasElement>(null),
    previews = useRef<HTMLDivElement>(null),
    original = useRef<ImageData | null>(null);
  const [metadata, setMetadata] = useState<OutputMetadata | null>(null),
    [failure, setFailure] = useState(""),
    [loaded, setLoaded] = useState(false),
    [attempt, setAttempt] = useState(0);
  const id = record?.id,
    errorRef = useRef(error);
  errorRef.current = error;
  useEffect(() => {
    if (!id) return;
    let active = true;
    const controller = new AbortController();
    setLoaded(false);
    setFailure("");
    void (async () => {
      const data = await request<OutputMetadata>(
        `/outputs/${encodeURIComponent(id)}.json`,
        { cache: "no-store", signal: controller.signal },
      );
      const image = new Image();
      image.src = `/outputs/${encodeURIComponent(id)}.png`;
      await image.decode();
      if (!active || !canvas.current) return;
      const node = canvas.current;
      node.width = image.width;
      node.height = image.height;
      const ctx = node.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(image, 0, 0);
      original.current = ctx.getImageData(0, 0, node.width, node.height);
      setMetadata(data);
      setLoaded(true);
    })().catch((e) => {
      if (active) setFailure(errorRef.current(e));
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [id, attempt]);
  useEffect(() => {
    if (!loaded || !canvas.current || !original.current) return;
    const ctx = canvas.current.getContext("2d")!;
    if (record?.color) {
      const rgb = record.color
          .slice(1)
          .match(/.{2}/g)!
          .map((v) => parseInt(v, 16)),
        pixels = new ImageData(
          new Uint8ClampedArray(original.current.data),
          original.current.width,
          original.current.height,
        );
      for (let i = 0; i < pixels.data.length; i += 4) {
        const dark =
          (original.current.data[i] +
            original.current.data[i + 1] +
            original.current.data[i + 2]) /
            3 <
          170;
        for (let j = 0; j < 3; j++) pixels.data[i + j] = dark ? rgb[j] : 255;
      }
      ctx.putImageData(pixels, 0, 0);
    } else ctx.putImageData(original.current, 0, 0);
    previews.current?.querySelectorAll("canvas").forEach((small) => {
      const ctx = small.getContext("2d")!;
      ctx.clearRect(0, 0, small.width, small.height);
      ctx.drawImage(canvas.current!, 0, 0, small.width, small.height);
    });
  }, [loaded, record?.color]);
  const change = (value: Partial<SavedOutput>) => {
    if (scope && record) saveOutput(scope, { ...record, ...value });
  };
  const concept = {
      ...item.c,
      ...(metadata
        ? { designSpec: metadata.designSpec, prompt: metadata.prompt }
        : {}),
    },
    review = metadata?.review;
  const refine = (label: string, instruction: string) =>
    onGenerate({
      ...concept,
      name: label.replace("选中 · ", ""),
      phase: "refine",
      sourceId: id,
      referenceId: undefined,
      referenceFile: undefined,
      variation: instruction,
      prompt: `Edit the supplied selected logo, do not redesign it. ${instruction} Preserve its subject (${concept.designSpec?.subject || "the original symbol"}), recognition features (${concept.designSpec?.recognitionCue || "original silhouette"}), colors and lettering. Single flat mark on a plain white background. No new decorative elements.`,
    });
  return (
    <article
      className="concept-card"
      data-output-id={id}
      data-selected={Boolean(record?.selected)}
      hidden={record?.discarded}
    >
      <div className="canvas">
        <canvas ref={canvas} hidden={!loaded} />
        {!loaded && (failure || item.failure || t(item.status || "正在绘制…"))}
      </div>
      <h3>{t(concept.name || "saved.draft")}</h3>
      <p>{concept.thesis}</p>
      {concept.designSpec && (
        <Disclosure
          className="design-details"
          id={`${scope}:${id}:0`}
          title={t("查看设计依据")}
        >
          <p>{concept.designSpec.constructionZh}</p>
          <p>
            {t(
              concept.phase === "refine"
                ? "基于选中图片微调，保留原稿。"
                : "独立探索方向；先判断主体与轮廓，不是同一构型的重复微调。",
            )}
          </p>
        </Disclosure>
      )}
      {(failure || item.failure) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => (id ? setAttempt((v) => v + 1) : onRetry())}
        >
          {t(id ? "saved.retry" : "重试此方案")}
        </button>
      )}
      {loaded && (
        <>
          <p className="visual-review" role="status">
            {t(
              {
                pass: "主体初筛通过（非审美认证）",
                reject: "初筛建议淘汰",
                unreviewed: "未完成视觉检查",
              }[review?.status || "unreviewed"],
            )}
          </p>
          {review?.reason && (
            <Disclosure
              className="design-details"
              id={`${scope}:${id}:${concept.designSpec ? 1 : 0}`}
              title={t("查看初筛依据")}
            >
              <p>{review.reason}</p>
            </Disclosure>
          )}
          <div className="versions" ref={previews}>
            {[16, 32, 64].map((size) => (
              <span key={size}>
                <span>{t(size === 64 ? "反白" : `${size}px`)}</span>
                <canvas
                  width={size}
                  height={size}
                  style={size === 64 ? { filter: "invert(1)" } : undefined}
                />
              </span>
            ))}
          </div>
          <div className="actions">
            <input
              type="color"
              value={record?.color || "#111111"}
              title={t("调整颜色")}
              onChange={(e) => change({ color: e.target.value })}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!canvas.current) return;
                const a = document.createElement("a");
                a.href = canvas.current.toDataURL();
                a.download = "logo2logo.png";
                a.click();
              }}
            >
              {t("下载 PNG")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => change({ color: null })}
            >
              {t("恢复原图")}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={Boolean(record?.selected)}
              onClick={() => change({ selected: !record?.selected })}
            >
              {t("saved.select")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => change({ discarded: true })}
            >
              {t("淘汰此稿")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onGenerate({ ...concept, seed: (concept.seed || 0) + 1 })
              }
            >
              {t("重做此方向")}
            </button>
            {review?.status === "pass" &&
              (
                [
                  [
                    "选中 · 优化留白",
                    "Slightly open the internal negative spaces without changing the outer silhouette.",
                  ],
                  [
                    "选中 · 调整比例",
                    "Make the mark slightly more compact horizontally, keeping its recognizable anatomy and topology.",
                  ],
                ] as const
              ).map(([label, instruction]) => (
                <button
                  key={label}
                  type="button"
                  disabled={busy}
                  onClick={() => refine(label, instruction)}
                >
                  {t(label)}
                </button>
              ))}
            <small>
              {t(
                review?.status === "pass"
                  ? "选中后以这张实际图片为输入微调，不再从品牌参考图重抽。"
                  : "尚未通过主体初筛，不进入微调；可重做或下载草稿自行检查。",
              )}
            </small>
          </div>
        </>
      )}
    </article>
  );
}
