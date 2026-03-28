import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ControlCenterMetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export function ControlCenterMetricCard({
  label,
  value,
  meta,
  className,
}: ControlCenterMetricCardProps) {
  return (
    <article className={cn("cc-metric-card-ui", className)}>
      <span>{label}</span>
      <strong>{value}</strong>
      {meta ? <small>{meta}</small> : null}
    </article>
  );
}
