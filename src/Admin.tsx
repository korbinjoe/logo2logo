import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, request } from "./lib/api";
import type { AccountResponse } from "./types";
import "./admin.css";
interface User {
  id: string;
  name: string;
  credits: number;
  providers: string;
}
interface Entry {
  id: string;
  delta: number;
  reason: string;
  created: number;
}
function Admin() {
  const [zh, setZh] = useState(() => {
    try {
      return localStorage.getItem("logo2logo-locale") === "zh";
    } catch {
      return false;
    }
  });
  const t = (en: string, cn: string) => (zh ? cn : en);
  const [access, setAccess] = useState<
    "loading" | "allowed" | "denied" | "error"
  >("loading");
  const [users, setUsers] = useState<User[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(0);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<User | null>(null),
    [entries, setEntries] = useState<Entry[]>([]);
  const [balance, setBalance] = useState(""),
    [reason, setReason] = useState("");
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [ledgerLoading, setLedgerLoading] = useState(false),
    [ledgerError, setLedgerError] = useState(false);
  const version = useRef(0),
    ledgerVersion = useRef(0),
    lock = useRef(false),
    operation = useRef<{ payload: string; id: string } | null>(null);
  const translateError = (error: unknown) => {
    const code = error instanceof ApiError ? error.data.code : "";
    if (code === "BALANCE_CHANGED")
      return t(
        "The balance changed. Select the refreshed account and try again.",
        "余额已变化，请重新选择刷新后的账号，再提交调整。",
      );
    if (code === "AUTH_REQUIRED" || code === "ADMIN_REQUIRED")
      return t(
        "Please sign in with an administrator account.",
        "请使用管理员账号登录。",
      );
    return t(
      "The request could not be completed. Refresh and try again.",
      "请求未完成，请刷新后重试。",
    );
  };
  async function load(search = filter, index = page) {
    const id = ++version.current;
    setLoading(true);
    try {
      const data = await request<{ users: User[]; total: number }>(
        `/api/admin/accounts?query=${encodeURIComponent(search)}&page=${index}`,
        { signal: AbortSignal.timeout(15000), cache: "no-store" },
      );
      if (id === version.current) {
        setUsers(data.users);
        setTotal(data.total);
      }
    } catch (e) {
      if (id === version.current) setNotice(translateError(e));
    } finally {
      if (id === version.current) setLoading(false);
    }
  }
  async function ledger(userId: string) {
    const id = ++ledgerVersion.current;
    setLedgerLoading(true);
    setLedgerError(false);
    setEntries([]);
    try {
      const data = await request<{ entries: Entry[] }>(
        `/api/admin/ledger?userId=${encodeURIComponent(userId)}`,
        { cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      if (id === ledgerVersion.current) setEntries(data.entries);
    } catch {
      if (id === ledgerVersion.current) setLedgerError(true);
    } finally {
      if (id === ledgerVersion.current) setLedgerLoading(false);
    }
  }
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
    try {
      localStorage.setItem("logo2logo-locale", zh ? "zh" : "en");
    } catch {
      /* private mode */
    }
  }, [zh]);
  useEffect(() => {
    let active = true;
    void request<AccountResponse>("/api/account", {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    })
      .then((data) => {
        if (active) setAccess(data.isAdmin ? "allowed" : "denied");
      })
      .catch(() => {
        if (active) setAccess("error");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (access === "allowed") void load(filter, page);
  }, [access, filter, page]);
  function choose(user: User) {
    if (busy) return;
    setSelected(user);
    setBalance(String(user.credits));
    setReason("");
    setNotice("");
    operation.current = null;
    void ledger(user.id);
  }
  async function save() {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    const payload = {
      userId: selected.id,
      credits: Number(balance),
      expectedCredits: selected.credits,
      reason: reason.trim(),
    };
    const serialized = JSON.stringify(payload);
    if (operation.current?.payload !== serialized)
      operation.current = { payload: serialized, id: crypto.randomUUID() };
    try {
      const result = await request<{ user: User }>("/api/admin/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, operationId: operation.current.id }),
        signal: AbortSignal.timeout(20000),
      });
      setSelected({ ...selected, credits: result.user.credits });
      setBalance(String(result.user.credits));
      setReason("");
      operation.current = null;
      setNotice(
        t(
          "Balance updated. The adjustment is recorded below.",
          "余额已更新，调整流水已记录。",
        ),
      );
      await Promise.all([load(), ledger(selected.id)]);
    } catch (e) {
      setNotice(translateError(e));
      if (e instanceof ApiError && e.data.code === "BALANCE_CHANGED") {
        setSelected(null);
        ++ledgerVersion.current;
        await load();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function description(entry: Entry) {
    if (entry.reason === "welcome_credits")
      return t("Welcome gift · 3 credits", "新用户赠送 · 3 次额度");
    try {
      const audit = JSON.parse(entry.reason);
      if (audit.type === "admin_adjustment")
        return `${audit.reason} · ${t("Admin", "管理员")}: ${audit.actor}`;
    } catch {
      /* regular ledger reason */
    }
    return entry.reason;
  }
  const valid =
    balance.trim() !== "" &&
    Number.isSafeInteger(Number(balance)) &&
    Number(balance) >= 0 &&
    Number(balance) <= 1000000 &&
    reason.trim().length >= 3;
  return (
    <main className="admin-shell">
      <header>
        <a href="/" className="admin-brand">
          <img src="/logo2logo-mark.svg" alt="" />
          Logo2logo
        </a>
        <button onClick={() => setZh(!zh)}>{zh ? "English" : "中文"}</button>
      </header>
      <p className="admin-eyebrow">WORKSPACE / ADMIN</p>
      <h1>{t("Account credits", "账号额度管理")}</h1>
      <p className="admin-intro">
        {t(
          "Each account receives 3 welcome credits once. Set balances and review every adjustment here.",
          "每个账号一次性获赠 3 次额度。在这里设置余额，并查看每次调整记录。",
        )}
      </p>
      {access !== "allowed" ? (
        <section className="admin-panel">
          <p role="status">
            {access === "loading"
              ? t("Checking access…", "正在检查权限…")
              : access === "error"
                ? t(
                    "Could not check access. Please refresh.",
                    "权限检查失败，请刷新重试。",
                  )
                : t(
                    "Sign in on the homepage using your administrator account, then return here.",
                    "请先在首页用管理员账号登录，再返回此页面。",
                  )}
          </p>
          <a href="/">{t("Back to homepage", "返回首页")} ↗</a>
        </section>
      ) : (
        <>
          <p role="status" className="admin-notice">
            {notice}
          </p>
          <div className="admin-layout">
            <section className="admin-panel">
              <form
                className="admin-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setPage(0);
                  setFilter(query.trim());
                  if (page === 0 && filter === query.trim())
                    void load(query.trim(), 0);
                }}
              >
                <input
                  aria-label={t(
                    "Search name or account ID",
                    "搜索用户名或账号 ID",
                  )}
                  placeholder={t("Name or account ID", "用户名或账号 ID")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button disabled={loading}>{t("Search", "搜索")}</button>
              </form>
              <p>
                {total} {t("accounts", "个账号")}{" "}
                {loading && t("· Loading…", "· 加载中…")}
              </p>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Account", "账号")}</th>
                      <th>{t("Credits", "余额")}</th>
                      <th>{t("Action", "操作")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} data-account-id={user.id}>
                        <td>
                          <strong>{user.name}</strong>
                          <small>{user.providers}</small>
                          <code>{user.id}</code>
                        </td>
                        <td>{user.credits}</td>
                        <td>
                          <button disabled={busy} onClick={() => choose(user)}>
                            {t("Manage", "管理")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!loading && !users.length && (
                <p>{t("No matching accounts.", "没有匹配的账号。")}</p>
              )}
              <nav className="admin-pagination">
                <button
                  disabled={page === 0 || loading}
                  onClick={() => setPage(page - 1)}
                >
                  {t("Previous", "上一页")}
                </button>
                <span>{page + 1}</span>
                <button
                  disabled={(page + 1) * 50 >= total || loading}
                  onClick={() => setPage(page + 1)}
                >
                  {t("Next", "下一页")}
                </button>
                <button disabled={loading} onClick={() => void load()}>
                  {t("Refresh", "刷新")}
                </button>
              </nav>
            </section>
            <section className="admin-panel admin-editor">
              {!selected ? (
                <p>
                  {t(
                    "Choose an account to adjust its credits.",
                    "选择一个账号来调整额度。",
                  )}
                </p>
              ) : (
                <>
                  <h2>{selected.name}</h2>
                  <code>{selected.id}</code>
                  <p>
                    {t("Current balance", "当前余额")}:{" "}
                    <strong>{selected.credits}</strong>
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (valid) void save();
                    }}
                  >
                    <label>
                      {t("New balance", "调整后的余额")}
                      <input
                        type="number"
                        min="0"
                        max="1000000"
                        step="1"
                        required
                        value={balance}
                        disabled={busy}
                        onChange={(e) => setBalance(e.target.value)}
                      />
                    </label>
                    <label>
                      {t("Reason (required)", "调整原因（必填）")}
                      <textarea
                        minLength={3}
                        maxLength={200}
                        required
                        value={reason}
                        disabled={busy}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <p>
                      {t("Change", "本次变化")}:{" "}
                      {Number.isFinite(Number(balance))
                        ? Number(balance) - selected.credits
                        : "—"}
                    </p>
                    <button className="admin-save" disabled={!valid || busy}>
                      {busy
                        ? t("Saving…", "保存中…")
                        : t("Save balance", "保存余额")}
                    </button>
                  </form>
                  <h3>{t("Recent ledger", "最近流水")}</h3>
                  {ledgerLoading ? (
                    <p>{t("Loading…", "加载中…")}</p>
                  ) : ledgerError ? (
                    <p>
                      {t(
                        "Ledger could not load. Select the account to retry.",
                        "流水加载失败，请重新选择账号重试。",
                      )}
                    </p>
                  ) : (
                    <ul className="admin-ledger">
                      {entries.map((entry) => (
                        <li key={entry.id}>
                          <strong>
                            {entry.delta > 0 ? "+" : ""}
                            {entry.delta}
                          </strong>
                          <span>
                            {description(entry)}
                            <small>
                              {new Date(entry.created).toLocaleString(
                                zh ? "zh-CN" : "en-US",
                              )}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Admin />);
