import test from "node:test";
import assert from "node:assert/strict";
import { createAccounts } from "../lib/accounts.ts";
import { historyPage, readHistoryItem } from "../lib/design-history.ts";
import {
  publicIPv4,
  extractDescription,
  websiteInfo,
} from "../lib/brand-info.ts";
import { readPreferences, writePreference } from "../src/lib/preferences.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("brand reactions survive refresh independently from the draft and reject invalid stored values", () => {
  let value = "{}";
  const storage = {
    getItem: () => value,
    setItem: (_, data) => (value = data),
  };
  writePreference(
    "brandReactions",
    {
      replit: { vote: "like", favorite: true },
      figma: { vote: "dislike", favorite: false },
    },
    storage,
  );
  writePreference("galleryCollection", "favorites", storage);
  writePreference("brandPreviews", { replit: "replit.svg" }, storage);
  const p = readPreferences(storage);
  assert.equal(p.brandReactions.replit.vote, "like");
  assert.equal(p.brandReactions.replit.favorite, true);
  assert.equal(p.galleryCollection, "favorites");
  assert.equal(p.brandPreviews.replit, "replit.svg");
  value = JSON.stringify({
    brandReactions: { replit: { vote: "both", favorite: 1 } },
    brandPreviews: { replit: "../../bad" },
    galleryCollection: "invalid",
  });
  const clean = readPreferences(storage);
  assert.deepEqual(clean.brandReactions.replit, {
    vote: null,
    favorite: false,
  });
  assert.deepEqual(clean.brandPreviews, {});
  assert.equal(clean.galleryCollection, "all");
});
test("account history paginates beyond the browser cache, stays private, and survives reopening the database", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "logo-history-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 1000;
  let store = createAccounts(join(dir, "history.sqlite"), {
    now: () => clock++,
  });
  const alice = store.identify("google", "alice", "Alice"),
    bob = store.identify("github", "bob", "Bob");
  store.db.prepare("UPDATE users SET credits=100 WHERE id=?").run(alice.id);
  for (let i = 0; i < 29; i++) {
    const job = store.reserve(alice.id);
    store.complete(job, `output-${i}`);
  }
  store.close();
  store = createAccounts(join(dir, "history.sqlite"));
  t.after(() => store.close());
  const first = store.history(alice.id, 0, 24),
    second = store.history(alice.id, 1, 24);
  assert.equal(first.total, 29);
  assert.equal(first.items.length, 24);
  assert.equal(second.items.length, 5);
  assert.equal(first.items[0].output, "output-28");
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.output)).size,
    29,
  );
  assert.equal(store.history(bob.id).total, 0);
  await writeFile(join(dir, "output-28.png"), "fixture");
  await writeFile(
    join(dir, "output-28.json"),
    JSON.stringify({
      designSpec: { brandName: "Mori", constructionZh: "A leaf" },
      createdAt: "2026-09-09T10:00:00Z",
      prompt: "leaf",
      seed: 17,
    }),
  );
  const result = await historyPage({
    commerce: { localMode: false, store, requireUser: () => alice },
    outputDir: dir,
    req: {},
    page: 0,
  });
  assert.equal(result.hasMore, true);
  assert.equal(result.items[0].title, "Mori");
  assert.equal(result.items[0].c.seed, 17);
  assert.equal(result.items[1].unavailable, true);
  assert.equal(
    await readHistoryItem(dir, { output: "../private", created: 0 }),
    null,
  );
});
test("brand introductions use bounded text previews and reject private network destinations", async () => {
  assert.equal(
    extractDescription(
      '<meta name="description" content="Backup"><meta content="Tools &amp; ideas" property="og:description">',
    ),
    "Tools & ideas",
  );
  assert.equal(extractDescription("<script>hello</script>"), "");
  assert.equal(
    extractDescription(
      `<meta name="description" content="${"word ".repeat(100)}">`,
    ).split(" ").length,
    24,
  );
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.4.2",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.1.1.1",
  ])
    assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4("93.184.216.34"), true);
  assert.deepEqual(
    await websiteInfo({ id: "private-test", url: "http://127.0.0.1:80/" }),
    { description: "", source: null },
  );
});
