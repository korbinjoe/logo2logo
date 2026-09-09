import { useAppState } from "../state";
import type { Brand } from "../types";
export const styles = [
  {
    value: "simple clean linework, minimal detail, generous negative space",
    label: "简洁线条",
    description: "轻盈、干净、留白多",
    path: "M9 32 24 7l15 25Z M17 32l7-12 7 12",
  },
  {
    value: "bold solid shapes, strong contrast, recognizable silhouette",
    label: "醒目色块",
    description: "轮廓鲜明、一眼记住",
    path: "M7 7h17v26H7zM24 7h17L24 33z",
  },
  {
    value: "soft flowing curves, rounded organic forms",
    label: "柔和曲线",
    description: "圆润、流畅、有亲和力",
    path: "M25 6c15-8 22 12 9 16 16 11-2 22-10 11C10 46-1 27 12 22-3 12 12-2 25 6Z",
  },
];
export function Brief({
  selected,
  busy,
  onClear,
  onSubmit,
  onRetry,
  canRetry,
  message,
  editorStatus,
}: {
  selected: Brand | null;
  busy: boolean;
  onClear: () => void;
  onSubmit: () => void;
  onRetry: () => void;
  canRetry: boolean;
  message: string;
  editorStatus: string;
}) {
  const { preferences, update, t } = useAppState(),
    draft = preferences.draft;
  return (
    <form
      id="briefForm"
      className="quick-brief"
      hidden={!selected}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="form-heading">
        <span className="eyebrow">{t("02 / THE CREATIVE BRIEF")}</span>
        <span className="step-number">{t("参考已选定")}</span>
      </div>
      <h2>{t("你的品牌，从这里开始。")}</h2>
      <p className="form-intro">
        {t("参考已选好。现在告诉我们品牌名称、做什么，以及你想画什么。")}
      </p>
      <div id="referenceSelection" className="reference-selection">
        {selected && (
          <>
            <img
              src={"/reference/" + encodeURIComponent(selected.file)}
              alt={selected.name}
            />
            <span>
              {t("reference", {
                name: selected.name,
                file: selected.file,
                tags: selected.tags.map((tag) => t(tag)).join(" / "),
              })}
            </span>
            <a
              href={
                /^https?:\/\//.test(selected.url) ? selected.url : undefined
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("品牌来源 ↗")}
            </a>
            <button type="button" disabled={busy} onClick={onClear}>
              {t("重新选择")}
            </button>
          </>
        )}
      </div>
      <fieldset id="briefFields" disabled={busy || !selected}>
        <label className="field-label" htmlFor="description">
          {t("品牌简报")}
          <span>{t("必填")}</span>
        </label>
        <textarea
          id="description"
          required
          maxLength={1500}
          rows={4}
          value={draft.description}
          onChange={(e) =>
            update("draft", { ...draft, description: e.target.value })
          }
          placeholder={t(
            "例如：Mori，一家自然生活方式品牌。想用一片舒展的叶子做标志，深绿色，不需要文字。",
          )}
        />
        <fieldset className="style-field">
          <legend>{t("更喜欢哪种视觉表达？")}</legend>
          <div className="style-options">
            {styles.map((style, i) => (
              <label key={style.value}>
                <input
                  type="radio"
                  name="style"
                  value={style.value}
                  checked={(draft.style || styles[0].value) === style.value}
                  onChange={() =>
                    update("draft", { ...draft, style: style.value })
                  }
                />
                <span className="style-card">
                  <svg viewBox="0 0 48 40" aria-hidden="true">
                    <path
                      d={style.path}
                      fill={i === 0 ? "none" : "currentColor"}
                      stroke={i === 0 ? "currentColor" : undefined}
                      strokeWidth={i === 0 ? 2 : undefined}
                    />
                  </svg>
                  <b>{t(style.label)}</b>
                  <small>{t(style.description)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      <a
        className="reference-prompt"
        href="#inspiration"
        hidden={Boolean(selected)}
      >
        <span>{t("请先选择一个参考品牌 Logo")}</span>
        <span>{t("返回图库选择 ↗")}</span>
      </a>
      <button className="primary" type="submit" disabled={busy || !selected}>
        <span>{t("探索我的 Logo")}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <p className="form-footnote">
        {t("探索 3 个方向 · 选中草案 · 继续微调")}
      </p>
      <p id="message" role="status">
        {message}
      </p>
      <button
        type="button"
        className="text-button"
        hidden={!canRetry}
        disabled={busy}
        onClick={onRetry}
      >
        {t("仅重试失败方向")}
      </button>
      <p className="editor-status" role="status">
        {editorStatus}
      </p>
    </form>
  );
}
