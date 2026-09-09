import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state";
import { request } from "../lib/api";
import { brandProfiles } from "../data/brand-profiles";
import type { Brand, Variant } from "../types";
import { ReactionButtons } from "./ReactionButtons";
export function websiteURL(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function BrandDetail({
  brand,
  selected,
  busy,
  onClose,
  onSelect,
}: {
  brand: Brand;
  selected: Brand | null;
  busy: boolean;
  onClose: () => void;
  onSelect: (brand: Brand, variant: Variant) => void;
}) {
  const { t, locale, preferences, update } = useAppState(),
    ref = useRef<HTMLDialogElement>(null),
    profile = brandProfiles[brand.id],
    lang = locale === "en" ? 0 : 1;
  const initial =
    preferences.brandPreviews[brand.id] ||
    (selected?.id === brand.id ? selected.file : brand.file);
  const [file, setFile] = useState(initial),
    [intro, setIntro] = useState<{
      description: string;
      source: string | null;
    } | null>(null),
    [loading, setLoading] = useState(!profile);
  const variant =
      brand.variants.find((v) => v.file === file) || brand.variants[0],
    website = websiteURL(brand.url);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (profile) return;
    const controller = new AbortController();
    setLoading(true);
    void request<{ description: string; source: string | null }>(
      `/api/brands/${encodeURIComponent(brand.id)}`,
      { signal: controller.signal },
    )
      .then(setIntro)
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [brand.id, profile]);
  const structural = t(
    variant.tags.includes("横向标志") ? "brand.wide" : "brand.compact",
  );
  const chromatic = t(
    variant.tags.includes("渐变")
      ? "brand.gradient"
      : variant.tags.includes("多色")
        ? "brand.multi"
        : "brand.mono",
  );
  return (
    <dialog
      className="brand-detail variant-dialog"
      ref={ref}
      aria-labelledby="brandDetailTitle"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="brand-detail-top">
        <span className="eyebrow">{t("brand.file")}</span>
        <button type="button" className="text-button" onClick={onClose}>
          {t("关闭 ×")}
        </button>
      </div>
      <div className="brand-detail-intro">
        <div className="brand-detail-art">
          <img
            src={"/reference/" + encodeURIComponent(variant.file)}
            alt={brand.name}
          />
          <span>{variant.file}</span>
        </div>
        <div className="brand-detail-identity">
          <p className="eyebrow">
            {profile
              ? profile.category[lang]
              : variant.tags.map((tag) => t(tag)).join(" / ")}
          </p>
          <h2 id="brandDetailTitle">{brand.name}</h2>
          <a
            className="brand-website"
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!website}
          >
            {t(website ? "brand.website" : "brand.noWebsite")}
          </a>
          <ReactionButtons brandId={brand.id} />
          <small>{t("brand.personal")}</small>
        </div>
      </div>
      <div className="brand-detail-copy">
        <section>
          <h3>{t("brand.story")}</h3>
          {profile ? (
            <>
              <p>{profile.story[lang]}</p>
              <a
                className="source-link"
                href={profile.source}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("brand.source")}
              </a>
            </>
          ) : loading ? (
            <p role="status">{t("brand.loading")}</p>
          ) : intro?.description ? (
            <>
              <p className="source-caption">{t("brand.preview")}</p>
              <blockquote>{intro.description}</blockquote>
              <a
                className="source-link"
                href={websiteURL(intro.source || "")}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("brand.source")}
              </a>
            </>
          ) : (
            <p>{t("brand.missing")}</p>
          )}
        </section>
        <section>
          <h3>{t("brand.design")}</h3>
          <p className="source-caption">
            {t(profile?.officialDesign ? "brand.official" : "brand.editorial")}
          </p>
          <p>{profile ? profile.design[lang] : `${structural} ${chromatic}`}</p>
          {profile?.designSource && (
            <a
              className="source-link"
              href={profile.designSource}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("brand.source")}
            </a>
          )}
          {!profile?.officialDesign && (
            <small className="source-note">{t("brand.readingNote")}</small>
          )}
        </section>
      </div>
      <div className="brand-detail-spec">
        <div>
          <span>{t("brand.structure")}</span>
          <p>{variant.tags.map((tag) => t(tag)).join(" · ")}</p>
        </div>
        <div>
          <span>{t("brand.palette")}</span>
          <div className="brand-colors">
            {variant.colors?.length ? (
              variant.colors
                .filter((c) => /^#[\da-f]{3,8}$/i.test(c))
                .map((color) => (
                  <span key={color}>
                    <i style={{ background: color }} />
                    {color.toUpperCase()}
                  </span>
                ))
            ) : (
              <small>{t("brand.noColors")}</small>
            )}
          </div>
        </div>
      </div>
      <section className="brand-versions">
        <div>
          <h3 id="variantTitle">{t("brand.variants")}</h3>
          <p>{t("brand.pick")}</p>
        </div>
        <div className="variant-grid">
          {brand.variants.map((v) => (
            <button
              key={v.file}
              type="button"
              className="logo-tile"
              aria-pressed={variant.file === v.file}
              onClick={() => {
                setFile(v.file);
                update("brandPreviews", {
                  ...preferences.brandPreviews,
                  [brand.id]: v.file,
                });
              }}
            >
              <img
                src={"/reference/" + encodeURIComponent(v.file)}
                alt={v.file}
              />
              <strong>{v.file}</strong>
            </button>
          ))}
        </div>
      </section>
      <div className="brand-detail-bottom">
        <span>
          {t(brand.variants.length === 1 ? "version" : "versions", {
            count: brand.variants.length,
          })}
        </span>
        <button
          type="button"
          className="primary"
          data-use-reference
          disabled={busy}
          onClick={() => {
            onSelect(brand, variant);
            onClose();
          }}
        >
          {t("brand.use")}
        </button>
      </div>
    </dialog>
  );
}
