// Browser regression fixture. Only mocked account/checkout requests are used.
async (page) => {
  const base = "http://127.0.0.1:4173";
  const account = {
    user: { id: "checkout-ui-test", name: "Checkout test", credits: 0 },
    designs: [],
    providers: [{ id: "google", enabled: true }],
    billingReady: true,
    localMode: false,
    paymentEnvironment: "sandbox",
    plans: [
      { id: "starter", amount: 1200, credits: 18 },
      { id: "creator", amount: 2400, credits: 60 },
      { id: "studio", amount: 5900, credits: 180 },
    ],
    socials: {},
  };
  let mode = "unavailable",
    hold = false,
    release,
    checkoutCalls = 0;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/history?*", (r) =>
    r.fulfill({
      json: { items: [], total: 0, page: 0, hasMore: false, pending: [] },
    }),
  );
  await page.route("**/api/account", async (r) => {
    if (hold)
      await new Promise((resolve) => {
        release = resolve;
      });
    if (mode === "network-error") return r.abort();
    return r.fulfill({
      json: {
        ...account,
        billingReady: mode !== "unavailable",
        user: mode === "signed-out" ? null : account.user,
      },
    });
  });
  await page.route("**/api/billing/checkout", (r) => {
    checkoutCalls++;
    if (mode === "success")
      return r.fulfill({ json: { url: "/?checkout-ui-success=1" } });
    return r.fulfill({ status: 503, json: { code: "BILLING_UNAVAILABLE" } });
  });
  await page.goto(base);
  await page.evaluate(() => localStorage.setItem("logo2logo-locale", "en"));
  await page.reload();
  const button = page.locator('[data-buy="starter"]'),
    feedback = page.locator("#checkout-feedback-starter");
  await page.waitForFunction(() =>
    document
      .querySelector('[data-buy="starter"]')
      ?.textContent.includes("coming soon"),
  );
  if (!(await button.isDisabled()) || !(await feedback.isVisible()))
    throw Error("Unavailable checkout has no visible explanation");
  if (checkoutCalls)
    throw Error("Unavailable checkout sent a purchase request");
  await page.setViewportSize({ width: 390, height: 844 });
  await button.scrollIntoViewIfNeeded();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  await page.screenshot({ path: ".runtime/checkout-unavailable-mobile.png" });
  mode = "ready";
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector('[data-buy="starter"]')?.disabled,
  );
  hold = true;
  await button.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-buy="starter"]')
        ?.getAttribute("aria-busy") === "true",
  );
  if (
    !(await button.isDisabled()) ||
    !(await button.textContent().then((t) => t.includes("Please wait")))
  )
    throw Error("Missing loading feedback");
  mode = "unavailable";
  hold = false;
  release();
  await page.waitForFunction(() =>
    document
      .querySelector("#checkout-feedback-starter")
      ?.textContent.includes("not open yet"),
  );
  if (checkoutCalls) throw Error("Readiness refresh did not block purchase");
  mode = "signed-out";
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector('[data-buy="starter"]')?.disabled,
  );
  await button.click();
  await page.locator("#accountDialog[open]").waitFor();
  if (checkoutCalls) throw Error("Signed-out checkout submitted a purchase");
  await page.locator("#closeAccount").click();
  mode = "ready";
  await page.reload();
  await page.waitForFunction(
    () => !document.querySelector('[data-buy="starter"]')?.disabled,
  );
  await button.click();
  await page.waitForFunction(() =>
    document
      .querySelector("#checkout-feedback-starter")
      ?.textContent.includes("not open yet"),
  );
  if (checkoutCalls !== 1 || (await button.isDisabled()))
    throw Error("Checkout failure not retryable");
  mode = "network-error";
  await button.click();
  await page.waitForFunction(() =>
    document
      .querySelector("#checkout-feedback-starter")
      ?.textContent.includes("Please try again"),
  );
  if (await button.isDisabled())
    throw Error("Network error left checkout locked");
  mode = "success";
  await button.click();
  await page.waitForURL("**/?checkout-ui-success=1");
  if (checkoutCalls !== 2) throw Error("Ready checkout did not navigate");
  mode = "unavailable";
  await page.evaluate(() => localStorage.setItem("logo2logo-locale", "zh"));
  await page.reload();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-buy="starter"]')
      ?.textContent.includes("购买暂未开放"),
  );
  if (!(await feedback.textContent().then((t) => t.includes("免费浏览"))))
    throw Error("Missing Chinese explanation");
  if (errors.length) throw Error(errors.join("\n"));
  const result =
    "PASS: unavailable, loading, readiness change, sign-in, checkout failure, network retry, successful redirect, mobile layout and Chinese messages.";
  await page.unroute("**/api/account");
  await page.unroute("**/api/billing/checkout");
  await page.unroute("**/api/history?*");
  return result;
};
