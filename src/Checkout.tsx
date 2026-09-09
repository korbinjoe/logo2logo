import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { request } from "./lib/api";
interface PaddleClient {
  Environment: { set: (environment: "sandbox") => void };
  Initialize: (options: {
    token: string;
    eventCallback: (event: { name: string }) => void;
  }) => void;
  Checkout: {
    open: (options: {
      transactionId: string;
      settings: {
        displayMode: "overlay";
        locale: string;
        successUrl: string;
        allowDiscountRemoval: boolean;
        showAddDiscounts: boolean;
      };
    }) => void;
  };
}
declare global {
  interface Window {
    Paddle?: PaddleClient;
  }
}
function Checkout() {
  const params = new URLSearchParams(location.search);
  let saved = "en";
  try {
    saved = localStorage.getItem("logo2logo-locale") || "en";
  } catch {
    /* private mode */
  }
  const zh =
    params.get("locale") === "zh" || (!params.has("locale") && saved === "zh");
  const [status, setStatus] = useState(
      zh ? "正在打开安全结账…" : "Opening secure checkout…",
    ),
    [reopen, setReopen] = useState(false),
    open = useRef<() => void>(() => {});
  const start = useCallback(async () => {
    try {
      const params = new URLSearchParams(location.search),
        transactionId = params.get("transaction_id") || params.get("_ptxn");
      const config = await request<{
        environment: string;
        token: string;
        transactionId: string;
      }>(
        `/api/billing/config?transaction_id=${encodeURIComponent(transactionId || "")}`,
        { cache: "no-store" },
      );
      if (!window.Paddle) throw new Error("Checkout unavailable");
      const paddle = window.Paddle;
      if (config.environment === "sandbox") paddle.Environment.set("sandbox");
      const successUrl = `${location.origin}/?checkout=success&session_id=${encodeURIComponent(config.transactionId)}#pricing`;
      paddle.Initialize({
        token: config.token,
        eventCallback: (event) => {
          if (event.name === "checkout.completed") location.assign(successUrl);
          if (event.name === "checkout.closed") {
            setStatus(
              zh
                ? "结账已关闭，可以重新打开或返回套餐。"
                : "Checkout closed. Reopen it or return to pricing.",
            );
            setReopen(true);
          }
        },
      });
      open.current = () =>
        paddle.Checkout.open({
          transactionId: config.transactionId,
          settings: {
            displayMode: "overlay",
            locale: zh ? "zh-Hans" : "en",
            successUrl,
            allowDiscountRemoval: false,
            showAddDiscounts: false,
          },
        });
      setStatus(
        config.environment === "sandbox"
          ? zh
            ? "测试结账，不会实际扣款。"
            : "Test checkout. No real payment will be taken."
          : zh
            ? "请在安全结账窗口完成付款。"
            : "Complete your payment in the secure checkout.",
      );
      open.current();
    } catch {
      setStatus(
        zh
          ? "无法打开结账，请返回套餐页登录后重试。"
          : "Checkout could not be opened. Return to pricing, sign in, and try again.",
      );
    }
  }, [zh]);
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
    void start();
  }, [start, zh]);
  return (
    <main className="checkout-shell">
      <a className="brand brand--responsive" href="/">
        <picture>
          <source media="(max-width: 760px)" srcSet="/logo2logo-mark.svg" />
          <img src="/logo2logo.svg" alt="Logo2logo" width="174" height="40" />
        </picture>
      </a>
      <p className="eyebrow">LOGO2LOGO / CHECKOUT</p>
      <h1 id="checkoutTitle">
        {zh ? "给创作，多一些空间。" : "A little more room to create."}
      </h1>
      <p id="checkoutStatus" role="status">
        {status}
      </p>
      <button
        id="reopenCheckout"
        type="button"
        hidden={!reopen}
        onClick={() => open.current()}
      >
        {zh ? "打开结账" : "Open checkout"}
      </button>
      <a id="backToPricing" href="/?checkout=cancelled#pricing">
        {zh ? "返回套餐" : "Back to pricing"}
      </a>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Checkout />);
