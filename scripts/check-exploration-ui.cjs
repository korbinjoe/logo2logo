// Isolated Playwright fixture: no model calls, accounts, or payments are created.
async (page) => {
  const errors = [],
    onError = (e) => errors.push(e.message);
  page.on("pageerror", onError);
  const base = "http://127.0.0.1:4173";
  await page.goto(base);
  await page.setViewportSize({width:1440,height:1000});
  const saved = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("logo2logo-"))
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  const config = await page.evaluate(() =>
    fetch("/api/account").then((r) => r.json()),
  );
  let user = { id: "history-fixture", name: "History fixture", credits: 60 },
    posts = 0;
  const c = {
    name: "Mori",
    thesis: "An open book becomes a forest canopy.",
    prompt: "A book and tree",
    referenceId: "replit",
    referenceFile: "replit-icon.svg",
    locale: "en",
    designSpec: {
      brandName: "Mori",
      subject: "tree",
      constructionZh: "A tree with an open book canopy",
      recognitionCue: "tree",
    },
  };
  const entries = Array.from({ length: 29 }, (_, i) => ({
    id: `history-fixture-${i}`,
    title: `Mori · ${i + 1}`,
    createdAt: new Date(Date.UTC(2026, 8, 9 - i)).toISOString(),
    review: "pass",
    phase: i % 2 ? "refine" : "explore",
    c,
    unavailable: i === 28,
  }));
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><path d="M200 70 L80 190 Q160 180 180 230 V310 H220 V230 Q240 180 320 190Z" fill="#152d28"/></svg>';
  try {
    await page.route("**/api/account", (r) =>
      r.fulfill({ json: { ...config, user, localMode: false, designs: [] } }),
    );
    await page.route("**/api/history?*", (r) => {
      const index = Number(r.request().url().split("page=")[1]);
      return r.fulfill({
        json: {
          items: user ? entries.slice(index * 24, (index + 1) * 24) : [],
          total: user ? 29 : 0,
          page: index,
          hasMore: user && index === 0,
        },
      });
    });
    await page.route("**/outputs/history-fixture-*.png", (r) =>
      r.fulfill({ contentType: "image/svg+xml", body: svg }),
    );
    await page.route("**/outputs/history-fixture-*.json", (r) =>
      r.fulfill({
        json: {
          ...c,
          review: { status: "pass", reason: "Fixture" },
          concept: c,
        },
      }),
    );
    await page.route("**/api/generate", (r) => {
      posts++;
      return r.fulfill({
        status: 500,
        json: { error: "Unexpected generation" },
      });
    });
    await page.route("**/api/auth/logout", (r) => {
      user = null;
      return r.fulfill({ json: { ok: true } });
    });
    await page.evaluate(() => {
      localStorage.removeItem("logo2logo-preferences-v1");
      localStorage.setItem("logo2logo-locale", "en");
      localStorage.setItem("logo2logo-theme", "editorial");
    });
    await page.reload();
    await page.waitForFunction(
      () => document.querySelectorAll(".history-card").length === 24,
    );
    if (await page.locator(".concept-card").count())
      throw Error("Expected no local workspace");
    await page.locator(".history-more").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".history-card").length === 29,
    );
    if (
      !(await page
        .locator('[data-history-id="history-fixture-28"] button')
        .isDisabled())
    )
      throw Error("Missing-file fallback");
    await page.locator("#history").evaluate(el=>el.scrollIntoView({block:"start",behavior:"instant"}));
    await page.screenshot({ path: "outputs/history-desktop.png" });
    await page.locator('[data-history-id="history-fixture-26"] button').click();
    await page.locator(".history-dialog[open]").waitFor();
    if (
      !(await page
        .locator(".history-dialog a[download]")
        .getAttribute("href")
        .then((v) => v.endsWith("history-fixture-26.png")))
    )
      throw Error("Wrong original download");
    await page.screenshot({ path: "outputs/history-preview.png" });
    await page.locator(".history-dialog .primary").click();
    const card = page.locator('[data-output-id="history-fixture-26"]');
    await card.locator(".actions").waitFor();
    await card.locator("input[type=color]").fill("#fa6200");
    await card
      .getByRole("button", { name: "Keep / unkeep this draft", exact: true })
      .click();
    await page.reload();
    await card.locator(".actions").waitFor();
    if (
      (await card.locator("input[type=color]").inputValue()) !== "#fa6200" ||
      (await card.getAttribute("data-selected")) !== "true"
    )
      throw Error("Restored editing preferences lost");
    if (posts) throw Error("History viewing triggered generation");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#languageSelect").selectOption("zh");
    await page.locator("#history").evaluate(el=>el.scrollIntoView({block:"start",behavior:"instant"}));
    await page.screenshot({ path: "outputs/history-mobile.png" });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Mobile overflow");
    await page.locator(".history-preview").first().click();
    await page.locator(".history-dialog[open]").waitFor();
    if (
      await page
        .locator(".history-dialog")
        .evaluate((d) => d.scrollWidth > d.clientWidth)
    )
      throw Error("History dialog overflow");
    await page.keyboard.press("Escape");
    await page.locator("#accountButton").click();
    await page.locator("#signOut").click();
    await page.waitForFunction(
      () =>
        !document.querySelector(".history-card") &&
        !document.querySelector(".concept-card"),
    );
    if (!(await page.locator(".history-empty button").isVisible()))
      throw Error("Missing sign-in prompt");
    return {
      serverHistory: true,
      pagination: 29,
      olderDraftRestored: true,
      localEditsPreserved: true,
      missingFileFallback: true,
      accountIsolation: true,
      generationRequests: posts,
      errors,
    };
  } finally {
    await page.unrouteAll();
    await page.evaluate((data) => {
      for (const k of Object.keys(localStorage))
        if (k.startsWith("logo2logo-")) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, saved);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base);
    page.off("pageerror", onError);
  }
}
