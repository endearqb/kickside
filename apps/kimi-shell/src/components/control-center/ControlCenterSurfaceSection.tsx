import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ControlCenterSurfaceSectionProps = {
  title?: ReactNode;
  statusBadge?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "accent" | "danger";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export function ControlCenterSurfaceSection({
  title,
  statusBadge,
  actions,
  tone = "default",
  className,
  bodyClassName,
  children,
}: ControlCenterSurfaceSectionProps) {
  const hasHeader = title || statusBadge || actions;
  return (
    <section className={cn("cc-surface-section", `tone-${tone}`, className)}>
      {hasHeader ? (
        <header className="cc-surface-section-header">
          <div className="cc-surface-section-copy">
            {title ? <h4>{title}</h4> : null}
          </div>
          {statusBadge || actions ? (
            <div className="cc-surface-section-actions">
              {statusBadge}
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}
      <div className={cn("cc-surface-section-body", bodyClassName)}>{children}</div>
    </section>
  );
}
