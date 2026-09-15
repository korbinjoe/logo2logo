import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state";
import { useCommerce } from "../commerce";
import { themes } from "../data/themes";
import { Icon } from "./Icon";
import type { ThemeCategory } from "../types";
export function BrandMark({ footer = false }: { footer?: boolean }) {
  const { theme, t } = useAppState();
  const src = themes.find((item) => item.id === theme)?.dark
    ? "/logo2logo-dark.svg"
    : "/logo2logo.svg";
  return (
    <a
      className={`brand ${footer ? "" : "brand--responsive"}`}
      href="/"
      aria-label={t("Logo2logo 首页")}
    >
      <picture>
        {!footer && (
          <source media="(max-width: 760px)" srcSet="/logo2logo-mark.svg" />
        )}
        <img
          src={src}
          data-brand-image
          alt="Logo2logo"
          width={footer ? 138 : 164}
          height={footer ? 32 : 38}
        />
      </picture>
    </a>
  );
}
export function SocialLinks() {
  const { config } = useCommerce(),
    { t } = useAppState();
  const defaults = {
    github: "https://github.com/korbinjoe/logo2logo",
    x: "https://x.com/korbinjoe",
    youtube: "",
  };
  return (
    <div className="social-links">
      {(["github", "x", "youtube"] as const).map((name) => {
        const url = config?.socials[name] ?? defaults[name],
          label = { github: "GitHub", x: "X", youtube: "YouTube" }[name];
        return (
          <a
            key={name}
            data-social={name}
            href={url || undefined}
            aria-disabled={url ? undefined : true}
            title={url ? undefined : t("shop.soon")}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
          >
            <Icon name={name} />
            <span>{label}</span>
          </a>
        );
      })}
    </div>
  );
}
export function Header() {
  const { preferences, update, theme, setTheme, locale, setLocale, t } =
      useAppState(),
    { config, setOpen, refresh } = useCommerce();
  const [expanded, setExpanded] = useState(false),
    ref = useRef<HTMLDetailsElement>(null),
    headerRef = useRef<HTMLElement>(null);
  const account = config?.user;
  const accountName = account?.name.trim() || t("shop.account");
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        "--masthead-height",
        `${header.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--masthead-height");
    };
  }, []);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) {
        setExpanded(false);
        ref.current?.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);
  return (
    <header className="masthead" ref={headerRef}>
      <BrandMark />
      <nav aria-label={t("主导航")}>
        <a href="#inspiration" aria-current="page">
          {t("探索灵感")}
        </a>
        <a href="#pricing">{t("shop.pricing")}</a>
        <a
          href="#history"
          className="history-nav"
          aria-label={t("history.nav")}
          title={t("history.nav")}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" />
          </svg>
          <span>{t("history.nav")}</span>
        </a>
      </nav>
      <SocialLinks />
      <details className="appearance" open={expanded} ref={ref}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            setExpanded((v) => !v);
          }}
        >
          <span className="appearance-icon" aria-hidden="true">
            ◐
          </span>
          <span id="activeThemeName">{t(`theme.${theme}`)}</span>
          <span className="chevron" aria-hidden="true" />
        </summary>
        <div className="theme-panel">
          <div className="theme-panel-heading">
            <b>{t("选择站点外观")}</b>
            <span>{t("theme.count", { count: themes.length })}</span>
          </div>
          <div
            className="theme-categories"
            role="group"
            aria-label={t("theme.filters")}
          >
            {(
              ["all", "light", "dark", "playful"] satisfies ThemeCategory[]
            ).map((category) => (
              <button
                key={category}
                type="button"
                data-category={category}
                data-preference-control
                aria-pressed={preferences.themeCategory === category}
                onClick={() => update("themeCategory", category)}
              >
                {t(`theme.category.${category}`)}
              </button>
            ))}
          </div>
          <div
            className="theme-choices"
            role="group"
            aria-label={t("站点外观")}
          >
            {themes.map((item) => (
              <button
                key={item.id}
                type="button"
                data-theme-choice={item.id}
                data-category={item.category}
                hidden={
                  preferences.themeCategory !== "all" &&
                  preferences.themeCategory !== item.category
                }
                aria-pressed={theme === item.id}
                onClick={() => {
                  setTheme(item.id);
                  setExpanded(false);
                  ref.current?.querySelector("summary")?.focus();
                }}
              >
                <span
                  className={`theme-sample sample-${item.id}`}
                  aria-hidden="true"
                >
                  <i />
                  <b>Aa</b>
                  <em />
                </span>
                <span className="theme-option-name">
                  {t(`theme.${item.id}`)}
                </span>
                <small>{t(`theme.${item.id}.description`)}</small>
                <span className="theme-check" aria-hidden="true">
                  ✓
                </span>
              </button>
            ))}
          </div>
          <p>{t("仅改变站点外观，不影响正在设计的 Logo。")}</p>
        </div>
      </details>
      <select
        id="languageSelect"
        className="language-select"
        aria-label="Language / 语言"
        value={locale}
        onChange={(e) => setLocale(e.target.value === "zh" ? "zh" : "en")}
      >
        <option value="en">EN</option>
        <option value="zh">中文</option>
      </select>
      <button
        id="accountButton"
        type="button"
        className="account-button"
        data-commerce
        title={account ? accountName : undefined}
        aria-label={
          account ? `${accountName} · ${t("shop.account")}` : t("shop.signin")
        }
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          void refresh().catch(() => {});
        }}
      >
        {account ? (
          <>
            <span className="account-avatar" aria-hidden="true">
              {Array.from(accountName)[0].toLocaleUpperCase(locale)}
            </span>
            <span className="account-button-name">{accountName}</span>
          </>
        ) : (
          t("shop.signin")
        )}
      </button>
    </header>
  );
}
export function Footer() {
  const { t, locale } = useAppState();
  return (
    <footer>
      <BrandMark footer />
      <p>{t("好标志，始于一个好想法。")}</p>
      <span>{t("MADE FOR YOUR NEXT IDEA ↗")}</span>
      <SocialLinks />
      <nav
        className="footer-policies"
        aria-label={locale === "zh" ? "政策与联系" : "Policies and contact"}
      >
        <a href="/terms.html">{locale === "zh" ? "服务条款" : "Terms"}</a>
        <a href="/privacy.html">{locale === "zh" ? "隐私政策" : "Privacy"}</a>
        <a href="/refund.html">{locale === "zh" ? "退款政策" : "Refunds"}</a>
        <a href="/contact.html">{locale === "zh" ? "联系我们" : "Contact"}</a>
      </nav>
    </footer>
  );
}
