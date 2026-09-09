import { useEffect } from "react";
import { Header, Footer } from "./components/Header";
import { Studio } from "./components/Studio";
import { Pricing } from "./components/Pricing";
import { AccountDialog } from "./components/AccountDialog";
import { useAppState } from "./state";
export function App() {
  const { update, storageFailed, t } = useAppState();
  useEffect(() => {
    const anchor = (e: MouseEvent) => {
      const target = (e.target as Element).closest('a[href^="#"]'),
        id = target?.getAttribute("href")?.slice(1);
      if (
        id === "inspiration" ||
        id === "pricing" ||
        id === "briefForm" ||
        id === "board" ||
        id === "history"
      )
        update("section", id);
    };
    const report = (error: unknown) => {
      const e = error instanceof Error ? error : new Error(String(error));
      void fetch("/api/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: e.message.slice(0, 2000),
          stack: e.stack?.slice(0, 4000),
        }),
        keepalive: true,
      }).catch(() => {});
    };
    const failure = (event: ErrorEvent) => report(event.error || event.message),
      rejection = (event: PromiseRejectionEvent) => report(event.reason);
    document.addEventListener("click", anchor);
    window.addEventListener("error", failure);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      document.removeEventListener("click", anchor);
      window.removeEventListener("error", failure);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, [update]);
  return (
    <>
      <Header />
      {storageFailed && (
        <p id="preferencesStatus" className="preferences-status" role="status">
          {t("saved.storageUnavailable")}
        </p>
      )}
      <main>
        <Studio />
        <Pricing />
      </main>
      <Footer />
      <AccountDialog />
    </>
  );
}
