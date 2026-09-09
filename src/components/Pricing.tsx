import { useAppState } from "../state";
import { useCommerce } from "../commerce";
import { Disclosure } from "./Disclosure";
import type { CreditPlan } from "../types";
const defaultPlans: CreditPlan[] = [
  { id: "starter", amount: 1200, credits: 18 },
  { id: "creator", amount: 2400, credits: 60 },
  { id: "studio", amount: 5900, credits: 180 },
];
export function Pricing() {
  const { t, preferences } = useAppState(),
    { config, buy, notice, showCheck, checkPayment, checkoutBusy } =
      useCommerce();
  return (
    <section
      id="pricing"
      className="pricing-section"
      aria-labelledby="pricingTitle"
    >
      <div className="pricing-heading">
        <div>
          <p className="eyebrow">{t("shop.eyebrow")}</p>
          <h2 id="pricingTitle">{t("shop.title")}</h2>
        </div>
        <p>{t("shop.intro")}</p>
      </div>
      <div className="commerce-feedback">
        <p id="commerceNotice" role="status" hidden={!notice}>
          {notice}
        </p>
        <button
          id="checkPayment"
          type="button"
          data-commerce
          className="text-button"
          hidden={!showCheck}
          onClick={() => void checkPayment()}
        >
          {t("shop.checkAgain")}
        </button>
      </div>
      <div className="pricing-packs">
        {(config?.plans || defaultPlans).map((plan) => (
          <article
            key={plan.id}
            className={`credit-pack ${plan.id === "creator" ? "featured" : ""}`}
            data-plan={plan.id}
            data-chosen={preferences.selectedPlan === plan.id}
          >
            <div className="pack-heading">
              <h3>{plan.id[0].toUpperCase() + plan.id.slice(1)}</h3>
              {plan.id === "creator" ? (
                <span className="pack-recommended">
                  {t("shop.recommended")}
                </span>
              ) : (
                <svg viewBox="0 0 36 36" aria-hidden="true">
                  {plan.id === "starter" ? (
                    <rect x="4" y="4" width="28" height="28" rx="8" />
                  ) : (
                    [0, 1, 2, 3].map((i) => (
                      <rect
                        key={i}
                        x={i % 2 ? 20 : 1}
                        y={i < 2 ? 1 : 20}
                        width="15"
                        height="15"
                        rx="4"
                      />
                    ))
                  )}
                </svg>
              )}
            </div>
            <p className="pack-description">{t(`shop.${plan.id}`)}</p>
            <p className="pack-price">
              <strong>${plan.amount / 100}</strong>
              <span>{t("shop.once")}</span>
            </p>
            <p className="pack-credits">
              {t("shop.credits", { count: plan.credits })}
            </p>
            <p className="pack-explorations">
              {t("shop.explorations", { count: plan.credits / 3 })}
            </p>
            <button
              type="button"
              data-buy={plan.id}
              data-commerce
              aria-pressed={preferences.selectedPlan === plan.id}
              disabled={checkoutBusy}
              onClick={() => void buy(plan.id)}
            >
              {t("shop.buy", { count: plan.credits })}
            </button>
          </article>
        ))}
      </div>
      <p className="pack-features">{t("shop.features")}</p>
      <p
        id="purchaseUnavailable"
        className="purchase-note"
        hidden={config?.billingReady}
      >
        {t("shop.billingSoon")}
      </p>
      <p
        id="paymentTestMode"
        className="purchase-note test-mode"
        hidden={
          !(config?.billingReady && config.paymentEnvironment === "sandbox")
        }
      >
        {t("shop.testMode")}
      </p>
      <div className="credit-explainer">
        <strong>{t("shop.ready")}</strong>
        <p>
          {t("shop.rules")}
          <small>{t("shop.expiry")}</small>
        </p>
      </div>
      <div className="pricing-faq">
        {[1, 2, 3].map((i) => (
          <Disclosure key={i} id={`faq:${i - 1}`} title={t(`shop.faq${i}`)}>
            <p>{t(`shop.faq${i}a`)}</p>
          </Disclosure>
        ))}
      </div>
    </section>
  );
}
