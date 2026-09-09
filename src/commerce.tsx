import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AccountResponse, PlanId, ProviderId } from "./types";
import { post, request } from "./lib/api";
import { useAppState } from "./state";
interface CommerceState {
  config: AccountResponse | null;
  scope: string | null;
  refresh: () => Promise<AccountResponse>;
  ensureAccess: (count: number) => Promise<boolean>;
  open: boolean;
  setOpen: (value: boolean) => void;
  buy: (plan: PlanId) => Promise<void>;
  login: (provider: ProviderId) => void;
  logout: () => Promise<void>;
  notice: string;
  checkPayment: () => Promise<void>;
  showCheck: boolean;
  checkoutBusy: boolean;
}
const Context = createContext<CommerceState | null>(null);
export function CommerceProvider({ children }: { children: ReactNode }) {
  const { t, locale, update } = useAppState();
  const [config, setConfig] = useState<AccountResponse | null>(null),
    [open, setOpen] = useState(false),
    [checkoutBusy, setCheckoutBusy] = useState(false);
  const [noticeState, setNotice] = useState<{
      key: string;
      count?: number;
    } | null>(null),
    [showCheck, setShowCheck] = useState(false);
  const mounted = useRef(true),
    attempts = useRef(0),
    paymentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    buyLock = useRef(false),
    refreshId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    const result = await request<AccountResponse>("/api/account", {
      cache: "no-store",
    });
    if (mounted.current && id === refreshId.current) setConfig(result);
    return result;
  }, []);
  const scope = config?.localMode ? "local" : config?.user?.id || null;
  const ensureAccess = async (count: number) => {
    let current: AccountResponse;
    try {
      current = await refresh();
    } catch {
      setNotice({ key: "shop.error" });
      return false;
    }
    if (current.localMode) return true;
    if (!current.user) {
      setOpen(true);
      return false;
    }
    if (current.user.credits < count) {
      setNotice({ key: "shop.notEnough", count });
      document
        .getElementById("pricing")
        ?.scrollIntoView({ behavior: "smooth" });
      return false;
    }
    return true;
  };
  const buy = async (plan: PlanId) => {
    if (buyLock.current) return;
    buyLock.current = true;
    setCheckoutBusy(true);
    update("selectedPlan", plan);
    try {
      const current = await refresh();
      if (!current.user) {
        setOpen(true);
        return;
      }
      if (!current.billingReady) {
        setNotice({ key: "shop.billingSoon" });
        return;
      }
      const result = await post<{ url: string }>("/api/billing/checkout", {
        plan,
        locale,
      });
      location.assign(result.url);
    } catch {
      setNotice({ key: "shop.error" });
    } finally {
      buyLock.current = false;
      setCheckoutBusy(false);
    }
  };
  const login = (provider: ProviderId) => {
    update("loginProvider", provider);
    location.assign(`/api/auth/${provider}`);
  };
  const logout = async () => {
    try {
      await post("/api/auth/logout", {});
      await refresh();
      setOpen(false);
    } catch {
      setNotice({ key: "shop.error" });
    }
  };
  const checkPayment = useCallback(async () => {
    clearTimeout(paymentTimer.current);
    const params = new URLSearchParams(location.search);
    try {
      const status = await request<{ paid: boolean }>(
        `/api/billing/status?session_id=${encodeURIComponent(params.get("session_id") || "")}`,
        { cache: "no-store" },
      );
      if (!mounted.current) return;
      if (status.paid) {
        setNotice({ key: "shop.paid" });
        setShowCheck(false);
        await refresh();
        return;
      }
      setNotice({
        key: attempts.current >= 10 ? "shop.later" : "shop.pending",
      });
      if (attempts.current++ < 10)
        paymentTimer.current = setTimeout(() => void checkPayment(), 3000);
    } catch {
      if (mounted.current) setNotice({ key: "shop.later" });
    }
    if (mounted.current) setShowCheck(true);
  }, [refresh]);
  useEffect(() => {
    mounted.current = true;
    void refresh()
      .then(() => {
        if (!mounted.current) return;
        const params = new URLSearchParams(location.search);
        if (params.get("auth") === "success")
          setNotice({ key: "shop.authSuccess" });
        if (["failed", "unavailable"].includes(params.get("auth") || "")) {
          setNotice({ key: "shop.authFailed" });
          setOpen(true);
        }
        if (params.get("checkout") === "cancelled")
          setNotice({ key: "shop.cancelled" });
        if (params.get("checkout") === "success") void checkPayment();
      })
      .catch(() => {
        if (mounted.current) setNotice({ key: "shop.error" });
      });
    return () => {
      mounted.current = false;
      clearTimeout(paymentTimer.current);
    };
  }, [refresh, checkPayment]);
  return (
    <Context.Provider
      value={{
        config,
        scope,
        refresh,
        ensureAccess,
        open,
        setOpen,
        buy,
        login,
        logout,
        notice: noticeState
          ? t(
              noticeState.key,
              noticeState.count === undefined
                ? {}
                : { count: noticeState.count },
            )
          : "",
        checkPayment: async () => {
          attempts.current = 0;
          await checkPayment();
        },
        showCheck,
        checkoutBusy,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCommerce() {
  const state = useContext(Context);
  if (!state) throw new Error("CommerceProvider required");
  return state;
}
