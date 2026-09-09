async (page) => {
  const errors = [],
    onError = (e) => errors.push(e.message),
    base = "http://127.0.0.1:4173";
  page.on("pageerror", onError);
  await page.goto(base);
  const saved = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("logo2logo-"))
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  const themes = [
    "light",
    "dark",
    "play",
    "swiss",
    "blueprint",
    "mint",
    "terminal",
    "arcade",
    "editorial",
    "orbital",
    "bauhaus",
    "collage",
    "cinema",
  ];
  const layout = [];
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of themes) {
        await page.evaluate((t) => {
          localStorage.setItem("logo2logo-theme", t);
          localStorage.setItem("logo2logo-locale", "en");
          const p = JSON.parse(
            localStorage.getItem("logo2logo-preferences-v1") || "{}",
          );
          p.heroMotion = true; p.section=null;
          localStorage.setItem("logo2logo-preferences-v1", JSON.stringify(p));
        }, theme);
        await page.reload();
        await page.evaluate(()=>scrollTo({top:0,behavior:"instant"}));
        await page.locator(".hero-atmosphere[data-rendered=true]").waitFor();
        const check = await page.evaluate(() => {
          const bg = document.querySelector(".hero-atmosphere"),
            r = bg.getBoundingClientRect();
          const content = document.querySelector(".hero-start"),
            c = content.getBoundingClientRect();
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            backgroundWidth: r.width,
            backgroundHeight: r.height,
            buttonClear:
              document
                .elementFromPoint(c.x + c.width / 2, c.y + c.height / 2)
                ?.closest(".hero-start") !== null,
            canvasCount: document.querySelectorAll(".atmosphere-canvas").length,
          };
        });
        if (check.overflow || !check.buttonClear || check.canvasCount !== 1)
          throw Error(JSON.stringify({ theme, width, ...check }));
        layout.push({ theme, width, ...check });
        if (width === 1440 && theme === "dark")
          await page.screenshot({ path: "outputs/hero-atmosphere-dark.png" });
        if (width === 1440 && theme === "orbital")
          await page.screenshot({
            path: "outputs/hero-atmosphere-orbital.png",
          });
        if (width === 390 && theme === "light")
          await page.screenshot({ path: "outputs/hero-atmosphere-mobile.png" });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => localStorage.setItem("logo2logo-theme", "light"));
    await page.reload();
    await page.locator(".hero-atmosphere[data-motion=running]").waitFor();
    await page.locator(".atmosphere-motion").click();
    await page.locator(".hero-atmosphere[data-motion=paused]").waitFor({state:"attached"});
    await page.reload();
    await page.locator(".hero-atmosphere[data-motion=paused]").waitFor({state:"attached"});
    await page.locator(".atmosphere-motion").click();
    await page.locator(".hero-start").click();
    await page.evaluate(() => scrollTo({top:document.querySelector(".studio").getBoundingClientRect().bottom + scrollY + 100,behavior:"instant"}));
    await page.locator(".hero-atmosphere[data-motion=paused]").waitFor({state:"attached"});
    await page.evaluate(() => scrollTo(0, 0));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".atmosphere-motion:disabled").waitFor();
    await page.locator(".hero-atmosphere[data-motion=paused]").waitFor({state:"attached"});
    if (errors.length) throw Error(errors.join("\n"));
    return {
      layouts: layout.length,
      fullViewportBackground: layout.every(
        (x) => Math.abs(x.backgroundWidth - x.width) < 2,
      ),
      pausePersists: true,
      offscreenPauses: true,
      reducedMotion: true,
      errors,
    };
  } finally {
    page.off("pageerror", onError);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate((s) => {
      for (const k of Object.keys(localStorage))
        if (k.startsWith("logo2logo-")) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, saved);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base);
  }
}
