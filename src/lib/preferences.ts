import type { Concept, Preferences, SavedOutput } from "../types.ts";
export const PREFERENCES_KEY = "logo2logo-preferences-v1";
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const filters = ["", "单色", "多色", "渐变", "紧凑图形", "横向标志"];
const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;
export function defaults(): Preferences {
  return {
    version: 1,
    gallery: { query: "", filter: "", visible: 72 },
    draft: { description: "", style: "", referenceId: "", referenceFile: "" },
    themeCategory: "all",
    selectedPlan: null,
    loginProvider: null,
    section: null,
    disclosures: {},
    workspaces: {},
    brandReactions: {},
    brandPreviews: {},
    galleryCollection: "all",
    galleryOrder: [],
    heroMotion: true,
  };
}
export function readPreferences(storage?: StorageLike): Preferences {
  try {
    storage ??= globalThis.localStorage;
    const p = object(JSON.parse(storage.getItem(PREFERENCES_KEY) || "{}")),
      gallery = object(p.gallery),
      draft = object(p.draft);
    const workspaces: Preferences["workspaces"] = {};
    for (const [scope, records] of Object.entries(object(p.workspaces))
      .filter(([key]) => identifier.test(key))
      .slice(-10)) {
      workspaces[scope] = Array.isArray(records)
        ? records
            .filter((r: unknown) => {
              const item = object(r);
              return (
                typeof item.id === "string" &&
                identifier.test(item.id) &&
                JSON.stringify(item).length < 30000
              );
            })
            .slice(-24)
            .map((value: unknown) => {
              const r = object(value),
                c = object(r.c);
              return {
                id: String(r.id),
                c: {
                  ...c,
                  name: text(c.name, 300),
                  thesis: text(c.thesis, 10000),
                } as Concept,
                color:
                  typeof r.color === "string" && /^#[a-f0-9]{6}$/i.test(r.color)
                    ? r.color
                    : null,
                discarded: r.discarded === true,
                selected: r.selected === true,
              };
            })
        : [];
    }
    return {
      version: 1,
      gallery: {
        query: text(gallery.query, 200),
        filter:
          typeof gallery.filter === "string" && filters.includes(gallery.filter)
            ? gallery.filter
            : "",
        visible: Math.min(
          5000,
          Math.max(
            72,
            typeof gallery.visible === "number" &&
              Number.isFinite(gallery.visible)
              ? Math.floor(gallery.visible)
              : 72,
          ),
        ),
      },
      draft: {
        description: text(draft.description, 1500),
        style: text(draft.style, 200),
        referenceId: text(draft.referenceId, 120),
        referenceFile: text(draft.referenceFile, 200),
      },
      themeCategory:
        p.themeCategory === "light" ||
        p.themeCategory === "dark" ||
        p.themeCategory === "playful"
          ? p.themeCategory
          : "all",
      selectedPlan:
        p.selectedPlan === "starter" ||
        p.selectedPlan === "creator" ||
        p.selectedPlan === "studio"
          ? p.selectedPlan
          : null,
      loginProvider:
        p.loginProvider === "google" || p.loginProvider === "github"
          ? p.loginProvider
          : null,
      section:
        p.section === "inspiration" ||
        p.section === "pricing" ||
        p.section === "briefForm" ||
        p.section === "board" ||
        p.section === "history"
          ? p.section
          : null,
      disclosures: Object.fromEntries(
        Object.entries(object(p.disclosures))
          .filter(
            (entry): entry is [string, boolean] =>
              entry[0].length < 150 && typeof entry[1] === "boolean",
          )
          .slice(-150),
      ),
      workspaces,
      heroMotion: p.heroMotion !== false,
      galleryOrder: Array.isArray(p.galleryOrder)
        ? [
            ...new Set(
              p.galleryOrder.filter(
                (id): id is string =>
                  typeof id === "string" && identifier.test(id),
              ),
            ),
          ].slice(0, 5000)
        : [],
      brandPreviews: Object.fromEntries(
        Object.entries(object(p.brandPreviews))
          .filter(
            ([id, file]) =>
              identifier.test(id) &&
              typeof file === "string" &&
              /^[\w.-]+\.svg$/.test(file),
          )
          .slice(-5000),
      ) as Record<string, string>,
      galleryCollection:
        p.galleryCollection === "liked" ||
        p.galleryCollection === "disliked" ||
        p.galleryCollection === "favorites"
          ? p.galleryCollection
          : "all",
      brandReactions: Object.fromEntries(
        Object.entries(object(p.brandReactions))
          .filter(([id]) => identifier.test(id))
          .slice(-5000)
          .map(([id, value]) => {
            const r = object(value);
            return [
              id,
              {
                vote: r.vote === "like" || r.vote === "dislike" ? r.vote : null,
                favorite: r.favorite === true,
              },
            ];
          }),
      ),
    };
  } catch {
    return defaults();
  }
}
export function writePreference<
  K extends Exclude<keyof Preferences, "version">,
>(key: K, value: Preferences[K], storage?: StorageLike): boolean {
  try {
    storage ??= globalThis.localStorage;
    const p = readPreferences(storage);
    if (!Object.hasOwn(p, key) || (key as string) === "version") return false;
    p[key] = value;
    storage.setItem(PREFERENCES_KEY, JSON.stringify(p));
    return true;
  } catch {
    if (typeof document !== "undefined")
      document.dispatchEvent(new Event("preferencesunavailable"));
    return false;
  }
}
export function withOutput(
  workspaces: Preferences["workspaces"],
  scope: string,
  record: SavedOutput,
): Preferences["workspaces"] {
  if (!identifier.test(scope)) return workspaces;
  const records = [...(workspaces[scope] || [])],
    index = records.findIndex((item) => item.id === record.id);
  if (index < 0) records.push(record);
  else records[index] = { ...records[index], ...record };
  return { ...workspaces, [scope]: records.slice(-24) };
}
