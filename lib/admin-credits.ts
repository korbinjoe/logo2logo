import { fault } from "./accounts.ts";
import type { RemoteAccounts, User } from "./types.ts";

export async function listAdminAccounts(
  store: RemoteAccounts,
  query: string,
  page: number,
) {
  const filter = query.trim().slice(0, 100);
  const where = "instr(lower(name),lower(?))>0 OR instr(id,?)>0";
  const users = await store.query<User & { providers: string }>(
    `SELECT users.*, (SELECT group_concat(provider, ', ') FROM identities WHERE user_id=users.id) AS providers FROM users WHERE ${where} ORDER BY name,id LIMIT 50 OFFSET ?`,
    filter,
    filter,
    page * 50,
  );
  const [count] = await store.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM users WHERE ${where}`,
    filter,
    filter,
  );
  return { users, total: count.total, page };
}

export async function adjustAdminCredits(
  store: RemoteAccounts,
  actor: string,
  input: Record<string, unknown>,
) {
  const { userId, credits, expectedCredits, reason, operationId } = input;
  if (
    typeof userId !== "string" ||
    userId.length > 100 ||
    typeof credits !== "number" ||
    !Number.isSafeInteger(credits) ||
    credits < 0 ||
    credits > 1_000_000 ||
    typeof expectedCredits !== "number" ||
    !Number.isSafeInteger(expectedCredits) ||
    typeof reason !== "string" ||
    reason.trim().length < 3 ||
    reason.trim().length > 200 ||
    typeof operationId !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(operationId)
  )
    throw fault("INVALID_ADJUSTMENT");
  const id = `admin:${operationId}`;
  const audit = JSON.stringify({
    type: "admin_adjustment",
    actor,
    reason: reason.trim(),
    balance: credits,
  });
  return store.transaction(async () => {
    const user = await store.user(userId);
    if (!user) throw fault("ACCOUNT_NOT_FOUND", 404);
    const [previous] = await store.query<{ user_id: string; reason: string }>(
      "SELECT user_id,reason FROM ledger WHERE id=?",
      id,
    );
    if (previous) {
      if (previous.user_id !== userId || previous.reason !== audit)
        throw fault("ADJUSTMENT_CONFLICT", 409);
      return { user, applied: false };
    }
    if (user.credits !== expectedCredits) throw fault("BALANCE_CHANGED", 409);
    await store.execute(
      "INSERT INTO ledger(id,user_id,delta,reason,created) VALUES(?,?,?,?,?)",
      id,
      userId,
      credits - user.credits,
      audit,
      Date.now(),
    );
    await store.execute(
      "UPDATE users SET credits=? WHERE id=?",
      credits,
      userId,
    );
    return { user: (await store.user(userId))!, applied: true };
  });
}
