// Isolated browser fixture; every account and ledger request is mocked.
async (page) => {
  const base = "http://127.0.0.1:4181";
  let authorized = true,
    conflict = false,
    calls = 0;
  let user = {
    id: "test-account",
    name: "Test Owner",
    credits: 3,
    providers: "github",
  };
  let entries = [
    {
      id: "welcome:test-account",
      delta: 3,
      reason: "welcome_credits",
      created: Date.now(),
    },
  ];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/account", (r) =>
    r.fulfill({ json: { user, isAdmin: authorized } }),
  );
  await page.route("**/api/admin/accounts?*", (r) => {
    const query = r.request().url().includes("query=missing") ? "missing" : "";
    return r.fulfill({
      json: {
        users: query && !user.name.includes(query) ? [] : [user],
        total: query && !user.name.includes(query) ? 0 : 1,
      },
    });
  });
  await page.route("**/api/admin/ledger?*", (r) =>
    r.fulfill({ json: { entries } }),
  );
  await page.route("**/api/admin/credits", (r) => {
    calls++;
    const data = r.request().postDataJSON();
    if (
      data.expectedCredits !== 3 ||
      data.credits !== 12 ||
      data.reason !== "Support adjustment" ||
      !data.operationId
    )
      throw Error("Invalid adjustment payload");
    if (conflict)
      return r.fulfill({ status: 409, json: { code: "BALANCE_CHANGED" } });
    user = { ...user, credits: data.credits };
    entries = [
      {
        id: "admin:" + data.operationId,
        delta: 9,
        reason: JSON.stringify({
          type: "admin_adjustment",
          actor: "owner-id",
          reason: data.reason,
        }),
        created: Date.now(),
      },
      ...entries,
    ];
    return r.fulfill({ json: { user, applied: true } });
  });
  await page.goto(base + "/admin.html");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByText("Welcome gift · 3 credits").waitFor();
  if (
    !(await page
      .getByRole("button", { name: "Save balance", exact: true })
      .isDisabled())
  )
    throw Error("Empty reason allowed");
  await page.getByLabel("New balance").fill("12");
  await page.getByLabel("Reason (required)").fill("Support adjustment");
  await page.getByRole("button", { name: "Save balance", exact: true }).click();
  await page.getByText("Balance updated.", { exact: false }).waitFor();
  await page.getByText("Support adjustment · Admin: owner-id").waitFor();
  if (calls !== 1) throw Error("Duplicate write");
  await page.screenshot({ path: ".runtime/admin-desktop.png" });
  await page.getByLabel("Search name or account ID").fill("missing");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No matching accounts.").waitFor();
  user = { ...user, credits: 3 };
  conflict = true;
  await page.reload();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByLabel("New balance").fill("12");
  await page.getByLabel("Reason (required)").fill("Support adjustment");
  await page.getByRole("button", { name: "Save balance", exact: true }).click();
  await page.getByText("The balance changed.", { exact: false }).waitFor();
  await page.getByText("Choose an account to adjust its credits.").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await page
    .getByRole("heading", { name: "账号额度管理", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "管理", exact: true }).click();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  await page.screenshot({ path: ".runtime/admin-mobile.png", fullPage: true });
  await page.reload();
  await page
    .getByRole("heading", { name: "账号额度管理", exact: true })
    .waitFor();
  authorized = false;
  await page.reload();
  await page.getByText("请先在首页用管理员账号登录，再返回此页面。").waitFor();
  if (await page.getByRole("button", { name: "管理", exact: true }).count())
    throw Error("Non-admin sees controls");
  if (errors.length) throw Error(errors.join("\n"));
  return {
    passed: true,
    checks: [
      "authorization",
      "balance edit and audit",
      "mandatory reason",
      "search",
      "concurrent balance conflict",
      "mobile layout",
      "persisted language",
    ],
    writes: calls,
  };
}
