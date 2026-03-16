import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type CardStatusTone = "neutral" | "success" | "warning" | "danger";

type ControlCenterCardHeaderProps = {
  title: string;
  description: string;
  statusLabel: string;
  statusTone?: CardStatusTone;
  primaryAction?: ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
};

export function ControlCenterCardHeader({
  title,
  description,
  statusLabel,
  statusTone = "neutral",
  primaryAction,
  collapsible = false,
  expanded = false,
  onToggle,
}: ControlCenterCardHeaderProps) {
  const canToggle = collapsible && typeof onToggle === "function";
  return (
    <header className="cc-card-header cc-card-header-structured">
      <div className="cc-card-header-copy">
        {canToggle ? (
          <button
            type="button"
            className="cc-step-title-toggle is-collapsible"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <span className="cc-step-title-copy">
              <h3 className="cc-step-title-line">{title}</h3>
              <p className="cc-step-inline-summary">{description}</p>
            </span>
            <ChevronRight
              size={14}
              className={`cc-step-collapse-icon ${expanded ? "expanded" : ""}`}
            />
          </button>
        ) : (
          <>
            <h3>{title}</h3>
            <p>{description}</p>
          </>
        )}
      </div>
      <div className="cc-card-header-actions">
        <span className={`cc-status-badge tone-${statusTone}`}>{statusLabel}</span>
        {primaryAction}
      </div>
    </header>
  );
}
