// Isolated browser fixture: no external model calls or real billing.
async (page) => {
  const base = "http://127.0.0.1:4173";
  await page.goto(base);
  const locale = await page.evaluate(() =>
    localStorage.getItem("logo2logo-locale"),
  );
  const config = await page.evaluate(() =>
    fetch("/api/account").then((r) => r.json()),
  );
  let polls = 0,
    complete = false;
  const errors = [],
    onError = (e) => errors.push(e.message);
  page.on("pageerror", onError);
  const handlers = [];
  const route = async (pattern, handler) => {
    handlers.push(pattern);
    await page.route(pattern, handler);
  };
  try {
    await page.evaluate(() => localStorage.setItem("logo2logo-locale", "en"));
    await route("**/api/account", (r) =>
      r.fulfill({
        json: {
          ...config,
          localMode: false,
          user: { id: "cloud-ui-fixture", name: "Cloud test", credits: 17 },
          designs: [],
        },
      }),
    );
    await route("**/api/history?*", (r) =>
      r.fulfill({
        json: {
          items: complete
            ? [
                {
                  id: "cloud-test-job",
                  createdAt: "2026-09-10T00:00:00.000Z",
                  title: "Cloud result",
                  review: "pass",
                  phase: "explore",
                  c: { name: "Cloud result" },
                },
              ]
            : [],
          total: complete ? 1 : 0,
          page: 0,
          hasMore: false,
          pending: complete ? [] : [{ id: "cloud-test-job" }],
        },
      }),
    );
    await route("**/api/generations/cloud-test-job", (r) => {
      polls++;
      complete = true;
      return r.fulfill({
        json: {
          done: true,
          id: "cloud-test-job",
          imageUrl: "/outputs/cloud-test-job.png",
        },
      });
    });
    await route("**/outputs/cloud-test-job.png", (r) =>
      r.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12"/></svg>',
      }),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Check progress", exact: true })
      .waitFor();
    if (polls !== 0) throw Error("Mount unexpectedly polled a generation");
    await page.reload();
    await page
      .getByRole("button", { name: "Check progress", exact: true })
      .click();
    await page.locator('[data-history-id="cloud-test-job"]').waitFor();
    if (polls !== 1) throw Error("Expected exactly one poll, got " + polls);
    if (
      await page
        .getByRole("button", { name: "Check progress", exact: true })
        .count()
    )
      throw Error("Completed job remains pending");
    if (errors.length) throw Error(errors.join("\n"));
    return {
      pendingSurvivesRefresh: true,
      manualPolls: polls,
      historyCompleted: true,
      pageErrors: errors,
    };
  } finally {
    for (const pattern of handlers) await page.unroute(pattern);
    await page.evaluate(
      (value) =>
        value === null
          ? localStorage.removeItem("logo2logo-locale")
          : localStorage.setItem("logo2logo-locale", value),
      locale,
    );
    page.off("pageerror", onError);
    await page.reload();
  }
};
