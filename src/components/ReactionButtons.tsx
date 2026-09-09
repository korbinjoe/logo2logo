import { useAppState } from "../state";
export function ReactionIcon({
  kind,
}: {
  kind: "like" | "dislike" | "favorite";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "favorite" ? (
        <path d="M6 3h12v18l-6-4-6 4Z" />
      ) : (
        <g transform={kind === "dislike" ? "rotate(180 12 12)" : undefined}>
          <path d="M8 10 12 3c2 0 3 1 2 4l-1 3h6a2 2 0 0 1 2 2l-2 7H8ZM3 10h5v10H3Z" />
        </g>
      )}
    </svg>
  );
}
export function ReactionButtons({
  brandId,
  compact = false,
}: {
  brandId: string;
  compact?: boolean;
}) {
  const { t, preferences, update } = useAppState(),
    reaction = preferences.brandReactions[brandId] || {
      vote: null,
      favorite: false,
    };
  return (
    <div
      className={`brand-reactions ${compact ? "compact" : ""}`}
      role="group"
      aria-label={t("brand.personal")}
    >
      {(["like", "dislike", "favorite"] as const).map((kind) => {
        const pressed =
            kind === "favorite" ? reaction.favorite : reaction.vote === kind,
          label = t(
            kind === "favorite" && pressed ? "brand.saved" : `brand.${kind}`,
          );
        return (
          <button
            type="button"
            key={kind}
            data-reaction={kind}
            aria-pressed={pressed}
            aria-label={label}
            title={label}
            onClick={(e) => {
              e.stopPropagation();
              update("brandReactions", {
                ...preferences.brandReactions,
                [brandId]:
                  kind === "favorite"
                    ? { ...reaction, favorite: !reaction.favorite }
                    : {
                        ...reaction,
                        vote: reaction.vote === kind ? null : kind,
                      },
              });
            }}
          >
            <ReactionIcon kind={kind} />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
