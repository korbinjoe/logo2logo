import { BrandDetail } from "./BrandDetail";
import { ReactionButtons } from "./ReactionButtons";
import { useMemo, useState } from "react";
import { useAppState } from "../state";
import type { Brand, Variant } from "../types";
export function Gallery({
  logos,
  selected,
  busy,
  loading,
  error,
  onSelect,
}: {
  logos: Brand[];
  selected: Brand | null;
  busy: boolean;
  loading: boolean;
  error: string;
  onSelect: (brand: Brand, variant: Variant) => void;
}) {
  const { t, preferences, update } = useAppState(),
    { query, filter, visible } = preferences.gallery;
  const [dialogBrand, setDialogBrand] = useState<Brand | null>(null);
  const ordered = useMemo(() => {
    const rank = new Map(
      preferences.galleryOrder.map((id, index) => [id, index]),
    );
    return [...logos].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
    );
  }, [logos, preferences.galleryOrder]);
  const matches = useMemo(
    () =>
      ordered.filter(
        (l) =>
          (l.name.toLowerCase().includes(query.trim().toLowerCase()) ||
            l.id.includes(query.trim().toLowerCase()) ||
            l.variants.some((v) =>
              v.file.toLowerCase().includes(query.trim().toLowerCase()),
            )) &&
          (!filter || l.variants.some((v) => v.tags.includes(filter))) &&
          (preferences.galleryCollection === "all" ||
            (preferences.galleryCollection === "favorites"
              ? preferences.brandReactions[l.id]?.favorite
              : preferences.brandReactions[l.id]?.vote ===
                (preferences.galleryCollection === "liked"
                  ? "like"
                  : "dislike"))),
      ),
    [
      ordered,
      query,
      filter,
      preferences.galleryCollection,
      preferences.brandReactions,
    ],
  );
  return (
    <section className="plaza" id="inspiration">
      <div className="gallery-heading">
        <div>
          <p className="eyebrow">{t("01 / 选择参考品牌")}</p>
          <h2>
            <span>{t("从一个喜欢的 Logo 开始")}</span>
          </h2>
        </div>
        <p>
          {t("挑一个你喜欢的视觉风格，")}
          <br />
          {t("为新想法找到出发点。")}
          <small>{t("选择品牌后，再选定一个具体版本。")}</small>
        </p>
      </div>
      <div className="gallery-tools">
        <div className="search-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            id="logoSearch"
            type="search"
            value={query}
            maxLength={200}
            placeholder={t("搜索品牌，如 Linear、Figma、Notion")}
            aria-label={t("搜索品牌")}
            onChange={(e) =>
              update("gallery", { query: e.target.value, filter, visible: 72 })
            }
          />
        </div>
        <div className="filter-select">
          <select
            id="logoFilter"
            aria-label={t("筛选品牌 Logo 风格")}
            value={filter}
            onChange={(e) =>
              update("gallery", { query, filter: e.target.value, visible: 72 })
            }
          >
            {["", "单色", "多色", "渐变", "紧凑图形", "横向标志"].map(
              (value) => (
                <option value={value} key={value}>
                  {t(value || "全部风格")}
                </option>
              ),
            )}
          </select>
          <span className="chevron" aria-hidden="true" />
        </div>
        <p id="galleryStatus" role="status">
          {loading
            ? t("正在读取灵感档案…")
            : error ||
              t("galleryCount", {
                shown: Math.min(matches.length, visible),
                total: matches.length,
              }) + (selected ? t("selected", { name: selected.name }) : "")}
        </p>
      </div>
      <div
        className="gallery-collections"
        role="group"
        aria-label={t("brand.personal")}
      >
        {(["all", "favorites", "liked", "disliked"] as const).map(
          (collection) => (
            <button
              type="button"
              key={collection}
              data-collection={collection}
              aria-pressed={preferences.galleryCollection === collection}
              onClick={() => {
                update("galleryCollection", collection);
                update("gallery", { query, filter, visible: 72 });
              }}
            >
              {t(`brand.${collection}`)}
              {collection === "favorites" && (
                <span>
                  {
                    Object.values(preferences.brandReactions).filter(
                      (r) => r.favorite,
                    ).length
                  }
                </span>
              )}
            </button>
          ),
        )}
        <button
          type="button"
          className="gallery-shuffle"
          disabled={loading || busy || matches.length < 2}
          title={t("brand.shuffleHint")}
          onClick={() => {
            const ids = matches.map((brand) => brand.id);
            for (let i = ids.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [ids[i], ids[j]] = [ids[j], ids[i]];
            }
            if (ids.every((id, i) => id === matches[i].id))
              ids.push(ids.shift()!);
            const included = new Set(ids);
            update("galleryOrder", [
              ...ids,
              ...ordered
                .filter((brand) => !included.has(brand.id))
                .map((brand) => brand.id),
            ]);
            update("gallery", { query, filter, visible: 72 });
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3.5-2 5-5m2-2c1.5-3 3-5 5-5h3m-4-4 4 4-4 4" />
          </svg>
          {t("brand.shuffle")}
        </button>
      </div>
      <div id="logoGrid" className="logo-grid">
        {matches.slice(0, visible).map((brand) => {
          const variant = filter
            ? brand.variants.find((v) => v.tags.includes(filter)) || brand
            : brand;
          return (
            <article
              key={brand.id}
              className="logo-tile brand-card"
              data-brand-id={brand.id}
              data-reference={selected?.id === brand.id}
            >
              <button
                type="button"
                className="brand-open"
                disabled={busy}
                aria-label={brand.name}
                onClick={() => setDialogBrand(brand)}
              >
                <img
                  src={"/reference/" + encodeURIComponent(variant.file)}
                  alt={brand.name}
                  loading="lazy"
                />
                <strong>{brand.name}</strong>
                <small>
                  {variant.tags.map((tag) => t(tag)).join(" · ")} ·{" "}
                  {t(brand.variants.length === 1 ? "version" : "versions", {
                    count: brand.variants.length,
                  })}
                </small>
              </button>
              <ReactionButtons brandId={brand.id} compact />
            </article>
          );
        })}
        {!loading && !error && !matches.length && (
          <p className="gallery-empty">
            {t(
              preferences.galleryCollection === "all"
                ? "没有找到匹配的品牌，试试其他关键词或风格。"
                : "brand.empty",
            )}
          </p>
        )}
      </div>
      <button
        id="loadMore"
        type="button"
        className="text-button"
        hidden={loading || Boolean(error) || matches.length <= visible}
        disabled={busy}
        onClick={() =>
          update("gallery", {
            query,
            filter,
            visible: Math.min(5000, visible + 72),
          })
        }
      >
        {t("loadMore", {
          count: Math.min(72, Math.max(0, matches.length - visible)),
        })}
      </button>
      <p className="attribution">
        {t(
          "参考素材来自 SVG Logos · 各标志归所属品牌所有 · 借鉴视觉风格，创造新的主体。",
        )}
      </p>
      {dialogBrand && (
        <BrandDetail
          key={dialogBrand.id}
          brand={dialogBrand}
          selected={selected}
          busy={busy}
          onClose={() => setDialogBrand(null)}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}
