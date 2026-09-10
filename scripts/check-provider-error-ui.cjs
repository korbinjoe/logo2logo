// Mocked provider rejection: no external generation or credits are consumed.
async (page) => {
  let calls = 0;
  const variant = {
    file: "notion.svg",
    tags: ["单色"],
    width: 100,
    height: 100,
  };
  const brand = {
    ...variant,
    id: "notion",
    name: "Notion",
    url: "https://notion.so",
    variants: [variant],
  };
  const concept = {
    name: "Direction",
    thesis: "Minimal letter N",
    prompt: "Minimal letter N",
    referenceId: "notion",
    referenceFile: "notion.svg",
    promptVersion: "exploration-v2",
    seed: 42,
  };
  await page.route("**/api/logos", (r) =>
    r.fulfill({ json: { logos: [brand] } }),
  );
  await page.route("**/api/account", (r) =>
    r.fulfill({
      json: {
        user: { id: "test-user", name: "Test", credits: 3 },
        localMode: false,
        billingReady: false,
        providers: [],
        plans: [],
        designs: [],
        socials: {},
      },
    }),
  );
  await page.route("**/api/history?*", (r) =>
    r.fulfill({
      json: { items: [], total: 0, page: 0, hasMore: false, pending: [] },
    }),
  );
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { connected: true } }),
  );
  await page.route("**/api/territories", (r) =>
    r.fulfill({
      json: {
        status: "complete",
        resumeId: "test-plan",
        territories: [1, 2, 3].map((n) => ({ ...concept, id: String(n) })),
      },
    }),
  );
  await page.route("**/api/generate", (r) => {
    calls++;
    return r.fulfill({
      status: 503,
      json: { code: "IMAGE_PROVIDER_BILLING_REQUIRED", requestId: "test-id" },
    });
  });
  await page.goto("http://127.0.0.1:4181");
  await page.evaluate(() => {
    localStorage.setItem("logo2logo-locale", "en");
    localStorage.setItem(
      "logo2logo-preferences-v1",
      JSON.stringify({
        version: 1,
        draft: {
          description: "An N logo",
          referenceId: "notion",
          referenceFile: "notion.svg",
          style: "",
        },
      }),
    );
  });
  await page.reload();
  const button = page.locator('#briefForm button[type="submit"]');
  await button.click();
  await page
    .locator("#message")
    .filter({ hasText: "top-up by the site administrator" })
    .waitFor();
  if (await button.isDisabled()) throw Error("UI remains busy after rejection");
  if (calls !== 1) throw Error("Provider failure did not stop batch: " + calls);
  await page.screenshot({
    path: ".runtime/provider-error-en.png",
    fullPage: true,
  });
  await page.evaluate(() => localStorage.setItem("logo2logo-locale", "zh"));
  await page.reload();
  await button.click();
  await page
    .locator("#message")
    .filter({ hasText: "fal 要求站点管理员充值" })
    .waitFor();
  if (calls !== 2) throw Error("Chinese batch did not stop");
  return {
    passed: true,
    requestsPerBatch: 1,
    englishFeedback: true,
    chineseFeedback: true,
  };
}
