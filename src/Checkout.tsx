import { createRoot } from "react-dom/client";

function Checkout() {
  const zh = new URLSearchParams(location.search).get("locale") === "zh";
  document.documentElement.lang = zh ? "zh-CN" : "en";
  return (
    <main className="checkout-shell">
      <a className="brand brand--responsive" href="/">
        <img src="/logo2logo.svg" alt="Logo2logo" width="174" height="40" />
      </a>
      <p className="eyebrow">LOGO2LOGO / CHECKOUT</p>
      <h1>{zh ? "选择适合你的创作套餐。" : "Choose your creative plan."}</h1>
      <p role="status">
        {zh
          ? "请从套餐页开始购买，我们会带你前往 PayPal 安全结账。"
          : "Start from pricing to continue to secure PayPal checkout."}
      </p>
      <a id="backToPricing" href="/#pricing">
        {zh ? "查看套餐" : "View plans"}
      </a>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Checkout />);
