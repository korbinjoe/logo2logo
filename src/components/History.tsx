import { useCallback, useEffect, useRef, useState } from "react";
import { useAppState } from "../state";
import { useCommerce } from "../commerce";
import { request, pollGeneration } from "../lib/api";
import type { HistoryItem, HistoryPage, SavedOutput } from "../types";
export function History({
  onOpen,
  busy,
}: {
  onOpen: (record: SavedOutput) => void;
  busy: boolean;
}) {
  const { t, error, locale, preferences } = useAppState(),
    { scope, setOpen, config } = useCommerce();
  const [items, setItems] = useState<HistoryItem[]>([]),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(false),
    [failure, setFailure] = useState(""),
    [pending, setPending] = useState<{ id: string }[]>([]),
    [checking, setChecking] = useState(false),
    [selected, setSelected] = useState<HistoryItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    version = useRef(0),
    loadingRef = useRef(false),
    errorRef = useRef(error);
  errorRef.current = error;
  const latest = scope
    ? (preferences.workspaces[scope] || []).map((item) => item.id).join(",")
    : "";
  const load = useCallback(
    async (index: number, replace = false) => {
      if (!scope) return;
      const current = version.current;
      loadingRef.current = true;
      setLoading(true);
      setFailure("");
      try {
        const result = await request<HistoryPage>(
          `/api/history?page=${index}`,
          { cache: "no-store" },
        );
        if (current !== version.current) return;
        setItems((previous) =>
          replace
            ? result.items
            : [
                ...previous,
                ...result.items.filter(
                  (item) => !previous.some((old) => old.id === item.id),
                ),
              ],
        );
        setTotal(result.total);
        setPending(result.pending || []);
        setPage(result.page);
        setHasMore(result.hasMore);
      } catch (e) {
        if (current === version.current) setFailure(errorRef.current(e));
      } finally {
        if (current === version.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [scope],
  );
  useEffect(() => {
    version.current++;
    setItems([]);
    setTotal(0);
    setPage(0);
    setHasMore(false);
    setSelected(null);
    setFailure("");
    setPending([]);
    setChecking(false);
    setLoading(false);
    if (scope) void load(0, true);
    return () => {
      version.current++;
    };
  }, [scope, latest, load]);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const openEditor = (item: HistoryItem) => {
    const saved = scope
      ? preferences.workspaces[scope]?.find((record) => record.id === item.id)
      : undefined;
    onOpen(
      saved || {
        id: item.id,
        c: item.c,
        color: null,
        discarded: false,
        selected: false,
      },
    );
    setSelected(null);
  };
  return (
    <section
      id="history"
      className="history-section"
      aria-labelledby="historyTitle"
    >
      <div className="history-heading">
        <div>
          <p className="eyebrow">{t("history.eyebrow")}</p>
          <h2 id="historyTitle">{t("history.title")}</h2>
          <p>{t("history.intro")}</p>
        </div>
        <div className="history-heading-actions">
          {scope && (
            <>
              <span>{t("history.count", { count: total })}</span>
              <button
                className="text-button"
                type="button"
                disabled={loading}
                onClick={() => {
                  if (!loadingRef.current) void load(0, true);
                }}
              >
                {t("history.refresh")}
              </button>
            </>
          )}
        </div>
      </div>
      {!scope ? (
        <div className="history-empty">
          <span className="archive-symbol" aria-hidden="true">
            ↺
          </span>
          <p>{t("history.signin")}</p>
          <button type="button" onClick={() => setOpen(true)}>
            {t("shop.signin")}
          </button>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="history-empty" role="status">
              <p>
                {locale === "zh"
                  ? "你有正在云端处理的 Logo，刷新页面不会丢失任务。"
                  : "A logo is processing in the cloud. Your task is saved even after refreshing."}
              </p>
              <button
                type="button"
                disabled={checking || busy}
                onClick={async () => {
                  const current = version.current;
                  setChecking(true);
                  setFailure("");
                  try {
                    for (const job of pending)
                      await pollGeneration(job.id, () => {});
                    if (current === version.current) await load(0, true);
                  } catch (e) {
                    if (current === version.current)
                      setFailure(errorRef.current(e));
                  } finally {
                    if (current === version.current) setChecking(false);
                  }
                }}
              >
                {checking
                  ? locale === "zh"
                    ? "正在检查…"
                    : "Checking…"
                  : locale === "zh"
                    ? "查看生成进度"
                    : "Check progress"}
              </button>
            </div>
          )}
          {failure && (
            <p role="alert" className="history-error">
              {failure}
            </p>
          )}
          {loading && <p role="status">{t("history.loading")}</p>}
          {!loading && !failure && !items.length && (
            <div className="history-empty">
              <span className="archive-symbol" aria-hidden="true">
                ↺
              </span>
              <p>{t("history.empty")}</p>
              <a href="#inspiration">{t("history.start")}</a>
            </div>
          )}
          <div className="history-grid">
            {items.map((item) => (
              <article
                key={item.id}
                className="history-card"
                data-history-id={item.id}
              >
                <button
                  type="button"
                  className="history-preview"
                  disabled={item.unavailable}
                  aria-label={`${t("history.view")}: ${item.title || t("history.untitled")}`}
                  onClick={() => setSelected(item)}
                >
                  {item.unavailable ? (
                    <span>{t("history.unavailable")}</span>
                  ) : (
                    <img
                      src={`/outputs/${encodeURIComponent(item.id)}.png`}
                      alt={item.title || t("history.untitled")}
                      loading="lazy"
                    />
                  )}
                  <span className="history-phase">
                    {t(
                      item.phase === "refine"
                        ? "history.refined"
                        : "history.original",
                    )}
                  </span>
                </button>
                <div className="history-card-caption">
                  <strong>{item.title || t("history.untitled")}</strong>
                  <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
                </div>
              </article>
            ))}
          </div>
          {hasMore && (
            <button
              className="text-button history-more"
              type="button"
              disabled={loading}
              onClick={() => {
                if (!loadingRef.current) void load(page + 1);
              }}
            >
              {t("history.loadMore")}
            </button>
          )}
          <p className="history-note">
            {t(config?.localMode ? "history.local" : "history.saved")}
          </p>
        </>
      )}
      <dialog
        className="history-dialog"
        ref={dialog}
        aria-labelledby="historyPreviewTitle"
        onClose={() => setSelected(null)}
        onCancel={() => setSelected(null)}
      >
        <div className="brand-detail-top">
          <span className="eyebrow">{t("history.title")}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => setSelected(null)}
          >
            {t("关闭 ×")}
          </button>
        </div>
        {selected && (
          <>
            <div className="history-full-image">
              <img
                src={`/outputs/${encodeURIComponent(selected.id)}.png`}
                alt={selected.title || t("history.untitled")}
              />
            </div>
            <div className="history-full-details">
              <h2 id="historyPreviewTitle">
                {selected.title || t("history.untitled")}
              </h2>
              <time dateTime={selected.createdAt}>
                {date(selected.createdAt)}
              </time>
              <p>
                {selected.c.thesis || selected.c.designSpec?.constructionZh}
              </p>
              <p className="source-caption">
                {t(
                  {
                    pass: "主体初筛通过（非审美认证）",
                    reject: "初筛建议淘汰",
                    unreviewed: "未完成视觉检查",
                  }[selected.review] || "未完成视觉检查",
                )}
              </p>
            </div>
            <div className="brand-detail-bottom">
              <a
                href={`/outputs/${encodeURIComponent(selected.id)}.png`}
                download={`logo2logo-${selected.id}.png`}
              >
                {t("history.download")}
              </a>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => openEditor(selected)}
              >
                {t("history.open")}
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
