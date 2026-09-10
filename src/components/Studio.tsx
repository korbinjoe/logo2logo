import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../state";
import { useCommerce } from "../commerce";
import { post, readGeneration, request, ApiError } from "../lib/api";
import type {
  Brand,
  Concept,
  PlanInput,
  PlanResponse,
  SavedOutput,
  Variant,
} from "../types";
import { History } from "./History";
import { Hero } from "./Hero";
import { Gallery } from "./Gallery";
import { Brief, styles } from "./Brief";
import { OutputCard, type DesignItem } from "./OutputCard";
interface PlanSession {
  input: PlanInput;
  resumeId?: string;
  rendered: Set<string>;
}
export function Studio() {
  const { preferences, update, t, error, locale, saveOutput } = useAppState(),
    { scope, ensureAccess, refresh } = useCommerce();
  const [logos, setLogos] = useState<Brand[]>([]),
    [loading, setLoading] = useState(true),
    [galleryError, setGalleryError] = useState("");
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    [items, setItems] = useState<DesignItem[]>([]),
    [message, setMessage] = useState(""),
    [summary, setSummary] = useState(""),
    [canRetry, setCanRetry] = useState(false),
    [editor, setEditor] = useState("");
  const plan = useRef<PlanSession | null>(null),
    scopeRef = useRef(scope),
    prefsRef = useRef(preferences),
    epoch = useRef(0),
    restoredPosition = useRef(false);
  prefsRef.current = preferences;
  const draft = preferences.draft,
    errorRef = useRef(error);
  errorRef.current = error;
  const selected = useMemo(() => {
    const brand = logos.find((l) => l.id === draft.referenceId),
      variant = brand?.variants.find((v) => v.file === draft.referenceFile);
    return brand && variant ? { ...brand, ...variant } : null;
  }, [logos, draft.referenceId, draft.referenceFile]);
  useEffect(() => {
    const controller = new AbortController();
    void request<{ logos: Brand[] }>("/api/logos", {
      signal: controller.signal,
    })
      .then((data) => {
        const featured = [
          "replit",
          "linear",
          "figma",
          "slack",
          "notion",
          "vercel",
          "airbnb",
          "stripe",
          "dropbox",
          "github",
          "discord",
          "claude",
        ];
        const list = data.logos.sort((a, b) => {
          const ai = featured.indexOf(a.id),
            bi = featured.indexOf(b.id);
          return (
            (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) ||
            a.name.localeCompare(b.name)
          );
        });
        setLogos(list);
        setLoading(false);
        const saved = prefsRef.current.draft,
          brand = list.find((l) => l.id === saved.referenceId);
        if (
          saved.referenceId &&
          !brand?.variants.some((v) => v.file === saved.referenceFile)
        )
          update("draft", { ...saved, referenceId: "", referenceFile: "" });
        if (saved.style && !styles.some((s) => s.value === saved.style))
          update("draft", {
            ...prefsRef.current.draft,
            style: styles[0].value,
          });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setGalleryError(errorRef.current(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [update]);
  useEffect(() => {
    let active = true;
    const check = async () => {
      const data = await request<{ state: string }>("/api/editor-status").catch(
        () => ({ state: "unavailable" }),
      );
      if (active)
        setEditor(
          (
            {
              downloading: "参考图编辑引擎正在下载，完成后即可开始设计。",
              verifying: "参考图编辑引擎正在运行图像对照验证。",
              failed: "参考图编辑验证失败，尚未启用。",
              blocked: "参考图编辑下载未完成，尚未启用。",
            } as Record<string, string>
          )[data.state] || "",
        );
    };
    void check();
    const timer = setInterval(() => void check(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (scopeRef.current !== scope) {
      epoch.current++;
      lock.current = false;
      setBusy(false);
      plan.current = null;
      setCanRetry(false);
      setMessage("");
    }
    scopeRef.current = scope;
    const records = scope ? prefsRef.current.workspaces[scope] || [] : [];
    setItems(
      records.map((record) => ({ key: record.id, c: record.c, record })),
    );
    setSummary(records.length ? "saved.heading" : "");
  }, [scope]);
  useEffect(() => {
    if (loading || restoredPosition.current) return;
    restoredPosition.current = true;
    const id =
      location.hash.slice(1) ||
      (!location.search ? prefsRef.current.section : null);
    if (id)
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el && !el.hidden && !el.classList.contains("hidden"))
          el.scrollIntoView();
      });
  }, [loading]);
  const scroll = (id: string) =>
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: id === "briefForm" ? "center" : "start",
      }),
    );
  const choose = (brand: Brand, variant: Variant) => {
    update("draft", {
      ...draft,
      referenceId: brand.id,
      referenceFile: variant.file,
    });
    update("section", "briefForm");
    scroll("briefForm");
  };
  const clear = () => {
    update("draft", { ...draft, referenceId: "", referenceFile: "" });
    update("section", "inspiration");
    scroll("inspiration");
    document.getElementById("logoSearch")?.focus({ preventScroll: true });
  };
  const patch = useCallback(
    (key: string, value: Partial<DesignItem>) =>
      setItems((items) =>
        items.map((item) => (item.key === key ? { ...item, ...value } : item)),
      ),
    [],
  );
  async function generate(
    c: Concept,
    token: number,
    key: string = crypto.randomUUID(),
  ) {
    const owner = scopeRef.current;
    if (!(await ensureAccess(1)) || token !== epoch.current) return;
    setItems((items) => [
      ...items.filter((item) => item.key !== key),
      { key, c, status: "正在绘制…" },
    ]);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: c.name,
          thesis: c.thesis,
          locale: c.locale || locale,
          prompt: c.prompt,
          seed: c.seed,
          sourceId: c.sourceId,
          referenceId: c.referenceId,
          referenceFile: c.referenceFile,
          promptVersion: c.promptVersion,
          designSpec: c.designSpec,
          variation: c.variation,
        }),
      });
      const result = await readGeneration(response, (event) => {
        if (token !== epoch.current) return;
        if (event.total)
          patch(key, {
            status: t("drawing", {
              percent: Math.round(((event.completed || 0) / event.total) * 100),
            }),
          });
        if (event.stage === "reviewing")
          patch(key, { status: "正在检查实际图像中的主体与结构…" });
      });
      const record: SavedOutput = {
        id: result.id!,
        c,
        color: null,
        selected: false,
        discarded: false,
      };
      if (owner) saveOutput(owner, record);
      if (token === epoch.current) patch(key, { record, status: undefined });
    } catch (e) {
      if (token === epoch.current)
        patch(key, { failure: error(e), status: undefined });
      if (
        e instanceof ApiError &&
        [
          "IMAGE_PROVIDER_BILLING_REQUIRED",
          "IMAGE_PROVIDER_ACCESS_DENIED",
          "IMAGE_PROVIDER_BUSY",
        ].includes(e.data.code || "")
      ) {
        if (token === epoch.current) setMessage(error(e));
        return false;
      }
    } finally {
      void refresh().catch(() => {});
    }
  }
  const generateOne = async (c: Concept, key?: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const token = epoch.current;
    try {
      await generate(c, token, key);
    } finally {
      if (token === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  async function runPlanning(resume: boolean) {
    if (lock.current) return;
    if (!selected) {
      setMessage(t("请先选择参考品牌 Logo。"));
      scroll("inspiration");
      return;
    }
    const input: PlanInput = {
      locale: resume && plan.current ? plan.current.input.locale : locale,
      description: draft.description,
      style: draft.style || styles[0].value,
      referenceId: selected.id,
      referenceFile: selected.file,
    };
    if (
      resume &&
      JSON.stringify(input) !== JSON.stringify(plan.current?.input)
    ) {
      setMessage(t("描述或参考图已改变，请重新点击生成，开始新的设计。"));
      return;
    }
    lock.current = true;
    setBusy(true);
    const token = epoch.current;
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      if (!(await ensureAccess(3)) || token !== epoch.current) return;
      if (!resume) {
        plan.current = { input, rendered: new Set() };
        setItems([]);
        setCanRetry(false);
      }
      const session = plan.current!;
      setMessage(
        t(
          resume
            ? "仅重新规划失败方向，已成功的草案保持不变…"
            : "正在探索三个不同方向，检查主体辨识特征…",
        ),
      );
      const started = Date.now();
      timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        if (token === epoch.current)
          setMessage(
            t("waiting", {
              seconds,
              detail: t(
                seconds >= 60
                  ? "模型响应较慢；单次规划超时后会停止并显示错误。"
                  : "正在生成设计方向。",
              ),
            }),
          );
      }, 1000);
      const response = await post<PlanResponse>("/api/territories", {
        ...input,
        ...(resume ? { resumeId: session.resumeId } : {}),
      });
      clearInterval(timer);
      if (token !== epoch.current) return;
      session.resumeId = response.resumeId;
      setSummary(
        response.status === "partial"
          ? t("partialSummary", { count: response.territories.length })
          : "先比较三个不同方向。淘汰主体不符的草案，选中后再微调。",
      );
      scroll("board");
      const failures = (response.failures || [])
        .map(
          (f) =>
            `${t(f.name || "")}: ${error(new ApiError(f))} [${f.code}${f.field ? "/" + f.field : ""}]`,
        )
        .join("; ");
      if (failures) setMessage(t("drawAccepted", { failures }));
      for (const [index, c] of response.territories.entries()) {
        if (token !== epoch.current) break;
        const id = c.id || String(index);
        if (!session.rendered.has(id)) {
          session.rendered.add(id);
          if ((await generate(c, token)) === false) return;
        }
      }
      if (token !== epoch.current) return;
      setCanRetry(response.status === "partial");
      setMessage(
        failures
          ? `${failures} ${t(response.territories.length ? "已保留成功方案，可仅重试失败方向。" : "本次没有生成有效方向，可稍后重试。")}${response.requestId ? t("requestId", { id: response.requestId }) : ""}`
          : t(
              "先看主体是否正确，再比较轮廓。视觉初筛不代表审美认证；淘汰不合格草案，选中后才微调。",
            ),
      );
    } catch (e) {
      if (token === epoch.current) {
        if (
          e instanceof ApiError &&
          ["PLAN_EXPIRED", "PLANNER_CHANGED"].includes(e.data.code || "")
        )
          setCanRetry(false);
        setMessage(error(e));
      }
    } finally {
      clearInterval(timer);
      if (token === epoch.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <Hero selected={Boolean(selected)} />
      <Gallery
        logos={logos}
        selected={selected}
        busy={busy}
        loading={loading}
        error={galleryError}
        onSelect={choose}
      />
      <Brief
        selected={selected}
        busy={busy}
        onClear={clear}
        onSubmit={() => void runPlanning(false)}
        onRetry={() => void runPlanning(true)}
        canRetry={canRetry}
        message={message}
        editorStatus={t(editor)}
      />
      <section
        id="board"
        className={`board ${!summary && !items.length ? "hidden" : ""}`}
      >
        <p className="eyebrow">{t("YOUR DIRECTIONS")}</p>
        <h2 id="summary">{t(summary)}</h2>
        <div className="saved-board-actions">
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!scope) return;
              update("workspaces", {
                ...preferences.workspaces,
                [scope]: (preferences.workspaces[scope] || []).map(
                  (record) => ({ ...record, discarded: false }),
                ),
              });
            }}
          >
            {t("saved.restore")}
          </button>
        </div>
        <div id="conceptGrid" className="concept-grid">
          {items.map((item) => (
            <OutputCard
              key={item.key}
              item={item}
              scope={scope}
              busy={busy}
              onGenerate={(c) => void generateOne(c)}
              onRetry={() => void generateOne(item.c, item.key)}
            />
          ))}
        </div>
      </section>
      <History
        key={scope || "guest"}
        onOpen={(record) => {
          if (lock.current) return;
          if (scope) saveOutput(scope, { ...record, discarded: false });
          setItems((items) =>
            items.some((item) => item.record?.id === record.id)
              ? items
              : [
                  ...items,
                  {
                    key: record.id,
                    c: record.c,
                    record: { ...record, discarded: false },
                  },
                ],
          );
          setSummary("saved.heading");
          update("section", "board");
          scroll("board");
        }}
        busy={busy}
      />
    </>
  );
}
