import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ApiFailure, Locale, Preferences, SavedOutput } from "./types";
import {
  defaults,
  readPreferences,
  withOutput,
  writePreference,
} from "./lib/preferences";
import { translate, errorMessage, type Params } from "./lib/i18n";
import { ApiError } from "./lib/api";
import { themes } from "./data/themes";
function readKey(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function initialPreferences() {
  const p = readPreferences();
  try {
    const old = JSON.parse(
      sessionStorage.getItem("logo2logo-draft") || "null",
    ) as Preferences["draft"] | null;
    if (old && !p.draft.description && !p.draft.referenceId) {
      writePreference("draft", old);
      return readPreferences();
    }
  } catch {
    /* Old, corrupt storage does not prevent startup. */
  } finally {
    try {
      sessionStorage.removeItem("logo2logo-draft");
    } catch {
      /* unavailable */
    }
  }
  return p;
}
interface State {
  preferences: Preferences;
  update: <K extends Exclude<keyof Preferences, "version">>(
    key: K,
    value: Preferences[K],
  ) => void;
  saveOutput: (scope: string, record: SavedOutput) => void;
  locale: Locale;
  setLocale: (value: Locale) => void;
  theme: string;
  setTheme: (value: string) => void;
  t: (key: string, params?: Params) => string;
  error: (error: unknown) => string;
  storageFailed: boolean;
}
const Context = createContext<State | null>(null);
export function StateProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(initialPreferences),
    preferencesRef = useRef(preferences);
  const [locale, setLocaleState] = useState<Locale>(() =>
    readKey("logo2logo-locale", "en") === "zh" ? "zh" : "en",
  );
  const [theme, setThemeState] = useState(() => {
    const saved = readKey("logo2logo-theme", "light");
    return themes.some((t) => t.id === saved) ? saved : "light";
  });
  const [storageFailed, setStorageFailed] = useState(false);
  const update = useCallback(
    <K extends Exclude<keyof Preferences, "version">>(
      key: K,
      value: Preferences[K],
    ) => {
      const next = { ...preferencesRef.current, [key]: value };
      preferencesRef.current = next;
      setPreferences(next);
      writePreference(key, value);
    },
    [],
  );
  const saveOutput = useCallback(
    (scope: string, record: SavedOutput) =>
      update(
        "workspaces",
        withOutput(preferencesRef.current.workspaces, scope, record),
      ),
    [update],
  );
  const saveKey = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      setStorageFailed(true);
    }
  };
  const setLocale = (value: Locale) => {
    setLocaleState(value);
    saveKey("logo2logo-locale", value);
  };
  const setTheme = (value: string) => {
    if (themes.some((t) => t.id === value)) {
      setThemeState(value);
      saveKey("logo2logo-theme", value);
    }
  };
  const t = useCallback(
    (key: string, params?: Params) => translate(locale, key, params),
    [locale],
  );
  const error = useCallback(
    (value: unknown) => {
      const data: ApiFailure =
        value instanceof ApiError
          ? value.data
          : value instanceof Error
            ? { error: value.message }
            : { error: String(value) };
      return (
        errorMessage(data, locale) +
        (data.requestId
          ? translate(locale, "requestId", { id: data.requestId })
          : "")
      );
    },
    [locale],
  );
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = t("Logo2logo — 让想法，有个样子。");
    document
      .querySelector("meta[name=description]")
      ?.setAttribute(
        "content",
        t("从喜欢的视觉风格出发，为你的品牌探索独特的 Logo。"),
      );
  }, [locale, t]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector("meta[name=theme-color]")
      ?.setAttribute(
        "content",
        themes.find((t) => t.id === theme)?.background || "#f8fafb",
      );
  }, [theme]);
  useEffect(() => {
    const failed = () => setStorageFailed(true);
    document.addEventListener("preferencesunavailable", failed);
    const storage = (event: StorageEvent) => {
      if (event.key === "logo2logo-preferences-v1" || event.key === null) {
        const p = event.key === null ? defaults() : readPreferences();
        preferencesRef.current = p;
        setPreferences(p);
      }
      if (event.key === "logo2logo-locale")
        setLocaleState(event.newValue === "zh" ? "zh" : "en");
      if (event.key === "logo2logo-theme")
        setThemeState(
          themes.some((t) => t.id === event.newValue)
            ? event.newValue!
            : "light",
        );
    };
    window.addEventListener("storage", storage);
    return () => {
      document.removeEventListener("preferencesunavailable", failed);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return (
    <Context.Provider
      value={{
        preferences,
        update,
        saveOutput,
        locale,
        setLocale,
        theme,
        setTheme,
        t,
        error,
        storageFailed,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAppState() {
  const state = useContext(Context);
  if (!state) throw new Error("StateProvider required");
  return state;
}
