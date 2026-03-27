import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  ControlCenterStatusBadge,
  type ControlCenterStatusTone,
} from "@/components/control-center/ControlCenterStatusBadge";

type ControlCenterCardHeaderProps = {
  eyebrow?: string;
  title: string;
  titleMeta?: ReactNode;
  titleMetaPlacement?: "inline" | "below";
  titleControls?: ReactNode;
  description?: string;
  statusLabel: string;
  statusTone?: ControlCenterStatusTone;
  primaryAction?: ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
};

export function ControlCenterCardHeader({
  eyebrow,
  title,
  titleMeta,
  titleMetaPlacement = "inline",
  titleControls,
  description,
  statusLabel,
  statusTone = "neutral",
  primaryAction,
  collapsible = false,
  expanded = false,
  onToggle,
  className,
}: ControlCenterCardHeaderProps) {
  const canToggle = collapsible && typeof onToggle === "function";
  const headerClassName = [
    "cc-card-header",
    "cc-card-header-structured",
    titleMetaPlacement === "below" ? "is-title-meta-below" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const titleStack = (
    <span className="cc-card-header-title-stack">
      <span className="cc-card-header-title-row">
        <h3 className="cc-step-title-line">{title}</h3>
        {titleMeta && titleMetaPlacement === "inline" ? (
          <span className="cc-card-header-title-meta">{titleMeta}</span>
        ) : null}
        {titleControls ? (
          <span className="cc-card-header-title-controls">{titleControls}</span>
        ) : null}
      </span>
      {titleMeta && titleMetaPlacement === "below" ? (
        <span className="cc-card-header-title-meta is-below">{titleMeta}</span>
      ) : null}
    </span>
  );

  const descriptionNode = description ? (
    <p className="cc-card-header-description">{description}</p>
  ) : null;

  return (
    <header className={headerClassName}>
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
              {titleStack}
              {descriptionNode}
            </span>
            <ChevronRight
              size={14}
              className={`cc-step-collapse-icon ${expanded ? "expanded" : ""}`}
            />
          </button>
        ) : (
          <div className="cc-card-header-static-copy">
            {eyebrow ? <span className="cc-card-header-eyebrow">{eyebrow}</span> : null}
            {titleStack}
            {descriptionNode}
          </div>
        )}
      </div>
      <div className="cc-card-header-actions">
        <ControlCenterStatusBadge tone={statusTone}>{statusLabel}</ControlCenterStatusBadge>
        {primaryAction}
      </div>
    </header>
  );
}
