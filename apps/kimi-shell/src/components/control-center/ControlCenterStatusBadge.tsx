import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ControlCenterStatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "accent";

type ControlCenterStatusBadgeProps = {
  tone?: ControlCenterStatusTone;
  className?: string;
  children: ReactNode;
};

export function ControlCenterStatusBadge({
  tone = "neutral",
  className,
  children,
}: ControlCenterStatusBadgeProps) {
  return (
    <span
      className={cn("cc-status-badge", "cc-status-badge-ui", `tone-${tone}`, className)}
      data-tone={tone}
    >
      {children}
    </span>
  );
}
