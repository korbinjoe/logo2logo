import type {
  RemoteAccounts,
  SqlValue,
  User,
  Identity,
  OAuthRow,
  Order,
  Job,
} from "./types.ts";
import { asError } from "./errors.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client/web";
import { hash, token, fault } from "./accounts.ts";

// No filesystem database, startup refunds, or instance-local transaction state.
// Every transaction uses its own connection context, safe under Fluid concurrency.
export function createRemoteAccounts({
  url,
  authToken,
  client = createClient({ url: url!, authToken }),
  now = Date.now,
}: {
  url?: string;
  authToken?: string;
  client?: import("@libsql/client").Client;
  now?: () => number;
}) {
  const context = new AsyncLocalStorage<import("@libsql/client").Transaction>();
  const execute = (sql: string, args: SqlValue[]) =>
    (context.getStore() || client).execute({
      sql,
      args: args.map((x) => (x === undefined ? null : x)),
    });
  const all = async <T = Record<string, unknown>>(
    sql: string,
    ...args: SqlValue[]
  ): Promise<T[]> => (await execute(sql, args)).rows as unknown as T[];
  const get = async <T>(sql: string, ...args: SqlValue[]) =>
    (await all<T>(sql, ...args))[0] as T | undefined;
  const run = async (sql: string, ...args: SqlValue[]) => ({
    changes: (await execute(sql, args)).rowsAffected,
  });
  async function transaction<T>(work: () => Promise<T>): Promise<T> {
    if (context.getStore()) return work();
    // Retry only lock contention while opening a transaction, before any writes.
    // Never replay a transaction after an uncertain commit/network response.
    async function begin() {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.transaction("write");
        } catch (cause) {
          if (asError(cause).code !== "SQLITE_BUSY" || attempt >= 3)
            throw cause;
          await new Promise((resolve) =>
            setTimeout(resolve, 25 * 2 ** attempt),
          );
        }
      }
    }
    const tx = await begin();
    try {
      const result = await context.run(tx, work);
      await tx.commit();
      return result;
    } catch (cause) {
      const error = asError(cause);
      await tx.rollback().catch(() => {});
      throw error;
    } finally {
      tx.close();
    }
  }
  async function adjust(
    id: string,
    userId: string,
    delta: number,
    reason: string,
  ) {
    const inserted = (
      await run(
        "INSERT OR IGNORE INTO ledger VALUES(?,?,?,?,?)",
        id,
        userId,
        delta,
        reason,
        now(),
      )
    ).changes;
    if (inserted)
      await run("UPDATE users SET credits=credits+? WHERE id=?", delta, userId);
    return Boolean(inserted);
  }
  async function applyRefunds(session: string) {
    const order = await get<Order>(
      "SELECT * FROM orders WHERE session=? AND paid=1",
      session,
    );
    if (!order) return;
    const total = (await get<{ amount: number }>(
      "SELECT COALESCE(SUM(amount),0) AS amount FROM refunds WHERE session=?",
      session,
    ))!.amount;
    const refunded = Math.min(
      order.credits,
      Math.ceil((order.credits * total) / order.amount),
    );
    if (refunded <= order.refunded) return;
    await adjust(
      `refund:${order.id}:${refunded}`,
      order.user_id,
      order.refunded - refunded,
      "payment_refunded",
    );
    await run("UPDATE orders SET refunded=? WHERE id=?", refunded, order.id);
  }

  const api: RemoteAccounts = {
    db: client,
    close: () => client.close(),
    query: all,
    execute: run,
    transaction,
    designs: (userId) =>
      all(
        "SELECT output FROM jobs WHERE user_id=? AND status='complete' ORDER BY created DESC LIMIT 12",
        userId,
      ),
    async history(userId, page = 0, limit = 24) {
      return {
        items: await all(
          "SELECT output,created FROM jobs WHERE user_id=? AND status='complete' ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
          userId,
          limit,
          page * limit,
        ),
        total: (await get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM jobs WHERE user_id=? AND status='complete'",
          userId,
        ))!.count,
      };
    },
    user: async (id) => await get<User>("SELECT * FROM users WHERE id=?", id),
    async grantWelcomeCredits(userId) {
      return transaction(async () => {
        if (!(await api.user(userId))) throw fault("ACCOUNT_NOT_FOUND", 404);
        return adjust(`welcome:${userId}`, userId, 3, "welcome_credits");
      });
    },
    async identify(provider, subject, name) {
      return transaction(async () => {
        const identity = await get<Identity>(
          "SELECT user_id FROM identities WHERE provider=? AND subject=?",
          provider,
          subject,
        );
        if (identity) {
          await run(
            "UPDATE users SET name=? WHERE id=?",
            name,
            identity.user_id,
          );
          return (await api.user(identity.user_id))!;
        }
        const id = randomUUID();
        await run("INSERT INTO users(id,name) VALUES(?,?)", id, name);
        await run(
          "INSERT INTO identities VALUES(?,?,?)",
          provider,
          subject,
          id,
        );
        return (await api.user(id))!;
      });
    },
    async session(userId) {
      const raw = token();
      await run("DELETE FROM sessions WHERE expires<?", now());
      await run(
        "INSERT INTO sessions VALUES(?,?,?)",
        hash(raw),
        userId,
        now() + 30 * 86400_000,
      );
      return raw;
    },
    async authenticate(raw = "") {
      return (
        (await get<User>(
          "SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE sessions.token=? AND expires>?",
          hash(raw),
          now(),
        )) || null
      );
    },
    async logout(raw = "") {
      await run("DELETE FROM sessions WHERE token=?", hash(raw));
    },
    async startOAuth(provider, browser) {
      const state = token(),
        verifier = token();
      await run("DELETE FROM oauth WHERE expires<?", now());
      await run(
        "INSERT INTO oauth VALUES(?,?,?,?,?)",
        hash(state),
        hash(browser),
        provider,
        verifier,
        now() + 600_000,
      );
      return { state, verifier };
    },
    async finishOAuth(state, browser, provider) {
      return transaction(async () => {
        const row = await get<OAuthRow>(
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
        await run("DELETE FROM oauth WHERE state=?", hash(state));
        return row.verifier;
      });
    },
    async requireCredits(userId, count = 1) {
      if (((await api.user(userId))?.credits || 0) < count)
        throw fault("CREDITS_REQUIRED", 402);
    },
    async limitPlanning(userId) {
      const bucket = Math.floor(now() / 3600000);
      await run("DELETE FROM rate_limits WHERE bucket<?", bucket - 1);
      await run(
        "INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=count+1",
        userId,
        bucket,
      );
      if (
        (await get<{ count: number }>(
          "SELECT count FROM rate_limits WHERE user_id=? AND bucket=?",
          userId,
          bucket,
        ))!.count > 20
      )
        throw fault("PLAN_RATE_LIMIT", 429);
    },
    async reserve(userId) {
      return transaction(async () => {
        if (
          await get<Pick<Job, "id">>(
            "SELECT id FROM jobs WHERE user_id=? AND status='reserved'",
            userId,
          )
        )
          throw fault("GENERATION_BUSY", 409);
        await api.requireCredits(userId);
        const id = randomUUID();
        await adjust(id, userId, -1, "generation");
        await run(
          "INSERT INTO jobs VALUES(?,?,'reserved',NULL,?)",
          id,
          userId,
          now(),
        );
        return id;
      });
    },
    async complete(id, output) {
      await run(
        "UPDATE jobs SET status='complete',output=? WHERE id=? AND status='reserved'",
        output,
        id,
      );
    },
    async release(id) {
      return transaction(async () => {
        const job = await get<Job>(
          "SELECT * FROM jobs WHERE id=? AND status='reserved'",
          id,
        );
        if (!job) return;
        await adjust("release:" + id, job.user_id, 1, "generation_failed");
        await run("UPDATE jobs SET status='released' WHERE id=?", id);
      });
    },
    async owns(userId, output) {
      return Boolean(
        await get<Pick<Job, "id">>(
          "SELECT id FROM jobs WHERE user_id=? AND output=? AND status='complete'",
          userId,
          output,
        ),
      );
    },
    async order(userId, plan) {
      const id = randomUUID();
      await run(
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
    async setCheckout(id, session) {
      await run("UPDATE orders SET session=? WHERE id=?", session, id);
    },
    async fulfill(payment) {
      return transaction(async () => {
        const order = await get<Order>(
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
        const changed = await adjust(
          "purchase:" + order.id,
          order.user_id,
          order.credits,
          "purchase",
        );
        await run(
          "UPDATE orders SET paid=1,session=? WHERE id=?",
          payment.id,
          order.id,
        );
        await applyRefunds(payment.id);
        return changed;
      });
    },
    async refund(refund) {
      return transaction(async () => {
        if (!Number.isSafeInteger(refund.amount) || refund.amount < 0)
          throw fault("PAYMENT_MISMATCH");
        await run(
          refund.cumulative
            ? "INSERT INTO refunds VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET amount=MAX(refunds.amount,excluded.amount) WHERE refunds.session=excluded.session"
            : "INSERT OR IGNORE INTO refunds VALUES(?,?,?)",
          refund.id,
          refund.session,
          refund.amount,
        );
        await applyRefunds(refund.session);
      });
    },
    async checkoutOrder(session, userId) {
      return await get<Order>(
        "SELECT * FROM orders WHERE session=? AND user_id=?",
        session,
        userId,
      );
    },
  };
  return api;
}
