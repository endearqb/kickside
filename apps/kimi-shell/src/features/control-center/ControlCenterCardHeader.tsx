import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

type CardStatusTone = "neutral" | "success" | "warning" | "danger";

type ControlCenterCardHeaderProps = {
  eyebrow?: string;
  title: string;
  titleMeta?: ReactNode;
  description?: string;
  statusLabel: string;
  statusTone?: CardStatusTone;
  primaryAction?: ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
};

export function ControlCenterCardHeader({
  eyebrow,
  title,
  titleMeta,
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
              {eyebrow ? <span className="cc-card-header-eyebrow">{eyebrow}</span> : null}
              <span className="cc-card-header-title-row">
                <h3 className="cc-step-title-line">{title}</h3>
                {titleMeta ? <span className="cc-card-header-title-meta">{titleMeta}</span> : null}
              </span>
              {description ? <p className="cc-step-inline-summary">{description}</p> : null}
            </span>
            <ChevronRight
              size={14}
              className={`cc-step-collapse-icon ${expanded ? "expanded" : ""}`}
            />
          </button>
        ) : (
          <div className="cc-card-header-static-copy">
            {eyebrow ? <span className="cc-card-header-eyebrow">{eyebrow}</span> : null}
            <div className="cc-card-header-title-row">
              <h3>{title}</h3>
              {titleMeta ? <span className="cc-card-header-title-meta">{titleMeta}</span> : null}
            </div>
            {description ? <p>{description}</p> : null}
          </div>
        )}
      </div>
      <div className="cc-card-header-actions">
        <span className={`cc-status-badge tone-${statusTone}`} data-tone={statusTone}>
          {statusLabel}
        </span>
        {primaryAction}
      </div>
    </header>
  );
}
