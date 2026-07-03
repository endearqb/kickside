import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DirectoryCardBadge = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
};

export type DirectoryCardItem = {
  id: string;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  description: ReactNode;
  badges?: DirectoryCardBadge[];
  active?: boolean;
  cornerSlot?: ReactNode;
  cornerAction?: {
    label: string;
    icon?: ReactNode;
    onSelect: () => void;
  };
  onOpen: () => void;
};

type DirectoryCardGridProps = {
  items: DirectoryCardItem[];
  empty?: ReactNode;
  className?: string;
  loading?: boolean;
  skeletonCount?: number;
};

export function DirectoryCardGrid({
  items,
  empty,
  className,
  loading = false,
  skeletonCount = 6,
}: DirectoryCardGridProps) {
  if (loading && items.length === 0) {
    return (
      <div
        className={cn("directory-card-grid", "is-loading", className)}
        aria-busy="true"
        aria-label="正在加载目录"
      >
        {Array.from({ length: skeletonCount }).map((_, index) => (
          <div key={index} className="directory-card-skeleton" aria-hidden="true">
            <span className="directory-skeleton-line is-title" />
            <span className="directory-skeleton-line" />
            <span className="directory-skeleton-line is-short" />
            <span className="directory-skeleton-pill" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <>{empty ?? null}</>;
  }

  return (
    <div className={cn("directory-card-grid", className)} aria-busy={loading || undefined}>
      {items.map((item) => (
        <article
          key={item.id}
          className={cn("directory-card", item.active && "is-active")}
          role="button"
          tabIndex={0}
          onClick={item.onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              item.onOpen();
            }
          }}
        >
          <div className="directory-card-main">
            <div className="directory-card-title-row">
              <div className="directory-card-title-copy">
                <strong title={String(item.title)}>{item.title}</strong>
                {item.subtitle ? <span>{item.subtitle}</span> : null}
              </div>
              {item.cornerSlot ? (
                <div
                  className="directory-card-corner-slot"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  {item.cornerSlot}
                </div>
              ) : item.cornerAction ? (
                <button
                  type="button"
                  className="directory-card-corner-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    item.cornerAction?.onSelect();
                  }}
                  aria-label={item.cornerAction.label}
                  title={item.cornerAction.label}
                >
                  {item.cornerAction.icon ?? item.cornerAction.label}
                </button>
              ) : null}
            </div>
            {item.meta ? <div className="directory-card-meta">{item.meta}</div> : null}
            <p>{item.description}</p>
            {item.badges?.length ? (
              <div className="directory-card-badges">
                {item.badges.slice(0, 3).map((badge) => (
                  <span key={badge.label} className={cn("directory-card-badge", `tone-${badge.tone ?? "neutral"}`)}>
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
