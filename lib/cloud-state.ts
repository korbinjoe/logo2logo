import type {
  RemoteAccounts,
  SqlValue,
  CloudJobRow,
  CloudJob,
  PlanningRow,
  DesignInput,
  PlanningSession,
  Metadata,
} from "./types.ts";
import { randomUUID, createHash } from "node:crypto";
import { fault, token, hash } from "./accounts.ts";

export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function createCloudState(
  store: RemoteAccounts,
  { now = Date.now } = {},
) {
  const one = async <T>(
    sql: string,
    ...args: SqlValue[]
  ): Promise<T | undefined> => (await store.query<T>(sql, ...args))[0];
  const job = async (id: string, userId: string): Promise<CloudJob> => {
    const row = await one<CloudJobRow>(
      "SELECT jobs.*,cloud_jobs.* FROM jobs JOIN cloud_jobs USING(id) WHERE jobs.id=? AND user_id=?",
      id,
      userId,
    );
    if (!row) throw fault("OUTPUT_NOT_FOUND", 404);
    return {
      ...row,
      input: JSON.parse(row.input),
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  };
  return {
    job,
    async callback(id: string, secret: string) {
      const row = await one<Pick<CloudJobRow, "user_id" | "request_id">>(
        "SELECT jobs.user_id,cloud_jobs.request_id FROM jobs JOIN cloud_jobs USING(id) WHERE jobs.id=? AND callback_hash=?",
        id,
        hash(secret),
      );
      if (!row) throw fault("INVALID_CALLBACK", 403);
      if (!row.request_id) throw fault("CALLBACK_NOT_READY", 503);
      return row.user_id;
    },
    active: (userId: string) =>
      store.query<{ id: string }>(
        "SELECT jobs.id FROM jobs JOIN cloud_jobs USING(id) WHERE user_id=? AND status='reserved'",
        userId,
      ),
    async reserve(userId: string, input: DesignInput, endpoint: string) {
      return store.transaction(async () => {
        const fingerprint = digest(input);
        const existing = await one<Pick<CloudJobRow, "id" | "fingerprint">>(
          "SELECT jobs.id,fingerprint FROM jobs JOIN cloud_jobs USING(id) WHERE user_id=? AND status='reserved'",
          userId,
        );
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw fault("GENERATION_BUSY", 409);
          return { id: existing.id, existing: true };
        }
        const id = await store.reserve(userId);
        const callbackToken = token();
        await store.execute(
          "INSERT INTO cloud_jobs(id,fingerprint,input,endpoint,callback_hash) VALUES(?,?,?,?,?)",
          id,
          fingerprint,
          JSON.stringify(input),
          endpoint,
          hash(callbackToken),
        );
        return { id, existing: false, callbackToken };
      });
    },
    submitted: (id: string, requestId: string) =>
      store.execute(
        "UPDATE cloud_jobs SET request_id=? WHERE id=? AND request_id IS NULL",
        requestId,
        id,
      ),
    async claim(id: string) {
      const lease = randomUUID();
      const changed = await store.execute(
        "UPDATE cloud_jobs SET lease=?,lease_until=? WHERE id=? AND lease_until<? AND EXISTS(SELECT 1 FROM jobs WHERE jobs.id=cloud_jobs.id AND status='reserved')",
        lease,
        now() + 280000,
        id,
        now(),
      );
      return changed.changes ? lease : null;
    },
    unlock: (id: string, lease: string) =>
      store.execute(
        "UPDATE cloud_jobs SET lease=NULL,lease_until=0 WHERE id=? AND lease=?",
        id,
        lease,
      ),
    async complete(id: string, lease: string, metadata: Metadata) {
      return store.transaction(async () => {
        const row = await one<Pick<CloudJobRow, "lease">>(
          "SELECT lease FROM cloud_jobs WHERE id=?",
          id,
        );
        if (row?.lease !== lease) throw fault("JOB_LEASE_LOST", 409);
        await store.execute(
          "UPDATE cloud_jobs SET metadata=?,lease=NULL,lease_until=0 WHERE id=?",
          JSON.stringify(metadata),
          id,
        );
        await store.complete(id, id);
      });
    },
    async fail(id: string, code: string) {
      return store.transaction(async () => {
        await store.execute(
          "UPDATE cloud_jobs SET error=? WHERE id=?",
          code,
          id,
        );
        await store.release(id);
      });
    },
    async withPlan<T extends object>(
      input: DesignInput,
      work: (
        session: PlanningSession,
        save: () => Promise<{ changes: number }>,
      ) => Promise<T>,
    ) {
      if (typeof input.description !== "string" || !input.description.trim())
        throw fault("INVALID_BRIEF");
      if (input.description.length > 1500) throw fault("BRIEF_TOO_LONG");
      const fingerprint = digest([
        input.description,
        input.style || null,
        input.referenceId,
        input.referenceFile || null,
        input.locale === "en" ? "en" : "zh",
        input.accountId,
      ]);
      const id = input.resumeId || randomUUID(),
        lease = randomUUID();
      const session = await store.transaction(async () => {
        await store.execute(
          "DELETE FROM planning_sessions WHERE expires<? AND lease_until<?",
          now(),
          now(),
        );
        const row = await one<PlanningRow>(
          "SELECT * FROM planning_sessions WHERE id=?",
          id,
        );
        if (input.resumeId && !row) throw fault("PLAN_EXPIRED", 410);
        if (row?.fingerprint && row.fingerprint !== fingerprint)
          throw fault("BRIEF_CHANGED", 409);
        if (row && row.lease_until > now()) throw fault("PLAN_BUSY", 409);
        const data: PlanningSession = row
          ? JSON.parse(row.data)
          : { id, checkpoint: { concepts: [], territories: [] } };
        await store.execute(
          "INSERT INTO planning_sessions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,lease_until=excluded.lease_until,expires=excluded.expires",
          id,
          fingerprint,
          JSON.stringify(data),
          now() + 1800000,
          lease,
          now() + 280000,
        );
        return data;
      });
      const save = () =>
        store.execute(
          "UPDATE planning_sessions SET data=?,expires=? WHERE id=? AND lease=?",
          JSON.stringify(session),
          now() + 1800000,
          id,
          lease,
        );
      try {
        return { ...(await work(session, save)), resumeId: id };
      } finally {
        await save();
        await store.execute(
          "UPDATE planning_sessions SET lease=NULL,lease_until=0 WHERE id=? AND lease=?",
          id,
          lease,
        );
      }
    },
  };
}
