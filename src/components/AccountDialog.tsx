import { useEffect, useRef } from "react";
import { useCommerce } from "../commerce";
import { useAppState } from "../state";
import { Icon } from "./Icon";
export function AccountDialog() {
  const { config, open, setOpen, login, logout, notice } = useCommerce(),
    { t, preferences } = useAppState();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  const account = config?.user;
  return (
    <dialog
      ref={ref}
      id="accountDialog"
      className="account-dialog"
      aria-labelledby={account ? "accountName" : "accountDialogTitle"}
      onCancel={() => setOpen(false)}
      onClose={() => setOpen(false)}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            setOpen(false);
        }
      }}
    >
      <button
        id="closeAccount"
        type="button"
        className="close-account"
        data-commerce
        onClick={() => setOpen(false)}
      >
        {t("shop.close")}
      </button>
      <img className="account-symbol" src="/logo2logo-mark.svg" alt="" />
      <div id="accountSignedOut" hidden={Boolean(account)}>
        <h2 id="accountDialogTitle">{t("shop.welcome")}</h2>
        <p className="account-description">{t("shop.loginHelp")}</p>
        {(["google", "github"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className="provider-button"
            data-provider={id}
            data-commerce
            disabled={!config?.providers.some((p) => p.id === id && p.enabled)}
            aria-pressed={preferences.loginProvider === id}
            onClick={() => login(id)}
          >
            <Icon name={id} />
            <span>{t(`shop.${id}`)}</span>
          </button>
        ))}
        <p
          id="loginUnavailable"
          className="account-note"
          hidden={config?.providers.some((p) => p.enabled)}
        >
          {t("shop.signinSoon")}
        </p>
        <p className="account-note">{t("shop.sameAccount")}</p>
      </div>
      <div id="accountSignedIn" hidden={!account}>
        <h2 id="accountName">{account?.name}</h2>
        <p id="accountCredits" className="account-balance">
          {t("shop.balance", { count: account?.credits || 0 })}
        </p>
        <a
          id="accountTopup"
          href="#pricing"
          className="account-topup"
          onClick={() => setOpen(false)}
        >
          {t("shop.topup")}
        </a>
        <a
          href="#history"
          className="account-history-link"
          onClick={() => setOpen(false)}
        >
          {t("history.title")} ↗
        </a>
        {config?.isAdmin && (
          <a href="/admin.html" className="account-history-link">
            {t("shop.admin")}
          </a>
        )}
        <h3>{t("shop.history")}</h3>
        <div id="accountHistory" className="account-history">
          {config?.designs.map((design) => (
            <a
              key={design.output}
              href={`/outputs/${encodeURIComponent(design.output)}.png`}
              target="_blank"
              rel="noopener"
            >
              <img
                src={`/outputs/${encodeURIComponent(design.output)}.png`}
                alt="Logo"
              />
            </a>
          ))}
        </div>
        <p
          id="noHistory"
          className="account-note"
          hidden={Boolean(config?.designs.length)}
        >
          {t("shop.noHistory")}
        </p>
        <button
          id="signOut"
          type="button"
          className="account-signout"
          data-commerce
          onClick={() => void logout()}
        >
          {t("shop.logout")}
        </button>
      </div>
      {notice && (
        <p className="account-note" role="status">
          {notice}
        </p>
      )}
    </dialog>
  );
}
