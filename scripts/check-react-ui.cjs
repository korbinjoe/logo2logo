// Run with playwright-cli in an isolated session. All generation/billing calls below are fixtures.
async (page) => {
  const errors = [];
  const onError = (e) => errors.push(e.message);
  page.on("pageerror", onError);
  const base = "http://127.0.0.1:4173";
  await page.goto(base);
  await page.locator("#logoGrid .logo-tile").first().waitFor();
  const originalStorage = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("logo2logo-"))
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  const config = await page.evaluate(() =>
    fetch("/api/account").then((r) => r.json()),
  );
  let user = { id: "react-fixture", name: "React fixture", credits: 60 },
    plans = 0,
    generations = 0,
    purchases = 0;
  const payloads = [];
  const concept = (i) => ({
    id: `direction-${i}`,
    name: `Direction ${i}`,
    thesis: "Fixture circle",
    prompt: "Circle",
    seed: i,
    locale: "en",
    referenceId: "replit",
    referenceFile: "replit.svg",
    designSpec: {
      subject: "circle",
      constructionZh: "A circular mark",
      recognitionCue: "circle",
    },
  });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="30" fill="black"/></svg>';
  try {
    await page.route("**/api/account", (r) =>
      r.fulfill({
        json: {
          ...config,
          user,
          localMode: false,
          designs: [],
          billingReady: true,
          providers: [
            { id: "google", enabled: true },
            { id: "github", enabled: true },
          ],
        },
      }),
    );
    await page.route("**/api/territories", (r) => {
      plans++;
      payloads.push(JSON.parse(r.request().postData()));
      return r.fulfill({
        json: {
          status: plans === 1 ? "partial" : "complete",
          territories:
            plans === 1
              ? [concept(1), concept(3)]
              : [concept(1), concept(2), concept(3)],
          failures:
            plans === 1
              ? [
                  {
                    name: "Direction 2",
                    code: "INVALID_FIELD",
                    error: "Fixture failure",
                  },
                ]
              : [],
          resumeId: "resume-fixture",
        },
      });
    });
    await page.route("**/api/history?*", (r) =>
      r.fulfill({ json: { items: [], total: 0, page: 0, hasMore: false } }),
    );
    await page.route("**/api/generate", (r) => {
      generations++;
      payloads.push(JSON.parse(r.request().postData()));
      const id = `react-output-${generations}`;
      return r.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({ completed: 1, total: 2 }) +
          "\n" +
          JSON.stringify({ stage: "reviewing" }) +
          "\n" +
          JSON.stringify({
            id,
            imageUrl: `/outputs/${id}.png`,
            review: { status: "pass" },
          }),
      });
    });
    await page.route("**/outputs/react-output-*.json", (r) =>
      r.fulfill({
        json: {
          designSpec: concept(1).designSpec,
          prompt: "Circle",
          review: { status: "pass", reason: "Fixture" },
        },
      }),
    );
    await page.route("**/outputs/react-output-*.png", (r) =>
      r.fulfill({ contentType: "image/svg+xml", body: svg }),
    );
    await page.route("**/api/auth/logout", (r) => {
      user = null;
      return r.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/billing/checkout", (r) => {
      purchases++;
      return r.fulfill({ status: 503, json: { code: "BILLING_UNAVAILABLE" } });
    });
    await page.evaluate(() => {
      localStorage.removeItem("logo2logo-preferences-v1");
      localStorage.setItem("logo2logo-locale", "en");
    });
    await page.reload();
    await page.locator("#logoGrid .logo-tile").first().waitFor();
    if (!(await page.locator("#briefForm").isHidden()))
      throw new Error("Missing reference gate");
    await page.locator("#logoGrid .logo-tile").first().click();
    await page.locator(".variant-grid button").last().click();
    await page.locator("[data-use-reference]").click();
    await page.locator("#description").fill("Mori forest bookstore");
    await page.locator("#briefForm .primary").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".concept-card .actions").length === 2 &&
        !document.querySelector("#briefForm .primary").disabled,
    );
    await page
      .getByRole("button", { name: "Retry failed directions", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".concept-card .actions").length === 3 &&
        !document.querySelector("#briefForm .primary").disabled,
    );
    if (
      plans !== 2 ||
      generations !== 3 ||
      !payloads.some((p) => p.resumeId === "resume-fixture")
    )
      throw new Error(`Partial retry duplicated work: ${plans}/${generations}`);
    const refine = page
      .locator(".concept-card")
      .first()
      .getByRole("button", { name: "Refine · Spacing", exact: true });
    await refine.click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".concept-card .actions").length === 4 &&
        !document.querySelector("#briefForm .primary").disabled,
    );
    if (
      generations !== 4 ||
      !payloads.at(-1).sourceId ||
      payloads.at(-1).referenceId
    )
      throw new Error("Refinement lost original image");
    const card = page.locator(".concept-card").first();
    await card.locator("input[type=color]").fill("#ff0000");
    await card
      .getByRole("button", { name: "Keep / unkeep this draft", exact: true })
      .click();
    await page.reload();
    await page.waitForFunction(
      () => document.querySelectorAll(".concept-card .actions").length === 4,
    );
    if (generations !== 4 || plans !== 2)
      throw new Error("Reload created new work");
    if (
      (await page
        .locator(".concept-card")
        .first()
        .locator("input[type=color]")
        .inputValue()) !== "#ff0000"
    )
      throw new Error("Lost color");
    await page.locator("[data-buy=creator]").click();
    await page.waitForFunction(
      () => document.querySelector("#commerceNotice").textContent.length > 0,
    );
    if (purchases !== 1) throw new Error("Duplicate checkout");
    await page.locator("#accountButton").click();
    await page.locator("#signOut").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".concept-card").length === 0,
    );
    if (!(await page.locator("#board").isHidden()))
      throw new Error("Signed-out account can see prior board");
    return {
      plans,
      generations,
      purchases,
      partialRetry: true,
      refinement: true,
      persistence: true,
      accountIsolation: true,
      errors,
    };
  } finally {
    await page.unrouteAll();
    await page.evaluate((saved) => {
      for (const key of Object.keys(localStorage))
        if (key.startsWith("logo2logo-")) localStorage.removeItem(key);
      for (const [key, value] of Object.entries(saved))
        localStorage.setItem(key, value);
    }, originalStorage);
    await page.goto(base);
    page.off("pageerror", onError);
  }
}
