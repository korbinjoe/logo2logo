import type { ReactNode } from "react";
import { useAppState } from "../state";
export function Disclosure({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const { preferences, update } = useAppState();
  const open = Boolean(preferences.disclosures[id]);
  return (
    <details className={className} open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          update("disclosures", { ...preferences.disclosures, [id]: !open });
        }}
      >
        {title}
      </summary>
      {children}
    </details>
  );
}
