import type {
  LocalAccounts,
  SqlValue,
  User,
  Identity,
  OAuthRow,
  Order,
  Job,
  HistoryEntry,
} from "./types.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const fault = (code: string, status = 400) =>
  Object.assign(new Error(code), { code, status });

// SQLite transactions keep balances correct across concurrent HTTP requests.
// Run one application process per database: startup releases interrupted reservations.
export function createAccounts(path: string, { now = Date.now } = {}) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS identities(provider TEXT,subject TEXT,user_id TEXT REFERENCES users(id),PRIMARY KEY(provider,subject));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);
    CREATE TABLE IF NOT EXISTS oauth(state TEXT PRIMARY KEY,browser TEXT,provider TEXT,verifier TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),plan TEXT,amount INTEGER,credits INTEGER,currency TEXT,session TEXT UNIQUE,paid INTEGER DEFAULT 0,refunded INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,session TEXT,amount INTEGER);
    CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),delta INTEGER,reason TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),status TEXT,output TEXT UNIQUE,created INTEGER);
    CREATE TABLE IF NOT EXISTS rate_limits(user_id TEXT,bucket INTEGER,count INTEGER,PRIMARY KEY(user_id,bucket));`);
  const get = <T>(sql: string, ...args: SqlValue[]) =>
    db.prepare(sql).get(...args) as T | undefined;
  const run = (sql: string, ...args: SqlValue[]) =>
    db.prepare(sql).run(...args);
  function transaction<T>(work: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      db.exec("COMMIT");
      return value;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function adjust(id: string, userId: string, delta: number, reason: string) {
    const inserted = run(
      "INSERT OR IGNORE INTO ledger VALUES(?,?,?,?,?)",
      id,
      userId,
      delta,
      reason,
      now(),
    ).changes;
    if (inserted)
      run("UPDATE users SET credits=credits+? WHERE id=?", delta, userId);
    return Boolean(inserted);
  }
  function applyRefunds(session: string) {
    const order = get<Order>(
      "SELECT * FROM orders WHERE session=? AND paid=1",
      session,
    );
    if (!order) return;
    const total = get<{ amount: number }>(
      "SELECT COALESCE(SUM(amount),0) AS amount FROM refunds WHERE session=?",
      session,
    )!.amount;
    const refunded = Math.min(
      order.credits,
      Math.ceil((order.credits * total) / order.amount),
    );
    if (refunded <= order.refunded) return;
    adjust(
      `refund:${order.id}:${refunded}`,
      order.user_id,
      order.refunded - refunded,
      "payment_refunded",
    );
    run("UPDATE orders SET refunded=? WHERE id=?", refunded, order.id);
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS jobs_user_history ON jobs(user_id,status,created DESC,id DESC)",
  );
  const api: LocalAccounts = {
    db,
    close: () => db.close(),
    designs: (userId) =>
      db
        .prepare(
          "SELECT output FROM jobs WHERE user_id=? AND status='complete' ORDER BY created DESC LIMIT 12",
        )
        .all(userId) as { output: string }[],
    history(userId, page = 0, limit = 24) {
      return {
        items: db
          .prepare(
            "SELECT output,created FROM jobs WHERE user_id=? AND status='complete' ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
          )
          .all(userId, limit, page * limit) as unknown as HistoryEntry[],
        total: get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM jobs WHERE user_id=? AND status='complete'",
          userId,
        )!.count,
      };
    },
    user: (id) => get<User>("SELECT * FROM users WHERE id=?", id),
    grantWelcomeCredits(userId) {
      return transaction(() => {
        if (!api.user(userId)) throw fault("ACCOUNT_NOT_FOUND", 404);
        return adjust(`welcome:${userId}`, userId, 3, "welcome_credits");
      });
    },
    identify(provider, subject, name) {
      return transaction(() => {
        const identity = get<Identity>(
          "SELECT user_id FROM identities WHERE provider=? AND subject=?",
          provider,
          subject,
        );
        if (identity) {
          run("UPDATE users SET name=? WHERE id=?", name, identity.user_id);
          return api.user(identity.user_id)!;
        }
        const id = randomUUID();
        run("INSERT INTO users(id,name) VALUES(?,?)", id, name);
        run("INSERT INTO identities VALUES(?,?,?)", provider, subject, id);
        return api.user(id)!;
      });
    },
    session(userId) {
      const raw = token();
      run("DELETE FROM sessions WHERE expires<?", now());
      run(
        "INSERT INTO sessions VALUES(?,?,?)",
        hash(raw),
        userId,
        now() + 30 * 86400_000,
      );
      return raw;
    },
    authenticate(raw = "") {
      return (
        get<User>(
          "SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE sessions.token=? AND expires>?",
          hash(raw),
          now(),
        ) || null
      );
    },
    logout(raw = "") {
      run("DELETE FROM sessions WHERE token=?", hash(raw));
    },
    startOAuth(provider, browser) {
      const state = token(),
        verifier = token();
      run("DELETE FROM oauth WHERE expires<?", now());
      run(
        "INSERT INTO oauth VALUES(?,?,?,?,?)",
        hash(state),
        hash(browser),
        provider,
        verifier,
        now() + 600_000,
      );
      return { state, verifier };
    },
    finishOAuth(state, browser, provider) {
      return transaction(() => {
        const row = get<OAuthRow>(
          "SELECT * FROM oauth WHERE state=?",
          hash(state),
        );
        if (
          !row ||
          row.browser !== hash(browser) ||
          row.provider !== provider ||
          row.expires < now()
        )
          throw fault("AUTH_EXPIRED");
        run("DELETE FROM oauth WHERE state=?", hash(state));
        return row.verifier;
      });
    },
    requireCredits(userId, count = 1) {
      if ((api.user(userId)?.credits || 0) < count)
        throw fault("CREDITS_REQUIRED", 402);
    },
    limitPlanning(userId) {
      const bucket = Math.floor(now() / 3600000);
      run("DELETE FROM rate_limits WHERE bucket<?", bucket - 1);
      run(
        "INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=count+1",
        userId,
        bucket,
      );
      if (
        get<{ count: number }>(
          "SELECT count FROM rate_limits WHERE user_id=? AND bucket=?",
          userId,
          bucket,
        )!.count > 20
      )
        throw fault("PLAN_RATE_LIMIT", 429);
    },
    reserve(userId) {
      return transaction(() => {
        if (
          get<Pick<Job, "id">>(
            "SELECT id FROM jobs WHERE user_id=? AND status='reserved'",
            userId,
          )
        )
          throw fault("GENERATION_BUSY", 409);
        api.requireCredits(userId);
        const id = randomUUID();
        adjust(id, userId, -1, "generation");
        run(
          "INSERT INTO jobs VALUES(?,?,'reserved',NULL,?)",
          id,
          userId,
          now(),
        );
        return id;
      });
    },
    complete(id, output) {
      run(
        "UPDATE jobs SET status='complete',output=? WHERE id=? AND status='reserved'",
        output,
        id,
      );
    },
    release(id) {
      return transaction(() => {
        const job = get<Job>(
          "SELECT * FROM jobs WHERE id=? AND status='reserved'",
          id,
        );
        if (!job) return;
        adjust("release:" + id, job.user_id, 1, "generation_failed");
        run("UPDATE jobs SET status='released' WHERE id=?", id);
      });
    },
    owns(userId, output) {
      return Boolean(
        get<Pick<Job, "id">>(
          "SELECT id FROM jobs WHERE user_id=? AND output=? AND status='complete'",
          userId,
          output,
        ),
      );
    },
    order(userId, plan) {
      const id = randomUUID();
      run(
        "INSERT INTO orders(id,user_id,plan,amount,credits,currency) VALUES(?,?,?,?,?,?)",
        id,
        userId,
        plan.id,
        plan.amount,
        plan.credits,
        "usd",
      );
      return id;
    },
    setCheckout(id, session) {
      run("UPDATE orders SET session=? WHERE id=?", session, id);
    },
    fulfill(payment) {
      return transaction(() => {
        const order = get<Order>(
          "SELECT * FROM orders WHERE id=?",
          payment.orderId || "",
        );
        if (
          !order ||
          order.user_id !== payment.userId ||
          (order.session && order.session !== payment.id) ||
          payment.currency !== order.currency.toUpperCase() ||
          payment.amount !== order.amount
        )
          throw fault("PAYMENT_MISMATCH");
        if (payment.status !== "completed") return false;
        const changed = adjust(
          "purchase:" + order.id,
          order.user_id,
          order.credits,
          "purchase",
        );
        run(
          "UPDATE orders SET paid=1,session=? WHERE id=?",
          payment.id,
          order.id,
        );
        applyRefunds(payment.id);
        return changed;
      });
    },
    refund(refund) {
      return transaction(() => {
        if (!Number.isSafeInteger(refund.amount) || refund.amount < 0)
          throw fault("PAYMENT_MISMATCH");
        run(
          "INSERT OR IGNORE INTO refunds VALUES(?,?,?)",
          refund.id,
          refund.session,
          refund.amount,
        );
        applyRefunds(refund.session);
      });
    },
    checkoutOrder(session, userId) {
      return get<Pick<Order, "paid">>(
        "SELECT paid FROM orders WHERE session=? AND user_id=?",
        session,
        userId,
      );
    },
  };
  for (const job of db
    .prepare("SELECT id FROM jobs WHERE status='reserved'")
    .all())
    api.release(String(job.id));
  return api;
}
