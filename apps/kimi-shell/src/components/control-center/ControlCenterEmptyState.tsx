import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type ControlCenterEmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function ControlCenterEmptyState({
  title,
  description,
  action,
  icon,
  className,
}: ControlCenterEmptyStateProps) {
  return (
    <div className={cn("cc-empty-state", className)}>
      <div className="cc-empty-state-icon">{icon ?? <Sparkles size={18} />}</div>
      <div className="cc-empty-state-copy">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="cc-empty-state-action">{action}</div> : null}
    </div>
  );
}
